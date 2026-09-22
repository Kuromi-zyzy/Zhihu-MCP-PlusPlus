// 统一错误码与响应 envelope（v1 §5）
// 所有工具的返回都经 ok(data, meta) / fail(code, message, opts) 包装。
export const ERROR_CODES = Object.freeze([
  'invalid_input', 'not_authenticated', 'permission_denied', 'not_found',
  'rate_limited', 'anti_bot_blocked', 'network_error', 'upstream_timeout',
  'upstream_changed', 'parse_error', 'browser_error', 'storage_error',
  'unsupported_content_type', 'internal_error'
]);
export const SCHEMA_VERSION = '1.0';

// HTTP 状态码 → 错误码的映射
export function codeFromHttpStatus(status) {
  if (status === 401) return 'not_authenticated';
  if (status === 403 || status === 429) return 'anti_bot_blocked';
  if (status === 404) return 'not_found';
  if (status >= 500) return 'network_error';
  return 'network_error';
}

// 403/429 属反爬拦截 → fallback 优先，不重试；5xx/网络错误可重试
export function isRetryable(code) {
  return code === 'network_error' || code === 'upstream_timeout';
}

export function ok(data, meta = {}) {
  return {
    ok: true,
    schema_version: SCHEMA_VERSION,
    data,
    meta: { cached: false, ...meta }
  };
}

export function fail(code, message, { retryable = undefined, meta = {} } = {}) {
  if (!ERROR_CODES.includes(code)) code = 'internal_error';
  return {
    ok: false,
    schema_version: SCHEMA_VERSION,
    error: { code, message, retryable: retryable ?? isRetryable(code) },
    meta
  };
}

// 把任意异常归一成 envelope（兜底 internal_error）
export function failFromError(e, meta = {}) {
  if (e && e.__envelope) return e.__envelope;
  const msg = e && e.message ? String(e.message) : String(e);
  let code = 'internal_error';
  if (/HTTP 401/.test(msg)) code = 'not_authenticated';
  else if (/HTTP 40[34]|HTTP 429/.test(msg)) code = 'anti_bot_blocked';
  else if (/HTTP 404/.test(msg)) code = 'not_found';
  else if (/abort|timeout|timed out/i.test(msg)) code = 'upstream_timeout';
  else if (/fetch failed|ECONN|ENOTFOUND|network/i.test(msg)) code = 'network_error';
  return fail(code, msg, { meta });
}

// 供 throw 的带 envelope 错误（在深层代码里构造好再抛，避免信息丢失）
export class EnvelopeError extends Error {
  constructor(code, message, opts = {}) {
    super(message);
    this.__envelope = fail(code, message, opts);
  }
}

// ---------- Context Budget（v1 §13） ----------
// fields 白名单投影 + include_content/max_content_chars 截断

export function projectFields(obj, fields) {
  if (!Array.isArray(fields) || fields.length === 0) return obj;
  const out = {};
  for (const f of fields) {
    if (f in obj) out[f] = obj[f];
  }
  return out;
}

export function truncateContent(obj, { include_content = true, max_content_chars = 12000 } = {}) {
  if (include_content === false) {
    const { content, ...rest } = obj;
    return { ...rest, content_omitted: true };
  }
  const limit = Number(max_content_chars) || 12000;
  if (typeof obj.content === 'string' && obj.content.length > limit) {
    return { ...obj, content: obj.content.slice(0, limit), content_truncated: true, content_chars: obj.content.length };
  }
  return obj;
}
