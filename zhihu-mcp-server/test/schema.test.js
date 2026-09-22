import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ok, fail, failFromError, EnvelopeError, codeFromHttpStatus, projectFields, truncateContent, ERROR_CODES } from '../errors.js';
import { resolveZhihuUrl } from '../url-resolver.js';

// ---------- envelope ----------

test('ok/fail envelope: schema_version 与结构', () => {
  const s = ok({ a: 1 }, { source: 'zhihu_web' });
  assert.equal(s.ok, true);
  assert.equal(s.schema_version, '1.0');
  assert.equal(s.meta.source, 'zhihu_web');
  assert.equal(s.meta.cached, false);

  const f = fail('not_authenticated', '需要登录');
  assert.equal(f.ok, false);
  assert.equal(f.error.code, 'not_authenticated');
  assert.equal(f.error.retryable, false);
});

test('fail: 未知错误码兜底 internal_error', () => {
  const f = fail('no_such_code', 'x');
  assert.equal(f.error.code, 'internal_error');
});

test('错误码枚举完整（§5 全部 14 个）', () => {
  for (const c of ['invalid_input', 'not_authenticated', 'permission_denied', 'not_found', 'rate_limited',
    'anti_bot_blocked', 'network_error', 'upstream_timeout', 'upstream_changed', 'parse_error',
    'browser_error', 'storage_error', 'unsupported_content_type', 'internal_error']) {
    assert.ok(ERROR_CODES.includes(c), `missing ${c}`);
  }
});

test('codeFromHttpStatus 映射', () => {
  assert.equal(codeFromHttpStatus(401), 'not_authenticated');
  assert.equal(codeFromHttpStatus(403), 'anti_bot_blocked');
  assert.equal(codeFromHttpStatus(429), 'anti_bot_blocked');
  assert.equal(codeFromHttpStatus(404), 'not_found');
  assert.equal(codeFromHttpStatus(503), 'network_error');
});

test('failFromError: EnvelopeError 原样透传，普通异常归类', () => {
  const e1 = new EnvelopeError('rate_limited', '慢点');
  assert.equal(failFromError(e1).error.code, 'rate_limited');
  assert.equal(failFromError(new Error('fetch failed: ECONNRESET')).error.code, 'network_error');
  assert.equal(failFromError(new Error('The operation was aborted due to timeout')).error.code, 'upstream_timeout');
});

// ---------- context budget ----------

test('projectFields: 白名单投影', () => {
  const r = projectFields({ title: 't', content: 'c', voteup_count: 1 }, ['title', 'voteup_count']);
  assert.deepEqual(r, { title: 't', voteup_count: 1 });
});

test('truncateContent: 截断标记与 include_content=false', () => {
  const t1 = truncateContent({ content: 'x'.repeat(20000) }, { max_content_chars: 100 });
  assert.equal(t1.content_truncated, true);
  assert.equal(t1.content_chars, 20000);
  assert.equal(t1.content.length, 100);
  const t2 = truncateContent({ content: 'secret', title: 't' }, { include_content: false });
  assert.equal(t2.content, undefined);
  assert.equal(t2.content_omitted, true);
  assert.equal(t2.title, 't');
});

// ---------- url resolver ----------

test('resolveZhihuUrl: 全类型 + canonical_url', () => {
  const cases = [
    ['https://www.zhihu.com/question/123', 'question', '123'],
    ['https://www.zhihu.com/question/123/answer/456', 'answer', '456'],
    ['https://zhuanlan.zhihu.com/p/789', 'article', '789'],
    ['https://www.zhihu.com/tardis/zm/art/111', 'article', '111'],
    ['https://www.zhihu.com/pin/222', 'pin', '222'],
    ['https://www.zhihu.com/people/abc-def', 'user', 'abc-def'],
    ['https://www.zhihu.com/collection/333', 'collection', '333'],
  ];
  for (const [url, type, id] of cases) {
    const r = resolveZhihuUrl(url);
    assert.equal(r.type, type, url);
    assert.equal(r.id, id, url);
    assert.ok(r.canonical_url.startsWith('https://'), url);
  }
});

test('resolveZhihuUrl: 拒绝站外与非 URL 输入', () => {
  assert.equal(resolveZhihuUrl('https://evil.com/question/1'), null);
  assert.equal(resolveZhihuUrl('not-a-url'), null);
  assert.equal(resolveZhihuUrl(''), null);
});
