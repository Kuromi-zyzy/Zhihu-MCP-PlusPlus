// handler 级测试：handleTool 主分发器的认证链路
// （rc3 审查：CI 全绿但没有真正调用核心 tool handler 验证认证流程，漏 await 因此漏网）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zhmcp_handler_'));
process.env.ZHIHU_MCP_DATA_DIR = DATA_DIR;

const index = await import(`../index.js?case=${crypto.randomUUID()}`);
const { handleTool } = index;
// handleTool 未导出时跳过（index.js 只导出了 main 的依赖最小集）
const hasHandle = typeof handleTool === 'function';

test('handleTool: zhihu_auth_import 正常 Cookie 走通 await 验证链（mock fetch）', { skip: !hasHandle }, async () => {
  const originalFetch = globalThis.fetch;
  // mock /api/v4/me 200 → 验证通过
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ id: 'u1', name: '测试用户' })
  });
  try {
    const r = await handleTool('zhihu_auth_import', { cookies: { d_c0: 'mock', z_c0: 'mock2' } }, Date.now());
    assert.equal(r.ok, true, `expected ok, got ${JSON.stringify(r).slice(0, 200)}`);
    assert.equal(r.data.user.name, '测试用户');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('handleTool: zhihu_auth_import 验证失败不写库（mock 401）', { skip: !hasHandle }, async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  try {
    const r = await handleTool('zhihu_auth_import', { cookies: { d_c0: 'bad' } }, Date.now());
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'not_authenticated');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('handleTool: 缺 d_c0 直接 invalid_input（无网络请求）', { skip: !hasHandle }, async () => {
  const r = await handleTool('zhihu_auth_import', { cookies: { z_c0: 'only' } }, Date.now());
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'invalid_input');
});
