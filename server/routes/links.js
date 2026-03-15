/**
 * Link Routes — 연결 CRUD
 * DB tables: links, link_members
 */
const express = require('express');
const router = express.Router();
const { getDB, persist, generateId, getOne, getAll } = require('../db');

// POST /api/links — 연결 만들기
router.post('/', (req, res) => {
  try {
    const { members, why } = req.body;
    if (!members || !Array.isArray(members) || members.length < 2) {
      return res.status(400).json({ error: '2개 이상의 조각 ID가 필요합니다' });
    }

    const uniqueIds = [...new Set(members)];
    if (uniqueIds.length < 2) {
      return res.status(400).json({ error: '2개 이상의 서로 다른 조각이 필요합니다' });
    }

    // 조각 존재 및 소유권 확인
    for (const fid of uniqueIds) {
      if (!getOne('SELECT id FROM fibers WHERE id = ? AND user_id = ?', [fid, req.user.id])) {
        return res.status(404).json({ error: '조각을 찾을 수 없습니다: ' + fid });
      }
    }

    const id = generateId('lk');
    const now = Date.now();

    getDB().run(
      'INSERT INTO links (id, user_id, why, created_at) VALUES (?, ?, ?, ?)',
      [id, req.user.id, why || '', now]
    );
    uniqueIds.forEach((fid, i) => {
      getDB().run(
        'INSERT INTO link_members (link_id, fiber_id, sort_order) VALUES (?, ?, ?)',
        [id, fid, i]
      );
    });
    persist();

    res.status(201).json(_getLinkWithMembers(id, req.user.id));
  } catch (err) {
    console.error('POST /api/links error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/links — 연결 목록 (?fiber_id= 로 특정 조각의 연결 조회)
router.get('/', (req, res) => {
  try {
    const fiberId = req.query.fiber_id;
    let links;

    if (fiberId) {
      const linkIds = getAll(
        'SELECT DISTINCT lm.link_id FROM link_members lm JOIN links l ON l.id = lm.link_id WHERE lm.fiber_id = ? AND l.user_id = ?',
        [fiberId, req.user.id]
      ).map(r => r.link_id);

      if (!linkIds.length) return res.json([]);

      const placeholders = linkIds.map(() => '?').join(',');
      links = getAll(
        `SELECT * FROM links WHERE id IN (${placeholders}) AND user_id = ? ORDER BY created_at DESC`,
        [...linkIds, req.user.id]
      );
    } else {
      links = getAll('SELECT * FROM links WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
    }

    for (const link of links) {
      _attachMembers(link);
    }

    res.json(links);
  } catch (err) {
    console.error('GET /api/links error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/links/:id — 연결 상세
router.get('/:id', (req, res) => {
  try {
    const link = _getLinkWithMembers(req.params.id, req.user.id);
    if (!link) return res.status(404).json({ error: 'Not found' });
    res.json(link);
  } catch (err) {
    console.error('GET /api/links/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/links/:id — 연결 삭제
router.delete('/:id', (req, res) => {
  try {
    const link = getOne('SELECT id FROM links WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!link) return res.status(404).json({ error: 'Not found' });

    getDB().run('DELETE FROM link_members WHERE link_id = ?', [req.params.id]);
    getDB().run('DELETE FROM links WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    persist();

    res.status(204).end();
  } catch (err) {
    console.error('DELETE /api/links/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function _getLinkWithMembers(id, userId) {
  const link = getOne('SELECT * FROM links WHERE id = ? AND user_id = ?', [id, userId]);
  if (!link) return null;
  _attachMembers(link);
  return link;
}

function _attachMembers(link) {
  const members = getAll(
    `SELECT f.* FROM link_members lm
     JOIN fibers f ON f.id = lm.fiber_id
     WHERE lm.link_id = ?
     ORDER BY lm.sort_order`,
    [link.id]
  );
  members.forEach(m => {
    if (m.source_range) {
      try { m.source_range = JSON.parse(m.source_range); } catch (e) { m.source_range = null; }
    }
  });
  link.members = members;
  link.member_ids = members.map(m => m.id);
}

module.exports = router;
