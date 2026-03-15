/**
 * Hint Service — 하이브리드 스코어링 기반 유사 조각 찾기
 *
 * 3가지 신호:
 *   1. 임베딩 유사도 — 표면적 의미 비교 (바닥 깔개)
 *   2. 그래프 근접도 — 사용자의 연결 패턴 (2-hop, 공통 이웃)
 *   3. 답글 의미 유사도 — 사용자의 해석이 연결 신호
 *
 * 적응형 가중치 (코잡기 → 뜨개질 전환):
 *   - 코잡기 단계: 임베딩 80%, 그래프 10%, 답글 10%
 *   - 뜨개질 단계: 임베딩 30%, 그래프 50%, 답글 20%
 */

const { embed, cosineSimilarity, isReady } = require('./embedder');
const { getDB, persist, getOne, getAll } = require('../db');

// ─── 임베딩 인메모리 캐시 ───
const embeddingCache = new Map();  // fiber_id -> number[]
let cacheLoaded = false;

function _loadCache() {
  if (cacheLoaded) return;
  try {
    const rows = getAll('SELECT fiber_id, embedding FROM fiber_embeddings', []);
    for (const row of rows) {
      embeddingCache.set(row.fiber_id, JSON.parse(row.embedding));
    }
    cacheLoaded = true;
  } catch (e) {}
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
 * 조각의 연결(link) 이웃 집합을 반환
 * 같은 연결에 속한 다른 조각들이 이웃
 */
function getNeighbors(fiberId) {
  const linkIds = getAll('SELECT link_id FROM link_members WHERE fiber_id = ?', [fiberId])
    .map(r => r.link_id);

  const neighbors = new Set();
  for (const lid of linkIds) {
    const fiberIds = getAll('SELECT fiber_id FROM link_members WHERE link_id = ?', [lid]);
    for (const row of fiberIds) {
      if (row.fiber_id !== fiberId) neighbors.add(row.fiber_id);
    }
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
 * 특정 조각의 답글 임베딩 목록을 반환
 */
function getReplyEmbeddings(fiberId) {
  const rows = getAll(
    `SELECT re.embedding FROM reply_embeddings re
     JOIN fiber_replies fr ON re.reply_id = fr.id
     WHERE fr.fiber_id = ?`,
    [fiberId]
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

  for (const replyVec of candidateReplies) {
    const s = cosineSimilarity(targetVec, replyVec);
    if (s > maxScore) maxScore = s;
  }

  for (const replyVec of targetReplies) {
    const s = cosineSimilarity(candidateVec, replyVec);
    if (s > maxScore) maxScore = s;
  }

  return Math.max(0, maxScore);
}

// ─── 적응형 가중치 ───

/**
 * 현재 단계의 가중치 반환
 * density = 연결(link) 수 / 조각(fiber) 수
 * - < 1.0: 코잡기 단계 (임베딩 중심)
 * - 1.0~2.0: 전환 구간 (선형 보간)
 * - ≥ 2.0: 뜨개질 단계 (그래프 중심)
 */
function getWeights() {
  const fiberCount = (getAll('SELECT COUNT(*) as cnt FROM fibers', [])[0]?.cnt) || 0;
  const linkCount = (getAll('SELECT COUNT(*) as cnt FROM links', [])[0]?.cnt) || 0;

  if (fiberCount === 0) {
    return { embedding: 0.8, graph: 0.1, reply: 0.1, phase: 'casting-on', density: 0 };
  }

  const density = linkCount / fiberCount;

  const castOn = { embedding: 0.8, graph: 0.1, reply: 0.1 };
  const knitting = { embedding: 0.3, graph: 0.5, reply: 0.2 };

  if (density < 1.0) {
    return { ...castOn, phase: 'casting-on', density };
  }
  if (density >= 2.0) {
    return { ...knitting, phase: 'knitting', density };
  }

  // 전환 구간: 선형 보간
  const t = (density - 1.0) / (2.0 - 1.0);
  return {
    embedding: castOn.embedding + t * (knitting.embedding - castOn.embedding),
    graph: castOn.graph + t * (knitting.graph - castOn.graph),
    reply: castOn.reply + t * (knitting.reply - castOn.reply),
    phase: 'transition',
    density
  };
}

// ─── 결 대비 ───

const TONE_BOOST = 0.15;

function _toneContrast(toneA, toneB) {
  if (!toneA || !toneB || toneA === toneB) return 0;
  if ((toneA === 'positive' && toneB === 'critic') ||
      (toneA === 'critic' && toneB === 'positive')) return 1.0;
  return 0.5;
}

// ─── 힌트 간 클러스터링 ───

const CLUSTER_THRESHOLD = 0.5;

function _assignClusters(hintIds, cacheMap) {
  if (!hintIds.length) return { clusters: {}, count: 0 };

  const parent = {};
  hintIds.forEach(id => { parent[id] = id; });
  function find(x) {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  function union(a, b) { parent[find(a)] = find(b); }

  for (let i = 0; i < hintIds.length; i++) {
    for (let j = i + 1; j < hintIds.length; j++) {
      const vecA = cacheMap.get(hintIds[i]);
      const vecB = cacheMap.get(hintIds[j]);
      if (vecA && vecB && cosineSimilarity(vecA, vecB) > CLUSTER_THRESHOLD) {
        union(hintIds[i], hintIds[j]);
      }
    }
  }

  const rootToCluster = {};
  let nextCluster = 0;
  const clusters = {};
  hintIds.forEach(id => {
    const root = find(id);
    if (!(root in rootToCluster)) rootToCluster[root] = nextCluster++;
    clusters[id] = rootToCluster[root];
  });
  return { clusters, count: nextCluster };
}

// ─── 하이브리드 유사 조각 찾기 ───

function findSimilarFibers(targetId) {
  const targetVec = _getCachedEmbedding(targetId);
  if (!targetVec) return { hints: [], phase: 'casting-on', density: 0 };

  const allEmbeddings = _getAllCachedEmbeddings();
  if (allEmbeddings.size <= 1) return { hints: [], phase: 'casting-on', density: 0 };

  const weights = getWeights();
  const threshold = weights.phase === 'knitting' ? 0.3 : 0.25;
  const targetNeighbors = getNeighbors(targetId);

  const toneRows = getAll('SELECT id, tone FROM fibers', []);
  const toneMap = {};
  toneRows.forEach(r => { toneMap[r.id] = r.tone || 'positive'; });
  const targetTone = toneMap[targetId] || 'positive';

  const scored = [];
  for (const [fiberId, candidateVec] of allEmbeddings) {
    if (fiberId === targetId) continue;

    const embeddingScore = cosineSimilarity(targetVec, candidateVec);
    const graphScore = calcGraphScore(targetId, fiberId, targetNeighbors);
    const replyScore = calcReplyScore(targetVec, candidateVec, targetId, fiberId);

    const hybrid = weights.embedding * embeddingScore
      + weights.graph * graphScore
      + weights.reply * replyScore;

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

  const ids = top.map(s => s.fiber_id);
  const placeholders = ids.map(() => '?').join(',');
  const fibers = getAll(`SELECT * FROM fibers WHERE id IN (${placeholders})`, ids);

  const fiberMap = {};
  fibers.forEach(f => { fiberMap[f.id] = f; });

  const clusterIds = ids.filter(id => embeddingCache.has(id));
  const { clusters, count: clusterCount } = _assignClusters(clusterIds, embeddingCache);

  const hints = top
    .filter(s => fiberMap[s.fiber_id])
    .map(s => ({
      ...fiberMap[s.fiber_id],
      similarity: Math.round(s.score * 100),
      signals: s.signals,
      cluster_id: clusters[s.fiber_id] != null ? clusters[s.fiber_id] : 0
    }));

  return { hints, cluster_count: clusterCount || 1, phase: weights.phase, density: weights.density };
}

// ─── 일괄 처리 ───

async function backfillEmbeddings() {
  if (!isReady()) return;

  const fibers = getAll(
    `SELECT f.id, f.text, f.thought FROM fibers f
     LEFT JOIN fiber_embeddings e ON f.id = e.fiber_id
     WHERE e.fiber_id IS NULL`,
    []
  );

  if (!fibers.length) {
    console.log('[hint] 모든 조각에 임베딩이 있습니다.');
    return;
  }

  console.log(`[hint] 임베딩 없는 조각 ${fibers.length}개 처리 시작...`);
  for (const f of fibers) {
    await saveEmbedding(f.id, f.text, f.thought);
  }
  console.log('[hint] 일괄 임베딩 완료');
}

async function backfillReplyEmbeddings() {
  if (!isReady()) return;

  const replies = getAll(
    `SELECT fr.id, fr.note FROM fiber_replies fr
     LEFT JOIN reply_embeddings re ON fr.id = re.reply_id
     WHERE re.reply_id IS NULL`,
    []
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
