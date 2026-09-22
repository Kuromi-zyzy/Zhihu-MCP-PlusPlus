// URL Resolver（v1 §7）：classifyZhihuUrl 升级为正式模块，zhihu_resolve_url 的实现层
// 规范化输出统一带 canonical_url（无原生规范页时按类型构造）。

const HOST_RE = /(^|\.)zhihu\.com$/;

function canonicalize(type, id, { question_id } = {}) {
  switch (type) {
    case 'question': return `https://www.zhihu.com/question/${id}`;
    case 'answer': return `https://www.zhihu.com/question/${question_id}/answer/${id}`;
    case 'article': return `https://zhuanlan.zhihu.com/p/${id}`;
    case 'pin': return `https://www.zhihu.com/pin/${id}`;
    case 'user': return `https://www.zhihu.com/people/${encodeURIComponent(id)}`;
    case 'collection': return `https://www.zhihu.com/collection/${id}`;
    default: return null;
  }
}

function resolveZhihuUrl(input) {
  let url = String(input ?? '').trim();
  if (!url) return null;
  // 允许纯 ID + 类型直接解析（zhihu_get_content 用）
  if (/^\d{3,32}$/.test(url)) return null; // 纯数字无类型不可解析
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://www.zhihu.com/' + url.replace(/^\/+/, '');
  }
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!HOST_RE.test(u.hostname)) return null;
  const p = u.pathname;

  let m = p.match(/\/question\/(\d+)(?:\/answer\/(\d+))?/);
  if (m) {
    return m[2]
      ? { type: 'answer', id: m[2], question_id: m[1], canonical_url: `https://www.zhihu.com/question/${m[1]}/answer/${m[2]}` }
      : { type: 'question', id: m[1], canonical_url: `https://www.zhihu.com/question/${m[1]}` };
  }
  m = p.match(/\/pin\/(\d+)/);
  if (m) return { type: 'pin', id: m[1], canonical_url: `https://www.zhihu.com/pin/${m[1]}` };
  // tardis/bd、tardis/zm 是知乎给搜索引擎的文章镜像页，数字 ID 与专栏文章一致
  m = p.match(/\/tardis\/(?:bd|zm)\/art\/(\d+)/);
  if (m) return { type: 'article', id: m[1], canonical_url: `https://zhuanlan.zhihu.com/p/${m[1]}` };
  m = p.match(/\/p\/(\d+)/);
  if (m && u.hostname === 'zhuanlan.zhihu.com') return { type: 'article', id: m[1], canonical_url: `https://zhuanlan.zhihu.com/p/${m[1]}` };
  m = p.match(/\/people\/([^/]+)/);
  if (m) return { type: 'user', id: decodeURIComponent(m[1]), canonical_url: `https://www.zhihu.com/people/${m[1]}` };
  m = p.match(/\/collection\/(\d+)/);
  if (m) return { type: 'collection', id: m[1], canonical_url: `https://www.zhihu.com/collection/${m[1]}` };
  // /api/v4/... 修正页与其它未识别路径
  return null;
}

export { resolveZhihuUrl, canonicalize };
