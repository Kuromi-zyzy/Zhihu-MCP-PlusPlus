#!/usr/bin/env node
// Integration smoke test（v1 §28）：无账号也必须完成大部分检查。
// 用法：node scripts/smoke-test.mjs [--http URL]（默认自起 stdio 子进程）
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const results = [];
const add = (name, pass, note = '') => {
  results.push({ name, pass, note });
  console.log(`${pass ? '✓' : '✗'} ${name}${note ? ' — ' + note : ''}`);
};

const proc = spawn('node', [path.join(__dirname, '..', 'index.js')], {
  stdio: ['pipe', 'pipe', 'pipe'],
  // smoke 必须跑在隔离数据目录：不读真实凭据库、不写真实凭据库（rc3 曾因此让
  // CI runner "logged_in=true"、本地 npm test 覆盖真实 Cookie——P0 级污染）
  env: { ...process.env, ZHIHU_MCP_DATA_DIR: process.env.ZHIHU_MCP_DATA_DIR || path.join(process.env.TEMP || '/tmp', `zhmcp_smoke_${process.pid}`) }
});
let buf = '';
proc.stdout.on('data', d => { buf += d.toString(); });
function send(obj) {
  return new Promise(res => {
    buf = '';
    proc.stdin.write(JSON.stringify(obj) + '\n');
    const t = setInterval(() => {
      const nl = buf.indexOf('\n');
      if (nl >= 0) { clearInterval(t); res(JSON.parse(buf.slice(0, nl))); }
    }, 50);
    setTimeout(() => { clearInterval(t); res(null); }, 60000);
  });
}

try {
  await send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } });
  await send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  add('mcp initialize', true);

  const list = await send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const tools = list?.result?.tools || [];
  add('list tools', tools.length >= 20, `${tools.length} tools, annotated=${tools.every(t => t.annotations)}`);

  const call = async (id, name, args) => {
    const r = await send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
    try { return JSON.parse(r?.result?.content?.[0]?.text || '{}'); } catch { return { ok: false }; }
  };

  const a = await call(10, 'zhihu_auth_status', {});
  // 隔离目录下必须是未登录态：若为 true 说明凭据隔离被破坏（测试/迁移污染）——硬失败
  add('auth status (fresh, not logged in)', a.ok === true && a.data?.logged_in === false,
    a.ok ? `logged_in=${a.data?.logged_in}` : `error=${a.error?.code}: ${String(a.error?.message).slice(0, 120)}`);

  const r = await call(11, 'zhihu_resolve_url', { url: 'https://www.zhihu.com/question/123/answer/456' });
  add('resolve url', r.ok === true && r.data?.type === 'answer');

  // 以下两项依赖外网（Bing/知乎）。CI 沙箱可能无外网：无有效响应时记 skip 而非 fail。
  const b = await call(12, 'zhihu_search', { query: 'zhihu', source: 'web', limit: 3 });
  add('bing search', b.ok === true, b.ok ? `total=${b.data?.total}` : `skipped (${b.error?.code || 'no response'})`);

  const l = await call(13, 'zhihu_local_search', { keyword: '测试' });
  add('local search', l.ok === true, `mode=${l.data?.mode}`);

  const d = await call(14, 'zhihu_diagnostics', {});
  // sqlite 可用性是硬指标（无网络依赖）；bing 可达性在网络受限环境只记录不判失败
  const sqliteOk = d.ok === true && d.data?.sqlite?.ok === true;
  add('diagnostics (sqlite)', sqliteOk, d.ok ? `sqlite=${d.data?.sqlite?.ok} bing=${d.data?.bing?.reachable}` : `error=${d.error?.code}: ${String(d.error?.message).slice(0, 120)}`);
  add('diagnostics (bing reachable)', d.ok === true ? (d.data?.bing?.reachable === true || d.data?.bing?.reachable === false) : false,
    d.ok ? `bing=${d.data?.bing?.reachable}` : 'skipped');

  const inv = await call(15, 'zhihu_save_answer', { answer_id: 'evil; calc' });
  add('injection rejected', inv.ok === false && inv.error?.code === 'invalid_input');
} catch (e) {
  add('smoke flow', false, String(e.message).slice(0, 120));
} finally {
  proc.kill();
}

const failed = results.filter(r => !r.pass);
console.log(`\nsmoke: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
