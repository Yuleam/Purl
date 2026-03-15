#!/usr/bin/env node
/**
 * 뜨개질 MCP Server
 *
 * Claude Desktop/Code가 뜨개질 데이터를 탐색할 수 있게 하는 MCP 서버.
 * 읽기 전용 (프로젝트 철학: 도구는 대신하지 않고 돕는다).
 *
 * Transport: stdio (stdout은 JSON-RPC 전용 — 모든 로그는 stderr로)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createRequire } from 'node:module';

// stdout 보호: import된 CommonJS 모듈의 console.log가 MCP 프로토콜을 오염시키지 않도록
console.log = console.error;

const require = createRequire(import.meta.url);
const { initDB, getOne, getAll } = require('./db.js');
const { findSimilarFibers } = require('./services/hint.js');
const { initEmbedder, isReady } = require('./services/embedder.js');

// ─── Helpers ───

function formatDate(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function truncate(str, max = 80) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '...' : str;
}

function relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const days = Math.floor(diff / 86400000);
  if (days === 0) return '오늘';
  if (days === 1) return '어제';
  if (days < 7) return `${days}일 전`;
  if (days < 30) return `${Math.floor(days / 7)}주 전`;
  if (days < 365) return `${Math.floor(days / 30)}달 전`;
  return `${Math.floor(days / 365)}년 전`;
}

const TONE_LABEL = { positive: 'Positive', critic: 'Critic', hold: 'Hold' };

// ─── MCP Server ───

const server = new McpServer({
  name: 'knitting',
  version: '0.2.0',
});

// ═══════════════════════════════════════════
// Resources
// ═══════════════════════════════════════════

server.resource(
  'knitting-guide',
  'knitting://guide',
  async () => ({
    contents: [{
      uri: 'knitting://guide',
      mimeType: 'text/plain',
      text: `뜨개질 — 다시 만나기 위한 도구
====================================

이 도구의 가치는 잡는 순간이 아니라, 다시 만나는 순간에 발생한다.

핵심 개념 (4개):

조각 (fiber) = 잡은 문장 + 그 순간의 반응
  - 감도 (1~100) = 얼마나 강하게 반응했는가
  - 방향성 = Positive / Critic / Hold
  - 생각(thought) = 그때 든 생각
  - 출처(source) = 어디서 잡았는가

연결 (link) = 2개 이상의 조각이 닿아있다 + 왜
  - why = 사용자가 느낀 연결의 이유

만남 (encounter) = 과거 조각과의 재회
  - 확률적 리서페이싱 (Readwise 모델 차용)
  - 오래 안 본 조각, 최근 잡은 조각, 높은 감도 → 높은 가중치

궤적 (trail) = 내 조각들의 시간적 흐름
  - 시간순 시각화 (색=방향성, 크기=감도)

원칙:
  "가볍게 잡는다 / 다시 만나게 한다 / 대신하지 않는다"
  도구는 판정하지 않고 조용히 놓아둔다. 깨달음은 사용자에게서 나온다.
  LLM은 어떤 경우에도 사용하지 않는다.`
    }]
  })
);

server.resource(
  'knitting-schema',
  'knitting://schema',
  async () => ({
    contents: [{
      uri: 'knitting://schema',
      mimeType: 'text/plain',
      text: `뜨개질 Database Schema
============================

fibers (조각)
  id TEXT PK (prefix: fb_)
  text TEXT — 잡은 문장
  source TEXT — 출처 URL 또는 레이블
  tension INTEGER 1-5 — 감도 (UI에서는 ×20 → 1~100)
  thought TEXT — 그때 든 생각
  caught_at INTEGER — 잡은 시점
  tone TEXT — positive|critic|hold (방향성)

fiber_replies (답글)
  id TEXT PK (prefix: rp_)
  fiber_id TEXT FK -> fibers
  note TEXT
  created_at INTEGER

links (연결)
  id TEXT PK (prefix: lk_)
  why TEXT — 연결 이유
  created_at INTEGER

link_members (연결의 멤버)
  link_id TEXT FK -> links
  fiber_id TEXT FK -> fibers
  sort_order INTEGER
  PK (link_id, fiber_id)

encounters (만남 기록)
  id INTEGER PK
  fiber_id TEXT FK -> fibers
  encountered_at INTEGER

fiber_embeddings (임베딩 — 주변부 보조용)
  fiber_id TEXT PK FK -> fibers
  embedding TEXT (JSON)`
    }]
  })
);

// ═══════════════════════════════════════════
// Tools (all read-only)
// ═══════════════════════════════════════════

// 1. overview
server.tool(
  'overview',
  '전체 현황: 조각/연결/만남 수, 뜨개질 단계, 방향성 분포 등 통계',
  {},
  async () => {
    const fiberCount = getOne('SELECT COUNT(*) as cnt FROM fibers', [])?.cnt || 0;
    const linkCount = getOne('SELECT COUNT(*) as cnt FROM links', [])?.cnt || 0;
    const encounterCount = getOne('SELECT COUNT(*) as cnt FROM encounters', [])?.cnt || 0;
    const replyCount = getOne('SELECT COUNT(*) as cnt FROM fiber_replies', [])?.cnt || 0;

    const density = fiberCount > 0 ? linkCount / fiberCount : 0;
    let phase = 'casting-on (코잡기)';
    if (density >= 2.0) phase = 'knitting (뜨개질)';
    else if (density >= 1.0) phase = 'transition (전환)';

    const tones = getAll('SELECT tone, COUNT(*) as cnt FROM fibers GROUP BY tone', []);
    const toneText = tones.map(t => `  ${TONE_LABEL[t.tone] || 'Positive'}: ${t.cnt}`).join('\n');

    const text = `뜨개질 현황
==============================
조각 (fibers): ${fiberCount}개
연결 (links): ${linkCount}개
만남 (encounters): ${encounterCount}회
답글 (replies): ${replyCount}개

단계 (phase): ${phase}
밀도 (density): ${density.toFixed(2)} (연결 수 / 조각 수)

방향성 분포:
${toneText || '  (없음)'}

임베딩 모델: ${isReady() ? 'Ready (KR-SBERT-V40K)' : 'Loading...'}`;

    return { content: [{ type: 'text', text }] };
  }
);

// 2. list_fibers
server.tool(
  'list_fibers',
  '조각 목록 조회. 정렬/페이지네이션 가능.',
  {
    sort: z.enum(['caught_at', 'tension']).optional()
      .describe('정렬 기준 (기본: caught_at)'),
    order: z.enum(['ASC', 'DESC']).optional()
      .describe('정렬 방향 (기본: DESC)'),
    limit: z.number().min(1).max(100).optional()
      .describe('반환할 조각 수 (기본 20)'),
    offset: z.number().min(0).optional()
      .describe('오프셋 (기본 0)'),
  },
  async ({ sort, order, limit, offset }) => {
    const s = sort || 'caught_at';
    const o = order || 'DESC';
    const lim = limit || 20;
    const off = offset || 0;

    const total = getOne('SELECT COUNT(*) as cnt FROM fibers', [])?.cnt || 0;
    const fibers = getAll(
      `SELECT * FROM fibers ORDER BY ${s} ${o} LIMIT ? OFFSET ?`,
      [lim, off]
    );

    if (!fibers.length) {
      return { content: [{ type: 'text', text: '아직 잡은 조각이 없습니다.' }] };
    }

    const lines = fibers.map((f, i) => {
      const tone = TONE_LABEL[f.tone] || 'Positive';
      const sensitivity = (f.tension || 3) * 20;
      return `${off + i + 1}. [${f.id}] "${truncate(f.text, 60)}"
   ${tone} | 감도 ${sensitivity} | ${relativeTime(f.caught_at)}`;
    });

    const text = `조각 목록 (${off + 1}-${off + fibers.length} / ${total})\n${'='.repeat(40)}\n\n${lines.join('\n\n')}`;
    return { content: [{ type: 'text', text }] };
  }
);

// 3. get_fiber
server.tool(
  'get_fiber',
  '조각 상세 조회. 텍스트, 생각, 연결, 답글 포함.',
  {
    fiber_id: z.string().describe('조각 ID (예: fb_xxxxx)'),
  },
  async ({ fiber_id }) => {
    const fiber = getOne('SELECT * FROM fibers WHERE id = ?', [fiber_id]);
    if (!fiber) {
      return { content: [{ type: 'text', text: `조각을 찾을 수 없습니다: ${fiber_id}` }], isError: true };
    }

    const replies = getAll(
      'SELECT * FROM fiber_replies WHERE fiber_id = ? ORDER BY created_at ASC',
      [fiber_id]
    );

    const links = getAll(
      `SELECT l.id, l.why, l.created_at FROM links l
       JOIN link_members lm ON l.id = lm.link_id
       WHERE lm.fiber_id = ?`,
      [fiber_id]
    );

    const sensitivity = (fiber.tension || 3) * 20;
    const repliesText = replies.length
      ? replies.map((r, i) => `  ${i + 1}. [${r.id}] ${r.note} (${formatDate(r.created_at)})`).join('\n')
      : '  (없음)';

    const linksText = links.length
      ? links.map((l, i) => {
          const members = getAll(
            `SELECT f.id, f.text FROM link_members lm
             JOIN fibers f ON f.id = lm.fiber_id
             WHERE lm.link_id = ? AND lm.fiber_id != ?`,
            [l.id, fiber_id]
          );
          const memberList = members.map(m => `"${truncate(m.text, 40)}"`).join(', ');
          return `  ${i + 1}. [${l.id}] ${l.why || '(이유 없음)'}\n     → ${memberList}`;
        }).join('\n')
      : '  (없음)';

    const text = `조각 상세 [${fiber.id}]
${'='.repeat(40)}
텍스트: ${fiber.text}

생각: ${fiber.thought || '(없음)'}

방향성: ${TONE_LABEL[fiber.tone] || 'Positive'}
감도: ${sensitivity}
출처: ${fiber.source || '-'}
잡은 시간: ${formatDate(fiber.caught_at)} (${relativeTime(fiber.caught_at)})

연결 (${links.length}개):
${linksText}

답글 (${replies.length}개):
${repliesText}`;

    return { content: [{ type: 'text', text }] };
  }
);

// 4. search_fibers
server.tool(
  'search_fibers',
  '조각 키워드 검색. 텍스트, 생각, 출처에서 검색.',
  {
    query: z.string().describe('검색할 키워드'),
    tone: z.enum(['positive', 'critic', 'hold']).optional()
      .describe('방향성 필터'),
    limit: z.number().min(1).max(50).optional()
      .describe('최대 결과 수 (기본 20)'),
  },
  async ({ query, tone, limit }) => {
    const lim = limit || 20;
    const pattern = `%${query}%`;
    let sql = 'SELECT * FROM fibers WHERE (text LIKE ? OR thought LIKE ? OR source LIKE ?)';
    const params = [pattern, pattern, pattern];

    if (tone) {
      sql += ' AND tone = ?';
      params.push(tone);
    }
    sql += ' ORDER BY caught_at DESC LIMIT ?';
    params.push(lim);

    const fibers = getAll(sql, params);

    if (!fibers.length) {
      return { content: [{ type: 'text', text: `"${query}" 검색 결과가 없습니다.` }] };
    }

    const lines = fibers.map((f, i) => {
      return `${i + 1}. [${f.id}] "${truncate(f.text, 60)}"
   ${TONE_LABEL[f.tone] || 'Positive'} | 감도 ${(f.tension || 3) * 20} | ${relativeTime(f.caught_at)}`;
    });

    const text = `"${query}" 검색 결과 (${fibers.length}개)\n${'='.repeat(40)}\n\n${lines.join('\n\n')}`;
    return { content: [{ type: 'text', text }] };
  }
);

// 5. find_similar_fibers
server.tool(
  'find_similar_fibers',
  '유사 조각 찾기 (하이브리드 스코어링). 임베딩 유사도 + 그래프 근접도 + 답글 유사도.',
  {
    fiber_id: z.string().describe('대상 조각 ID'),
  },
  async ({ fiber_id }) => {
    if (!isReady()) {
      return {
        content: [{ type: 'text', text: '임베딩 모델이 아직 로딩 중입니다. 잠시 후 다시 시도해주세요.' }],
      };
    }

    const target = getOne('SELECT * FROM fibers WHERE id = ?', [fiber_id]);
    if (!target) {
      return { content: [{ type: 'text', text: `조각을 찾을 수 없습니다: ${fiber_id}` }], isError: true };
    }

    const result = findSimilarFibers(fiber_id);

    if (!result.hints.length) {
      return {
        content: [{
          type: 'text',
          text: `[${fiber_id}] "${truncate(target.text, 40)}"의 유사 조각이 없습니다.\n단계: ${result.phase} | 밀도: ${result.density.toFixed(2)}`
        }],
      };
    }

    const lines = result.hints.map((h, i) => {
      return `${i + 1}. [${h.id}] "${truncate(h.text, 60)}"
   유사도: ${h.similarity}% | ${TONE_LABEL[h.tone] || 'Positive'} | 감도 ${(h.tension || 3) * 20}
   신호: 임베딩 ${h.signals.embedding}% | 그래프 ${h.signals.graph}% | 답글 ${h.signals.reply}% | 결대비 ${h.signals.tone}%`;
    });

    const text = `유사 조각 (대상: "${truncate(target.text, 40)}")
단계: ${result.phase} | 밀도: ${result.density.toFixed(2)}
${'='.repeat(40)}

${lines.join('\n\n')}`;

    return { content: [{ type: 'text', text }] };
  }
);

// 6. list_links
server.tool(
  'list_links',
  '연결 목록 조회. 특정 조각의 연결만 필터 가능.',
  {
    fiber_id: z.string().optional()
      .describe('특정 조각이 포함된 연결만 조회'),
    limit: z.number().min(1).max(100).optional()
      .describe('최대 결과 수 (기본 50)'),
  },
  async ({ fiber_id, limit }) => {
    const lim = limit || 50;
    let linksList;

    if (fiber_id) {
      linksList = getAll(
        `SELECT DISTINCT l.* FROM links l
         JOIN link_members lm ON l.id = lm.link_id
         WHERE lm.fiber_id = ?
         ORDER BY l.created_at DESC LIMIT ?`,
        [fiber_id, lim]
      );
    } else {
      linksList = getAll('SELECT * FROM links ORDER BY created_at DESC LIMIT ?', [lim]);
    }

    if (!linksList.length) {
      return { content: [{ type: 'text', text: fiber_id ? '이 조각의 연결이 없습니다.' : '아직 만든 연결이 없습니다.' }] };
    }

    const lines = linksList.map((l, i) => {
      const members = getAll(
        `SELECT f.id, f.text, f.tone FROM link_members lm
         JOIN fibers f ON f.id = lm.fiber_id
         WHERE lm.link_id = ?`,
        [l.id]
      );
      const memberLines = members.map((m, j) =>
        `   조각${j + 1}: [${m.id}] "${truncate(m.text, 40)}"`
      ).join('\n');
      return `${i + 1}. [${l.id}] ${relativeTime(l.created_at)}
${memberLines}
   왜: ${l.why || '(기록 없음)'}`;
    });

    const header = fiber_id ? `조각 [${fiber_id}]의 연결` : '연결 목록';
    const text = `${header} (${linksList.length}개)\n${'='.repeat(40)}\n\n${lines.join('\n\n')}`;
    return { content: [{ type: 'text', text }] };
  }
);

// 7. get_encounter
server.tool(
  'get_encounter',
  '만남 조각 1개를 확률적으로 선택. 앱의 만남 탭과 같은 알고리즘.',
  {},
  async () => {
    const fibers = getAll('SELECT * FROM fibers ORDER BY caught_at DESC', []);
    if (!fibers.length) {
      return { content: [{ type: 'text', text: '아직 잡은 조각이 없습니다.' }] };
    }

    // 가중치 계산 (만남 알고리즘)
    const now = Date.now();
    const weights = fibers.map(f => {
      let w = 1.0;
      const lastEncounter = getOne(
        'SELECT encountered_at FROM encounters WHERE fiber_id = ? ORDER BY encountered_at DESC LIMIT 1',
        [f.id]
      );
      if (!lastEncounter) {
        w *= 3.0;
      } else {
        const daysSince = (now - lastEncounter.encountered_at) / 86400000;
        w *= (Math.log(daysSince + 1) + 1);
      }
      const daysSinceCaught = (now - (f.caught_at || 0)) / 86400000;
      if (daysSinceCaught <= 7) w *= 1.5;
      const sensitivity = (f.tension || 3) * 20;
      w *= (1 + sensitivity / 200);
      return { fiber: f, weight: w };
    });

    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
    let rand = Math.random() * totalWeight;
    let selected = weights[0].fiber;
    for (const w of weights) {
      rand -= w.weight;
      if (rand <= 0) { selected = w.fiber; break; }
    }

    const sensitivity = (selected.tension || 3) * 20;
    const text = `만남 조각
${'='.repeat(40)}
"${selected.text}"

방향성: ${TONE_LABEL[selected.tone] || 'Positive'}
감도: ${sensitivity}
생각: ${selected.thought || '(없음)'}
출처: ${selected.source || '-'}
잡은 시간: ${formatDate(selected.caught_at)} (${relativeTime(selected.caught_at)})
ID: ${selected.id}`;

    return { content: [{ type: 'text', text }] };
  }
);

// 8. get_trail
server.tool(
  'get_trail',
  '궤적 조회. 기간 내 조각 목록 + 요약 통계.',
  {
    days: z.number().min(1).max(365).optional()
      .describe('최근 N일 (기본 30)'),
  },
  async ({ days }) => {
    const d = days || 30;
    const from = Date.now() - d * 86400000;

    const fibers = getAll(
      'SELECT * FROM fibers WHERE caught_at >= ? ORDER BY caught_at DESC',
      [from]
    );

    if (!fibers.length) {
      return { content: [{ type: 'text', text: `최근 ${d}일간 잡은 조각이 없습니다.` }] };
    }

    const positive = fibers.filter(f => (f.tone || 'positive') === 'positive').length;
    const critic = fibers.filter(f => f.tone === 'critic').length;
    const hold = fibers.filter(f => f.tone === 'hold').length;
    const avgSensitivity = Math.round(fibers.reduce((sum, f) => sum + (f.tension || 3) * 20, 0) / fibers.length);

    // 날짜별 그룹
    const byDate = {};
    fibers.forEach(f => {
      const dateStr = new Date(f.caught_at).toLocaleDateString('ko-KR');
      if (!byDate[dateStr]) byDate[dateStr] = [];
      byDate[dateStr].push(f);
    });

    const dateLines = Object.entries(byDate).map(([date, fs]) => {
      const dots = fs.map(f => {
        const tone = f.tone || 'positive';
        return tone === 'positive' ? '●' : tone === 'critic' ? '◆' : '◇';
      }).join('');
      return `  ${date}: ${dots} (${fs.length}개)`;
    }).join('\n');

    const text = `궤적 — 최근 ${d}일
${'='.repeat(40)}
조각 ${fibers.length}개
Positive ${positive} · Critic ${critic} · Hold ${hold}
평균 감도 ${avgSensitivity}

${dateLines}`;

    return { content: [{ type: 'text', text }] };
  }
);

// ═══════════════════════════════════════════
// Startup
// ═══════════════════════════════════════════

async function main() {
  console.error('[mcp] Initializing database...');
  await initDB();
  console.error('[mcp] Database ready.');

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[mcp] MCP server connected via stdio.');

  // 백그라운드: 임베딩 모델 로드
  initEmbedder()
    .then(() => console.error('[mcp] Embedder model loaded — find_similar_fibers ready.'))
    .catch(err => console.error('[mcp] Embedder failed:', err.message));
}

main().catch(err => {
  console.error('[mcp] Fatal error:', err);
  process.exit(1);
});
