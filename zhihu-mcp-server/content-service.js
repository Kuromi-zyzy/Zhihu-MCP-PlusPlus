// 统一内容服务（v1 §6/§8/§9/§10）：ZhihuContent 归一化模型 + get/save/comments 全走同一 service
import { zhihuWebRequest, zhihuAndroidRequest, withFallback } from './transport.js';
import { resolveZhihuUrl } from './url-resolver.js';
import { EnvelopeError } from './errors.js';

// ---------- 归一化：知乎 API 原始对象 → ZhihuContent ----------

function pickAuthor(obj) {
  const a = obj?.author || {};
  return { name: a.name || '', url_token: a.url_token || '' };
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .trim();
}

export function normalizeContent(type, raw, { question = null } = {}) {
  if (!raw) throw new EnvelopeError('not_found', `${type} not found`);
  switch (type) {
    case 'question':
      return {
        type, id: String(raw.id),
        canonical_url: `https://www.zhihu.com/question/${raw.id}`,
        title: raw.title || '', author: null,
        content: stripHtml(raw.detail || raw.excerpt || ''),
        excerpt: raw.excerpt || '',
        voteup_count: null, comment_count: raw.comment_count ?? null,
        created_at: raw.created_time ? new Date(raw.created_time * 1000).toISOString() : null,
        updated_at: raw.updated_time ? new Date(raw.updated_time * 1000).toISOString() : null,
        question: null,
        topics: (raw.topics || []).map(t => t.name || t),
        answer_count: raw.answer_count ?? null,
        follower_count: raw.follower_count ?? null,
        visit_count: raw.visit_count ?? null
      };
    case 'answer': {
      const q = raw.question || question || {};
      const qid = String(q.id ?? question?.id ?? '');
      return {
        type, id: String(raw.id),
        canonical_url: `https://www.zhihu.com/question/${qid}/answer/${raw.id}`,
        title: q.title || '', author: pickAuthor(raw),
        content: stripHtml(raw.content || raw.excerpt || ''),
        excerpt: raw.excerpt || '',
        voteup_count: raw.voteup_count ?? 0, comment_count: raw.comment_count ?? null,
        created_at: raw.created_time ? new Date(raw.created_time * 1000).toISOString() : null,
        updated_at: raw.updated_time ? new Date(raw.updated_time * 1000).toISOString() : null,
        question: qid ? { id: qid, title: q.title || '' } : null,
        topics: (q.topics || []).map(t => t?.name || t).filter(Boolean),
        ip_info: raw.ip_info || null
      };
    }
    case 'article':
      return {
        type, id: String(raw.id),
        canonical_url: `https://zhuanlan.zhihu.com/p/${raw.id}`,
        title: raw.title || '', author: pickAuthor(raw),
        content: stripHtml(raw.content || raw.excerpt || ''),
        excerpt: raw.excerpt || '',
        voteup_count: raw.voteup_count ?? 0, comment_count: raw.comment_count ?? null,
        created_at: raw.created ? new Date(raw.created * 1000).toISOString() : null,
        updated_at: raw.updated ? new Date(raw.updated * 1000).toISOString() : null,
        question: null,
        topics: (raw.topics || []).map(t => t?.name || t).filter(Boolean)
      };
    case 'pin': {
      const first = (raw.content && raw.content[0]) || {};
      return {
        type, id: String(raw.id),
        canonical_url: `https://www.zhihu.com/pin/${raw.id}`,
        title: first.excerpt_title ? stripHtml(first.excerpt_title).slice(0, 60) : (stripHtml(first.content) || '').slice(0, 60),
        author: pickAuthor(raw),
        content: stripHtml(first.content || ''),
        excerpt: first.excerpt_title ? stripHtml(first.excerpt_title) : '',
        voteup_count: raw.like_count ?? raw.voteup_count ?? 0,
        comment_count: raw.comment_count ?? raw.comments_count ?? null,
        created_at: raw.created ? new Date(raw.created * 1000).toISOString() : null,
        updated_at: raw.updated ? new Date(raw.updated * 1000).toISOString() : null,
        question: null,
        topics: []
      };
    }
    case 'user':
      return {
        type, id: raw.url_token || String(raw.id),
        canonical_url: `https://www.zhihu.com/people/${raw.url_token}`,
        title: raw.name || '', author: null,
        content: raw.headline || raw.description || '',
        excerpt: raw.headline || '',
        voteup_count: raw.voteup_count ?? null, comment_count: null,
        created_at: null, updated_at: null,
        question: null,
        topics: [],
        follower_count: raw.follower_count ?? null
      };
    case 'collection':
      return {
        type, id: String(raw.id),
        canonical_url: `https://www.zhihu.com/collection/${raw.id}`,
        title: raw.title || '', author: pickAuthor(raw.creator || {}),
        content: raw.description || '',
        excerpt: raw.description || '',
        voteup_count: null, comment_count: raw.comment_count ?? null,
        created_at: null,
        updated_at: raw.updated ? new Date(raw.updated * 1000).toISOString() : null,
        question: null,
        topics: [],
        item_count: raw.item_count ?? null
      };
    default:
      throw new EnvelopeError('unsupported_content_type', `unsupported type: ${type}`);
  }
}

