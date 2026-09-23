// Search Router（v1 §11）：auto/zhihu/web/local 多源检索 + 规范化去重合并
// 初版确定性排序：来源置信度 + voteup 元数据 + 关键词命中，不做 LLM rerank。
import { bingSearchZhihu } from './bing.js';
import { zhihuWebRequest } from '../transport.js';
import { resolveZhihuUrl } from '../url-resolver.js';
import { rateLimit } from '../rate-limiter.js';
import { localSearch } from '../storage.js';
import { EnvelopeError } from '../errors.js';

const SOURCE_CONFIDENCE = { zhihu: 0.9, web: 0.7, local: 0.95 };

function stripTags(s) {
  return String(s || '').replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
}

// 知乎站内搜索结果归一
function normalizeZhihuSearchItem(obj) {
  const o = obj?.object || obj?.target || obj || {};
  let type = o.type || '';
  // 站内 search_v3 的 type: answer/article/question/pin/search_time...
  if (type === 'search_time') return null;
  const id = o.id != null ? String(o.id) : (o.url?.match(/\/(\d+)(?:\/|$)/)?.[1] ?? null);
  if (!type || !id) return null;
  let url = o.url || '';
  if (!url) {
    url = type === 'article' ? `https://zhuanlan.zhihu.com/p/${id}`
      : type === 'answer' ? `https://www.zhihu.com/question/${o.question?.id ?? ''}/answer/${id}`
      : type === 'question' ? `https://www.zhihu.com/question/${id}`
      : type === 'pin' ? `https://www.zhihu.com/pin/${id}` : '';
  }
  const resolved = resolveZhihuUrl(url);
  return {
    type: resolved?.type || type,
    id: resolved?.id || id,
    title: stripTags(o.title || o.excerpt_title || ''),
    excerpt: stripTags(o.excerpt || o.content || ''),
    url,
    voteup_count: o.voteup_count ?? null,
    author: o.author?.name || '',
    source: 'zhihu'
  };
}

// Bing 结果归一（模块内已过滤站外）
function normalizeBingItem(r) {
  const resolved = resolveZhihuUrl(r.url);
  if (!resolved) return null;
  return {
    type: resolved.type,
    id: resolved.id,
    question_id: resolved.question_id,
    title: r.title,
    excerpt: r.snippet,
    url: resolved.canonical_url || r.url,
    voteup_count: null,
    author: '',
    source: 'web'
  };
}

function dedupeKey(item) {
  if (item.type === 'answer') return `answer:${item.id}`;
  if (item.type === 'article') return `article:${item.id}`;
  return `${item.type}:${item.id}`;
}

function scoreItem(item, query) {
  let s = SOURCE_CONFIDENCE[item.source] ?? 0.5;
  const q = query.toLowerCase();
  const title = (item.title || '').toLowerCase();
  if (title.includes(q)) s += 0.5;
  else if (q.split(/\s+/).some(w => w && title.includes(w))) s += 0.25;
  if (typeof item.voteup_count === 'number') {
    s += Math.min(Math.log10(Math.max(item.voteup_count, 1)) / 10, 0.15);
  }
  return s;
}

async function searchZhihuSource(query, limit) {
  await rateLimit('zhihu_web');
  const { data } = await zhihuWebRequest(
    `search_v3?gk_version=gz-gaokao&t=general&q=${encodeURIComponent(query)}&correction=1&search_source=Normal&limit=${limit}&offset=0`,
    { useCache: true, cacheTtlMs: 5 * 60 * 1000 }
  );
  return (data.data || []).map(normalizeZhihuSearchItem).filter(Boolean);
}

async function searchBingSource(query, limit) {
  await rateLimit('bing');
  const raw = await bingSearchZhihu(query, limit);
  return raw.map(normalizeBingItem).filter(Boolean);
}

function searchLocalSource(query, limit) {
  const res = localSearch({ keyword: query, limit });
  return res.items.map(it => {
    // storage 主键是复合形态 `answer:123456`；对客户端/去重边界必须还原纯数字 ID，
    // 否则 zhihu_get_content 拿到 `answer:answer:123456`，三源去重也无法与远端合并
    const prefix = `${it.content_type}:`;
    const rawId = String(it.content_id || '').startsWith(prefix)
      ? String(it.content_id).slice(prefix.length)
      : String(it.content_id || '');
    return {
      type: it.content_type,
      id: rawId,
      title: it.title || '',
      excerpt: it.excerpt || '',
      url: it.url || '',
      voteup_count: it.voteup_count,
      author: it.author || '',
      source: 'local'
    };
  });
}

export { searchLocalSource, scoreItem };

// 主入口：source = auto | zhihu | web | local
export async function routeSearch({ query, source = 'auto', limit = 10 }) {
  if (!query || !String(query).trim()) throw new EnvelopeError('invalid_input', 'query 不能为空');
  const lim = Math.min(Math.max(Number(limit) || 10, 1), 20);
  const q = String(query).trim();
  const sourcesUsed = [];
  let items = [];

  if (source === 'local') {
    items = searchLocalSource(q, lim);
    sourcesUsed.push('local');
  } else if (source === 'zhihu') {
    items = await searchZhihuSource(q, lim);
    sourcesUsed.push('zhihu');
  } else if (source === 'web') {
    items = await searchBingSource(q, lim);
    sourcesUsed.push('web');
  } else {
    // auto：三源并发，独立容错——单源失败不阻塞合并
    const settled = await Promise.allSettled([
      searchZhihuSource(q, lim),
      searchBingSource(q, lim),
      Promise.resolve(searchLocalSource(q, lim))
    ]);
    const errors = [];
    for (const [i, s] of settled.entries()) {
      const names = ['zhihu', 'web', 'local'];
      if (s.status === 'fulfilled') {
        if (s.value.length) sourcesUsed.push(names[i]);
      } else {
        errors.push(`${names[i]}: ${s.reason?.__envelope?.error?.code || s.reason?.message || 'failed'}`);
      }
    }
    items = settled.flatMap(s => (s.status === 'fulfilled' ? s.value : []));
    if (!items.length && errors.length) {
      throw new EnvelopeError('network_error', `所有搜索源失败: ${errors.join('; ')}`);
    }
  }

  // 去重合并：同一对象多源命中时保留得分高的，记录 all_sources
  const byKey = new Map();
  for (const it of items) {
    const key = dedupeKey(it);
    const prev = byKey.get(key);
    if (prev) {
      prev.all_sources = [...new Set([...(prev.all_sources || [prev.source]), it.source])];
      const sNew = scoreItem(it, q), sOld = scoreItem(prev, q);
      if (sNew > sOld) {
        byKey.set(key, { ...it, all_sources: prev.all_sources });
      } else {
        prev.voteup_count = prev.voteup_count ?? it.voteup_count;
        prev.title = prev.title || it.title;
      }
    } else {
      byKey.set(key, { ...it, all_sources: [it.source] });
    }
  }
  // 排序先于剥离 source：scoreItem 依赖 item.source 查 SOURCE_CONFIDENCE，
  // 先删 source 会让所有条目置信度落到 0.5 默认值，来源权重失效。
  const ranked = [...byKey.values()]
    .sort((a, b) => scoreItem(b, q) - scoreItem(a, q))
    .slice(0, lim)
    .map(({ source, ...rest }) => rest);
  return { items: ranked, sources: sourcesUsed, total: ranked.length };
}
