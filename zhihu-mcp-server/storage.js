// 本地知识库存储（v1 §14-17）：SQLite + FTS5 全文索引 + SHA-256 去重
// 数据库文件：~/.zhihu-mcp/index.sqlite（Markdown 归档仍是人类可读主存储，SQLite 是机器查询层）
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';

const DATA_DIR = process.env.ZHIHU_MCP_DATA_DIR || path.join(os.homedir(), '.zhihu-mcp');
const DB_FILE = path.join(DATA_DIR, 'index.sqlite');

let db = null;
let embeddingDisabled = false;

function getDb() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_FILE);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS contents (
      content_id TEXT PRIMARY KEY,
      content_type TEXT NOT NULL,
      title TEXT,
      author TEXT,
      url TEXT,
      question_id TEXT,
      voteup_count INTEGER DEFAULT 0,
      created_at TEXT,
      saved_at TEXT,
      updated_at TEXT,
      content_hash TEXT,
      file_path TEXT,
      content TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_contents_type ON contents(content_type);
    CREATE INDEX IF NOT EXISTS idx_contents_hash ON contents(content_hash);
    -- 中文检索用 trigram tokenizer：unicode61 会把整段连续 CJK 当一个 token（实测），
    -- trigram 支持任意 >=3 字子串匹配；<3 字符的英文词由 LIKE 兜底
    CREATE VIRTUAL TABLE IF NOT EXISTS contents_fts USING fts5(
      title, content, author,
      content='contents', content_rowid='rowid',
      tokenize='trigram'
    );
    CREATE TABLE IF NOT EXISTS embeddings (
      content_id TEXT PRIMARY KEY,
      vector BLOB NOT NULL,
      model TEXT NOT NULL,
      dim INTEGER NOT NULL
    );
  `);
  // FTS 外部内容表需要触发器同步
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS contents_ai AFTER INSERT ON contents BEGIN
      INSERT INTO contents_fts(rowid, title, content, author) VALUES (new.rowid, new.title, new.content, new.author);
    END;
    CREATE TRIGGER IF NOT EXISTS contents_ad AFTER DELETE ON contents BEGIN
      INSERT INTO contents_fts(contents_fts, rowid, title, content, author) VALUES ('delete', old.rowid, old.title, old.content, old.author);
    END;
    CREATE TRIGGER IF NOT EXISTS contents_au AFTER UPDATE ON contents BEGIN
      INSERT INTO contents_fts(contents_fts, rowid, title, content, author) VALUES ('delete', old.rowid, old.title, old.content, old.author);
      INSERT INTO contents_fts(rowid, title, content, author) VALUES (new.rowid, new.title, new.content, new.author);
    END;
  `);
  return db;
}