// ---------- 内容读取：统一入口，web→android fallback ----------

const ANSWERS_INCLUDE = 'data[*].content,excerpt,voteup_count,comment_count,created_time,updated_time,author,question.topics,ip_info';

export async function fetchQuestion(id) {
  const { data, cached } = await withFallback([
    () => zhihuWebRequest(`questions/${id}?include=detail,excerpt,answer_count,voteup_count,comment_count,follower_count,visit_count,topics,created_time,updated_time`),
  ]);
  return { content: normalizeContent('question', data), cached };
}

export async function fetchAnswer(id) {
  const { data, cached } = await withFallback([
    () => zhihuWebRequest(`answers/${id}?include=content,excerpt,voteup_count,comment_count,created_time,updated_time,author,question.topics,ip_info`),
  ]);
  return { content: normalizeContent('answer', data), cached };
}

export async function fetchArticle(id) {
  const { data, cached } = await withFallback([
    () => zhihuWebRequest(`articles/${id}?include=content,excerpt,voteup_count,comment_count,created,updated,author,topics`),
  ]);
  return { content: normalizeContent('article', data), cached };
}

export async function fetchPin(id) {
  // pin 无可靠 web v4 端点 → Android API 优先，web 失败不影响
  const { data, cached } = await withFallback([
    () => zhihuAndroidRequest(`https://api.zhihu.com/v4/pins/${id}`),
    () => zhihuWebRequest(`pins/${id}`),
  ]);
  const raw = data?.data?.pin || data?.pin || data;
  return { content: normalizeContent('pin', raw), cached };
}

export async function fetchUser(token) {
  const { data, cached } = await zhihuWebRequest(`members/${encodeURIComponent(token)}?include=follower_count,headline,voteup_count,description`);
  return { content: normalizeContent('user', data), cached };
}

export async function fetchCollection(id) {
  const { data, cached } = await zhihuWebRequest(`collections/${id}?include=title,description,updated,creator,item_count,follow_count,comment_count`);
  return { content: normalizeContent('collection', data.collection || data), cached };
}

export async function fetchAnswers(questionId, { limit = 20, offset = 0, sort = 'default' } = {}) {
  const order = ['default', 'updated'].includes(sort) ? sort : 'default';
  const { data } = await withFallback([
    () => zhihuWebRequest(`questions/${questionId}/feeds?limit=${limit}&offset=${offset}&order=${order}`),
    () => zhihuAndroidRequest(`https://api.zhihu.com/v4/questions/${questionId}/answers?include=${encodeURIComponent(ANSWERS_INCLUDE)}&limit=${limit}&offset=${offset}&sort_by=${order}`),
  ]);
  const items = (data.data || []).map(it => normalizeContent('answer', it.answer || it.target || it, {
    question: it.question || null
  }));
  return {
    items,
    next_cursor: data.paging?.next ? String(offset + items.length) : null,
    has_more: !data.paging?.is_end
  };
}

