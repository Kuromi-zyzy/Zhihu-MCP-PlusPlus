// 统一 Credential Store（v1 §3）
// 所有登录态集中到 ~/.zhihu-mcp/credentials.json，Python 与 Node 共用。
// 旧 config.json / ~/.zhihu-mcp/config.json 只读迁移，不再写入。
// 文件权限：POSIX 尽量 0600；Windows 依赖用户私有目录（%USERPROFILE%）。
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CRED_DIR = path.join(os.homedir(), '.zhihu-mcp');
const CRED_FILE = path.join(CRED_DIR, 'credentials.json');
// 兼容迁移源（只读）
const LEGACY_MCP_CONFIG = path.join(CRED_DIR, 'config.json');

function ensureDir() {
  if (!fs.existsSync(CRED_DIR)) fs.mkdirSync(CRED_DIR, { recursive: true });
  if (process.platform !== 'win32') {
    try { fs.chmodSync(CRED_DIR, 0o700); } catch { /* best effort */ }
  }
}

function applyFilePerms() {
  if (process.platform !== 'win32') {
    try { fs.chmodSync(CRED_FILE, 0o600); } catch { /* best effort */ }
  }
}

function migrateLegacy() {
  // 迁移源 1：~/.zhihu-mcp/config.json（MCP 旧 cookies 字段）
  if (fs.existsSync(LEGACY_MCP_CONFIG)) {
    try {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_MCP_CONFIG, 'utf8'));
      if (legacy.cookies && Object.keys(legacy.cookies).length) {
        const store = {
          version: 1,
          cookies: legacy.cookies,
          user: null,
          validated_at: null,
          updated_at: new Date().toISOString(),
          migrated_from: 'mcp-config.json'
        };
        fs.writeFileSync(CRED_FILE, JSON.stringify(store, null, 2));
        applyFilePerms();
        console.error('[credentials] migrated from ~/.zhihu-mcp/config.json');
        return;
      }
    } catch (e) {
      console.error('[credentials] legacy mcp config unreadable:', e.message);
    }
  }
  // 迁移源 2：仓库根 config.json（爬虫 cookie 字段，整串解析出键值）
  const spiderConfig = path.resolve(__dirname, '..', 'config.json');
  if (fs.existsSync(spiderConfig)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(spiderConfig, 'utf8'));
      const raw = cfg.cookie || '';
      const cookies = {};
      for (const pair of raw.split(';')) {
        const idx = pair.indexOf('=');
        if (idx > 0) cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
      }
      if (Object.keys(cookies).length) {
        const store = {
          version: 1,
          cookies,
          user: null,
          validated_at: null,
          updated_at: new Date().toISOString(),
          migrated_from: 'spider-config.json'
        };
        fs.writeFileSync(CRED_FILE, JSON.stringify(store, null, 2));
        applyFilePerms();
        console.error('[credentials] migrated from spider config.json');
      }
    } catch { /* 迁移失败不阻塞启动 */ }
  }
}

function loadStore() {
  ensureDir();
  if (!fs.existsSync(CRED_FILE)) {
    migrateLegacy();
  }
  if (!fs.existsSync(CRED_FILE)) {
    return { version: 1, cookies: {}, user: null, validated_at: null, updated_at: null };
  }
  try {
    return JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'));
  } catch (e) {
    console.error('[credentials] store unreadable:', e.message);
    return { version: 1, cookies: {}, user: null, validated_at: null, updated_at: null };
  }
}

function saveStore(store) {
  ensureDir();
  store.version = 1;
  store.updated_at = new Date().toISOString();
  fs.writeFileSync(CRED_FILE, JSON.stringify(store, null, 2));
  applyFilePerms();
}

function getCookies() {
  return loadStore().cookies || {};
}

// user 统一 schema：{id, name} | null（不接受裸字符串，避免两种结构并存）
function normalizeUser(user) {
  if (user == null) return null;
  if (typeof user === 'string') return { id: null, name: user };
  if (typeof user === 'object' && (user.name || user.id)) return { id: user.id ?? null, name: user.name ?? '' };
  return null;
}

function setCookies(cookies, { user = undefined, validated_at = undefined, replace = false } = {}) {
  const store = loadStore();
  // replace=true 用于导入整套新登录态：整体替换，防止换账号后旧 Cookie 键残留
  store.cookies = replace ? { ...cookies } : { ...store.cookies, ...cookies };
  if (user !== undefined) store.user = normalizeUser(user);
  if (validated_at !== undefined) store.validated_at = validated_at;
  saveStore(store);
  return store;
}

function clearAuth() {
  const store = loadStore();
  store.cookies = {};
  store.user = null;
  store.validated_at = null;
  saveStore(store);
}

export { CRED_DIR, CRED_FILE, loadStore, saveStore, getCookies, setCookies, clearAuth, normalizeUser };
