/**
 * SQLite Database Setup (better-sqlite3 — 동기 API, 파일 직접 저장)
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'knitting.db');

let _db = null;

// 라우트에서 getDB().run(sql, params) 패턴 호환용 래퍼
const dbProxy = {
  run(sql, params) {
    const args = Array.isArray(params) ? params : (params !== undefined ? [params] : []);
    return _db.prepare(sql).run(...args);
  }
};

function generateId(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
}

function initDB() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  // ─── 사용자 ───
  _db.exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);

  // 마이그레이션: verified 컬럼 (기존 사용자는 인증 완료 처리)
  try {
    _db.exec(`ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0`);
    _db.exec(`UPDATE users SET verified = 1`);
  } catch (e) {}

  // 이메일 인증 코드
  _db.exec(`CREATE TABLE IF NOT EXISTS email_verification_codes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0
  )`);

  // 마이그레이션: attempts 컬럼
  try { _db.exec(`ALTER TABLE email_verification_codes ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`); } catch (e) {}

  // 비밀번호 재설정 코드
  _db.exec(`CREATE TABLE IF NOT EXISTS password_reset_codes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0
  )`);

  // 사용자 프로필
  _db.exec(`CREATE TABLE IF NOT EXISTS user_profiles (
    user_id TEXT PRIMARY KEY,
    occupation TEXT DEFAULT '',
    context TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  )`);

  // ─── 조각 ───
  _db.exec(`CREATE TABLE IF NOT EXISTS fibers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL,
    source TEXT DEFAULT '',
    source_note_id TEXT DEFAULT '',
    source_note_title TEXT DEFAULT '',
    tension INTEGER DEFAULT 3 CHECK(tension BETWEEN 1 AND 5),
    thought TEXT DEFAULT '',
    caught_at INTEGER NOT NULL,
    spun_at INTEGER,
    source_range TEXT DEFAULT NULL,
    tone TEXT DEFAULT 'positive'
  )`);

  // 구 DB 마이그레이션
  try { _db.exec(`ALTER TABLE fibers ADD COLUMN user_id TEXT NOT NULL DEFAULT ''`); } catch (e) {}
  try { _db.exec(`ALTER TABLE fibers ADD COLUMN source_range TEXT DEFAULT NULL`); } catch (e) {}
  try { _db.exec(`ALTER TABLE fibers ADD COLUMN tone TEXT DEFAULT 'positive'`); } catch (e) {}

  // tone 값 마이그레이션: resonance/friction/question → positive/critic/hold
  try {
    _db.exec(`UPDATE fibers SET tone = 'positive' WHERE tone = 'resonance'`);
    _db.exec(`UPDATE fibers SET tone = 'critic' WHERE tone = 'friction'`);
    _db.exec(`UPDATE fibers SET tone = 'hold' WHERE tone = 'question'`);
  } catch (e) {}

  _db.exec(`CREATE TABLE IF NOT EXISTS fiber_replies (
    id TEXT PRIMARY KEY,
    fiber_id TEXT NOT NULL,
    note TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);

  _db.exec(`CREATE TABLE IF NOT EXISTS fiber_embeddings (
    fiber_id TEXT PRIMARY KEY,
    embedding TEXT NOT NULL
  )`);

  _db.exec(`CREATE TABLE IF NOT EXISTS reply_embeddings (
    reply_id TEXT PRIMARY KEY,
    embedding TEXT NOT NULL
  )`);

  // ─── 연결 ───
  _db.exec(`CREATE TABLE IF NOT EXISTS links (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT '',
    why TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  )`);

  try { _db.exec(`ALTER TABLE links ADD COLUMN user_id TEXT NOT NULL DEFAULT ''`); } catch (e) {}

  _db.exec(`CREATE TABLE IF NOT EXISTS link_members (
    link_id TEXT NOT NULL,
    fiber_id TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    PRIMARY KEY (link_id, fiber_id)
  )`);

  // ─── 만남 기록 ───
  _db.exec(`CREATE TABLE IF NOT EXISTS encounters (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT '',
    fiber_id TEXT NOT NULL,
    encountered_at INTEGER NOT NULL
  )`);

  try { _db.exec(`ALTER TABLE encounters ADD COLUMN user_id TEXT NOT NULL DEFAULT ''`); } catch (e) {}

  // ─── 레거시 테이블 (하위 호환성) ───
  _db.exec(`CREATE TABLE IF NOT EXISTS knots (id TEXT PRIMARY KEY, insight TEXT NOT NULL, created_at INTEGER NOT NULL)`);
  _db.exec(`CREATE TABLE IF NOT EXISTS knot_stitches (knot_id TEXT NOT NULL, stitch_id TEXT NOT NULL, PRIMARY KEY (knot_id, stitch_id))`);
  _db.exec(`CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, why TEXT DEFAULT '', created_at INTEGER NOT NULL)`);
  _db.exec(`CREATE TABLE IF NOT EXISTS thread_fibers (thread_id TEXT NOT NULL, fiber_id TEXT NOT NULL, PRIMARY KEY (thread_id, fiber_id))`);
  _db.exec(`CREATE TABLE IF NOT EXISTS stitches (id TEXT PRIMARY KEY, why TEXT DEFAULT '', created_at INTEGER NOT NULL)`);
  _db.exec(`CREATE TABLE IF NOT EXISTS stitch_members (stitch_id TEXT NOT NULL, member_type TEXT NOT NULL, member_id TEXT NOT NULL, PRIMARY KEY (stitch_id, member_type, member_id))`);
  _db.exec(`CREATE TABLE IF NOT EXISTS fabrics (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  _db.exec(`CREATE TABLE IF NOT EXISTS fabric_members (fabric_id TEXT NOT NULL, member_type TEXT NOT NULL, member_id TEXT NOT NULL, PRIMARY KEY (fabric_id, member_type, member_id))`);
  _db.exec(`CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, type TEXT DEFAULT 'blank', title TEXT DEFAULT '', content TEXT DEFAULT '', html_content TEXT DEFAULT '', answers TEXT DEFAULT NULL, bookshelf_id TEXT DEFAULT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);

  return _db;
}

// better-sqlite3는 파일에 자동 저장 — persist()는 하위 호환성용 no-op
function persist() {}

function getDB() {
  return dbProxy;
}

function getOne(sql, params) {
  const args = Array.isArray(params) ? params : (params !== undefined ? [params] : []);
  return _db.prepare(sql).get(...args) || null;
}

function getAll(sql, params) {
  const args = Array.isArray(params) ? params : (params !== undefined ? [params] : []);
  return _db.prepare(sql).all(...args);
}

// 하위 호환성용 (periphery.js 등 직접 호출 코드 지원)
function rowsToObjects(rows) {
  return rows || [];
}

module.exports = { initDB, getDB, persist, generateId, rowsToObjects, getOne, getAll };