// 统一入口：type+id 或 url → resolve → dispatch → normalize
export async function getContent({ url, type, id, question_id }) {
  if (url) {
    const resolved = resolveZhihuUrl(url);
    if (!resolved) throw new EnvelopeError('invalid_input', `无法解析知乎 URL: ${url}`);
    ({ type, id, question_id } = resolved);
  }
  if (!type || !id) throw new EnvelopeError('invalid_input', '需要 url 或 type+id');
  const validTypes = ['question', 'answer', 'article', 'pin', 'user', 'collection'];
  if (!validTypes.includes(type)) {
    throw new EnvelopeError('unsupported_content_type', `type 只支持: ${validTypes.join('/')}`);
  }
  const dispatch = {
    question: () => fetchQuestion(id),
    answer: () => fetchAnswer(id),
    article: () => fetchArticle(id),
    pin: () => fetchPin(id),
    user: () => fetchUser(id),
    collection: () => fetchCollection(id)
  };
  const { content, cached } = await dispatch[type]();
  if (type === 'answer' && question_id && !content.question) {
    content.question = { id: question_id };
  }
  return { content, cached };
}

// ---------- 评论与楼中楼（§10） ----------

function normalizeComment(c) {
  return {
    id: String(c.id),
    author: pickAuthor(c),
    content: stripHtml(c.content || ''),
    like_count: c.like_count ?? c.vote_count ?? 0,
    created_at: c.created_time ? new Date(c.created_time * 1000).toISOString() : null,
    child_count: c.child_comment_count ?? c.child_count ?? 0
  };
}

const COMMENT_ENDPOINTS = {
  // comment_v5 是现行评论端点（questions/answers/articles 通用）；2026-09-22 实测确认
  question: (id, limit, offset) => zhihuWebRequest(`comment_v5/questions/${id}/root_comment?limit=${limit}&offset=${offset}&order=normal`),
  answer: (id, limit, offset) => zhihuWebRequest(`comment_v5/answers/${id}/root_comment?limit=${limit}&offset=${offset}&order=normal`),
  article: (id, limit, offset) => zhihuWebRequest(`comment_v5/articles/${id}/root_comment?limit=${limit}&offset=${offset}&order=normal`),
  pin: (id, limit, offset) => zhihuAndroidRequest(`https://api.zhihu.com/v4/pins/${id}/comments?limit=${limit}&offset=${offset}`)
};

export async function listComments({ type, id, url, limit = 10, cursor = 0 }) {
  if (url) {
    const r = resolveZhihuUrl(url);
    if (r) { type = r.type; id = r.id; }
  }
  if (!type || !id) throw new EnvelopeError('invalid_input', '需要 type+id 或 url');
  const ep = COMMENT_ENDPOINTS[type];
  if (!ep) throw new EnvelopeError('unsupported_content_type', `评论仅支持: ${Object.keys(COMMENT_ENDPOINTS).join('/')}`);
  const lim = Math.min(Math.max(Number(limit) || 10, 1), 20);
  const off = Number(cursor) || 0;
  const { data } = await ep(id, lim, off);
  const arr = Array.isArray(data) ? data : (data.data || []);
  const items = arr.map(normalizeComment);
  return { items, next_cursor: items.length === lim ? String(off + lim) : null, has_more: items.length === lim };
}

// 楼中楼：指定父评论的子回复。端点为老版 Android 通道 /comments/<id>/child_comments
// （comment_v5 无楼中楼端点，2026-09-22 实测确认）
export async function listReplies({ comment_id, limit = 10, cursor = 0 }) {
  if (!comment_id) throw new EnvelopeError('invalid_input', '需要 comment_id');
  const lim = Math.min(Math.max(Number(limit) || 10, 1), 20);
  const off = Number(cursor) || 0;
  const { data } = await zhihuAndroidRequest(`https://api.zhihu.com/comments/${comment_id}/child_comments?limit=${lim}&offset=${off}`);
  const arr = Array.isArray(data) ? data : (data.data || []);
  const items = arr.map(normalizeComment);
  return { items, next_cursor: data.paging?.next ? String(off + lim) : null, has_more: !data.paging?.is_end ?? items.length === lim };
}
