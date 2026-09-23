// 统一知乎 transport 层（v1 §4）：web（zse96 签名）/ android 两条通道 + fallback 编排 + 重试策略（§22）
// 重试只针对 timeout/ECONNRESET/5xx；401/403/429/404 立即 fallback，不撞墙。
import { getCookies } from './credentials.js';
import { signRequest } from './zse-signer.js';
import { rateLimit } from './rate-limiter.js';
import { EnvelopeError, codeFromHttpStatus } from './errors.js';
import { cacheGet, cacheSet } from './cache.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const ZSE93 = '101_3_3.0';

const ANDROID_HEADERS = {
  'x-api-version': '3.1.8',
  'x-app-version': '10.61.0',
  'x-app-za': 'OS=Android&Release=12&Model=sdk_gphone64_arm64&VersionName=10.61.0&VersionCode=26107&Product=com.zhihu.android&Width=1440&Height=2952&Installer=%E7%81%B0%E5%BA%A6&DeviceType=AndroidPhone&Brand=google',
  'User-Agent': 'com.zhihu.android/Futureve/10.61.0 Mozilla/5.0 (Linux; Android 12; sdk_gphone64_arm64 Build/SE1A.220630.001.A1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/57.0.1000.10 Mobile Safari/537.36'
};

function cookieHeader() {
  const cookies = getCookies();
  const entries = Object.entries(cookies);
  if (!entries.length) return '';
  return entries.map(([k, v]) => `${k}=${v}`).join('; ');
}

const RETRYABLE = ['upstream_timeout', 'network_error'];

async function fetchOnce(url, headers, timeoutMs) {
  let resp;
  try {
    resp = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    // 原始网络异常统一转 envelope，否则 retry 层看不到 retryable code（ AbortError/TypeError/ECONNRESET）
    const name = e?.name || '';
    if (name === 'AbortError' || name === 'TimeoutError' || /timed?\s?out/i.test(String(e?.message))) {
      throw new EnvelopeError('upstream_timeout', `请求超时（${timeoutMs}ms）: ${url.slice(0, 120)}`);
    }
    throw new EnvelopeError('network_error', `网络错误: ${String(e?.message || e).slice(0, 160)}`);
  }
  if (resp.ok) return resp.json();
  const code = codeFromHttpStatus(resp.status);
  throw new EnvelopeError(code, `HTTP ${resp.status}: ${resp.statusText}`);
}

// 带重试的请求：仅 retryable 错误重试（最多 2 次，指数退避）
async function fetchWithRetry(url, headers, { timeoutMs = 15000, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchOnce(url, headers, timeoutMs);
    } catch (e) {
      lastErr = e;
      const env = e.__envelope;
      if (!env || !RETRYABLE.includes(env.error.code) || attempt === retries) throw e;
      await new Promise(r => setTimeout(r, 800 * Math.pow(2, attempt)));
    }
  }
  throw lastErr;
}

// Web API：zse96 v2 签名（有 d_c0 时）
export async function zhihuWebRequest(pathOrUrl, { useCache = true, cacheTtlMs = undefined } = {}) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `https://www.zhihu.com/api/v4/${pathOrUrl.replace(/^\/+/, '')}`;
  const cacheKey = `web:${url}`;
  if (useCache) {
    const hit = cacheGet(cacheKey);
    if (hit) return { data: hit, cached: true };
  }
  await rateLimit('zhihu_web');
  const cookies = getCookies();
  const headers = {
    'User-Agent': UA,
    'x-zse-93': ZSE93,
    'x-requested-with': 'fetch',
    'Referer': 'https://www.zhihu.com/'
  };
  if (Object.keys(cookies).length) headers['Cookie'] = cookieHeader();
  const dc0 = cookies['d_c0'] || '';
  if (dc0) headers['x-zse-96'] = signRequest(url, dc0, null, ZSE93);
  const data = await fetchWithRetry(url, headers);
  if (useCache) cacheSet(cacheKey, data, cacheTtlMs);
  return { data, cached: false };
}

// Android API：无需签名
export async function zhihuAndroidRequest(url, { useCache = true, cacheTtlMs = undefined } = {}) {
  const cacheKey = `android:${url}`;
  if (useCache) {
    const hit = cacheGet(cacheKey);
    if (hit) return { data: hit, cached: true };
  }
  await rateLimit('zhihu_android');
  const headers = { ...ANDROID_HEADERS };
  if (Object.keys(getCookies()).length) headers['Cookie'] = cookieHeader();
  const data = await fetchWithRetry(url, headers);
  if (useCache) cacheSet(cacheKey, data, cacheTtlMs);
  return { data, cached: false };
}

// fallback 链编排：依次尝试各 transport，全败抛最后一个 envelope
export async function withFallback(attempts) {
  let lastErr;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (e) {
      lastErr = e;
      const code = e?.__envelope?.error?.code;
      // 404/输入类错误没有 fallback 价值，直接抛
      if (code === 'not_found' || code === 'invalid_input' || code === 'not_authenticated') throw e;
      // 其余（anti_bot_blocked/network/timeout/parse）继续下一层
    }
  }
  throw lastErr;
}
