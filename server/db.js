/**
 * SQLite Database Setup (sql.js — WebAssembly, no native deps)
 */
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'knitting.db');

let db = null;

function generateId(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
}

async function initDB() {
  const SQL = await initSqlJs();

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS fibers (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    source TEXT DEFAULT '',
    source_note_id TEXT DEFAULT '',
    source_note_title TEXT DEFAULT '',
    tension INTEGER DEFAULT 3 CHECK(tension BETWEEN 1 AND 5),
    thought TEXT DEFAULT '',
    caught_at INTEGER NOT NULL,
    spun_at INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS stitches (
    id TEXT PRIMARY KEY,
    fiber_a_id TEXT NOT NULL,
    fiber_b_id TEXT NOT NULL,
    why TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  )`);

  // Migration: add source_range column to fibers
  try {
    db.run(`ALTER TABLE fibers ADD COLUMN source_range TEXT DEFAULT NULL`);
  } catch (e) {
    // Column already exists, ignore
  }

  // Migration: add tone column to fibers (결: resonance | friction | question)
  try {
    db.run(`ALTER TABLE fibers ADD COLUMN tone TEXT DEFAULT 'resonance'`);
  } catch (e) {
    // Column already exists, ignore
  }

  db.run(`CREATE TABLE IF NOT EXISTS fiber_replies (
    id TEXT PRIMARY KEY,
    fiber_id TEXT NOT NULL,
    note TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS fiber_embeddings (
    fiber_id TEXT PRIMARY KEY,
    embedding TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reply_embeddings (
    reply_id TEXT PRIMARY KEY,
    embedding TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS knots (
    id TEXT PRIMARY KEY,
    insight TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS knot_stitches (
    knot_id TEXT NOT NULL,
    stitch_id TEXT NOT NULL,
    PRIMARY KEY (knot_id, stitch_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    type TEXT DEFAULT 'blank',
    title TEXT DEFAULT '',
    content TEXT DEFAULT '',
    html_content TEXT DEFAULT '',
    answers TEXT DEFAULT NULL,
    bookshelf_id TEXT DEFAULT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);

  persist();
  return db;
}

function persist() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  const tmpPath = DB_PATH + '.tmp';
  fs.writeFileSync(tmpPath, buffer);
  fs.renameSync(tmpPath, DB_PATH);
}

function getDB() {
  return db;
}

function rowsToObjects(result) {
  if (!result || !result.length) return [];
  const stmt = result[0];
  return stmt.values.map(row => {
    const obj = {};
    stmt.columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

function getOne(sql, params) {
  const rows = rowsToObjects(getDB().exec(sql, params));
  return rows.length ? rows[0] : null;
}

function getAll(sql, params) {
  return rowsToObjects(getDB().exec(sql, params));
}

module.exports = { initDB, getDB, persist, generateId, rowsToObjects, getOne, getAll };
