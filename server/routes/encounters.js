/**
 * Encounter Routes — 만남 (확률적 재회)
 *
 * 선택 알고리즘:
 *   기본 가중치 = 1.0
 *   한번도 만남 없음 → ×3.0
 *   만남 있음 → ×(log(경과일+1)+1)
 *   잡은지 7일 이내 → ×1.5
 *   감도 부스트 → ×(1 + 감도/200)
 *   직전 만남과 같은 방향성 → ×0.5
 */
const express = require('express');
const router = express.Router();
const { getDB, persist, generateId, getOne, getAll } = require('../db');

const DAY_MS = 86400000;

// GET /api/encounter — 만남 조각 1개 (확률 선택)
router.get('/', (req, res) => {
  try {
    const fibers = getAll('SELECT * FROM fibers WHERE user_id = ?', [req.user.id]);
    if (!fibers.length) {
      return res.json({ fiber: null, message: '아직 잡은 조각이 없어요' });
    }

    const now = Date.now();

    // 직전 만남의 방향성
    const lastEnc = getOne(
      `SELECT f.tone FROM encounters e
       JOIN fibers f ON f.id = e.fiber_id
       WHERE e.user_id = ?
       ORDER BY e.encountered_at DESC LIMIT 1`,
      [req.user.id]
    );
    const lastTone = lastEnc ? lastEnc.tone : null;

    // 각 조각의 마지막 만남 시점
    const encounterMap = {};
    const encRows = getAll(
      'SELECT fiber_id, MAX(encountered_at) as last_at FROM encounters WHERE user_id = ? GROUP BY fiber_id',
      [req.user.id]
    );
    for (const e of encRows) {
      encounterMap[e.fiber_id] = e.last_at;
    }

    // 가중치 계산
    let totalWeight = 0;
    const weighted = fibers.map(f => {
      let w = 1.0;

      const lastAt = encounterMap[f.id];
      if (!lastAt) {
        w *= 3.0;
      } else {
        const days = (now - lastAt) / DAY_MS;
        w *= (Math.log(days + 1) + 1);
      }

      const caughtDays = (now - f.caught_at) / DAY_MS;
      if (caughtDays <= 7) {
        w *= 1.5;
      }

      const sensitivity = (f.tension || 3) * 20;
      w *= (1 + sensitivity / 200);

      if (lastTone && f.tone === lastTone) {
        w *= 0.5;
      }

      totalWeight += w;
      return { fiber: f, weight: w };
    });

    let rand = Math.random() * totalWeight;
    let selected = weighted[0].fiber;
    for (const item of weighted) {
      rand -= item.weight;
      if (rand <= 0) {
        selected = item.fiber;
        break;
      }
    }

    if (selected.source_range) {
      try { selected.source_range = JSON.parse(selected.source_range); } catch (e) { selected.source_range = null; }
    }

    res.json({ fiber: selected });
  } catch (err) {
    console.error('GET /api/encounter error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/encounter — 만남 기록 저장
router.post('/', (req, res) => {
  try {
    const { fiber_id } = req.body;
    if (!fiber_id) {
      return res.status(400).json({ error: 'fiber_id is required' });
    }

    const fiber = getOne('SELECT id FROM fibers WHERE id = ? AND user_id = ?', [fiber_id, req.user.id]);
    if (!fiber) {
      return res.status(404).json({ error: 'Fiber not found' });
    }

    const id = generateId('en');
    const now = Date.now();

    getDB().run(
      'INSERT INTO encounters (id, user_id, fiber_id, encountered_at) VALUES (?, ?, ?, ?)',
      [id, req.user.id, fiber_id, now]
    );
    persist();

    res.status(201).json({ id, fiber_id, encountered_at: now });
  } catch (err) {
    console.error('POST /api/encounter error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
