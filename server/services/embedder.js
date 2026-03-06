/**
 * Embedder Service — 로컬 임베딩 모델로 텍스트 → 벡터 변환
 * @xenova/transformers (ONNX Runtime) 기반, 외부 API 불필요
 *
 * 모델: snunlp/KR-SBERT-V40K-klueNLI-augSTS (ONNX 변환, 양자화)
 * KorSTS Spearman 86.28 — 한국어 의미 유사도 최고 수준
 */

const path = require('path');

let embedPipeline = null;

async function initEmbedder() {
  if (embedPipeline) return;
  const { pipeline, env } = await import('@xenova/transformers');

  // 로컬 모델만 사용
  const modelsDir = path.join(__dirname, '..', 'models');
  env.localModelPath = modelsDir;
  env.allowRemoteModels = false;

  console.log('[embedder] 모델 로딩 중: KR-SBERT-V40K (로컬 ONNX)');
  embedPipeline = await pipeline('feature-extraction', 'kr-sbert-onnx', {
    quantized: true,
    local_files_only: true
  });
  console.log('[embedder] 모델 로드 완료 (768차원)');
}

/**
 * 텍스트를 임베딩 벡터로 변환
 * @param {string} text
 * @returns {Promise<number[]>} 768차원 벡터
 */
async function embed(text) {
  if (!embedPipeline) throw new Error('Embedder not initialized');
  if (!text || !text.trim()) return null;

  const output = await embedPipeline(text.trim(), { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

/**
 * 두 벡터 간 코사인 유사도 (이미 정규화된 벡터면 내적과 동일)
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} -1 ~ 1
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

function isReady() {
  return !!embedPipeline;
}

module.exports = { initEmbedder, embed, cosineSimilarity, isReady };
