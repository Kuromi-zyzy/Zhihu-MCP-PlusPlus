// 轻量 SQLite 缓存（v1 §23）：question/answer/article 元数据、搜索结果，带 TTL 与 refresh 绕过
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import os from 'os';
import fs from 'fs';

const DATA_DIR = process.env.ZHIHU_MCP_DATA_DIR || path.join(os.homedir(), '.zhihu-mcp');
const DB_FILE = path.join(DATA_DIR, 'index.sqlite');

const DEFAULT_TTL_MS = {
  detail: 10 * 60 * 1000,   // 详情 10 分钟
  search: 5 * 60 * 1000,    // 搜索 5 分钟
  hot: 2 * 60 * 1000        // 热榜 2 分钟
};

let db = null;

function getDb() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_FILE);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
  return db;
}

function cacheGet(key) {
  try {
    const row = getDb().prepare('SELECT value, expires_at FROM cache WHERE key = ?').get(key);
    if (!row) return null;
    if (row.expires_at < Date.now()) {
      getDb().prepare('DELETE FROM cache WHERE key = ?').run(key);
      return null;
    }
    return JSON.parse(row.value);
  } catch { return null; }
}

function cacheSet(key, value, ttlMs) {
  try {
    getDb().prepare('INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)')
      .run(key, JSON.stringify(value), Date.now() + (ttlMs || DEFAULT_TTL_MS.detail));
  } catch { /* 缓存失败不阻塞主流程 */ }
}

export { cacheGet, cacheSet, DEFAULT_TTL_MS, DB_FILE };
