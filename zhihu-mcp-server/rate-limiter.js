// 统一限流器（v1 §21）：按 source 独立限速，替代散落的 sleep()
const DEFAULTS = {
  zhihu_web: 1000,      // 知乎 Web API ≥1s
  zhihu_android: 1000,  // Android API ≥1s
  bing: 1000,           // Bing ≥1s
  browser: 2000         // 浏览器链路 ≥2s
};

const lastAt = new Map();

async function rateLimit(source, minIntervalMs = undefined) {
  const interval = minIntervalMs ?? DEFAULTS[source] ?? 1000;
  const prev = lastAt.get(source) || 0;
  const now = Date.now();
  const wait = prev + interval - now;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastAt.set(source, Date.now());
}

export { rateLimit, DEFAULTS as RATE_LIMIT_DEFAULTS };
