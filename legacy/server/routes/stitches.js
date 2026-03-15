/**
 * Stitch Routes — 코 CRUD (2개 이상의 멤버(올/실) 엮기)
 * DB tables: stitches, stitch_members
 */
const express = require('express');
const router = express.Router();
const { getDB, persist, generateId, getOne, getAll } = require('../db');
const { saveStitchEmbedding, deleteStitchEmbedding } = require('../services/hint');

// POST /api/stitches — 코 만들기
router.post('/', (req, res) => {
  try {
    const { member_ids, why } = req.body;
    // member_ids: [{type: 'fiber'|'thread', id: '...'}, ...]
    if (!member_ids || !Array.isArray(member_ids) || member_ids.length < 2) {
      return res.status(400).json({ error: 'member_ids must be an array with at least 2 items' });
    }

    // 중복 제거 (type+id 기준)
    const seen = new Set();
    const unique = member_ids.filter(m => {
      const key = m.type + ':' + m.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (unique.length < 2) {
      return res.status(400).json({ error: 'At least 2 distinct members are required' });
    }

    // 멤버 존재 확인
    for (const m of unique) {
      if (m.type === 'fiber') {
        if (!getOne('SELECT id FROM fibers WHERE id = ?', [m.id])) {
          return res.status(404).json({ error: `Fiber not found: ${m.id}` });
        }
      } else if (m.type === 'thread') {
        if (!getOne('SELECT id FROM threads WHERE id = ?', [m.id])) {
          return res.status(404).json({ error: `Thread not found: ${m.id}` });
        }
      } else {
        return res.status(400).json({ error: `Invalid member type: ${m.type}` });
      }
    }

    const id = generateId('sc');
    const now = Date.now();

    getDB().run(
      'INSERT INTO stitches (id, why, created_at) VALUES (?, ?, ?)',
      [id, why || '', now]
    );
    for (const m of unique) {
      getDB().run(
        'INSERT INTO stitch_members (stitch_id, member_type, member_id) VALUES (?, ?, ?)',
        [id, m.type, m.id]
      );
    }
    persist();

    const stitch = _getStitchWithMembers(id);
    res.status(201).json(stitch);

    // 편물 자동 관리: 코의 실 멤버들을 편물에 모은다
    const threadMembers = unique.filter(m => m.type === 'thread').map(m => m.id);
    if (threadMembers.length >= 2) {
      _autoFabric(threadMembers);
    }

    // 비동기 임베딩 생성
    saveStitchEmbedding(id).catch(err =>
      console.error('[stitch] 임베딩 생성 실패:', err.message)
    );
  } catch (err) {
    console.error('POST /api/stitches error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/stitches — 코 목록
router.get('/', (req, res) => {
  try {
    let stitches;
    if (req.query.thread_id) {
      // 특정 실이 포함된 코 조회
      const stitchIds = getAll(
        "SELECT DISTINCT stitch_id FROM stitch_members WHERE member_type = 'thread' AND member_id = ?",
        [req.query.thread_id]
      ).map(r => r.stitch_id);

      if (!stitchIds.length) return res.json([]);

      const placeholders = stitchIds.map(() => '?').join(',');
      stitches = getAll(
        `SELECT * FROM stitches WHERE id IN (${placeholders}) ORDER BY created_at DESC`,
        stitchIds
      );
    } else if (req.query.member_id) {
      // 특정 멤버(올 또는 실)가 포함된 코 조회
      const stitchIds = getAll(
        'SELECT DISTINCT stitch_id FROM stitch_members WHERE member_id = ?',
        [req.query.member_id]
      ).map(r => r.stitch_id);

      if (!stitchIds.length) return res.json([]);

      const placeholders = stitchIds.map(() => '?').join(',');
      stitches = getAll(
        `SELECT * FROM stitches WHERE id IN (${placeholders}) ORDER BY created_at DESC`,
        stitchIds
      );
    } else {
      stitches = getAll('SELECT * FROM stitches ORDER BY created_at DESC', []);
    }

    // 각 코에 멤버 목록 첨부
    for (const s of stitches) {
      _attachMembers(s);
    }

    res.json(stitches);
  } catch (err) {
    console.error('GET /api/stitches error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/stitches/:id
router.get('/:id', (req, res) => {
  try {
    const stitch = _getStitchWithMembers(req.params.id);
    if (!stitch) return res.status(404).json({ error: 'Not found' });
    res.json(stitch);
  } catch (err) {
    console.error('GET /api/stitches/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/stitches/:id/members — 멤버 추가/제거
router.patch('/:id/members', (req, res) => {
  try {
    const stitch = getOne('SELECT id FROM stitches WHERE id = ?', [req.params.id]);
    if (!stitch) return res.status(404).json({ error: 'Not found' });

    const { add_members, remove_members } = req.body;

    if (remove_members && Array.isArray(remove_members)) {
      for (const m of remove_members) {
        getDB().run(
          'DELETE FROM stitch_members WHERE stitch_id = ? AND member_type = ? AND member_id = ?',
          [req.params.id, m.type, m.id]
        );
      }
    }

    if (add_members && Array.isArray(add_members)) {
      for (const m of add_members) {
        if (m.type !== 'fiber' && m.type !== 'thread') continue;
        const table = m.type === 'fiber' ? 'fibers' : 'threads';
        if (!getOne(`SELECT id FROM ${table} WHERE id = ?`, [m.id])) continue;
        const exists = getOne(
          'SELECT 1 FROM stitch_members WHERE stitch_id = ? AND member_type = ? AND member_id = ?',
          [req.params.id, m.type, m.id]
        );
        if (!exists) {
          getDB().run(
            'INSERT INTO stitch_members (stitch_id, member_type, member_id) VALUES (?, ?, ?)',
            [req.params.id, m.type, m.id]
          );
        }
      }
    }

    // 최소 2개 멤버 검증
    const memberCount = getOne(
      'SELECT COUNT(*) as cnt FROM stitch_members WHERE stitch_id = ?',
      [req.params.id]
    )?.cnt || 0;
    if (memberCount < 2) {
      return res.status(400).json({ error: 'Stitch must have at least 2 members' });
    }

    persist();

    saveStitchEmbedding(req.params.id).catch(err =>
      console.error('[stitch] 임베딩 갱신 실패:', err.message)
    );

    res.json(_getStitchWithMembers(req.params.id));
  } catch (err) {
    console.error('PATCH /api/stitches/:id/members error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/stitches/:id
router.delete('/:id', (req, res) => {
  try {
    const stitch = getOne('SELECT id FROM stitches WHERE id = ?', [req.params.id]);
    if (!stitch) return res.status(404).json({ error: 'Not found' });

    deleteStitchEmbedding(req.params.id);
    getDB().run('DELETE FROM stitch_members WHERE stitch_id = ?', [req.params.id]);
    // 편물의 멤버에서도 제거
    getDB().run("DELETE FROM fabric_members WHERE member_type = 'stitch' AND member_id = ?",
      [req.params.id]);
    getDB().run('DELETE FROM stitches WHERE id = ?', [req.params.id]);
    persist();

    res.status(204).end();
  } catch (err) {
    console.error('DELETE /api/stitches/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 코 생성 시 편물 자동 관리 (실 멤버들을 같은 편물에 모은다)
function _autoFabric(threadIds) {
  try {
    // 각 실이 속한 편물 찾기
    const fabricMap = {}; // threadId -> fabricId
    const fabrics = new Set();
    for (const tid of threadIds) {
      const link = getOne(
        "SELECT fabric_id FROM fabric_members WHERE member_type = 'thread' AND member_id = ?",
        [tid]
      );
      if (link) {
        fabricMap[tid] = link.fabric_id;
        fabrics.add(link.fabric_id);
      }
    }

    const unlinked = threadIds.filter(tid => !fabricMap[tid]);

    if (fabrics.size === 0) {
      // 모두 편물 없음 → 새 편물 생성
      const fabricId = generateId('fa');
      const now = Date.now();
      getDB().run(
        'INSERT INTO fabrics (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [fabricId, '자동 편물', '', now, now]
      );
      for (const tid of threadIds) {
        getDB().run(
          "INSERT INTO fabric_members (fabric_id, member_type, member_id) VALUES (?, 'thread', ?)",
          [fabricId, tid]
        );
      }
      persist();
    } else {
      // 기존 편물에 병합
      const targetFabricId = [...fabrics][0];

      // 다른 편물들의 멤버를 target으로 이동
      for (const fid of fabrics) {
        if (fid === targetFabricId) continue;
        const members = getAll(
          'SELECT member_type, member_id FROM fabric_members WHERE fabric_id = ?',
          [fid]
        );
        for (const m of members) {
          const exists = getOne(
            'SELECT 1 FROM fabric_members WHERE fabric_id = ? AND member_type = ? AND member_id = ?',
            [targetFabricId, m.member_type, m.member_id]
          );
          if (!exists) {
            getDB().run(
              'INSERT INTO fabric_members (fabric_id, member_type, member_id) VALUES (?, ?, ?)',
              [targetFabricId, m.member_type, m.member_id]
            );
          }
        }
        getDB().run('DELETE FROM fabric_members WHERE fabric_id = ?', [fid]);
        getDB().run('DELETE FROM fabrics WHERE id = ?', [fid]);
      }

      // 편물 없는 실 추가
      for (const tid of unlinked) {
        const exists = getOne(
          "SELECT 1 FROM fabric_members WHERE fabric_id = ? AND member_type = 'thread' AND member_id = ?",
          [targetFabricId, tid]
        );
        if (!exists) {
          getDB().run(
            "INSERT INTO fabric_members (fabric_id, member_type, member_id) VALUES (?, 'thread', ?)",
            [targetFabricId, tid]
          );
        }
      }

      getDB().run('UPDATE fabrics SET updated_at = ? WHERE id = ?', [Date.now(), targetFabricId]);
      persist();
    }
  } catch (err) {
    console.error('[autoFabric] error:', err.message);
  }
}

function _getStitchWithMembers(id) {
  const stitch = getOne('SELECT * FROM stitches WHERE id = ?', [id]);
  if (!stitch) return null;
  _attachMembers(stitch);
  return stitch;
}

function _attachMembers(stitch) {
  const members = getAll(
    'SELECT member_type, member_id FROM stitch_members WHERE stitch_id = ?',
    [stitch.id]
  );
  stitch.members = members.map(m => {
    const detail = m.member_type === 'fiber'
      ? getOne('SELECT id, text, tension, tone FROM fibers WHERE id = ?', [m.member_id])
      : getOne('SELECT id, why FROM threads WHERE id = ?', [m.member_id]);
    return { type: m.member_type, id: m.member_id, detail };
  });
}

module.exports = router;
