/**
 * Fabric Routes — 편물 CRUD (2개 이상의 멤버(올/실/코) 엮기)
 * DB tables: fabrics, fabric_members
 */
const express = require('express');
const router = express.Router();
const { getDB, persist, generateId, getOne, getAll } = require('../db');

// POST /api/fabrics
router.post('/', (req, res) => {
  try {
    const { name, description, member_ids } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }

    const id = generateId('fa');
    const now = Date.now();

    getDB().run(
      'INSERT INTO fabrics (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [id, name.trim(), description || '', now, now]
    );

    if (member_ids && Array.isArray(member_ids)) {
      for (const m of member_ids) {
        if (!m.type || !m.id) continue;
        getDB().run(
          'INSERT OR IGNORE INTO fabric_members (fabric_id, member_type, member_id) VALUES (?, ?, ?)',
          [id, m.type, m.id]
        );
      }
    }

    persist();
    res.status(201).json(_getFabricWithMembers(id));
  } catch (err) {
    console.error('POST /api/fabrics error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/fabrics
router.get('/', (req, res) => {
  try {
    const fabrics = getAll('SELECT * FROM fabrics ORDER BY created_at DESC', []);
    fabrics.forEach(f => {
      const members = getAll(
        'SELECT member_type, member_id FROM fabric_members WHERE fabric_id = ?',
        [f.id]
      );
      f.members = members.map(m => ({ type: m.member_type, id: m.member_id }));
      // 하위 호환: thread_ids
      f.thread_ids = members
        .filter(m => m.member_type === 'thread')
        .map(m => m.member_id);
    });
    res.json(fabrics);
  } catch (err) {
    console.error('GET /api/fabrics error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/fabrics/:id
router.get('/:id', (req, res) => {
  try {
    const fabric = _getFabricWithMembers(req.params.id);
    if (!fabric) return res.status(404).json({ error: 'Not found' });
    res.json(fabric);
  } catch (err) {
    console.error('GET /api/fabrics/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/fabrics/:id/full — 편물 전체 구조 (멤버 상세 해소)
router.get('/:id/full', (req, res) => {
  try {
    const fabric = getOne('SELECT * FROM fabrics WHERE id = ?', [req.params.id]);
    if (!fabric) return res.status(404).json({ error: 'Not found' });

    const members = getAll(
      'SELECT member_type, member_id FROM fabric_members WHERE fabric_id = ?',
      [fabric.id]
    );

    fabric.members = [];
    for (const m of members) {
      if (m.member_type === 'fiber') {
        const fiber = getOne('SELECT * FROM fibers WHERE id = ?', [m.member_id]);
        fabric.members.push({ type: 'fiber', id: m.member_id, detail: fiber });
      } else if (m.member_type === 'thread') {
        const thread = getOne('SELECT * FROM threads WHERE id = ?', [m.member_id]);
        if (thread) {
          const fibers = getAll(
            `SELECT f.* FROM thread_fibers tf
             JOIN fibers f ON f.id = tf.fiber_id
             WHERE tf.thread_id = ?`,
            [m.member_id]
          );
          thread.fibers = fibers;
        }
        fabric.members.push({ type: 'thread', id: m.member_id, detail: thread });
      } else if (m.member_type === 'stitch') {
        const stitch = getOne('SELECT * FROM stitches WHERE id = ?', [m.member_id]);
        if (stitch) {
          const stitchMembers = getAll(
            'SELECT member_type, member_id FROM stitch_members WHERE stitch_id = ?',
            [m.member_id]
          );
          stitch.members = stitchMembers.map(sm => ({ type: sm.member_type, id: sm.member_id }));
        }
        fabric.members.push({ type: 'stitch', id: m.member_id, detail: stitch });
      }
    }

    // 하위 호환: threads 배열
    fabric.threads = fabric.members
      .filter(m => m.type === 'thread' && m.detail)
      .map(m => m.detail);

    res.json(fabric);
  } catch (err) {
    console.error('GET /api/fabrics/:id/full error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/fabrics/:id
router.patch('/:id', (req, res) => {
  try {
    const fabric = getOne('SELECT * FROM fabrics WHERE id = ?', [req.params.id]);
    if (!fabric) return res.status(404).json({ error: 'Not found' });

    const updates = [];
    const params = [];

    if (req.body.name !== undefined) {
      updates.push('name = ?');
      params.push(req.body.name.trim());
    }
    if (req.body.description !== undefined) {
      updates.push('description = ?');
      params.push(req.body.description);
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?');
      params.push(Date.now());
      params.push(req.params.id);
      getDB().run(`UPDATE fabrics SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    if (req.body.member_ids && Array.isArray(req.body.member_ids)) {
      getDB().run('DELETE FROM fabric_members WHERE fabric_id = ?', [req.params.id]);
      for (const m of req.body.member_ids) {
        if (!m.type || !m.id) continue;
        getDB().run(
          'INSERT OR IGNORE INTO fabric_members (fabric_id, member_type, member_id) VALUES (?, ?, ?)',
          [req.params.id, m.type, m.id]
        );
      }
    }

    persist();
    res.json(_getFabricWithMembers(req.params.id));
  } catch (err) {
    console.error('PATCH /api/fabrics/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/fabrics/:id/members — 멤버 추가/제거
router.patch('/:id/members', (req, res) => {
  try {
    const fabric = getOne('SELECT id FROM fabrics WHERE id = ?', [req.params.id]);
    if (!fabric) return res.status(404).json({ error: 'Not found' });

    const { add_members, remove_members } = req.body;

    if (remove_members && Array.isArray(remove_members)) {
      for (const m of remove_members) {
        getDB().run(
          'DELETE FROM fabric_members WHERE fabric_id = ? AND member_type = ? AND member_id = ?',
          [req.params.id, m.type, m.id]
        );
      }
    }

    if (add_members && Array.isArray(add_members)) {
      for (const m of add_members) {
        if (!['fiber', 'thread', 'stitch'].includes(m.type)) continue;
        getDB().run(
          'INSERT OR IGNORE INTO fabric_members (fabric_id, member_type, member_id) VALUES (?, ?, ?)',
          [req.params.id, m.type, m.id]
        );
      }
    }

    getDB().run('UPDATE fabrics SET updated_at = ? WHERE id = ?', [Date.now(), req.params.id]);
    persist();

    res.json(_getFabricWithMembers(req.params.id));
  } catch (err) {
    console.error('PATCH /api/fabrics/:id/members error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/fabrics/:id
router.delete('/:id', (req, res) => {
  try {
    const fabric = getOne('SELECT id FROM fabrics WHERE id = ?', [req.params.id]);
    if (!fabric) return res.status(404).json({ error: 'Not found' });

    getDB().run('DELETE FROM fabric_members WHERE fabric_id = ?', [req.params.id]);
    getDB().run('DELETE FROM fabrics WHERE id = ?', [req.params.id]);
    persist();

    res.status(204).end();
  } catch (err) {
    console.error('DELETE /api/fabrics/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function _getFabricWithMembers(id) {
  const fabric = getOne('SELECT * FROM fabrics WHERE id = ?', [id]);
  if (!fabric) return null;
  const members = getAll(
    'SELECT member_type, member_id FROM fabric_members WHERE fabric_id = ?',
    [id]
  );
  fabric.members = members.map(m => ({ type: m.member_type, id: m.member_id }));
  fabric.thread_ids = members
    .filter(m => m.member_type === 'thread')
    .map(m => m.member_id);
  return fabric;
}

module.exports = router;
