/**
 * Hint Service — 하이브리드 스코어링 기반 유사 올 찾기
 *
 * 3가지 신호:
 *   1. 임베딩 유사도 — 표면적 의미 비교 (바닥 깔개)
 *   2. 그래프 근접도 — 사용자의 엮기 패턴 (2-hop, 공통 이웃)
 *   3. 답글 의미 유사도 — 사용자의 해석이 연결 신호
 *
 * 적응형 가중치 (코잡기 → 뜨개질 전환):
 *   - 코잡기 단계: 임베딩 80%, 그래프 10%, 답글 10%
 *   - 뜨개질 단계: 임베딩 30%, 그래프 50%, 답글 20%
 */

const { embed, cosineSimilarity, isReady } = require('./embedder');
const { getDB, persist, rowsToObjects } = require('../db');

// ─── 임베딩 인메모리 캐시 ───
// DB에서 매번 JSON.parse 하는 비용을 줄이기 위해 파싱된 벡터를 메모리에 캐싱
const embeddingCache = new Map();  // fiber_id -> number[]
let cacheLoaded = false;

function _loadCache() {
  if (cacheLoaded) return;
  const db = getDB();
  if (!db) return;
  const rows = rowsToObjects(
    db.exec('SELECT fiber_id, embedding FROM fiber_embeddings')
  );
  for (const row of rows) {
    embeddingCache.set(row.fiber_id, JSON.parse(row.embedding));
  }
  cacheLoaded = true;
}

function _getCachedEmbedding(fiberId) {
  _loadCache();
  return embeddingCache.get(fiberId) || null;
}

function _getAllCachedEmbeddings() {
  _loadCache();
  return embeddingCache;
}

// ─── 임베딩 관리 ───

async function saveEmbedding(fiberId, text, thought) {
  if (!isReady()) return;
  const combined = (text || '') + (thought ? ' ' + thought : '');
  const vector = await embed(combined);
  if (!vector) return;

  const db = getDB();
  db.run(
    `INSERT OR REPLACE INTO fiber_embeddings (fiber_id, embedding) VALUES (?, ?)`,
    [fiberId, JSON.stringify(vector)]
  );
  persist();
  embeddingCache.set(fiberId, vector);
}

function deleteEmbedding(fiberId) {
  const db = getDB();
  db.run(`DELETE FROM fiber_embeddings WHERE fiber_id = ?`, [fiberId]);
  embeddingCache.delete(fiberId);
}

async function saveReplyEmbedding(replyId, note) {
  if (!isReady()) return;
  const vector = await embed(note);
  if (!vector) return;

  const db = getDB();
  db.run(
    `INSERT OR REPLACE INTO reply_embeddings (reply_id, embedding) VALUES (?, ?)`,
    [replyId, JSON.stringify(vector)]
  );
  persist();
}

function deleteReplyEmbedding(replyId) {
  const db = getDB();
  db.run(`DELETE FROM reply_embeddings WHERE reply_id = ?`, [replyId]);
}

// ─── 그래프 근접도 ───

/**
 * 올의 stitch 이웃 집합을 반환
 */
function getNeighbors(fiberId) {
  const db = getDB();
  const rows = rowsToObjects(
    db.exec(
      `SELECT fiber_a_id, fiber_b_id FROM stitches
       WHERE fiber_a_id = ? OR fiber_b_id = ?`,
      [fiberId, fiberId]
    )
  );
  const neighbors = new Set();
  for (const row of rows) {
    if (row.fiber_a_id !== fiberId) neighbors.add(row.fiber_a_id);
    if (row.fiber_b_id !== fiberId) neighbors.add(row.fiber_b_id);
  }
  return neighbors;
}

/**
 * 그래프 근접도 점수 (0~1)
 * - 1-hop 직접 연결: 1.0
 * - 2-hop 간접 연결: 0.5
 * - 공통 이웃 비율: 공통 수 / max(이웃A, 이웃B)
 * - 최종: max(hop 점수, 공통이웃 비율)
 */
function calcGraphScore(targetId, candidateId, targetNeighbors) {
  // 1-hop: 직접 연결
  if (targetNeighbors.has(candidateId)) return 1.0;

  const candidateNeighbors = getNeighbors(candidateId);

  // 공통 이웃
  let common = 0;
  for (const n of targetNeighbors) {
    if (candidateNeighbors.has(n)) common++;
  }

  const maxNeighbors = Math.max(targetNeighbors.size, candidateNeighbors.size);
  const commonRatio = maxNeighbors > 0 ? common / maxNeighbors : 0;

  // 2-hop: target의 이웃이 candidate와 연결
  let hopScore = 0;
  for (const n of targetNeighbors) {
    if (candidateNeighbors.has(n)) {
      hopScore = 0.5;
      break;
    }
  }

  return Math.max(hopScore, commonRatio);
}

