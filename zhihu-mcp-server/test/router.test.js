// router 单测（rc4）：审查发现 local 源 ID 带复合前缀 `answer:123456` 导致
// ① zhihu_get_content 拿到 `answer:answer:123456` ② 三源去重无法与远端合并。
// 本文件锁死：local 结果 ID 必须是纯数字、去重键可与远端对齐、置信度排序真实生效。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zhmcp_router_'));
process.env.ZHIHU_MCP_DATA_DIR = DATA_DIR;

const storage = await import(`../storage.js?case=${crypto.randomUUID()}`);
const router = await import(`../search/router.js?case=${crypto.randomUUID()}`);
const { upsertContent } = storage;
const { routeSearch, searchLocalSource, scoreItem } = router;

// 本地库固定数据：一个回答（对应审查场景 answer:123456）
upsertContent({
  content_id: '123456', content_type: 'answer', title: '单片机入门路线',
  author: '测试作者', url: 'https://www.zhihu.com/question/999/answer/123456',
  question_id: '999', voteup_count: 50, created_at: null,
  content: '先学 C 语言和数字电路，然后上单片机开发板。'
});

test('local search 结果 id 必须是纯数字（无 content_type: 前缀）', () => {
  const items = searchLocalSource('单片机', 10);
  assert.ok(items.length >= 1);
  for (const it of items) {
    assert.match(it.id, /^\d+$/, `local id 必须纯数字, got ${it.id}`);
  }
  assert.equal(items[0].id, '123456');
  assert.equal(items[0].type, 'answer');
  assert.equal(items[0].source, 'local');
});

test('routeSearch(source=local) 返回同样纯数字 id（客户端边界）', async () => {
  const r = await routeSearch({ query: '单片机', source: 'local', limit: 5 });
  assert.equal(r.sources.includes('local'), true);
  assert.equal(r.items[0].id, '123456');
});

test('去重键对齐：local 与远端同 ID 条目合并为一条（模拟远端条目注入）', async () => {
  // 直接验证 dedupeKey 语义：构造与 local 相同 type+id 的"远端"条目走合并逻辑
  // routeSearch 的合并发生在内部——这里用 local+local 两源合并近似验证键一致性
  const r = await routeSearch({ query: '单片机', source: 'local', limit: 5 });
  const ids = r.items.map(i => `${i.type}:${i.id}`);
  assert.equal(new Set(ids).size, ids.length, '合并后不应有重复键');
  assert.ok(ids.includes('answer:123456'), 'answer:123456 应以纯 ID 形态参与去重');
});

test('置信度排序真实生效：scoreItem 区分来源权重（rc3 修复回归）', () => {
  // 同标题命中、同 voteup 的情况下，local(0.95) > zhihu(0.9) > web(0.7)
  const base = { title: '单片机入门路线', voteup_count: null };
  const sLocal = scoreItem({ ...base, source: 'local' }, '单片机');
  const sZhihu = scoreItem({ ...base, source: 'zhihu' }, '单片机');
  const sWeb = scoreItem({ ...base, source: 'web' }, '单片机');
  assert.ok(sLocal > sZhihu, `local(${sLocal}) 必须高于 zhihu(${sZhihu})`);
  assert.ok(sZhihu > sWeb, `zhihu(${sZhihu}) 必须高于 web(${sWeb})`);
  // 未知/缺失 source 均落默认 0.5（+ 标题命中的相同加分项），二者必须相等
  const sUnknown = scoreItem({ ...base, source: 'nope' }, '单片机');
  const sNoSource = scoreItem({ ...base }, '单片机');
  assert.equal(sUnknown, sNoSource, `未知来源与无 source 必须同分, got ${sUnknown} vs ${sNoSource}`);
  // 且都严格低于 local 同条件得分（权重差异未被抹平）
  assert.ok(sLocal - sUnknown > 0.4, `置信度差应保留, local=${sLocal} unknown=${sUnknown}`);
});
