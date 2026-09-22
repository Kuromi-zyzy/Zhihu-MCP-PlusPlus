// Bing 检索知乎（zhihu_search_web 的实现层，独立成模块便于 fixture 回归测试）
// cn.bing.com 对中文多词查询会静默丢弃 site: 限制（实测），结果必须按域名硬过滤；
// DDG 大陆直连不可达，不做回退。纯 fetch + 正则解析，无新依赖。

const BING_UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
];

const BING_TIMEOUT_MS = 15000;

function decodeHtmlEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function unwrapBingHref(h) {
  let url = h.replace(/&amp;/g, '&');
  if (url.startsWith('/')) url = 'https://cn.bing.com' + url;
  // bing 偶发 /ck/a?...&u=a1<base64url> 跳转包装
  const m = url.match(/[?&]u=a1([\w-]+)/);
  if (m) {
    try { return Buffer.from(m[1], 'base64url').toString('utf8'); } catch { /* keep url */ }
  }
  return url;
}

// 从知乎 URL 提取内容类型与 ID
function classifyZhihuUrl(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)zhihu\.com$/.test(u.hostname)) return null;
    let m = u.pathname.match(/\/question\/(\d+)(?:\/answer\/(\d+))?/);
    if (m) {
      return m[2]
        ? { type: 'answer', id: m[2], question_id: m[1] }
        : { type: 'question', id: m[1] };
    }
    m = u.pathname.match(/\/pin\/(\d+)/);
    if (m) return { type: 'pin', id: m[1] };
    // tardis/bd、tardis/zm 是知乎给搜索引擎的文章镜像页，数字 ID 与专栏文章一致
    m = u.pathname.match(/\/tardis\/(?:bd|zm)\/art\/(\d+)/);
    if (m) return { type: 'article', id: m[1], canonical_url: `https://zhuanlan.zhihu.com/p/${m[1]}` };
    m = u.pathname.match(/\/p\/(\d+)/);
    if (m && u.hostname === 'zhuanlan.zhihu.com') return { type: 'article', id: m[1] };
    m = u.pathname.match(/\/people\/([^/]+)/);
    if (m) return { type: 'user', id: decodeURIComponent(m[1]) };
    m = u.pathname.match(/\/collection\/(\d+)/);
    if (m) return { type: 'collection', id: m[1] };
    return { type: 'other', id: null };
  } catch {
    return null;
  }
}

// 各类型对应的后续 MCP 工具（pin/other 暂无专用工具，给出替代路径）
const ZHIHU_NEXT_TOOLS = {
  question: ['zhihu_get_question', 'zhihu_question_answers', 'zhihu_save_question'],
  answer: ['zhihu_get_answer', 'zhihu_save_answer'],
  article: ['zhihu_get_article', 'zhihu_save_article'],
  user: ['zhihu_get_user'],
  collection: ['zhihu_save_collection'],
  pin: ['zhihu_get_answer (pin 暂无专用工具，可从所属问题入手)'],
  other: []
};

// 从 Bing 结果页 HTML 解析结果列表（导出供测试）
function parseBingResults(html) {
  const chunks = html.split(/<li class="b_algo[ "]/).slice(1);
  const raw = [];
  for (const c of chunks) {
    const hrefM = c.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"/);
    if (!hrefM) continue;
    const titleM = c.match(/<h2[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/);
    const snipM = c.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    // 先剥标签、再解码实体、解码后可能露出新标签（&lt;b&gt; → <b>），再剥一次
    const clean = (s) => decodeHtmlEntities(
      decodeHtmlEntities((s || '').replace(/<[^>]*>/g, '')).replace(/<[^>]*>/g, '')
    ).trim();
    raw.push({
      title: clean(titleM ? titleM[1] : ''),
      url: unwrapBingHref(hrefM[1]),
      snippet: clean(snipM ? snipM[1] : '').slice(0, 300)
    });
  }
  return raw;
}

async function bingSearchZhihu(query, limit) {
  const q = /site:[^\s]*zhihu/i.test(query) ? query : `site:zhihu.com ${query}`;
  const url = `https://cn.bing.com/search?q=${encodeURIComponent(q)}&setlang=zh-CN&count=${Math.min(limit * 3, 30)}`;
  await new Promise(r => setTimeout(r, 300 + Math.floor(Math.random() * 700)));
  const resp = await fetch(url, {
    headers: {
      'User-Agent': BING_UA_POOL[Math.floor(Math.random() * BING_UA_POOL.length)],
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Referer': 'https://cn.bing.com/'
    },
    signal: AbortSignal.timeout(BING_TIMEOUT_MS)
  });
  if (!resp.ok) {
    throw new Error(`bing HTTP ${resp.status}: ${resp.statusText}`);
  }
  const html = await resp.text();
  return parseBingResults(html);
}

export { bingSearchZhihu, classifyZhihuUrl, parseBingResults, ZHIHU_NEXT_TOOLS, unwrapBingHref, decodeHtmlEntities };
