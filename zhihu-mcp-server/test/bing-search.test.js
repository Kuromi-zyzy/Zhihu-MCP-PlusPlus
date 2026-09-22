import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { parseBingResults, classifyZhihuUrl, ZHIHU_NEXT_TOOLS, unwrapBingHref } from '../bing-search.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(path.join(__dirname, 'fixtures', 'bing-search.html'), 'utf8');

// ---------- Bing HTML 解析（真实页面 fixture 回归） ----------

test('parseBingResults: 真实 fixture 解析出多条结果且字段齐全', () => {
  const items = parseBingResults(fixture);
  assert.ok(items.length >= 3, `expected >=3 items, got ${items.length}`);
  for (const it of items) {
    assert.equal(typeof it.title, 'string');
    assert.ok(it.title.length > 0, 'title should be non-empty');
    assert.ok(/^https?:\/\//.test(it.url), `url should be absolute, got ${it.url}`);
    assert.equal(typeof it.snippet, 'string');
  }
});

test('parseBingResults: 实体与标签清理', () => {
  const html = `<li class="b_algo"><h2><a href="https://zhuanlan.zhihu.com/p/1">A &amp; B 测试</a></h2><p>摘 &lt;b&gt;要&lt;/b&gt; 内容&nbsp;here</p></li>`;
  const [it] = parseBingResults(html);
  assert.equal(it.title, 'A & B 测试');
  assert.equal(it.snippet, '摘 要 内容 here');
});

test('unwrapBingHref: 处理 /ck/a u=a1 base64url 包装', () => {
  const wrapped = 'https://cn.bing.com/ck/a?!&p=xx&u=a1aHR0cHM6Ly93d3cuemhpaHUuY29tL3F1ZXN0aW9uLzEyMz&ntb=1';
  assert.equal(unwrapBingHref(wrapped), 'https://www.zhihu.com/question/123');
});

// ---------- classifyZhihuUrl：类型/ID 提取全类型覆盖 ----------

test('classifyZhihuUrl: question', () => {
  assert.deepEqual(classifyZhihuUrl('https://www.zhihu.com/question/46278480'), { type: 'question', id: '46278480' });
});

test('classifyZhihuUrl: answer（带所属问题）', () => {
  assert.deepEqual(
    classifyZhihuUrl('https://www.zhihu.com/question/46278480/answer/12345678'),
    { type: 'answer', id: '12345678', question_id: '46278480' }
  );
});

test('classifyZhihuUrl: zhuanlan article', () => {
  assert.deepEqual(
    classifyZhihuUrl('https://zhuanlan.zhihu.com/p/644534214'),
    { type: 'article', id: '644534214' }
  );
});

test('classifyZhihuUrl: tardis 镜像页映射回专栏 canonical_url', () => {
  assert.deepEqual(
    classifyZhihuUrl('https://www.zhihu.com/tardis/bd/art/111186496'),
    { type: 'article', id: '111186496', canonical_url: 'https://zhuanlan.zhihu.com/p/111186496' }
  );
});

test('classifyZhihuUrl: pin / user / collection', () => {
  assert.deepEqual(classifyZhihuUrl('https://www.zhihu.com/pin/1700000000000000000'), { type: 'pin', id: '1700000000000000000' });
  assert.deepEqual(classifyZhihuUrl('https://www.zhihu.com/people/mono'), { type: 'user', id: 'mono' });
  assert.deepEqual(classifyZhihuUrl('https://www.zhihu.com/collection/960833771'), { type: 'collection', id: '960833771' });
});

test('classifyZhihuUrl: 站外域名一律拒绝（Bing site: 失效时的硬过滤）', () => {
  for (const u of [
    'https://baike.baidu.com/item/x/1',
    'https://www.microsoft.com/zh-cn/',
    'https://blog.csdn.net/a/b',
    'https://evil-zhihu.com/question/1',   // 伪装域（前缀拼接）
    'https://zhihu.com.evil.io/question/1', // 伪装域（后缀拼接）
    'not a url at all'
  ]) {
    assert.equal(classifyZhihuUrl(u), null, `should reject: ${u}`);
  }
});

test('classifyZhihuUrl: zhihu.com 裸域与子域都接受', () => {
  assert.ok(classifyZhihuUrl('https://zhihu.com/question/1'));
  assert.ok(classifyZhihuUrl('https://www.zhihu.com/question/1'));
  assert.ok(classifyZhihuUrl('https://zhuanlan.zhihu.com/p/2'));
});

test('ZHIHU_NEXT_TOOLS: 各类型都有下一步工具，other 为空数组', () => {
  for (const t of ['question', 'answer', 'article', 'user', 'collection', 'pin']) {
    assert.ok(Array.isArray(ZHIHU_NEXT_TOOLS[t]), `missing tools for ${t}`);
  }
  assert.deepEqual(ZHIHU_NEXT_TOOLS.other, []);
});