// ─── 답글 유사도 ───

/**
 * 특정 올의 답글 임베딩 목록을 반환
 */
function getReplyEmbeddings(fiberId) {
  const db = getDB();
  const rows = rowsToObjects(
    db.exec(
      `SELECT re.embedding FROM reply_embeddings re
       JOIN fiber_replies fr ON re.reply_id = fr.id
       WHERE fr.fiber_id = ?`,
      [fiberId]
    )
  );
  return rows.map(r => JSON.parse(r.embedding));
}

/**
 * 답글 유사도 점수 (0~1)
 * 양방향:
 *   - target 임베딩 vs candidate의 답글 임베딩들
 *   - candidate 임베딩 vs target의 답글 임베딩들
 * 최종: 두 방향 중 max
 */
function calcReplyScore(targetVec, candidateVec, targetId, candidateId) {
  const targetReplies = getReplyEmbeddings(targetId);
  const candidateReplies = getReplyEmbeddings(candidateId);

  if (!targetReplies.length && !candidateReplies.length) return 0;

  let maxScore = 0;

  // target 임베딩 vs candidate 답글들
  for (const replyVec of candidateReplies) {
    const s = cosineSimilarity(targetVec, replyVec);
    if (s > maxScore) maxScore = s;
  }

  // candidate 임베딩 vs target 답글들
  for (const replyVec of targetReplies) {
    const s = cosineSimilarity(candidateVec, replyVec);
    if (s > maxScore) maxScore = s;
  }

  return Math.max(0, maxScore);
}

// ─── 적응형 가중치 ───

/**
 * 현재 단계의 가중치 반환
 * density = stitch 수 / fiber 수
 * - < 1.0: 코잡기 단계 (임베딩 중심)
 * - 1.0~2.0: 전환 구간 (선형 보간)
 * - ≥ 2.0: 뜨개질 단계 (그래프 중심)
 */
function getWeights() {
  const db = getDB();

  const fiberCount = rowsToObjects(
    db.exec('SELECT COUNT(*) as cnt FROM fibers')
  )[0]?.cnt || 0;
  const stitchCount = rowsToObjects(
    db.exec('SELECT COUNT(*) as cnt FROM stitches')
  )[0]?.cnt || 0;

  if (fiberCount === 0) {
    return { embedding: 0.8, graph: 0.1, reply: 0.1, phase: 'casting-on', density: 0 };
  }

  const density = stitchCount / fiberCount;

  // 코잡기 단계
  const castOn = { embedding: 0.8, graph: 0.1, reply: 0.1 };
  // 뜨개질 단계
  const knitting = { embedding: 0.3, graph: 0.5, reply: 0.2 };

  if (density < 1.0) {
    return { ...castOn, phase: 'casting-on', density };
  }
  if (density >= 2.0) {
    return { ...knitting, phase: 'knitting', density };
  }

  // 전환 구간: 선형 보간
  const t = (density - 1.0) / (2.0 - 1.0); // 0~1
  return {
    embedding: castOn.embedding + t * (knitting.embedding - castOn.embedding),
    graph: castOn.graph + t * (knitting.graph - castOn.graph),
    reply: castOn.reply + t * (knitting.reply - castOn.reply),
    phase: 'transition',
    density
  };
}

// ─── 결 대비 ───

const TONE_BOOST = 0.15; // 최대 15% 부스팅

/**
 * 두 결 사이의 대비 점수 (0~1)
 * 공명↔마찰 = 1.0, 물음+어느결 = 0.5, 같은 결 = 0
 */
function _toneContrast(toneA, toneB) {
  if (!toneA || !toneB || toneA === toneB) return 0;
  if ((toneA === 'resonance' && toneB === 'friction') ||
      (toneA === 'friction' && toneB === 'resonance')) return 1.0;
  return 0.5; // question + 어느 결이든
}

// ─── 하이브리드 유사 올 찾기 ───

/**
 * 유사 올 찾기 (하이브리드 스코어링)
 * @param {string} targetId
 * @returns {object[]} 유사 올 목록 (상위 5개, 각 신호 점수 포함)
 */