export function contentHash(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  return 'sha256:' + crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

// upsert：hash 相同不重写正文，hash 不同则 update 并记 updated_at。
// 返回 'inserted' | 'unchanged' | 'updated'
export function upsertContent(item) {
  const d = getDb();
  const id = `${item.content_type}:${item.content_id}`;
  const hash = contentHash(item.content || '');
  const existing = d.prepare('SELECT content_hash FROM contents WHERE content_id = ?').get(id);
  if (existing && existing.content_hash === hash) return 'unchanged';
  const now = new Date().toISOString();
  if (existing) {
    d.prepare(`UPDATE contents SET content_type=?, title=?, author=?, url=?, question_id=?, voteup_count=?,
               updated_at=?, content_hash=?, file_path=?, content=? WHERE content_id=?`)
      .run(item.content_type, item.title ?? null, item.author ?? null, item.url ?? null, item.question_id ?? null,
           item.voteup_count ?? 0, now, hash, item.file_path ?? null, item.content ?? '', id);
    return 'updated';
  }
  d.prepare(`INSERT INTO contents (content_id, content_type, title, author, url, question_id, voteup_count,
              created_at, saved_at, updated_at, content_hash, file_path, content)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, item.content_type, item.title ?? null, item.author ?? null, item.url ?? null,
         item.question_id ?? null, item.voteup_count ?? 0, item.created_at ?? null, now, null,
         hash, item.file_path ?? null, item.content ?? '');
  return 'inserted';
}

// 本地全文检索（FTS5 trigram），支持 type/author 过滤与 limit；短关键词 LIKE 兜底
export function localSearch({ keyword, type, author, limit = 10 }) {
  const d = getDb();
  const lim = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const conds = [];
  const params = [];
  if (type) { conds.push('c.content_type = ?'); params.push(type); }
  if (author) { conds.push('c.author LIKE ?'); params.push(`%${author}%`); }
  const whereExtra = conds.length ? ' AND ' + conds.join(' AND ') : '';
  if (!keyword) {
    const rows = d.prepare(`SELECT content_id, content_type, title, author, url, question_id, voteup_count,
                             saved_at, updated_at, substr(content,1,200) as excerpt
                             FROM contents c WHERE 1=1${whereExtra} ORDER BY c.saved_at DESC LIMIT ?`)
      .all(...params, lim);
    return { items: rows, total: rows.length, mode: 'browse' };
  }
  const kw = String(keyword);
  if (kw.length < 3) {
    // trigram 最低 3 字符：短词走 LIKE 扫描（本地库规模小，可接受）
    const rows = d.prepare(`SELECT content_id, content_type, title, author, url, question_id, voteup_count,
                             saved_at, updated_at, substr(content,1,200) as excerpt
                             FROM contents c
                             WHERE (c.title LIKE ? OR c.content LIKE ? OR c.author LIKE ?)${whereExtra}
                             ORDER BY c.saved_at DESC LIMIT ?`)
      .all(`%${kw}%`, `%${kw}%`, `%${kw}%`, ...params, lim);
    return { items: rows, total: rows.length, mode: 'like' };
  }
  // FTS5 查询串安全化：双引号包裹，内部引号翻倍
  const ftsQuery = '"' + kw.replace(/"/g, '""') + '"';
  const rows = d.prepare(`SELECT c.content_id, c.content_type, c.title, c.author, c.url, c.question_id,
                           c.voteup_count, c.saved_at, c.updated_at,
                           snippet(contents_fts, 1, '『', '』', '…', 12) as excerpt,
                           bm25(contents_fts) as rank
                           FROM contents_fts f JOIN contents c ON c.rowid = f.rowid
                           WHERE contents_fts MATCH ?${whereExtra}
                           ORDER BY rank LIMIT ?`)
    .all(ftsQuery, ...params, lim);
  return { items: rows, total: rows.length, mode: 'fts' };
}

// 重建索引（zhihu_reindex）：从 output/ Markdown 与既有行重建 FTS
export function reindex() {
  const d = getDb();
  const before = d.prepare('SELECT COUNT(*) as n FROM contents').get().n;
  // 触发器同步 FTS；此处强制全表重刷 FTS 行
  d.exec(`INSERT INTO contents_fts(contents_fts) VALUES('rebuild')`);
  const after = d.prepare('SELECT COUNT(*) as n FROM contents').get().n;
  return { indexed: after, before, rebuilt_fts: true };
}

export function dbStats() {
  const d = getDb();
  const total = d.prepare('SELECT COUNT(*) as n FROM contents').get().n;
  const byType = d.prepare('SELECT content_type, COUNT(*) as n FROM contents GROUP BY content_type').all();
  return { db_file: DB_FILE, total, by_type: byType };
}

// ---------- 可选 Embedding（v1 §16）：FTS5 是核心，embedding 缺失不得阻塞 ----------
function providerInfo() {
  const p = process.env.ZHIHU_EMBEDDING_PROVIDER || '';
  if (!p || p === 'disabled') return { available: false, provider: 'disabled' };
  return { available: true, provider: p, dim: Number(process.env.ZHIHU_EMBEDDING_DIM) || 0 };
}

function embed(text) {
  const info = providerInfo();
  if (!info.available) return null;
  // v1 内置 provider：local-hash（确定性伪向量，仅用于链路联调；生产请配置真实 provider）
  if (info.provider === 'local-hash') {
    const dim = info.dim || 256;
    const vec = new Float32Array(dim);
    const tokens = String(text || '').toLowerCase();
    for (let i = 0; i < tokens.length; i++) vec[i % dim] += tokens.charCodeAt(i) % 97 / 97;
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    for (let i = 0; i < dim; i++) vec[i] /= norm;
    return { vector: Buffer.from(vec.buffer), model: 'local-hash', dim };
  }
  return null; // 未知 provider → 降级
}

export function embedUpsert(contentId, text) {
  const v = embed(text);
  if (!v) return false;
  try {
    getDb().prepare('INSERT OR REPLACE INTO embeddings (content_id, vector, model, dim) VALUES (?,?,?,?)')
      .run(contentId, v.vector, v.model, v.dim);
    return true;
  } catch { return false; }
}

function cosine(aBuf, bBuf, dim) {
  const a = new Float32Array(aBuf.buffer, aBuf.byteOffset, dim);
  const b = new Float32Array(bBuf.buffer, bBuf.byteOffset, dim);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < dim; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// semantic / hybrid：无 embedding 时明确降级为 keyword，绝不报错阻塞
export function semanticSearch({ keyword, type, limit = 10 }) {
  const info = providerInfo();
  if (!info.available) {
    const fb = localSearch({ keyword, type, limit });
    return { ...fb, mode: 'keyword_fallback', reason: 'embedding provider disabled' };
  }
  const qv = embed(keyword);
  if (!qv) {
    const fb = localSearch({ keyword, type, limit });
    return { ...fb, mode: 'keyword_fallback', reason: `provider ${info.provider} unavailable` };
  }
  const d = getDb();
  const rows = d.prepare('SELECT content_id, vector, dim FROM embeddings WHERE model = ?').all(qv.model);
  const scores = [];
  for (const r of rows) {
    if (r.dim !== qv.dim) continue;
    scores.push({ content_id: r.content_id, score: cosine(r.vector, qv.vector, qv.dim) });
  }
  scores.sort((a, b) => b.score - a.score);
  const lim = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const items = [];
  for (const s of scores.slice(0, lim)) {
    const row = d.prepare(`SELECT content_id, content_type, title, author, url, question_id, voteup_count,
                            saved_at, updated_at, substr(content,1,200) as excerpt
                            FROM contents WHERE content_id = ?`).get(s.content_id);
    if (row && (!type || row.content_type === type)) items.push({ ...row, similarity: Number(s.score.toFixed(4)) });
  }
  return { items, total: items.length, mode: 'semantic', provider: info.provider };
}

export function hybridSearch(args) {
  const info = providerInfo();
  if (!info.available) return semanticSearch(args); // 内部已降级 keyword
  const fts = localSearch({ ...args, limit: (args.limit || 10) * 2 });
  const sem = semanticSearch({ ...args, limit: (args.limit || 10) * 2, keyword: args.keyword });
  const merged = new Map();
  for (const it of fts.items) merged.set(it.content_id, { ...it, _s: 0 });
  const semItems = sem.items || [];
  const maxScore = semItems[0]?.similarity || 1;
  for (const it of semItems) {
    const prev = merged.get(it.content_id) || { ...it, _s: 0 };
    prev._s += 0.5 * (it.similarity / maxScore);
    merged.set(it.content_id, prev);
  }
  for (let i = 0; i < fts.items.length; i++) {
    const it = merged.get(fts.items[i].content_id);
    if (it) it._s += 0.5 * (1 - i / fts.items.length);
  }
  const lim = Math.min(Math.max(Number(args.limit) || 10, 1), 50);
  const items = [...merged.values()].sort((a, b) => b._s - a._s).slice(0, lim)
    .map(({ _s, ...rest }) => rest);
  return { items, total: items.length, mode: 'hybrid', provider: info.provider };
}

export { DB_FILE, providerInfo as embeddingProviderInfo, getDb };
