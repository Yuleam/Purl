/**
 * Thread Routes — 실 CRUD (2개 이상의 올 엮기)
 * DB tables: threads, thread_fibers
 */
const express = require('express');
const router = express.Router();
const { getDB, persist, generateId, getOne, getAll } = require('../db');
const { saveThreadEmbedding, deleteThreadEmbedding } = require('../services/hint');

// POST /api/threads — 실 만들기
router.post('/', (req, res) => {
  try {
    const { fiber_ids, why } = req.body;
    if (!fiber_ids || !Array.isArray(fiber_ids) || fiber_ids.length < 2) {
      return res.status(400).json({ error: 'fiber_ids must be an array with at least 2 items' });
    }

    // 중복 제거
    const uniqueIds = [...new Set(fiber_ids)];
    if (uniqueIds.length < 2) {
      return res.status(400).json({ error: 'At least 2 distinct fibers are required' });
    }

    // 올 존재 확인
    for (const fid of uniqueIds) {
      const fiber = getOne('SELECT id FROM fibers WHERE id = ?', [fid]);
      if (!fiber) {
        return res.status(404).json({ error: `Fiber not found: ${fid}` });
      }
    }

    const id = generateId('th');
    const now = Date.now();

    getDB().run(
      'INSERT INTO threads (id, why, created_at) VALUES (?, ?, ?)',
      [id, why || '', now]
    );
    for (const fid of uniqueIds) {
      getDB().run(
        'INSERT INTO thread_fibers (thread_id, fiber_id) VALUES (?, ?)',
        [id, fid]
      );
    }
    persist();

    const thread = _getThreadWithFibers(id);
    res.status(201).json(thread);

    // 비동기 임베딩 생성
    saveThreadEmbedding(id).catch(err =>
      console.error('[thread] 임베딩 생성 실패:', err.message)
    );
  } catch (err) {
    console.error('POST /api/threads error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/threads — 실 목록
router.get('/', (req, res) => {
  try {
    let threads;
    if (req.query.fiber_id) {
      // 특정 올이 포함된 실 조회
      const threadIds = getAll(
        'SELECT DISTINCT thread_id FROM thread_fibers WHERE fiber_id = ?',
        [req.query.fiber_id]
      ).map(r => r.thread_id);

      if (!threadIds.length) return res.json([]);

      const placeholders = threadIds.map(() => '?').join(',');
      threads = getAll(
        `SELECT * FROM threads WHERE id IN (${placeholders}) ORDER BY created_at DESC`,
        threadIds
      );
    } else {
      threads = getAll('SELECT * FROM threads ORDER BY created_at DESC', []);
    }

    // 각 실에 fiber 목록 첨부
    threads.forEach(t => {
      const fibers = getAll(
        `SELECT f.id, f.text FROM thread_fibers tf
         JOIN fibers f ON f.id = tf.fiber_id
         WHERE tf.thread_id = ?`,
        [t.id]
      );
      t.fiber_ids = fibers.map(f => f.id);
      t.fibers = fibers;
    });

    res.json(threads);
  } catch (err) {
    console.error('GET /api/threads error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/threads/:id — 실 상세
router.get('/:id', (req, res) => {
  try {
    const thread = _getThreadWithFibers(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Not found' });
    res.json(thread);
  } catch (err) {
    console.error('GET /api/threads/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/threads/:id/members — 올 추가/제거
router.patch('/:id/members', (req, res) => {
  try {
    const thread = getOne('SELECT id FROM threads WHERE id = ?', [req.params.id]);
    if (!thread) return res.status(404).json({ error: 'Not found' });

    const { add_fiber_ids, remove_fiber_ids } = req.body;

    if (remove_fiber_ids && Array.isArray(remove_fiber_ids)) {
      for (const fid of remove_fiber_ids) {
        getDB().run('DELETE FROM thread_fibers WHERE thread_id = ? AND fiber_id = ?',
          [req.params.id, fid]);
      }
    }

    if (add_fiber_ids && Array.isArray(add_fiber_ids)) {
      for (const fid of add_fiber_ids) {
        const fiber = getOne('SELECT id FROM fibers WHERE id = ?', [fid]);
        if (!fiber) continue;
        const exists = getOne(
          'SELECT 1 FROM thread_fibers WHERE thread_id = ? AND fiber_id = ?',
          [req.params.id, fid]
        );
        if (!exists) {
          getDB().run('INSERT INTO thread_fibers (thread_id, fiber_id) VALUES (?, ?)',
            [req.params.id, fid]);
        }
      }
    }

    // 최소 2개 멤버 검증
    const memberCount = getOne(
      'SELECT COUNT(*) as cnt FROM thread_fibers WHERE thread_id = ?',
      [req.params.id]
    )?.cnt || 0;
    if (memberCount < 2) {
      return res.status(400).json({ error: 'Thread must have at least 2 fibers' });
    }

    persist();

    // 임베딩 갱신
    saveThreadEmbedding(req.params.id).catch(err =>
      console.error('[thread] 임베딩 갱신 실패:', err.message)
    );

    res.json(_getThreadWithFibers(req.params.id));
  } catch (err) {
    console.error('PATCH /api/threads/:id/members error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/threads/:id — why 수정
router.patch('/:id', (req, res) => {
  try {
    const thread = getOne('SELECT id FROM threads WHERE id = ?', [req.params.id]);
    if (!thread) return res.status(404).json({ error: 'Not found' });

    if (req.body.why !== undefined) {
      getDB().run('UPDATE threads SET why = ? WHERE id = ?', [req.body.why, req.params.id]);
      persist();

      saveThreadEmbedding(req.params.id).catch(err =>
        console.error('[thread] 임베딩 갱신 실패:', err.message)
      );
    }

    res.json(_getThreadWithFibers(req.params.id));
  } catch (err) {
    console.error('PATCH /api/threads/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/threads/:id
router.delete('/:id', (req, res) => {
  try {
    const thread = getOne('SELECT id FROM threads WHERE id = ?', [req.params.id]);
    if (!thread) return res.status(404).json({ error: 'Not found' });

    deleteThreadEmbedding(req.params.id);
    getDB().run('DELETE FROM thread_fibers WHERE thread_id = ?', [req.params.id]);
    getDB().run('DELETE FROM knot_stitches WHERE stitch_id = ?', [req.params.id]);
    // 코의 멤버에서도 제거
    getDB().run("DELETE FROM stitch_members WHERE member_type = 'thread' AND member_id = ?",
      [req.params.id]);
    // 편물의 멤버에서도 제거
    getDB().run("DELETE FROM fabric_members WHERE member_type = 'thread' AND member_id = ?",
      [req.params.id]);
    getDB().run('DELETE FROM threads WHERE id = ?', [req.params.id]);
    persist();

    res.status(204).end();
  } catch (err) {
    console.error('DELETE /api/threads/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function _getThreadWithFibers(id) {
  const thread = getOne('SELECT * FROM threads WHERE id = ?', [id]);
  if (!thread) return null;
  const fibers = getAll(
    `SELECT f.* FROM thread_fibers tf
     JOIN fibers f ON f.id = tf.fiber_id
     WHERE tf.thread_id = ?`,
    [id]
  );
  thread.fiber_ids = fibers.map(f => f.id);
  thread.fibers = fibers;
  return thread;
}

module.exports = router;
