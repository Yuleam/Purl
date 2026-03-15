/**
 * Node Routes — 범용 노드 힌트 (유사도 조회) + 부모 조회
 * fiber(fb_), thread(th_) 등 ID prefix로 타입 판별
 */
const express = require('express');
const router = express.Router();
const { findSimilarFibers, findSimilarThreads, findSimilarStitches } = require('../services/hint');
const { getDB } = require('../db');

// GET /api/nodes/:id/hints — 유사 노드 조회
router.get('/:id/hints', (req, res) => {
  try {
    const id = req.params.id;
    let result;
    if (id.startsWith('sc_')) {
      result = findSimilarStitches(id);
    } else if (id.startsWith('th_')) {
      result = findSimilarThreads(id);
    } else {
      result = findSimilarFibers(id);
    }
    res.json(result);
  } catch (err) {
    console.error('GET /api/nodes/:id/hints error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/nodes/:id/parents — 이 노드를 포함하는 상위 엔티티 조회
router.get('/:id/parents', (req, res) => {
  try {
    const db = getDB();
    const id = req.params.id;
    const prefix = id.substring(0, 3);
    const parents = [];

    // 올(fiber) → 속한 실, 코, 편물 조회
    if (prefix === 'fb_') {
      // 이 올을 포함하는 실
      const threads = db.exec(
        `SELECT t.id, t.why, t.created_at FROM threads t
         JOIN thread_fibers tf ON t.id = tf.thread_id
         WHERE tf.fiber_id = ?`, [id]
      );
      if (threads.length && threads[0].values) {
        threads[0].values.forEach(r => {
          parents.push({ id: r[0], type: 'thread', why: r[1], created_at: r[2] });
        });
      }

      // 이 올을 직접 포함하는 코
      const stitches = db.exec(
        `SELECT s.id, s.why, s.created_at FROM stitches s
         JOIN stitch_members sm ON s.id = sm.stitch_id
         WHERE sm.member_type = 'fiber' AND sm.member_id = ?`, [id]
      );
      if (stitches.length && stitches[0].values) {
        stitches[0].values.forEach(r => {
          parents.push({ id: r[0], type: 'stitch', why: r[1], created_at: r[2] });
        });
      }

      // 이 올을 직접 포함하는 편물
      const fabrics = db.exec(
        `SELECT f.id, f.name, f.description, f.created_at FROM fabrics f
         JOIN fabric_members fm ON f.id = fm.fabric_id
         WHERE fm.member_type = 'fiber' AND fm.member_id = ?`, [id]
      );
      if (fabrics.length && fabrics[0].values) {
        fabrics[0].values.forEach(r => {
          parents.push({ id: r[0], type: 'fabric', name: r[1], description: r[2], created_at: r[3] });
        });
      }
    }

    // 실(thread) → 속한 코, 편물 조회
    if (prefix === 'th_') {
      const stitches = db.exec(
        `SELECT s.id, s.why, s.created_at FROM stitches s
         JOIN stitch_members sm ON s.id = sm.stitch_id
         WHERE sm.member_type = 'thread' AND sm.member_id = ?`, [id]
      );
      if (stitches.length && stitches[0].values) {
        stitches[0].values.forEach(r => {
          parents.push({ id: r[0], type: 'stitch', why: r[1], created_at: r[2] });
        });
      }

      const fabrics = db.exec(
        `SELECT f.id, f.name, f.description, f.created_at FROM fabrics f
         JOIN fabric_members fm ON f.id = fm.fabric_id
         WHERE fm.member_type = 'thread' AND fm.member_id = ?`, [id]
      );
      if (fabrics.length && fabrics[0].values) {
        fabrics[0].values.forEach(r => {
          parents.push({ id: r[0], type: 'fabric', name: r[1], description: r[2], created_at: r[3] });
        });
      }
    }

    // 코(stitch) → 속한 편물 조회
    if (prefix === 'sc_') {
      const fabrics = db.exec(
        `SELECT f.id, f.name, f.description, f.created_at FROM fabrics f
         JOIN fabric_members fm ON f.id = fm.fabric_id
         WHERE fm.member_type = 'stitch' AND fm.member_id = ?`, [id]
      );
      if (fabrics.length && fabrics[0].values) {
        fabrics[0].values.forEach(r => {
          parents.push({ id: r[0], type: 'fabric', name: r[1], description: r[2], created_at: r[3] });
        });
      }
    }

    res.json({ parents: parents });
  } catch (err) {
    console.error('GET /api/nodes/:id/parents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
