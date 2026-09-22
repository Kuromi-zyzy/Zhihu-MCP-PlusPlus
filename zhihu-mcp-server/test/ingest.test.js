// ingest.js 单测：Markdown（YAML front matter）→ SQLite 导入
// 覆盖 zhihu_spider._write_md 实际产出的 4 类 URL 形态 + 无法识别文件跳过 + 幂等
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';

// 独立 DATA_DIR（与 storage.test.js 同法：query 参数制造独立模块实例）
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zhmcp_ing_'));
process.env.ZHIHU_MCP_DATA_DIR = DATA_DIR;
// fixture output 目录
const OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zhmcp_out_'));
process.env.ZHIHU_OUTPUT_DIR = OUTPUT_DIR;

const storage = await import(`../storage.js?case=${crypto.randomUUID()}`);
const ingest = await import(`../ingest.js?case=${crypto.randomUUID()}`);
const { upsertContent, localSearch } = storage;
const { parseMarkdownFile, importOutputMarkdown } = ingest;

function writeMd(rel, front, body) {
  const full = path.join(OUTPUT_DIR, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const fm = Object.entries(front).map(([k, v]) => `${k}: ${v}`).join('\n');
  fs.writeFileSync(full, `---\n${fm}\n---\n\n${body}\n`, 'utf8');
  return full;
}

test('parseMarkdownFile: question/answer 完整形态', () => {
  const f = writeMd('q/[101赞] 张三 - 如何入门嵌入式.md', {
    title: '如何入门嵌入式?', author: '张三', voteup: 101,
    url: 'https://www.zhihu.com/question/123456/answer/789012', created: '2026-01-01'
  }, '先学 C 语言，再上开发板，机器视觉是进阶方向。');
  const item = parseMarkdownFile(f);
  assert.equal(item.content_type, 'answer');
  assert.equal(item.content_id, '789012');
  assert.equal(item.question_id, '123456');
  assert.equal(item.voteup_count, 101);
  assert.equal(item.title, '如何入门嵌入式?');
  assert.ok(item.content.includes('机器视觉'));
});

test('parseMarkdownFile: article(zhuanlan)/pin/answer-only/question 四形态', () => {
  const fa = writeMd('a/x.md', { title: 'A', author: 'B', url: 'https://zhuanlan.zhihu.com/p/111222333' }, '正文A');
  assert.equal(parseMarkdownFile(fa).content_type, 'article');
  assert.equal(parseMarkdownFile(fa).content_id, '111222333');

  const fp = writeMd('p/x.md', { title: '', author: 'C', voteup: 0, url: 'https://www.zhihu.com/pin/222333444?native=0' }, '想法正文');
  const pin = parseMarkdownFile(fp);
  assert.equal(pin.content_type, 'pin');
  assert.equal(pin.content_id, '222333444');

  const fans = writeMd('ans/x.md', { title: 'T', author: 'D', url: 'https://www.zhihu.com/answer/333444555' }, '正文');
  assert.equal(parseMarkdownFile(fans).content_id, '333444555');

  const fq = writeMd('q/x.md', { title: '问题', author: 'E', url: 'https://www.zhihu.com/question/444555666' }, '问题摘要');
  const q = parseMarkdownFile(fq);
  assert.equal(q.content_type, 'question');
  assert.equal(q.question_id, '444555666');
});

test('parseMarkdownFile: 站外/无 URL/无 front matter 一律拒绝', () => {
  const f1 = writeMd('bad/x.md', { title: 'T', url: 'https://example.com/page/123' }, '正文');
  assert.equal(parseMarkdownFile(f1), null);
  const f2 = writeMd('bad/y.md', { title: 'T' }, '无 url 字段');
  assert.equal(parseMarkdownFile(f2), null);
  const f3 = path.join(OUTPUT_DIR, 'bad', 'plain.md');
  fs.writeFileSync(f3, '# 纯 Markdown 无 front matter\n', 'utf8');
  assert.equal(parseMarkdownFile(f3), null);
});

test('importOutputMarkdown: 全量扫描入库 → local_search 可检索 → 幂等 unchanged', () => {
  writeMd('ing/answer.md', { title: '灯光设计', author: '照明师', voteup: 5, url: 'https://www.zhihu.com/question/999888777/answer/666555444' }, '演播室灯光 系统设计 要点。');
  const r1 = importOutputMarkdown();
  assert.ok(r1.inserted >= 1, `new file must insert once, got ${JSON.stringify(r1)}`);
  assert.ok(fs.existsSync(r1.output_dir));

  const hits = localSearch({ keyword: '演播室灯光' });
  assert.ok(hits.total >= 1, `expected FTS hit, got ${hits.total}`);

  const r2 = importOutputMarkdown();
  assert.equal(r2.inserted, 0, 'SHA-256 去重：重复导入不新增');
  assert.equal(r2.unchanged, r1.inserted + r1.unchanged, '第二次扫描全部 unchanged（幂等）');
});

test('importOutputMarkdown: upsert 状态机与 storage 一致（inserted→unchanged→updated）', () => {
  const f = writeMd('upd/x.md', { title: 'V1', author: 'F', url: 'https://zhuanlan.zhihu.com/p/777888999' }, '初始正文');
  assert.equal(upsertContent(parseMarkdownFile(f)), 'inserted');
  fs.writeFileSync(f, `---\ntitle: V2\nauthor: F\nurl: https://zhuanlan.zhihu.com/p/777888999\n---\n\n更新后正文\n`, 'utf8');
  assert.equal(upsertContent(parseMarkdownFile(f)), 'updated');
  fs.writeFileSync(f, `---\ntitle: V2\nauthor: F\nurl: https://zhuanlan.zhihu.com/p/777888999\n---\n\n更新后正文\n`, 'utf8');
  assert.equal(upsertContent(parseMarkdownFile(f)), 'unchanged');
});
