/**
 * Fiber Routes — 올/실 CRUD + 힌트 조회
 */
const express = require('express');
const router = express.Router();
const { getDB, persist, generateId, getOne, getAll } = require('../db');
const { findSimilarFibers, saveEmbedding, deleteEmbedding, saveReplyEmbedding, deleteReplyEmbedding } = require('../services/hint');

function _parseSourceRange(fiber) {
  if (fiber && fiber.source_range) {
    try { fiber.source_range = JSON.parse(fiber.source_range); } catch (e) { fiber.source_range = null; }
  }
}

// POST /api/fibers — 올 잡기
router.post('/', (req, res) => {
  try {
    const { text, source, source_note_id, source_note_title, tension, source_range, tone } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }
    const id = generateId('fb');
    const t = Math.max(1, Math.min(5, parseInt(tension) || 3));
    const validTones = ['resonance', 'friction', 'question'];
    const safeTone = validTones.includes(tone) ? tone : 'resonance';
    const now = Date.now();

    getDB().run(
      `INSERT INTO fibers (id, text, source, source_note_id, source_note_title, tension, caught_at, source_range, tone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, text.trim(), source || '', source_note_id || '', source_note_title || '', t, now,
       source_range ? JSON.stringify(source_range) : null, safeTone]
    );
    persist();

    const fiber = getOne('SELECT * FROM fibers WHERE id = ?', [id]);
    _parseSourceRange(fiber);
    res.status(201).json(fiber);

    // 비동기로 임베딩 생성 (응답 후 처리)
    saveEmbedding(id, text.trim(), '').catch(err =>
      console.error('[embedding] 생성 실패:', err.message)
    );
  } catch (err) {
    console.error('POST /api/fibers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/fibers — 바구니 목록
router.get('/', (req, res) => {
  try {
    const sort = req.query.sort || 'caught_at';
    const order = req.query.order || 'DESC';
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;

    const validSorts = ['caught_at', 'tension', 'spun_at'];
    const sortCol = validSorts.includes(sort) ? sort : 'caught_at';
    const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const fibers = getAll(
      `SELECT * FROM fibers ORDER BY ${sortCol} ${sortOrder} LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    fibers.forEach(_parseSourceRange);
    res.json(fibers);
  } catch (err) {
    console.error('GET /api/fibers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/fibers/:id — 올/실 상세
router.get('/:id', (req, res) => {
  try {
    const fiber = getOne('SELECT * FROM fibers WHERE id = ?', [req.params.id]);
    if (!fiber) return res.status(404).json({ error: 'Not found' });
    _parseSourceRange(fiber);
    res.json(fiber);
  } catch (err) {
    console.error('GET /api/fibers/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/fibers/:id — 실 잣기 (생각 추가), 장력 변경
router.patch('/:id', (req, res) => {
  try {
    const fiber = getOne('SELECT * FROM fibers WHERE id = ?', [req.params.id]);
    if (!fiber) return res.status(404).json({ error: 'Not found' });

    const updates = [];
    const params = [];

    if (req.body.thought !== undefined) {
      updates.push('thought = ?');
      params.push(req.body.thought);
      if (req.body.thought && !fiber.spun_at) {
        updates.push('spun_at = ?');
        params.push(Date.now());
      }
    }

    if (req.body.tension !== undefined) {
      const t = Math.max(1, Math.min(5, parseInt(req.body.tension) || 3));
      updates.push('tension = ?');
      params.push(t);
    }

    if (req.body.source_range !== undefined) {
      updates.push('source_range = ?');
      params.push(req.body.source_range ? JSON.stringify(req.body.source_range) : null);
    }

    if (req.body.tone !== undefined) {
      const validTones = ['resonance', 'friction', 'question'];
      if (validTones.includes(req.body.tone)) {
        updates.push('tone = ?');
        params.push(req.body.tone);
      }
    }

    if (updates.length === 0) {
      return res.json(fiber);
    }

    params.push(req.params.id);
    getDB().run(`UPDATE fibers SET ${updates.join(', ')} WHERE id = ?`, params);
    persist();

    const updated = getOne('SELECT * FROM fibers WHERE id = ?', [req.params.id]);
    _parseSourceRange(updated);
    res.json(updated);

    // thought 변경 시 임베딩 재생성
    if (req.body.thought !== undefined) {
      saveEmbedding(req.params.id, updated.text, updated.thought).catch(err =>
        console.error('[embedding] 갱신 실패:', err.message)
      );
    }
  } catch (err) {
    console.error('PATCH /api/fibers/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/fibers/:id
router.delete('/:id', (req, res) => {
  try {
    const fiber = getOne('SELECT * FROM fibers WHERE id = ?', [req.params.id]);
    if (!fiber) return res.status(404).json({ error: 'Not found' });

    // 답글 임베딩 먼저 삭제 (fiber_replies 참조 필요)
    const replies = getAll('SELECT id FROM fiber_replies WHERE fiber_id = ?', [req.params.id]);
    for (const r of replies) {
      deleteReplyEmbedding(r.id);
    }
    getDB().run('DELETE FROM fiber_replies WHERE fiber_id = ?', [req.params.id]);
    // 관련 stitch의 knot_stitches 먼저 정리
    const relatedStitches = getAll(
      'SELECT id FROM stitches WHERE fiber_a_id = ? OR fiber_b_id = ?',
      [req.params.id, req.params.id]
    );
    for (const s of relatedStitches) {
      getDB().run('DELETE FROM knot_stitches WHERE stitch_id = ?', [s.id]);
    }
    getDB().run('DELETE FROM stitches WHERE fiber_a_id = ? OR fiber_b_id = ?', [req.params.id, req.params.id]);
    deleteEmbedding(req.params.id);
    getDB().run('DELETE FROM fibers WHERE id = ?', [req.params.id]);
    persist();

    res.status(204).end();
  } catch (err) {
    console.error('DELETE /api/fibers/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/fibers/:id/hints — 유사 올 조회 (하이브리드 스코어링)
router.get('/:id/hints', (req, res) => {
  try {
    const result = findSimilarFibers(req.params.id);
    res.json(result);
  } catch (err) {
    console.error('GET /api/fibers/:id/hints error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/fibers/:id/replies — 답글 생성
router.post('/:id/replies', (req, res) => {
  try {
    const fiber = getOne('SELECT * FROM fibers WHERE id = ?', [req.params.id]);
    if (!fiber) return res.status(404).json({ error: 'Fiber not found' });
    const { note } = req.body;
    if (!note || !note.trim()) return res.status(400).json({ error: 'note is required' });
    const id = generateId('rp');
    const now = Date.now();
    getDB().run('INSERT INTO fiber_replies (id, fiber_id, note, created_at) VALUES (?, ?, ?, ?)',
      [id, req.params.id, note.trim(), now]);
    persist();
    res.status(201).json({ id, fiber_id: req.params.id, note: note.trim(), created_at: now });

    // 비동기로 답글 임베딩 생성
    saveReplyEmbedding(id, note.trim()).catch(err =>
      console.error('[embedding] 답글 임베딩 생성 실패:', err.message)
    );
  } catch (err) {
    console.error('POST /api/fibers/:id/replies error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/fibers/:id/replies — 답글 목록
router.get('/:id/replies', (req, res) => {
  try {
    const replies = getAll('SELECT * FROM fiber_replies WHERE fiber_id = ? ORDER BY created_at ASC', [req.params.id]);
    res.json(replies);
  } catch (err) {
    console.error('GET /api/fibers/:id/replies error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/fibers/:fid/replies/:rid — 답글 삭제
router.delete('/:fid/replies/:rid', (req, res) => {
  try {
    deleteReplyEmbedding(req.params.rid);
    getDB().run('DELETE FROM fiber_replies WHERE id = ? AND fiber_id = ?', [req.params.rid, req.params.fid]);
    persist();
    res.status(204).end();
  } catch (err) {
    console.error('DELETE /api/fibers/:fid/replies/:rid error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
