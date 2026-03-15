/**
 * Trail Routes — 궤적 (시간순 조각 흐름)
 *
 * GET /api/trail?from=&to=         — 기간 내 조각 목록
 * GET /api/trail/summary?from=&to= — 기간 요약
 */
const express = require('express');
const router = express.Router();
const { getAll } = require('../db');

// GET /api/trail?from=&to=
router.get('/', (req, res) => {
  try {
    const { from, to } = req.query;
    let sql = 'SELECT id, text, tension, tone, caught_at FROM fibers WHERE user_id = ?';
    const params = [req.user.id];

    if (from) {
      sql += ' AND caught_at >= ?';
      params.push(Number(from));
    }
    if (to) {
      sql += ' AND caught_at <= ?';
      params.push(Number(to));
    }
    sql += ' ORDER BY caught_at DESC';

    const rows = getAll(sql, params);

    const result = rows.map(r => ({
      id: r.id,
      text: r.text && r.text.length > 30 ? r.text.substring(0, 30) + '…' : r.text,
      tension: r.tension,
      tone: r.tone || 'positive',
      caught_at: r.caught_at
    }));

    res.json(result);
  } catch (err) {
    console.error('GET /api/trail error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/trail/summary?from=&to=
router.get('/summary', (req, res) => {
  try {
    const { from, to } = req.query;
    let sql = 'SELECT tension, tone FROM fibers WHERE user_id = ?';
    const params = [req.user.id];

    if (from) {
      sql += ' AND caught_at >= ?';
      params.push(Number(from));
    }
    if (to) {
      sql += ' AND caught_at <= ?';
      params.push(Number(to));
    }

    const rows = getAll(sql, params);

    let positive = 0, critic = 0, hold = 0;
    let totalSensitivity = 0;

    for (const r of rows) {
      const tone = r.tone || 'positive';
      if (tone === 'positive') positive++;
      else if (tone === 'critic') critic++;
      else hold++;
      totalSensitivity += (r.tension || 3) * 20;
    }

    res.json({
      total: rows.length,
      positive,
      critic,
      hold,
      avgSensitivity: rows.length ? Math.round(totalSensitivity / rows.length) : 0
    });
  } catch (err) {
    console.error('GET /api/trail/summary error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
