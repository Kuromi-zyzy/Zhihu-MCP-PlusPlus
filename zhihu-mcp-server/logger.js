// 结构化日志（v1 §24）：一行一 JSON 到 stderr（stdio 模式下 stdout 是协议通道）
// 禁止输出 Cookie/Authorization/完整凭证。
const REDACT = /cookie|authorization|z_c0|d_c0|sessionid/i;

function redact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (REDACT.test(k)) out[k] = '[REDACTED]';
    else if (typeof v === 'string' && v.length > 200) out[k] = v.slice(0, 200) + '…';
    else out[k] = v;
  }
  return out;
}

function log(level, fields) {
  const entry = { timestamp: new Date().toISOString(), level, ...redact(fields) };
  process.stderr.write(JSON.stringify(entry) + '\n');
}

export const logger = {
  info: (fields) => log('info', fields),
  warn: (fields) => log('warn', fields),
  error: (fields) => log('error', fields)
};
