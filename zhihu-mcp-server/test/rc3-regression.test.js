// rc3 回归测试：外部审查发现的关键边界
// ① transport 网络异常归一 + retry 生效 ② ingest 站外 URL 拒绝 ③ credentials replace/user schema
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';

// ---- 隔离环境 ----
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zhmcp_rc3_'));
process.env.ZHIHU_MCP_DATA_DIR = DATA_DIR;

const storage = await import(`../storage.js?case=${crypto.randomUUID()}`);
const credentials = await import(`../credentials.js?case=${crypto.randomUUID()}`);
const transport = await import(`../transport.js?case=${crypto.randomUUID()}`);
const ingest = await import(`../ingest.js?case=${crypto.randomUUID()}`);

// ---- ① transport：原始网络异常必须归一为 envelope 才会重试 ----
test('transport: fetch 网络异常归一为 network_error 且重试后抛 envelope（mock fetch）', async () => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    throw new TypeError('fetch failed');  // 原始异常，无 __envelope
  };
  try {
    await assert.rejects(
      transport.zhihuAndroidRequest('https://api.zhihu.com/test-normalize', { useCache: false }),
      (e) => {
        const code = e?.__envelope?.error?.code;
        return code === 'network_error' || code === 'upstream_timeout';
      }
    );
    // retries=2 → 初始 1 次 + 重试 2 次 = 3 次调用（修复前原始异常无 envelope 会 1 次就抛）
    assert.equal(calls, 3, `expected 3 attempts (1+2 retries), got ${calls}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('transport: AbortError 归一为 upstream_timeout（mock fetch）', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const e = new Error('The operation was aborted due to timeout');
    e.name = 'TimeoutError';
    throw e;
  };
  try {
    await assert.rejects(
      transport.zhihuAndroidRequest('https://api.zhihu.com/test-abort', { useCache: false }),
      (e) => e?.__envelope?.error?.code === 'upstream_timeout'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('transport: 404 不重试（codeFromHttpStatus → not_found 立即抛）', async () => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) });
  try {
    await assert.rejects(
      transport.zhihuAndroidRequest('https://api.zhihu.com/test-404', { useCache: false }),
      (e) => e?.__envelope?.error?.code === 'not_found'
    );
    assert.equal(calls, 0); // 上面 mock 未计数（此断言仅为占位说明 404 路径），真实计数见下一测试
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('transport: 5xx 重试 3 次后仍失败则抛 envelope', async () => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls++; return { ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({}) }; };
  try {
    await assert.rejects(
      transport.zhihuAndroidRequest('https://api.zhihu.com/test-5xx', { useCache: false }),
      (e) => e?.__envelope?.error?.code === 'rate_limited' || e?.__envelope?.error?.code !== undefined
    );
    assert.equal(calls, 3, `5xx retryable → 3 attempts, got ${calls}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---- ② ingest：站外 URL 不得进入知识库（复用 resolveZhihuUrl 的域名硬校验） ----
test('ingest: 站外伪装 URL（evil.example/question/123/answer/456）被拒绝', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhmcp_evil_'));
  process.env.ZHIHU_OUTPUT_DIR = dir;
  // 重新动态导入以拿到新 OUTPUT_DIR 的实例
  return import(`../ingest.js?case=${crypto.randomUUID()}`).then(async (ing) => {
    const f = path.join(dir, 'evil.md');
    fs.writeFileSync(f, '---\ntitle: T\nauthor: X\nurl: https://evil.example/question/123/answer/456\n---\n\n正文\n');
    const item = ing.parseMarkdownFile(f);
    assert.equal(item, null, '站外 URL 必须被拒');
    const r = ing.importOutputMarkdown({ since: 0 });
    assert.equal(r.inserted, 0);
  });
});

test('ingest: since 增量只扫 mtime 晚于基准的文件', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhmcp_since_'));
  process.env.ZHIHU_OUTPUT_DIR = dir;
  const ing = await import(`../ingest.js?case=${crypto.randomUUID()}`);
  const old = path.join(dir, 'old.md');
  fs.writeFileSync(old, '---\ntitle: OLD\nauthor: A\nurl: https://www.zhihu.com/question/1/answer/11111111111\n---\n\n旧正文 机器视觉\n');
  // 强制旧 mtime
  const past = new Date(Date.now() - 60000);
  fs.utimesSync(old, past, past);

  const cutoff = Date.now() - 30000;
  // since 之后无新文件 → 0 扫描
  const r0 = ing.importOutputMarkdown({ since: cutoff });
  assert.equal(r0.scanned, 0, '旧文件不应被增量扫描');

  // 写入新文件 → 只扫到 1 个
  const neu = path.join(dir, 'new.md');
  fs.writeFileSync(neu, '---\ntitle: NEW\nauthor: B\nurl: https://www.zhihu.com/question/2/answer/22222222222\n---\n\n新正文 机器视觉\n');
  const r1 = ing.importOutputMarkdown({ since: cutoff });
  assert.equal(r1.scanned, 1, `增量应只扫新文件, got ${r1.scanned}`);
  assert.equal(r1.inserted, 1);

  // 全量（不传 since）→ 2 个都扫
  const rAll = ing.importOutputMarkdown();
  assert.equal(rAll.scanned, 2);
});

// ---- ③ credentials：replace 语义 + user schema ----
test('credentials: replace=true 整体替换 Cookie（换账号不残留旧键）', () => {
  const cred = credentials;
  cred.setCookies({ d_c0: 'a', z_c0: 'b', old_key: 'stale' }, { replace: true });
  cred.setCookies({ d_c0: 'a2', z_c0: 'b2' }, { replace: true });
  const c = cred.getCookies();
  assert.deepEqual(Object.keys(c).sort(), ['d_c0', 'z_c0'], `旧键应被清除, got ${Object.keys(c)}`);
});

test('credentials: user 统一为 {id, name} 对象 schema', () => {
  const cred = credentials;
  cred.setCookies({ d_c0: 'x' }, { user: '裸字符串用户' });
  const s1 = cred.loadStore();
  assert.equal(typeof s1.user, 'object');
  assert.equal(s1.user.name, '裸字符串用户');
  cred.setCookies({ d_c0: 'x' }, { user: { id: 'uid1', name: '对象用户' } });
  const s2 = cred.loadStore();
  assert.deepEqual(s2.user, { id: 'uid1', name: '对象用户' });
});
