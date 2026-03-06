/**
 * Knot Routes — 매듭 CRUD (통찰 기록)
 */
const express = require('express');
const router = express.Router();
const { getDB, persist, generateId, getOne, getAll } = require('../db');

// POST /api/knots — 매듭 만들기
router.post('/', (req, res) => {
  try {
    const { insight, stitch_ids } = req.body;
    if (!insight || !insight.trim()) {
      return res.status(400).json({ error: 'insight is required' });
    }
    if (!stitch_ids || !Array.isArray(stitch_ids) || stitch_ids.length < 1) {
      return res.status(400).json({ error: 'At least 1 stitch_id is required' });
    }

    // Validate all stitches exist
    for (const sid of stitch_ids) {
      const s = getOne('SELECT id FROM stitches WHERE id = ?', [sid]);
      if (!s) return res.status(404).json({ error: 'Stitch not found: ' + sid });
    }

    const id = generateId('kn');
    const now = Date.now();

    getDB().run(
      'INSERT INTO knots (id, insight, created_at) VALUES (?, ?, ?)',
      [id, insight.trim(), now]
    );

    for (const sid of stitch_ids) {
      getDB().run(
        'INSERT INTO knot_stitches (knot_id, stitch_id) VALUES (?, ?)',
        [id, sid]
      );
    }
    persist();

    const knot = _getKnotWithDetails(id);
    res.status(201).json(knot);
  } catch (err) {
    console.error('POST /api/knots error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/knots — 매듭 목록
router.get('/', (req, res) => {
  try {
    const knots = getAll('SELECT * FROM knots ORDER BY created_at DESC', []);

    // Attach stitch IDs for each knot
    knots.forEach(k => {
      const links = getAll('SELECT stitch_id FROM knot_stitches WHERE knot_id = ?', [k.id]);
      k.stitch_ids = links.map(l => l.stitch_id);
    });

    res.json(knots);
  } catch (err) {
    console.error('GET /api/knots error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/knots/:id — 매듭 상세 (코 + 올 정보 포함)
router.get('/:id', (req, res) => {
  try {
    const knot = _getKnotWithDetails(req.params.id);
    if (!knot) return res.status(404).json({ error: 'Not found' });
    res.json(knot);
  } catch (err) {
    console.error('GET /api/knots/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/knots/:id — 매듭 수정
router.patch('/:id', (req, res) => {
  try {
    const knot = getOne('SELECT * FROM knots WHERE id = ?', [req.params.id]);
    if (!knot) return res.status(404).json({ error: 'Not found' });

    if (req.body.insight !== undefined) {
      getDB().run('UPDATE knots SET insight = ? WHERE id = ?', [req.body.insight.trim(), req.params.id]);
    }

    // Update stitch associations if provided
    if (req.body.stitch_ids && Array.isArray(req.body.stitch_ids)) {
      getDB().run('DELETE FROM knot_stitches WHERE knot_id = ?', [req.params.id]);
      for (const sid of req.body.stitch_ids) {
        getDB().run('INSERT INTO knot_stitches (knot_id, stitch_id) VALUES (?, ?)', [req.params.id, sid]);
      }
    }

    persist();
    const updated = _getKnotWithDetails(req.params.id);
    res.json(updated);
  } catch (err) {
    console.error('PATCH /api/knots/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/knots/:id
router.delete('/:id', (req, res) => {
  try {
    const knot = getOne('SELECT id FROM knots WHERE id = ?', [req.params.id]);
    if (!knot) return res.status(404).json({ error: 'Not found' });

    getDB().run('DELETE FROM knot_stitches WHERE knot_id = ?', [req.params.id]);
    getDB().run('DELETE FROM knots WHERE id = ?', [req.params.id]);
    persist();

    res.status(204).end();
  } catch (err) {
    console.error('DELETE /api/knots/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper: get knot with stitches and fiber details
function _getKnotWithDetails(id) {
  const knot = getOne('SELECT * FROM knots WHERE id = ?', [id]);
  if (!knot) return null;

  const stitchLinks = getAll('SELECT stitch_id FROM knot_stitches WHERE knot_id = ?', [id]);
  knot.stitches = [];

  for (const link of stitchLinks) {
    const stitch = getOne('SELECT * FROM stitches WHERE id = ?', [link.stitch_id]);
    if (!stitch) continue;

    // Attach fiber summaries
    const fiberA = getOne('SELECT id, text, tension FROM fibers WHERE id = ?', [stitch.fiber_a_id]);
    const fiberB = getOne('SELECT id, text, tension FROM fibers WHERE id = ?', [stitch.fiber_b_id]);
    stitch.fiber_a = fiberA;
    stitch.fiber_b = fiberB;
    knot.stitches.push(stitch);
  }

  return knot;
}

module.exports = router;
