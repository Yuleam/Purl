#!/usr/bin/env node
/**
 * Sense Point MCP Server
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

// ─── MCP Server ───

const server = new McpServer({
  name: 'sense-point-knitting',
  version: '0.1.0',
});

// ═══════════════════════════════════════════
// Resources
// ═══════════════════════════════════════════

server.resource(
  'knitting-metaphor',
  'knitting://metaphor',
  async () => ({
    contents: [{
      uri: 'knitting://metaphor',
      mimeType: 'text/plain',
      text: `Sense Point Knitting Metaphor Guide
====================================

This app uses knitting as a metaphor for connecting information:

FIBER (올) = A caught piece of text from a note
  - Catching a fiber (올 잡기) = Highlighting text that resonates
  - Spinning thread (실 잣기) = Adding your own thought to a fiber
  - Tension (장력, 1-5) = How much a fiber pulls your attention

TONE (결) = The emotional quality of a fiber
  - Resonance (공명) = This resonates with me
  - Friction (마찰) = This creates tension/disagreement
  - Question (물음) = This raises a question

STITCH (코) = A connection between two fibers
  - The user articulates WHY two fibers connect
  - This is the core act of knitting

KNOT (매듭) = An insight that emerges from stitches
  - Ties together multiple stitches
  - Represents higher-level understanding

REPLY (답글) = A comment/annotation on a fiber

BASKET (바구니) = The collection of all fibers

HINT (실마리) = A similar fiber suggested by the hybrid algorithm

PHASES:
  - Casting-on (코잡기) = Early stage, mostly collecting fibers
  - Transition (전환) = Starting to make connections
  - Knitting (뜨개질) = Rich network of connections

PHILOSOPHY:
  "도구는 대신하지 않고 돕는다" — Tools help, they don't replace.
  The user makes all connections. The algorithm only suggests.
  No LLM is used in the app itself.`
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
      text: `Sense Point Database Schema
============================

fibers (올)
  id TEXT PK (prefix: fb_)
  text TEXT — the caught text
  source TEXT — origin URL or label
  source_note_id TEXT — ID of the source note
  source_note_title TEXT — title of the source note
  tension INTEGER 1-5 — attention pull (장력)
  thought TEXT — user's reflection (실 잣기)
  caught_at INTEGER — timestamp when caught
  spun_at INTEGER — timestamp when thought was added
  source_range TEXT (JSON) — highlight position in source
  tone TEXT — resonance|friction|question (결)

stitches (코)
  id TEXT PK (prefix: sc_)
  fiber_a_id TEXT FK -> fibers
  fiber_b_id TEXT FK -> fibers
  why TEXT — reason for connection
  created_at INTEGER

fiber_replies (답글)
  id TEXT PK (prefix: rp_)
  fiber_id TEXT FK -> fibers
  note TEXT
  created_at INTEGER

knots (매듭)
  id TEXT PK (prefix: kn_)
  insight TEXT
  created_at INTEGER

knot_stitches (매듭-코 연결)
  knot_id TEXT FK -> knots
  stitch_id TEXT FK -> stitches`
    }]
  })
);

// ═══════════════════════════════════════════
// Tools (all read-only)
// ═══════════════════════════════════════════

// 1. overview
server.tool(
  'overview',
  '바구니 현황: 올/코/매듭 수, 뜨개질 단계, 결 분포 등 전체 통계',
  {},
  async () => {
    const fiberCount = getOne('SELECT COUNT(*) as cnt FROM fibers', [])?.cnt || 0;
    const stitchCount = getOne('SELECT COUNT(*) as cnt FROM stitches', [])?.cnt || 0;
    const knotCount = getOne('SELECT COUNT(*) as cnt FROM knots', [])?.cnt || 0;
    const replyCount = getOne('SELECT COUNT(*) as cnt FROM fiber_replies', [])?.cnt || 0;
    const spunCount = getOne('SELECT COUNT(*) as cnt FROM fibers WHERE spun_at IS NOT NULL', [])?.cnt || 0;

    const density = fiberCount > 0 ? stitchCount / fiberCount : 0;
    let phase = 'casting-on (코잡기)';
    if (density >= 2.0) phase = 'knitting (뜨개질)';
    else if (density >= 1.0) phase = 'transition (전환)';

    const tones = getAll('SELECT tone, COUNT(*) as cnt FROM fibers GROUP BY tone', []);
    const toneText = tones.map(t => `  ${t.tone || 'resonance'}: ${t.cnt}`).join('\n');

    const tensions = getAll('SELECT tension, COUNT(*) as cnt FROM fibers GROUP BY tension ORDER BY tension', []);
    const tensionText = tensions.map(t => `  장력 ${t.tension}: ${t.cnt}`).join('\n');

    const sources = getAll(
      "SELECT source_note_title, COUNT(*) as cnt FROM fibers WHERE source_note_title != '' GROUP BY source_note_title ORDER BY cnt DESC LIMIT 10",
      []
    );
    const sourceText = sources.length
      ? sources.map(s => `  ${s.source_note_title}: ${s.cnt}개`).join('\n')
      : '  (없음)';

    const text = `바구니 현황 (Basket Overview)
==============================
올 (fibers): ${fiberCount}개 (실 잣은 올: ${spunCount}개)
코 (stitches): ${stitchCount}개
매듭 (knots): ${knotCount}개
답글 (replies): ${replyCount}개

단계 (phase): ${phase}
밀도 (density): ${density.toFixed(2)} (코 수 / 올 수)

결 분포 (tone):
${toneText || '  (없음)'}

장력 분포 (tension):
${tensionText || '  (없음)'}

출처 상위 10:
${sourceText}

임베딩 모델: ${isReady() ? 'Ready (KR-SBERT-V40K)' : 'Loading... (find_similar_fibers 아직 사용 불가)'}`;

    return { content: [{ type: 'text', text }] };
  }
);

// 2. list_fibers
server.tool(
  'list_fibers',
  '올 목록 조회. 올(fiber)은 사용자가 노트에서 잡은(올 잡기) 텍스트 조각. 정렬/페이지네이션 가능.',
  {
    sort: z.enum(['caught_at', 'tension', 'spun_at']).optional()
      .describe('정렬 기준. caught_at=잡은 시간, tension=장력, spun_at=실 잣은 시간'),
    order: z.enum(['ASC', 'DESC']).optional()
      .describe('정렬 방향 (기본: DESC)'),
    limit: z.number().min(1).max(100).optional()
      .describe('반환할 올 수 (기본 20, 최대 100)'),
    offset: z.number().min(0).optional()
      .describe('페이지네이션 오프셋 (기본 0)'),
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
      return { content: [{ type: 'text', text: '바구니가 비어있습니다. 아직 잡은 올이 없습니다.' }] };
    }

    const lines = fibers.map((f, i) => {
      const spun = f.spun_at ? 'Spun' : 'Unspun';
      const tone = f.tone || 'resonance';
      return `${off + i + 1}. [${f.id}] "${truncate(f.text, 60)}"
   결: ${tone} | 장력: ${f.tension} | ${spun} | 출처: ${f.source_note_title || '-'}
   잡은 시간: ${formatDate(f.caught_at)}`;
    });

    const text = `올 목록 (${off + 1}-${off + fibers.length} / ${total})\n${'='.repeat(40)}\n\n${lines.join('\n\n')}`;
    return { content: [{ type: 'text', text }] };
  }
);

// 3. get_fiber
server.tool(
  'get_fiber',
  '올 상세 조회. 텍스트, 생각(실 잣기), 답글, 출처 정보 포함.',
  {
    fiber_id: z.string().describe('올 ID (예: fb_xxxxx)'),
  },
  async ({ fiber_id }) => {
    const fiber = getOne('SELECT * FROM fibers WHERE id = ?', [fiber_id]);
    if (!fiber) {
      return { content: [{ type: 'text', text: `올을 찾을 수 없습니다: ${fiber_id}` }], isError: true };
    }

    const replies = getAll(
      'SELECT * FROM fiber_replies WHERE fiber_id = ? ORDER BY created_at ASC',
      [fiber_id]
    );

    const stitchCount = getOne(
      'SELECT COUNT(*) as cnt FROM stitches WHERE fiber_a_id = ? OR fiber_b_id = ?',
      [fiber_id, fiber_id]
    )?.cnt || 0;

    const repliesText = replies.length
      ? replies.map((r, i) => `  ${i + 1}. [${r.id}] ${r.note} (${formatDate(r.created_at)})`).join('\n')
      : '  (없음)';

    const text = `올 상세 [${fiber.id}]
${'='.repeat(40)}
텍스트: ${fiber.text}

생각 (실 잣기): ${fiber.thought || '(아직 실을 잣지 않음)'}

결 (tone): ${fiber.tone || 'resonance'}
장력 (tension): ${fiber.tension}
출처: ${fiber.source_note_title || '-'}${fiber.source ? ` (${fiber.source})` : ''}
잡은 시간: ${formatDate(fiber.caught_at)}
실 잣은 시간: ${formatDate(fiber.spun_at)}
연결된 코 수: ${stitchCount}

답글 (${replies.length}개):
${repliesText}`;

    return { content: [{ type: 'text', text }] };
  }
);

// 4. search_fibers
server.tool(
  'search_fibers',
  '올 키워드 검색. 텍스트, 생각, 출처 제목에서 키워드로 검색. 의미 유사도 검색은 find_similar_fibers를 사용.',
  {
    query: z.string().describe('검색할 키워드'),
    tone: z.enum(['resonance', 'friction', 'question']).optional()
      .describe('결 필터: resonance(공명), friction(마찰), question(물음)'),
    limit: z.number().min(1).max(50).optional()
      .describe('최대 결과 수 (기본 20)'),
  },
  async ({ query, tone, limit }) => {
    const lim = limit || 20;
    const pattern = `%${query}%`;
    let sql = 'SELECT * FROM fibers WHERE (text LIKE ? OR thought LIKE ? OR source_note_title LIKE ?)';
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
   결: ${f.tone || 'resonance'} | 장력: ${f.tension} | 출처: ${f.source_note_title || '-'}`;
    });

    const text = `"${query}" 검색 결과 (${fibers.length}개)\n${'='.repeat(40)}\n\n${lines.join('\n\n')}`;
    return { content: [{ type: 'text', text }] };
  }
);

// 5. find_similar_fibers
server.tool(
  'find_similar_fibers',
  '유사 올 찾기 (하이브리드 스코어링). 3가지 신호: 임베딩 유사도(의미), 그래프 근접도(사용자의 연결 패턴), 답글 유사도(사용자의 해석). 결 대비 보너스 포함.',
  {
    fiber_id: z.string().describe('유사 올을 찾을 대상 올 ID'),
  },
  async ({ fiber_id }) => {
    if (!isReady()) {
      return {
        content: [{ type: 'text', text: '임베딩 모델이 아직 로딩 중입니다 (~30초). 잠시 후 다시 시도해주세요.' }],
      };
    }

    const target = getOne('SELECT * FROM fibers WHERE id = ?', [fiber_id]);
    if (!target) {
      return { content: [{ type: 'text', text: `올을 찾을 수 없습니다: ${fiber_id}` }], isError: true };
    }

    const result = findSimilarFibers(fiber_id);

    if (!result.hints.length) {
      return {
        content: [{
          type: 'text',
          text: `[${fiber_id}] "${truncate(target.text, 40)}"의 유사 올이 없습니다.\n단계: ${result.phase} | 밀도: ${result.density.toFixed(2)}`
        }],
      };
    }

    const lines = result.hints.map((h, i) => {
      return `${i + 1}. [${h.id}] "${truncate(h.text, 60)}"
   유사도: ${h.similarity}% | 결: ${h.tone || 'resonance'} | 장력: ${h.tension}
   신호: 임베딩 ${h.signals.embedding}% | 그래프 ${h.signals.graph}% | 답글 ${h.signals.reply}% | 결대비 ${h.signals.tone}%
   생각: ${truncate(h.thought, 50) || '(없음)'}`;
    });

    const text = `유사 올 (대상: "${truncate(target.text, 40)}")
단계: ${result.phase} | 밀도: ${result.density.toFixed(2)}
${'='.repeat(40)}

${lines.join('\n\n')}`;

    return { content: [{ type: 'text', text }] };
  }
);

// 6. list_stitches
server.tool(
  'list_stitches',
  '코(stitch) 목록 조회. 코는 사용자가 두 올 사이에 만든 연결로, why 필드에 연결 이유가 있음.',
  {
    fiber_id: z.string().optional()
      .describe('특정 올과 연결된 코만 조회 (생략 시 전체)'),
    limit: z.number().min(1).max(100).optional()
      .describe('최대 결과 수 (기본 50)'),
  },
  async ({ fiber_id, limit }) => {
    const lim = limit || 50;
    let stitches;

    if (fiber_id) {
      stitches = getAll(
        'SELECT * FROM stitches WHERE fiber_a_id = ? OR fiber_b_id = ? ORDER BY created_at DESC LIMIT ?',
        [fiber_id, fiber_id, lim]
      );
    } else {
      stitches = getAll('SELECT * FROM stitches ORDER BY created_at DESC LIMIT ?', [lim]);
    }

    if (!stitches.length) {
      return { content: [{ type: 'text', text: fiber_id ? `이 올에 연결된 코가 없습니다: ${fiber_id}` : '아직 만든 코가 없습니다.' }] };
    }

    const lines = stitches.map((s, i) => {
      const fiberA = getOne('SELECT id, text, tone, tension FROM fibers WHERE id = ?', [s.fiber_a_id]);
      const fiberB = getOne('SELECT id, text, tone, tension FROM fibers WHERE id = ?', [s.fiber_b_id]);
      return `${i + 1}. [${s.id}] ${formatDate(s.created_at)}
   올A: [${s.fiber_a_id}] "${truncate(fiberA?.text, 40)}"
   올B: [${s.fiber_b_id}] "${truncate(fiberB?.text, 40)}"
   이유: ${s.why || '(기록 없음)'}`;
    });

    const header = fiber_id ? `올 [${fiber_id}]의 코 목록` : '코 목록';
    const text = `${header} (${stitches.length}개)\n${'='.repeat(40)}\n\n${lines.join('\n\n')}`;
    return { content: [{ type: 'text', text }] };
  }
);

// 7. list_knots
server.tool(
  'list_knots',
  '매듭(knot) 목록 조회. 매듭은 코들을 묶어 기록한 통찰/인사이트.',
  {
    limit: z.number().min(1).max(50).optional()
      .describe('최대 결과 수 (기본 20)'),
  },
  async ({ limit }) => {
    const lim = limit || 20;
    const knots = getAll('SELECT * FROM knots ORDER BY created_at DESC LIMIT ?', [lim]);

    if (!knots.length) {
      return { content: [{ type: 'text', text: '아직 만든 매듭이 없습니다.' }] };
    }

    const lines = knots.map((k, i) => {
      const links = getAll('SELECT stitch_id FROM knot_stitches WHERE knot_id = ?', [k.id]);
      return `${i + 1}. [${k.id}] "${truncate(k.insight, 60)}"
   코 ${links.length}개 연결 | ${formatDate(k.created_at)}`;
    });

    const text = `매듭 목록 (${knots.length}개)\n${'='.repeat(40)}\n\n${lines.join('\n\n')}`;
    return { content: [{ type: 'text', text }] };
  }
);

// 8. get_knot
server.tool(
  'get_knot',
  '매듭 상세 조회. 통찰 텍스트와 연결된 모든 코, 그리고 각 코가 연결한 올들의 전체 맥락 포함.',
  {
    knot_id: z.string().describe('매듭 ID (예: kn_xxxxx)'),
  },
  async ({ knot_id }) => {
    const knot = getOne('SELECT * FROM knots WHERE id = ?', [knot_id]);
    if (!knot) {
      return { content: [{ type: 'text', text: `매듭을 찾을 수 없습니다: ${knot_id}` }], isError: true };
    }

    const links = getAll('SELECT stitch_id FROM knot_stitches WHERE knot_id = ?', [knot_id]);

    const stitchDetails = [];
    for (const link of links) {
      const stitch = getOne('SELECT * FROM stitches WHERE id = ?', [link.stitch_id]);
      if (!stitch) continue;
      const fiberA = getOne('SELECT id, text, tone, tension, thought FROM fibers WHERE id = ?', [stitch.fiber_a_id]);
      const fiberB = getOne('SELECT id, text, tone, tension, thought FROM fibers WHERE id = ?', [stitch.fiber_b_id]);
      stitchDetails.push({ stitch, fiberA, fiberB });
    }

    const stitchLines = stitchDetails.map((d, i) => {
      return `  코 ${i + 1}: [${d.stitch.id}]
    올A: [${d.fiberA?.id}] "${truncate(d.fiberA?.text, 50)}" (${d.fiberA?.tone}, 장력:${d.fiberA?.tension})
      생각: ${truncate(d.fiberA?.thought, 50) || '(없음)'}
    올B: [${d.fiberB?.id}] "${truncate(d.fiberB?.text, 50)}" (${d.fiberB?.tone}, 장력:${d.fiberB?.tension})
      생각: ${truncate(d.fiberB?.thought, 50) || '(없음)'}
    연결 이유: ${d.stitch.why || '(기록 없음)'}`;
    });

    const text = `매듭 상세 [${knot.id}]
${'='.repeat(40)}
통찰: ${knot.insight}
생성: ${formatDate(knot.created_at)}

연결된 코 (${stitchDetails.length}개):
${stitchLines.join('\n\n') || '  (없음)'}`;

    return { content: [{ type: 'text', text }] };
  }
);

// ═══════════════════════════════════════════
// Note Tools
// ═══════════════════════════════════════════

function _noteContentText(note) {
  if (!note) return '';
  if (note.type === 'template' && note.answers) {
    const answers = typeof note.answers === 'string' ? JSON.parse(note.answers) : note.answers;
    const labels = { q1: '인상 깊었던 것', q2: '의미', q3: '느낌/감각', q4: '배운 것', q5: '내일 시도할 것' };
    return Object.entries(answers)
      .filter(([, v]) => v)
      .map(([k, v]) => `[${labels[k] || k}] ${v}`)
      .join('\n');
  }
  return note.content || '';
}

// 9. list_notes
server.tool(
  'list_notes',
  '노트 목록 조회. 노트는 사용자가 작성한 원본 문서로, 올(fiber)이 잡히는 출처.',
  {
    limit: z.number().min(1).max(100).optional()
      .describe('반환할 노트 수 (기본 20)'),
    offset: z.number().min(0).optional()
      .describe('페이지네이션 오프셋 (기본 0)'),
  },
  async ({ limit, offset }) => {
    const lim = limit || 20;
    const off = offset || 0;

    const total = getOne('SELECT COUNT(*) as cnt FROM notes', [])?.cnt || 0;
    const notesList = getAll(
      'SELECT * FROM notes ORDER BY updated_at DESC LIMIT ? OFFSET ?',
      [lim, off]
    );

    if (!notesList.length) {
      return { content: [{ type: 'text', text: '아직 작성한 노트가 없습니다.' }] };
    }

    const lines = notesList.map((n, i) => {
      const typeLabel = n.type === 'template' ? '양식지' : '무지';
      const preview = truncate(_noteContentText(n), 60);
      return `${off + i + 1}. [${n.id}] "${n.title || '제목 없음'}" (${typeLabel})
   미리보기: ${preview || '(내용 없음)'}
   수정: ${formatDate(n.updated_at)}`;
    });

    const text = `노트 목록 (${off + 1}-${off + notesList.length} / ${total})\n${'='.repeat(40)}\n\n${lines.join('\n\n')}`;
    return { content: [{ type: 'text', text }] };
  }
);

// 10. get_note
server.tool(
  'get_note',
  '노트 상세 조회. 전체 내용 포함. 이 노트에서 잡힌 올(fiber) 목록도 함께 반환.',
  {
    note_id: z.string().describe('노트 ID'),
  },
  async ({ note_id }) => {
    const note = getOne('SELECT * FROM notes WHERE id = ?', [note_id]);
    if (!note) {
      return { content: [{ type: 'text', text: `노트를 찾을 수 없습니다: ${note_id}` }], isError: true };
    }

    const typeLabel = note.type === 'template' ? '양식지' : '무지';
    const contentText = _noteContentText(note);

    // 이 노트에서 잡힌 올 조회
    const fibers = getAll(
      'SELECT id, text, tone, tension, caught_at FROM fibers WHERE source_note_id = ? ORDER BY caught_at ASC',
      [note_id]
    );

    const fibersText = fibers.length
      ? fibers.map((f, i) => `  ${i + 1}. [${f.id}] "${truncate(f.text, 50)}" (${f.tone}, 장력:${f.tension})`).join('\n')
      : '  (이 노트에서 잡힌 올 없음)';

    const text = `노트 상세 [${note.id}]
${'='.repeat(40)}
제목: ${note.title || '제목 없음'}
유형: ${typeLabel}
생성: ${formatDate(note.created_at)}
수정: ${formatDate(note.updated_at)}

내용:
${contentText || '(내용 없음)'}

이 노트에서 잡힌 올 (${fibers.length}개):
${fibersText}`;

    return { content: [{ type: 'text', text }] };
  }
);

// 11. search_notes
server.tool(
  'search_notes',
  '노트 키워드 검색. 제목과 내용에서 키워드로 검색.',
  {
    query: z.string().describe('검색할 키워드'),
    limit: z.number().min(1).max(50).optional()
      .describe('최대 결과 수 (기본 20)'),
  },
  async ({ query, limit }) => {
    const lim = limit || 20;
    const pattern = `%${query}%`;

    const notesList = getAll(
      'SELECT * FROM notes WHERE title LIKE ? OR content LIKE ? OR answers LIKE ? ORDER BY updated_at DESC LIMIT ?',
      [pattern, pattern, pattern, lim]
    );

    if (!notesList.length) {
      return { content: [{ type: 'text', text: `"${query}" 노트 검색 결과가 없습니다.` }] };
    }

    const lines = notesList.map((n, i) => {
      const typeLabel = n.type === 'template' ? '양식지' : '무지';
      const preview = truncate(_noteContentText(n), 60);
      return `${i + 1}. [${n.id}] "${n.title || '제목 없음'}" (${typeLabel})
   미리보기: ${preview || '(내용 없음)'}`;
    });

    const text = `"${query}" 노트 검색 결과 (${notesList.length}개)\n${'='.repeat(40)}\n\n${lines.join('\n\n')}`;
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

  // 백그라운드: 임베딩 모델 로드 (find_similar_fibers용)
  initEmbedder()
    .then(() => console.error('[mcp] Embedder model loaded — find_similar_fibers ready.'))
    .catch(err => console.error('[mcp] Embedder failed:', err.message));
}

main().catch(err => {
  console.error('[mcp] Fatal error:', err);
  process.exit(1);
});
