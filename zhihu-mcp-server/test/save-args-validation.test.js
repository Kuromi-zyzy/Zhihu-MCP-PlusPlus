import { test } from 'node:test';
import assert from 'node:assert/strict';

// save_* 工具的入参校验逻辑与 index.js 保持同一套规则。
// 这里复制校验正则/枚举做纯函数级回归：恶意 ID 必须在进入 python 进程前被拦下。

const ID_RE = /^\d{3,32}$/;
const SORTS = ['default', 'voteups', 'created'];

function validId(v) {
  return ID_RE.test(String(v ?? '').trim());
}

test('requireValidId 规则: 合法知乎数字 ID 通过', () => {
  assert.ok(validId('46278480'));
  assert.ok(validId(' 320078376 ')); // 容忍首尾空白
  assert.ok(validId('111186496'));
});

test('requireValidId 规则: shell 注入载荷全部拒绝', () => {
  for (const evil of [
    '123 && calc',
    '123; rm -rf /',
    '123 | dir',
    '123 `whoami`',
    '123 $(shutdown)',
    '123\n& format c:',
    '1;2',
    'abc',
    '',
    null,
    undefined,
    '12',                    // 过短
    '1234567890123456789012345678901234567890' // 过长
  ]) {
    assert.equal(validId(evil), false, `should reject: ${JSON.stringify(evil)}`);
  }
});

test('requireValidId 规则: 负数/小数/科学计数法拒绝', () => {
  for (const evil of ['-123', '1.23', '1e5', '+123', '0x10']) {
    assert.equal(validId(evil), false, `should reject: ${evil}`);
  }
});

test('sort 枚举: 非法值必须在白名单外', () => {
  for (const s of SORTS) assert.ok(SORTS.includes(s));
  for (const bad of ['voteups; rm', 'DEFAULT', '', null, '1']) {
    assert.equal(SORTS.includes(String(bad)), false, `should reject: ${JSON.stringify(bad)}`);
  }
});