function findSimilarFibers(targetId) {
  const db = getDB();

  // 캐시에서 대상 임베딩 조회
  const targetVec = _getCachedEmbedding(targetId);
  if (!targetVec) return { hints: [], phase: 'casting-on', density: 0 };

  // 캐시에서 모든 임베딩 조회 (대상 제외)
  const allEmbeddings = _getAllCachedEmbeddings();
  if (allEmbeddings.size <= 1) return { hints: [], phase: 'casting-on', density: 0 };

  // 가중치
  const weights = getWeights();
  const threshold = weights.phase === 'knitting' ? 0.3 : 0.25;

  // target의 이웃 (그래프 점수용, 한 번만 계산)
  const targetNeighbors = getNeighbors(targetId);

  // 결 대비용: 모든 fiber의 tone 미리 조회
  const toneRows = rowsToObjects(db.exec('SELECT id, tone FROM fibers'));
  const toneMap = {};
  toneRows.forEach(r => { toneMap[r.id] = r.tone || 'resonance'; });
  const targetTone = toneMap[targetId] || 'resonance';

  // 하이브리드 점수 계산
  const scored = [];
  for (const [fiberId, candidateVec] of allEmbeddings) {
    if (fiberId === targetId) continue;

    const embeddingScore = cosineSimilarity(targetVec, candidateVec);
    const graphScore = calcGraphScore(targetId, fiberId, targetNeighbors);
    const replyScore = calcReplyScore(targetVec, candidateVec, targetId, fiberId);

    const hybrid = weights.embedding * embeddingScore
      + weights.graph * graphScore
      + weights.reply * replyScore;

    // 결 대비 보너스
    const contrast = _toneContrast(targetTone, toneMap[fiberId]);
    const boosted = hybrid * (1 + TONE_BOOST * contrast);

    if (boosted > threshold) {
      scored.push({
        fiber_id: fiberId,
        score: boosted,
        signals: {
          embedding: Math.round(embeddingScore * 100),
          graph: Math.round(graphScore * 100),
          reply: Math.round(replyScore * 100),
          tone: Math.round(contrast * 100)
        }
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 5);

  if (!top.length) return { hints: [], phase: weights.phase, density: weights.density };

  // 올 상세 정보 조회
  const ids = top.map(s => s.fiber_id);
  const placeholders = ids.map(() => '?').join(',');
  const fibers = rowsToObjects(
    db.exec(`SELECT * FROM fibers WHERE id IN (${placeholders})`, ids)
  );

  const fiberMap = {};
  fibers.forEach(f => { fiberMap[f.id] = f; });

  const hints = top
    .filter(s => fiberMap[s.fiber_id])
    .map(s => ({
      ...fiberMap[s.fiber_id],
      similarity: Math.round(s.score * 100),
      signals: s.signals
    }));

  return { hints, phase: weights.phase, density: weights.density };
}

// ─── 일괄 처리 ───

async function backfillEmbeddings() {
  if (!isReady()) return;
  const db = getDB();

  const fibers = rowsToObjects(
    db.exec(`SELECT f.id, f.text, f.thought FROM fibers f
             LEFT JOIN fiber_embeddings e ON f.id = e.fiber_id
             WHERE e.fiber_id IS NULL`)
  );

  if (!fibers.length) {
    console.log('[hint] 모든 올에 임베딩이 있습니다.');
    return;
  }

  console.log(`[hint] 임베딩 없는 올 ${fibers.length}개 처리 시작...`);
  for (const f of fibers) {
    await saveEmbedding(f.id, f.text, f.thought);
  }
  console.log('[hint] 일괄 임베딩 완료');
}

async function backfillReplyEmbeddings() {
  if (!isReady()) return;
  const db = getDB();

  const replies = rowsToObjects(
    db.exec(`SELECT fr.id, fr.note FROM fiber_replies fr
             LEFT JOIN reply_embeddings re ON fr.id = re.reply_id
             WHERE re.reply_id IS NULL`)
  );

  if (!replies.length) {
    console.log('[hint] 모든 답글에 임베딩이 있습니다.');
    return;
  }

  console.log(`[hint] 임베딩 없는 답글 ${replies.length}개 처리 시작...`);
  for (const r of replies) {
    await saveReplyEmbedding(r.id, r.note);
  }
  console.log('[hint] 답글 일괄 임베딩 완료');
}

module.exports = {
  findSimilarFibers,
  saveEmbedding,
  deleteEmbedding,
  saveReplyEmbedding,
  deleteReplyEmbedding,
  backfillEmbeddings,
  backfillReplyEmbeddings
};
