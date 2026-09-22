import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';

// node --test 全部文件共享一个进程，storage.js 是模块级单例（DATA_DIR 在加载时求值）。
// 为隔离状态，这里不直接复用全局实例：用唯一 DATA_DIR + 动态 import 触发新的模块图。
// 但 ESM 缓存按 URL 唯一——加 query 参数制造独立实例。
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zhmcp_st_'));
process.env.ZHIHU_MCP_DATA_DIR = DATA_DIR;
const storage = await import(`../storage.js?case=${crypto.randomUUID()}`);

const { contentHash, upsertContent, localSearch, reindex, dbStats, semanticSearch, hybridSearch, embeddingProviderInfo } = storage;

test('contentHash: 归一化（CRLF/首尾空白）确定性', () => {
  assert.equal(contentHash('a\r\nb'), contentHash('a\nb'));
  assert.equal(contentHash('  x  '), contentHash('x'));
  assert.notEqual(contentHash('a'), contentHash('b'));
});

test('upsertContent: inserted → unchanged → updated 状态机与 hash 去重', () => {
  const item = { content_id: '99', content_type: 'answer', title: 'T', author: 'A', content: '机器视觉 学习 路线 正文' };
  assert.equal(upsertContent(item), 'inserted');
  assert.equal(upsertContent({ ...item }), 'unchanged');
  assert.equal(upsertContent({ ...item, content: '内容 v2 更新后 机器视觉 优先' }), 'updated');
});

test('localSearch: FTS 中文子串命中 + trigram 语义', () => {
  const r = localSearch({ keyword: '机器视觉' });
  assert.ok(r.total >= 1, `expected hits, got ${r.total}`);
  assert.ok(r.items[0].excerpt.length > 0);
});

test('localSearch: 短词 LIKE 兜底 + type/author 过滤', () => {
  const r1 = localSearch({ keyword: '视觉' });
  assert.ok(r1.mode === 'like' || r1.mode === 'fts');
  const r2 = localSearch({ type: 'answer' });
  assert.ok(r2.items.every(i => i.content_type === 'answer'));
  const r3 = localSearch({ author: '不存在作者xyz' });
  assert.equal(r3.total, 0);
});

test('localSearch: FTS 查询串注入安全（引号翻倍）', () => {
  const r = localSearch({ keyword: 'weird "quoted" term' });
  assert.ok(Array.isArray(r.items));
});

test('reindex + dbStats', () => {
  const r = reindex();
  assert.equal(r.rebuilt_fts, true);
  const s = dbStats();
  assert.ok(s.total >= 1);
  assert.ok(s.by_type.some(t => t.content_type === 'answer'));
});

test('semantic/hybrid: 无 provider 时明确降级 keyword_fallback，不报错（§16）', () => {
  assert.equal(embeddingProviderInfo().available, false);
  const s = semanticSearch({ keyword: '机器视觉' });
  assert.equal(s.mode, 'keyword_fallback');
  assert.ok(s.items.length >= 1);
  const h = hybridSearch({ keyword: '机器视觉' });
  assert.equal(h.mode, 'keyword_fallback');
});

test('local-hash provider: embed 可选启用后 hybrid 不崩（§16 可选能力）', () => {
  process.env.ZHIHU_EMBEDDING_PROVIDER = 'local-hash';
  process.env.ZHIHU_EMBEDDING_DIM = '128';
  const h = hybridSearch({ keyword: '机器视觉' });
  assert.ok(['hybrid', 'semantic', 'keyword_fallback'].includes(h.mode));
  delete process.env.ZHIHU_EMBEDDING_PROVIDER;
  delete process.env.ZHIHU_EMBEDDING_DIM;
});
