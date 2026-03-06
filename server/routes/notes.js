/**
 * Note Routes — 노트 CRUD + 일괄 가져오기
 */
const express = require('express');
const router = express.Router();
const { getDB, persist, generateId, getOne, getAll } = require('../db');

function _parseAnswers(note) {
  if (note && note.answers) {
    try { note.answers = JSON.parse(note.answers); } catch (e) { note.answers = null; }
  }
}

// GET /api/notes — 노트 목록
router.get('/', (req, res) => {
  try {
    const sort = req.query.sort || 'updated_at';
    const order = req.query.order || 'DESC';
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;

    const validSorts = ['created_at', 'updated_at', 'title'];
    const sortCol = validSorts.includes(sort) ? sort : 'updated_at';
    const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const notes = getAll(
      `SELECT * FROM notes ORDER BY ${sortCol} ${sortOrder} LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    notes.forEach(_parseAnswers);
    res.json(notes);
  } catch (err) {
    console.error('GET /api/notes error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/notes/:id — 노트 상세
router.get('/:id', (req, res) => {
  try {
    const note = getOne('SELECT * FROM notes WHERE id = ?', [req.params.id]);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    _parseAnswers(note);
    res.json(note);
  } catch (err) {
    console.error('GET /api/notes/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/notes — 노트 생성
router.post('/', (req, res) => {
  try {
    const { type, title, content, htmlContent, answers, bookshelfId } = req.body;
    const id = generateId('nt');
    const now = Date.now();

    getDB().run(
      `INSERT INTO notes (id, type, title, content, html_content, answers, bookshelf_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        type || 'blank',
        title || '',
        content || '',
        htmlContent || '',
        answers ? JSON.stringify(answers) : null,
        bookshelfId || null,
        now,
        now
      ]
    );
    persist();

    const note = getOne('SELECT * FROM notes WHERE id = ?', [id]);
    _parseAnswers(note);
    res.status(201).json(note);
  } catch (err) {
    console.error('POST /api/notes error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/notes/import — localStorage에서 일괄 가져오기
router.post('/import', (req, res) => {
  try {
    const { notes: noteList } = req.body;
    if (!Array.isArray(noteList)) {
      return res.status(400).json({ error: 'notes array is required' });
    }

    let imported = 0;
    for (const n of noteList) {
      if (!n.id) continue;

      // 이미 존재하면 건너뛰기
      const existing = getOne('SELECT id FROM notes WHERE id = ?', [n.id]);
      if (existing) continue;

      getDB().run(
        `INSERT INTO notes (id, type, title, content, html_content, answers, bookshelf_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          n.id,
          n.type || 'blank',
          n.title || '',
          n.content || '',
          n.htmlContent || '',
          n.answers ? JSON.stringify(n.answers) : null,
          n.bookshelfId || null,
          n.createdAt || Date.now(),
          n.updatedAt || Date.now()
        ]
      );
      imported++;
    }
    persist();
    res.status(201).json({ imported, total: noteList.length });
  } catch (err) {
    console.error('POST /api/notes/import error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/notes/:id — 노트 수정
router.patch('/:id', (req, res) => {
  try {
    const note = getOne('SELECT * FROM notes WHERE id = ?', [req.params.id]);
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const { type, title, content, htmlContent, answers, bookshelfId } = req.body;
    const now = Date.now();

    if (type !== undefined) getDB().run('UPDATE notes SET type = ? WHERE id = ?', [type, req.params.id]);
    if (title !== undefined) getDB().run('UPDATE notes SET title = ? WHERE id = ?', [title, req.params.id]);
    if (content !== undefined) getDB().run('UPDATE notes SET content = ? WHERE id = ?', [content, req.params.id]);
    if (htmlContent !== undefined) getDB().run('UPDATE notes SET html_content = ? WHERE id = ?', [htmlContent, req.params.id]);
    if (answers !== undefined) getDB().run('UPDATE notes SET answers = ? WHERE id = ?', [answers ? JSON.stringify(answers) : null, req.params.id]);
    if (bookshelfId !== undefined) getDB().run('UPDATE notes SET bookshelf_id = ? WHERE id = ?', [bookshelfId, req.params.id]);

    getDB().run('UPDATE notes SET updated_at = ? WHERE id = ?', [now, req.params.id]);
    persist();

    const updated = getOne('SELECT * FROM notes WHERE id = ?', [req.params.id]);
    _parseAnswers(updated);
    res.json(updated);
  } catch (err) {
    console.error('PATCH /api/notes/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/notes/:id — 노트 삭제
router.delete('/:id', (req, res) => {
  try {
    const note = getOne('SELECT * FROM notes WHERE id = ?', [req.params.id]);
    if (!note) return res.status(404).json({ error: 'Note not found' });

    getDB().run('DELETE FROM notes WHERE id = ?', [req.params.id]);
    persist();
    res.status(204).end();
  } catch (err) {
    console.error('DELETE /api/notes/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
