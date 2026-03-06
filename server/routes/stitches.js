/**
 * Stitch Routes — 코 CRUD (올/실 간의 연결)
 */
const express = require('express');
const router = express.Router();
const { getDB, persist, generateId, getOne, getAll } = require('../db');

// POST /api/stitches — 코 만들기
router.post('/', (req, res) => {
  try {
    const { fiber_a_id, fiber_b_id, why } = req.body;
    if (!fiber_a_id || !fiber_b_id) {
      return res.status(400).json({ error: 'fiber_a_id and fiber_b_id are required' });
    }
    if (fiber_a_id === fiber_b_id) {
      return res.status(400).json({ error: 'Cannot connect a fiber to itself' });
    }

    const fiberA = getOne('SELECT id FROM fibers WHERE id = ?', [fiber_a_id]);
    const fiberB = getOne('SELECT id FROM fibers WHERE id = ?', [fiber_b_id]);
    if (!fiberA || !fiberB) {
      return res.status(404).json({ error: 'One or both fibers not found' });
    }

    const id = generateId('sc');
    const now = Date.now();

    getDB().run(
      'INSERT INTO stitches (id, fiber_a_id, fiber_b_id, why, created_at) VALUES (?, ?, ?, ?, ?)',
      [id, fiber_a_id, fiber_b_id, why || '', now]
    );
    persist();

    const stitch = getOne('SELECT * FROM stitches WHERE id = ?', [id]);
    res.status(201).json(stitch);
  } catch (err) {
    console.error('POST /api/stitches error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/stitches — 연결 목록
router.get('/', (req, res) => {
  try {
    let stitches;
    if (req.query.fiber_id) {
      stitches = getAll(
        'SELECT * FROM stitches WHERE fiber_a_id = ? OR fiber_b_id = ? ORDER BY created_at DESC',
        [req.query.fiber_id, req.query.fiber_id]
      );
    } else {
      stitches = getAll('SELECT * FROM stitches ORDER BY created_at DESC', []);
    }
    res.json(stitches);
  } catch (err) {
    console.error('GET /api/stitches error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/stitches/:id
router.delete('/:id', (req, res) => {
  try {
    const stitch = getOne('SELECT id FROM stitches WHERE id = ?', [req.params.id]);
    if (!stitch) return res.status(404).json({ error: 'Not found' });

    getDB().run('DELETE FROM knot_stitches WHERE stitch_id = ?', [req.params.id]);
    getDB().run('DELETE FROM stitches WHERE id = ?', [req.params.id]);
    persist();

    res.status(204).end();
  } catch (err) {
    console.error('DELETE /api/stitches/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
