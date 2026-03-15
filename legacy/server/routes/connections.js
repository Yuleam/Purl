/**
 * Connection Routes — 교차 연결 CRUD (다른 층위 간 연결)
 */
const express = require('express');
const router = express.Router();
const { getDB, persist, generateId, getOne, getAll } = require('../db');

// POST /api/connections
router.post('/', (req, res) => {
  try {
    const { source_type, source_id, target_type, target_id, why } = req.body;
    if (!source_type || !source_id || !target_type || !target_id) {
      return res.status(400).json({ error: 'source_type, source_id, target_type, target_id are required' });
    }

    const id = generateId('cn');
    const now = Date.now();

    getDB().run(
      'INSERT INTO connections (id, source_type, source_id, target_type, target_id, why, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, source_type, source_id, target_type, target_id, why || '', now]
    );
    persist();

    const conn = getOne('SELECT * FROM connections WHERE id = ?', [id]);
    res.status(201).json(conn);
  } catch (err) {
    console.error('POST /api/connections error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/connections
router.get('/', (req, res) => {
  try {
    let conns;
    if (req.query.node_id) {
      conns = getAll(
        'SELECT * FROM connections WHERE source_id = ? OR target_id = ? ORDER BY created_at DESC',
        [req.query.node_id, req.query.node_id]
      );
    } else {
      conns = getAll('SELECT * FROM connections ORDER BY created_at DESC', []);
    }
    res.json(conns);
  } catch (err) {
    console.error('GET /api/connections error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/connections/:id
router.delete('/:id', (req, res) => {
  try {
    const conn = getOne('SELECT id FROM connections WHERE id = ?', [req.params.id]);
    if (!conn) return res.status(404).json({ error: 'Not found' });

    getDB().run('DELETE FROM connections WHERE id = ?', [req.params.id]);
    persist();

    res.status(204).end();
  } catch (err) {
    console.error('DELETE /api/connections/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
