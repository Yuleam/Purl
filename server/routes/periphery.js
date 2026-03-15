/**
 * 주변부 (Periphery) API
 * 잡기 중 과거 조각이 조용히 옆에 오는 것
 *
 * GET /api/periphery?text=&tone=&source=&exclude_id=
 */

const express = require('express');
const router = express.Router();
const { getAll } = require('../db');

// 한국어 + 영어 불용어
const STOPWORDS = new Set([
  '이', '그', '저', '것', '수', '등', '및', '더', '또', '를', '을', '에', '의', '가', '는', '은',
  '도', '로', '으로', '와', '과', '에서', '까지', '부터', '한', '하다', '있다', '없다', '되다',
  '이다', '아니다', '같다', '때문', '위해', '통해', '대해', '관한', '대한', '하는', '하고',
  '그리고', '하지만', '그러나', '또는', '혹은', '때', '중', '후', '전', '내', '외',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'and', 'but', 'or',
  'nor', 'not', 'so', 'if', 'then', 'than', 'too', 'very', 'just',
  'about', 'up', 'out', 'no', 'only', 'own', 'same', 'that', 'this',
  'it', 'its', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he',
  'she', 'they', 'them', 'their', 'what', 'which', 'who', 'when',
  'where', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'any'
]);

function extractKeywords(text) {
  if (!text) return [];
  var words = text.toLowerCase().match(/[\uac00-\ud7a3]+|[a-z]+|[0-9]+/g);
  if (!words) return [];
  return words.filter(function(w) {
    return w.length >= 2 && !STOPWORDS.has(w);
  });
}

function keywordOverlap(keywordsA, keywordsB) {
  if (!keywordsA.length || !keywordsB.length) return 0;
  var setB = new Set(keywordsB);
  var overlap = 0;
  for (var i = 0; i < keywordsA.length; i++) {
    if (setB.has(keywordsA[i])) overlap++;
  }
  return overlap;
}

// GET /api/periphery
router.get('/', function(req, res) {
  var text = req.query.text || '';
  var tone = req.query.tone || '';
  var source = req.query.source || '';
  var excludeId = req.query.exclude_id || '';

  // 해당 사용자의 조각만 조회
  var allFibers = getAll('SELECT * FROM fibers WHERE user_id = ? ORDER BY caught_at DESC', [req.user.id]);
  if (!allFibers.length) return res.json([]);

  if (excludeId) {
    allFibers = allFibers.filter(function(f) { return f.id !== excludeId; });
  }

  var results = [];
  var usedIds = new Set();

  // --- 1순위: 키워드 겹침 ---
  var inputKeywords = extractKeywords(text);
  if (inputKeywords.length > 0) {
    var scored = [];
    for (var i = 0; i < allFibers.length; i++) {
      var fiber = allFibers[i];
      var fiberKeywords = extractKeywords(fiber.text + ' ' + (fiber.thought || ''));
      var overlap = keywordOverlap(inputKeywords, fiberKeywords);
      if (overlap > 0) {
        scored.push({ fiber: fiber, score: overlap });
      }
    }
    scored.sort(function(a, b) {
      return b.score - a.score || (b.fiber.caught_at || 0) - (a.fiber.caught_at || 0);
    });
    for (var j = 0; j < scored.length && results.length < 2; j++) {
      if (!usedIds.has(scored[j].fiber.id)) {
        results.push(scored[j].fiber);
        usedIds.add(scored[j].fiber.id);
      }
    }
  }

  // --- 2순위: 같은 출처 ---
  if (results.length < 2 && source) {
    for (var k = 0; k < allFibers.length && results.length < 2; k++) {
      var f2 = allFibers[k];
      if (!usedIds.has(f2.id) && f2.source && f2.source === source) {
        results.push(f2);
        usedIds.add(f2.id);
      }
    }
  }

  // --- 3순위: 같은 방향성의 최근 조각 ---
  if (results.length < 2 && tone) {
    for (var m = 0; m < allFibers.length && results.length < 2; m++) {
      var f3 = allFibers[m];
      if (!usedIds.has(f3.id) && f3.tone === tone) {
        results.push(f3);
        usedIds.add(f3.id);
      }
    }
  }

  res.json(results);
});

module.exports = router;
