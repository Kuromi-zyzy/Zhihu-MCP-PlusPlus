#!/usr/bin/env node

/**
 * Zhihu MCP++ v1.0 — 知乎检索、阅读、研究、归档与本地知识库后端
 * stdio + Streamable HTTP 双 transport；工具 15~25 个按类别组织；统一 envelope 输出。
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

import { ok, fail, failFromError, EnvelopeError } from './errors.js';
import { logger } from './logger.js';
import { loadStore, setCookies, clearAuth, getCookies, CRED_FILE } from './credentials.js';
import { resolveZhihuUrl } from './url-resolver.js';
import { routeSearch } from './search/router.js';
import { parseBingResults, bingSearchZhihu, classifyZhihuUrl, ZHIHU_NEXT_TOOLS } from './search/bing.js';
import {
  getContent, fetchQuestion, fetchAnswer, fetchArticle, fetchPin, fetchUser, fetchCollection,
  fetchAnswers, listComments, listReplies
} from './content-service.js';
import { zhihuWebRequest } from './transport.js';
import { importOutputMarkdown } from './ingest.js';
import { browserLogin, validateCurrent as validateCookie, validateCookieString } from './auth.js';
import {
  upsertContent, localSearch, rebuildFts, contentCount, dbStats, semanticSearch, hybridSearch,
  embeddingProviderInfo, contentHash, DB_FILE
} from './storage.js';
import { cacheGet, cacheSet } from './cache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SPIDER_DIR = path.resolve(__dirname, '..');
// 版本单源 = package.json（不再双写硬编码）
const { version: VERSION } = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

// ============ save_* 入参校验与安全执行（防命令注入） ============
function requireValidId(value, name) {
  const s = String(value ?? '').trim();
  if (!/^\d{3,32}$/.test(s)) {
    throw new EnvelopeError('invalid_input', `参数 ${name} 必须是纯数字 ID（收到: ${JSON.stringify(String(value)).slice(0, 40)}）`);
  }
  return s;
}

function requireEnum(value, name, allowed, fallback) {
  const s = String(value ?? fallback);
  if (!allowed.includes(s)) {
    throw new EnvelopeError('invalid_input', `参数 ${name} 只能是 ${allowed.join('/')}（收到: ${JSON.stringify(s).slice(0, 40)}）`);
  }
  return s;
}

function requireOptionalInt(value, name, { min = 1, max = 1000 } = {}) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new EnvelopeError('invalid_input', `参数 ${name} 必须是 ${min}-${max} 的整数（收到: ${JSON.stringify(String(value)).slice(0, 40)}）`);
  }
  return n;
}

// 异步执行 python 子进程：HTTP 模式下不能阻塞 event loop（execFileSync 会冻结 /healthz 等所有并发请求）
async function runPythonAsync(args, { timeoutMs, cwd = SPIDER_DIR } = {}) {
  const { spawn } = await import('child_process');
  return new Promise((resolve, reject) => {
    const child = spawn('python', args, { cwd, windowsHide: true });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new EnvelopeError('upstream_timeout', `python 子进程超时（${timeoutMs}ms）: ${args.join(' ').slice(0, 120)}`));
    }, timeoutMs);
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(new EnvelopeError('browser_error', `python 启动失败: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(stdout);
      const detail = (stdout + '\n' + stderr).trim();
      reject(new Error(`爬虫执行失败（${code}）${detail ? ':\n' + detail.slice(-1500) : ''}`));
    });
  });
}

async function runSpiderAsync(spiderArgs, timeoutMs) {
  try {
    return await runPythonAsync(['main.py', ...spiderArgs], { timeoutMs });
  } catch (e) {
    // runPythonAsync 的超时/启动失败已带 envelope（upstream_timeout/browser_error）——原样透传，
    // 不降级成普通 Error（否则错误码归一前功尽弃，客户端只见 internal_error）
    if (e?.__envelope) throw e;
    const detail = (typeof e.stdout === 'string' ? e.stdout : '') + '\n' + (typeof e.stderr === 'string' ? e.stderr : '');
    const tail = detail.trim() || String(e?.message || '').slice(-1500);
    throw new Error(`爬虫执行失败（${e.signal || e.status || e.code || 'unknown'}）:\n${tail.slice(-1500)}`);
  }
}

// ============ 工具定义（§34 分类；annotations per §18） ============

const ANNOT_RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
const ANNOT_SAVE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const TOOLS = [
  // ---- Search ----
  {
    name: 'zhihu_search',
    title: '多源搜索知乎',
    description: '搜索知乎内容。source=auto 时并发检索知乎站内+Bing+本地归档，去重合并（推荐）；可指定 zhihu/web/local 单源。返回结构化结果带 type/id/来源，可接 zhihu_get_content。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        source: { type: 'string', enum: ['auto', 'zhihu', 'web', 'local'], description: '搜索源，默认 auto', default: 'auto' },
        limit: { type: 'number', description: '返回数量 1-20，默认 10', default: 10 }
      },
      required: ['query']
    },
    annotations: ANNOT_RO
  },
  {
    name: 'zhihu_resolve_url',
    title: '解析知乎 URL',
    description: '把知乎 URL（question/answer/article/pin/people/collection、tardis 镜像页）解析为 {type, id, canonical_url}，无网络请求。',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: '知乎 URL' } },
      required: ['url']
    },
    annotations: ANNOT_RO
  },

  // ---- Content ----
  {
    name: 'zhihu_get_content',
    title: '统一内容读取',
    description: '统一内容入口：传 url 或 type+id（question/answer/article/pin/user/collection），返回归一化 ZhihuContent。支持 include_content=false 与 max_content_chars 截断。',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '知乎 URL（与 type+id 二选一）' },
        type: { type: 'string', enum: ['question', 'answer', 'article', 'pin', 'user', 'collection'] },
        id: { type: 'string', description: '内容 ID（url 缺省时必填）' },
        include_content: { type: 'boolean', description: '是否返回正文，默认 true', default: true },
        max_content_chars: { type: 'number', description: '正文截断长度，默认 12000', default: 12000 },
        fields: { type: 'array', items: { type: 'string' }, description: '字段白名单投影（可选）' }
      }
    },
    annotations: ANNOT_RO
  },
  {
    name: 'zhihu_get_question', title: '问题详情', description: '获取知乎问题详情（归一化）。legacy-compatible。',
    inputSchema: { type: 'object', properties: { question_id: { type: 'string', description: '问题 ID' } }, required: ['question_id'] },
    annotations: ANNOT_RO
  },
  {
    name: 'zhihu_get_answer', title: '回答详情', description: '获取知乎回答详情（归一化）。legacy-compatible。',
    inputSchema: { type: 'object', properties: { answer_id: { type: 'string', description: '回答 ID' } }, required: ['answer_id'] },
    annotations: ANNOT_RO
  },
  {
    name: 'zhihu_get_article', title: '文章详情', description: '获取知乎专栏文章详情（归一化）。legacy-compatible。',
    inputSchema: { type: 'object', properties: { article_id: { type: 'string', description: '文章 ID' } }, required: ['article_id'] },
    annotations: ANNOT_RO
  },
  {
    name: 'zhihu_get_pin', title: '想法详情', description: '获取知乎想法（pin）详情。',
    inputSchema: { type: 'object', properties: { pin_id: { type: 'string', description: '想法 ID' } }, required: ['pin_id'] },
    annotations: ANNOT_RO
  },
  {
    name: 'zhihu_get_user', title: '用户信息', description: '获取知乎用户公开信息。legacy-compatible。',
    inputSchema: { type: 'object', properties: { user_token: { type: 'string', description: '用户 URL token' } }, required: ['user_token'] },
    annotations: ANNOT_RO
  },
  {
    name: 'zhihu_question_answers', title: '回答列表', description: '获取问题下的回答列表（归一化，带 has_more 分页）。legacy-compatible。',
    inputSchema: {
      type: 'object',
      properties: {
        question_id: { type: 'string', description: '问题 ID' },
        limit: { type: 'number', description: '每页数量 1-20，默认 10', default: 10 },
        cursor: { type: 'number', description: '分页偏移，默认 0', default: 0 },
        sort: { type: 'string', enum: ['default', 'updated'], description: '排序', default: 'default' }
      },
      required: ['question_id']
    },
    annotations: ANNOT_RO
  },

  // ---- Discussion ----
  {
    name: 'zhihu_list_comments', title: '评论列表', description: '获取 question/answer/article/pin 的评论列表（带 has_more 分页，limit 1-20）。',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['question', 'answer', 'article', 'pin'] },
        id: { type: 'string', description: '内容 ID' },
        url: { type: 'string', description: '知乎 URL（可替代 type+id）' },
        limit: { type: 'number', description: '1-20，默认 10', default: 10 },
        cursor: { type: 'number', description: '分页偏移，默认 0', default: 0 }
      }
    },
    annotations: ANNOT_RO
  },
  {
    name: 'zhihu_list_replies', title: '楼中楼回复', description: '获取指定评论下的子回复（楼中楼）。',
    inputSchema: {
      type: 'object',
      properties: {
        comment_id: { type: 'string', description: '父评论 ID' },
        limit: { type: 'number', description: '1-20，默认 10', default: 10 },
        cursor: { type: 'number', description: '分页偏移，默认 0', default: 0 }
      },
      required: ['comment_id']
    },
    annotations: ANNOT_RO
  },

  // ---- Archive ----
  {
    name: 'zhihu_save_content', title: '保存内容到本地', description: '统一保存入口：传 url 或 type+id，先读取归一化内容，再写 Markdown + 本地 SQLite 索引（hash 去重）。',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '知乎 URL（与 type+id 二选一）' },
        type: { type: 'string', enum: ['question', 'answer', 'article', 'pin', 'user', 'collection'] },
        id: { type: 'string' }
      }
    },
    annotations: ANNOT_SAVE
  },
  {
    name: 'zhihu_save_question', title: '保存问题全部回答', description: '调用本地 Python 爬虫把问题下回答存为 Markdown（断点续传）。legacy-compatible。',
    inputSchema: {
      type: 'object',
      properties: {
        question_id: { type: 'string', description: '问题 ID' },
        max_pages: { type: 'number', description: '最大页数 1-500' },
        sort: { type: 'string', enum: ['default', 'voteups', 'created'], default: 'default' }
      },
      required: ['question_id']
    },
    annotations: ANNOT_SAVE
  },
  {
    name: 'zhihu_save_answer', title: '保存单条回答', description: '调用本地 Python 爬虫保存单条回答为 Markdown。legacy-compatible。',
    inputSchema: { type: 'object', properties: { answer_id: { type: 'string', description: '回答 ID' } }, required: ['answer_id'] },
    annotations: ANNOT_SAVE
  },
  {
    name: 'zhihu_save_article', title: '保存专栏文章', description: '调用本地 Python 爬虫保存专栏文章为 Markdown。legacy-compatible。',
    inputSchema: { type: 'object', properties: { article_id: { type: 'string', description: '文章 ID' } }, required: ['article_id'] },
    annotations: ANNOT_SAVE
  },
  {
    name: 'zhihu_save_collection', title: '保存收藏夹', description: '调用本地 Python 爬虫保存收藏夹内容为 Markdown。legacy-compatible。',
    inputSchema: {
      type: 'object',
      properties: {
        collection_id: { type: 'string', description: '收藏夹 ID' },
        max_pages: { type: 'number', description: '最大页数 1-500' }
      },
      required: ['collection_id']
    },
    annotations: ANNOT_SAVE
  },
  {
    name: 'zhihu_save_pin', title: '保存想法', description: '读取指定想法并写入本地索引与 Markdown。',
    inputSchema: { type: 'object', properties: { pin_id: { type: 'string', description: '想法 ID' } }, required: ['pin_id'] },
    annotations: ANNOT_SAVE
  },

  // ---- Local Knowledge ----
  {
    name: 'zhihu_local_search', title: '本地知识库检索', description: '检索本地归档（SQLite FTS5）。mode=keyword|semantic|hybrid；semantic/hybrid 需配置 embedding provider，缺失时自动降级 keyword。',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '关键词' },
        mode: { type: 'string', enum: ['keyword', 'semantic', 'hybrid'], description: '检索模式，默认 keyword', default: 'keyword' },
        type: { type: 'string', description: '按内容类型过滤（question/answer/article/pin...）' },
        author: { type: 'string', description: '按作者过滤' },
        limit: { type: 'number', description: '1-50，默认 10', default: 10 }
      }
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'zhihu_reindex', title: '重建本地索引', description: '扫描 output/ 全部 Markdown 导入本地知识库（SQLite），并重建 FTS 全文索引。',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },

  // ---- Auth ----
  {
    name: 'zhihu_auth_status', title: '认证状态', description: '查看登录状态：是否已验证、用户名、可用的 cookie 键名。不返回 Cookie 值。',
    inputSchema: { type: 'object', properties: {} },
    annotations: ANNOT_RO
  },
  {
    name: 'zhihu_auth_login', title: '登录知乎', description: '打开浏览器扫码登录（DrissionPage），登录令牌出现 + /api/v4/me 验证通过才写凭据。mode=browser（默认）。',
    inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['browser'], default: 'browser' } } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
  },
  {
    name: 'zhihu_auth_import', title: '导入 Cookie', description: '把 Cookie 键值对写入统一凭据库（自动验证后标记已验证）。',
    inputSchema: {
      type: 'object',
      properties: { cookies: { type: 'object', description: 'Cookie 键值对，至少需要 d_c0', additionalProperties: { type: 'string' } } },
      required: ['cookies']
    },
    annotations: ANNOT_SAVE
  },
  {
    name: 'zhihu_auth_logout', title: '退出登录', description: '清空统一凭据库中的登录态。',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },

  // ---- Diagnostics ----
  {
    name: 'zhihu_get_config', title: '查看配置', description: '查看运行配置概览（不包含 Cookie 值）。legacy-compatible。',
    inputSchema: { type: 'object', properties: {} },
    annotations: ANNOT_RO
  },
  {
    name: 'zhihu_diagnostics', title: '运行诊断', description: '只读诊断：node/python 版本、认证有效性、SQLite 可用性、embedding provider、Bing/知乎可达性概览。',
    inputSchema: { type: 'object', properties: {} },
    annotations: ANNOT_RO
  },
  {
    name: 'zhihu_hot_list', title: '热榜', description: '获取知乎热榜（Android API，无需登录）。legacy-compatible。',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: '数量 1-50，默认 50', default: 50 } } },
    annotations: ANNOT_RO
  },
  {
    name: 'zhihu_hot_search', title: '热搜词', description: '获取知乎热搜词。legacy-compatible。',
    inputSchema: { type: 'object', properties: {} },
    annotations: ANNOT_RO
  }
];

// ============ 工具实现分发 ============

function envelope(result, { isError = false } = {}) {
  const text = JSON.stringify(result, null, 2);
  return { content: [{ type: 'text', text }], isError };
}

function contextBudget(content, args) {
  if (!content || typeof content !== 'object') return content;
  const { include_content = true, max_content_chars = 12000, fields } = args;
  let out = { ...content };
  if (include_content === false) {
    delete out.content;
    out.content_omitted = true;
  } else {
    const limit = Number(max_content_chars) || 12000;
    if (typeof out.content === 'string' && out.content.length > limit) {
      out.content_truncated = true;
      out.content_chars = out.content.length;
      out.content = out.content.slice(0, limit);
    }
  }
  if (Array.isArray(fields) && fields.length) {
    const projected = {};
    for (const f of fields) if (f in out) projected[f] = out[f];
    return projected;
  }
  return out;
}

async function handleTool(name, args, startedAt) {
  switch (name) {
    // ---- Search ----
    case 'zhihu_search': {
      const r = await routeSearch(args);
      return ok({ items: r.items, sources: r.sources, total: r.total }, { sources: r.sources });
    }
    case 'zhihu_resolve_url': {
      const r = resolveZhihuUrl(args.url);
      if (!r) return fail('invalid_input', `无法解析知乎 URL: ${args.url}`);
      return ok(r);
    }

    // ---- Content ----
    case 'zhihu_get_content': {
      const { content, cached } = await getContent(args);
      return ok({ content: contextBudget(content, args) }, { source: 'zhihu_web', cached });
    }
    case 'zhihu_get_question': {
      const { content, cached } = await fetchQuestion(requireValidId(args.question_id, 'question_id'));
      return ok({ content }, { source: 'zhihu_web', cached });
    }
    case 'zhihu_get_answer': {
      const { content, cached } = await fetchAnswer(requireValidId(args.answer_id, 'answer_id'));
      return ok({ content }, { source: 'zhihu_web', cached });
    }
    case 'zhihu_get_article': {
      const { content, cached } = await fetchArticle(requireValidId(args.article_id, 'article_id'));
      return ok({ content }, { source: 'zhihu_web', cached });
    }
    case 'zhihu_get_pin': {
      const { content, cached } = await fetchPin(requireValidId(args.pin_id, 'pin_id'));
      return ok({ content }, { source: 'zhihu_android', cached });
    }
    case 'zhihu_get_user': {
      const { content, cached } = await fetchUser(args.user_token);
      return ok({ content }, { source: 'zhihu_web', cached });
    }
    case 'zhihu_question_answers': {
      const qid = requireValidId(args.question_id, 'question_id');
      const r = await fetchAnswers(qid, { limit: args.limit, offset: args.cursor, sort: args.sort });
      return ok({ items: r.items, next_cursor: r.next_cursor, has_more: r.has_more }, { source: 'zhihu_web' });
    }

    // ---- Discussion ----
    case 'zhihu_list_comments': {
      const r = await listComments(args);
      return ok(r);
    }
    case 'zhihu_list_replies': {
      const r = await listReplies(args);
      return ok(r);
    }

    // ---- Archive ----
    case 'zhihu_save_content': {
      const { content } = await getContent(args);
      const r = upsertContent({
        content_id: content.id, content_type: content.type, title: content.title,
        author: content.author?.name || '', url: content.canonical_url,
        question_id: content.question?.id || null, voteup_count: content.voteup_count ?? 0,
        created_at: content.created_at, content: content.content || ''
      });
      if (r !== 'unchanged') {
        // 尝试 embedding（可配置，失败不影响 Markdown/SQLite 主链）
        try {
          const { embedUpsert } = await import('./storage.js');
          embedUpsert(`${content.type}:${content.id}`, `${content.title}\n${content.content}`);
        } catch { /* optional */ }
      }
      return ok({ content_type: content.type, id: content.id, title: content.title, action: r, url: content.canonical_url });
    }
    case 'zhihu_save_question': {
      const qid = requireValidId(args.question_id, 'question_id');
      const spiderArgs = ['question', qid, '--sort', requireEnum(args.sort, 'sort', ['default', 'voteups', 'created'], 'default')];
      const pages = requireOptionalInt(args.max_pages, 'max_pages', { min: 1, max: 500 });
      if (pages !== undefined) spiderArgs.push('--max-pages', String(pages));
      const t0 = Date.now();
      const output = await runSpiderAsync(spiderArgs, 120000);
      // Markdown → SQLite 一体化：增量导入本次保存落盘的文件（mtime > t0），不重扫全库
      return ok({ output: output.slice(-1500), knowledge_base: importOutputMarkdown({ since: t0 }) });
    }
    case 'zhihu_save_answer': {
      const t0 = Date.now();
      const output = await runSpiderAsync(['answer', requireValidId(args.answer_id, 'answer_id')], 60000);
      return ok({ output: output.slice(-1500), knowledge_base: importOutputMarkdown({ since: t0 }) });
    }
    case 'zhihu_save_article': {
      const t0 = Date.now();
      const output = await runSpiderAsync(['article', requireValidId(args.article_id, 'article_id')], 60000);
      return ok({ output: output.slice(-1500), knowledge_base: importOutputMarkdown({ since: t0 }) });
    }
    case 'zhihu_save_collection': {
      const spiderArgs = ['collection', requireValidId(args.collection_id, 'collection_id')];
      const pages = requireOptionalInt(args.max_pages, 'max_pages', { min: 1, max: 500 });
      if (pages !== undefined) spiderArgs.push('--max-pages', String(pages));
      const t0 = Date.now();
      const output = await runSpiderAsync(spiderArgs, 180000);
      return ok({ output: output.slice(-1500), knowledge_base: importOutputMarkdown({ since: t0 }) });
    }
    case 'zhihu_save_pin': {
      const pid = requireValidId(args.pin_id, 'pin_id');
      const { content } = await fetchPin(pid);
      const r = upsertContent({
        content_id: content.id, content_type: 'pin', title: content.title,
        author: content.author?.name || '', url: content.canonical_url,
        question_id: null, voteup_count: content.voteup_count ?? 0,
        created_at: content.created_at, content: content.content || ''
      });
      return ok({ content_type: 'pin', id: content.id, action: r, url: content.canonical_url });
    }

    // ---- Local ----
    case 'zhihu_local_search': {
      const mode = requireEnum(args.mode, 'mode', ['keyword', 'semantic', 'hybrid'], 'keyword');
      let r;
      if (mode === 'semantic') r = semanticSearch(args);
      else if (mode === 'hybrid') r = hybridSearch(args);
      else r = localSearch(args);
      return ok(r);
    }
    case 'zhihu_reindex': {
      // 真重建：扫描 output/ Markdown 导入 SQLite，再物理重刷 FTS（v1 一体化收口）
      const before = contentCount();
      const ingest = importOutputMarkdown();
      rebuildFts();
      const after = contentCount();
      return ok({ ...ingest, before, after, rebuilt_fts: true });
    }

    // ---- Auth ----
    case 'zhihu_auth_status': {
      const store = loadStore();
      return ok({
        logged_in: Boolean(store.validated_at && Object.keys(store.cookies || {}).length),
        user: store.user,
        available_cookie_keys: Object.keys(store.cookies || {}),
        validated_at: store.validated_at,
        credential_store: CRED_FILE
      });
    }
    case 'zhihu_auth_login': {
      requireEnum(args.mode, 'mode', ['browser'], 'browser');
      // 现有 Cookie 仍有效则快速返回；否则打开浏览器扫码（login.py），验证通过才入库
      const existing = await validateCookie();
      if (existing.ok) {
        return ok({ logged_in: true, user: existing.user, credential_store: CRED_FILE, skipped_browser: true });
      }
      const result = await browserLogin();
      if (!result.ok) {
        return fail('not_authenticated', `浏览器登录未通过验证: ${result.info || result.output || '未捕获到登录令牌'}（原凭据未改动）`);
      }
      return ok({ logged_in: true, user: result.user, credential_store: CRED_FILE, skipped_browser: false });
    }
    case 'zhihu_auth_import': {
      const cookies = args.cookies || {};
      if (!cookies.d_c0) return fail('invalid_input', '至少需要 d_c0');
      // 验证后再入库（validateCookieString 是 async，漏 await 会让正常 Cookie 也判失败）
      const cookieStr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
      const result = await validateCookieString(cookieStr);
      if (!result.ok) return fail('not_authenticated', `Cookie 验证失败: ${result.info}（未写入凭据库）`);
      // 导入一套新登录态 = 整体替换，避免换账号后旧 Cookie 键残留
      setCookies(cookies, { user: result.user, validated_at: new Date().toISOString(), replace: true });
      return ok({ imported: Object.keys(cookies), user: result.user });
    }
    case 'zhihu_auth_logout': {
      clearAuth();
      return ok({ logged_out: true });
    }

    // ---- Diagnostics ----
    case 'zhihu_get_config': {
      const cookies = getCookies();
      return ok({
        version: VERSION,
        hasCookies: Object.keys(cookies).length > 0,
        cookieKeys: Object.keys(cookies),
        credential_store: CRED_FILE,
        db_file: DB_FILE
      });
    }
    case 'zhihu_diagnostics': {
      const store = loadStore();
      const emb = embeddingProviderInfo();
      let sqliteOk = true;
      try { dbStats(); } catch { sqliteOk = false; }
      let bingOk = null;
      try {
        const t0 = Date.now();
        await bingSearchZhihu('zhihu', 1);
        bingOk = { reachable: true, latency_ms: Date.now() - t0 };
      } catch { bingOk = { reachable: false }; }
      let zhihuOk = null;
      try {
        await zhihuWebRequest('questions/0?include=', { useCache: false });
        zhihuOk = { reachable: true };
      } catch (e) {
        const code = e?.__envelope?.error?.code;
        // 404 = 网络通、资源不存在 → reachable
        zhihuOk = { reachable: code === 'not_found' || code === 'not_authenticated' || code === 'anti_bot_blocked' ? true : false, note: code || undefined };
      }
      return ok({
        node: process.version,
        auth: { valid: Boolean(store.validated_at), cookie_keys: Object.keys(store.cookies || {}) },
        browser: { available: true, note: 'DrissionPage 走 Python 侧，见 login.py' },
        sqlite: { ok: sqliteOk, db_file: DB_FILE },
        embedding: emb,
        bing: bingOk,
        zhihu: zhihuOk
      });
    }

    // ---- Hot（legacy-compatible）----
    case 'zhihu_hot_list': {
      const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 50);
      const { data, cached } = await import('./transport.js').then(m => m.zhihuAndroidRequest(`https://api.zhihu.com/topstory/hot-list?limit=${limit}`));
      const items = data.data || [];
      return ok({
        total: items.length,
        hot_list: items.map((item, index) => ({
          rank: index + 1,
          title: item.target?.title_area?.text || 'N/A',
          excerpt: item.target?.excerpt_area?.text || '',
          url: item.target?.link?.url || '',
          hot_value: item.target?.metrics_area?.text || ''
        }))
      }, { source: 'zhihu_android', cached });
    }
    case 'zhihu_hot_search': {
      const { data } = await zhihuWebRequest('search/hot_search');
      const hotSearches = data.hot_search_queries || [];
      return ok({
        total: hotSearches.length,
        hot_searches: hotSearches.map(item => ({
          query: item.query, hot: item.hot_show || item.hot, label: item.label, index: item.index + 1
        }))
      });
    }

    default:
      return fail('invalid_input', `Unknown tool: ${name}`);
  }
}

// ============ MCP Server 装配 ============

function createMcpServer() {
  const server = new Server(
    { name: 'zhihu-mcp-server', version: VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(t => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations
    }))
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const startedAt = Date.now();
    try {
      const result = await handleTool(name, args || {}, startedAt);
      logger.info({ tool: name, duration_ms: Date.now() - startedAt, status: result.ok ? 'ok' : `error:${result.error?.code}` });
      return envelope(result, { isError: !result.ok });
    } catch (e) {
      const result = failFromError(e);
      logger.error({ tool: name, duration_ms: Date.now() - startedAt, status: `error:${result.error.code}`, error: result.error.message });
      return envelope(result, { isError: true });
    }
  });

  return server;
}

// ============ transport 选择：默认 stdio，--http 启用 Streamable HTTP ============

async function main() {
  const httpMode = process.argv.includes('--http');

  if (!httpMode) {
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`Zhihu MCP++ v${VERSION} running on stdio`);
    return;
  }

  const getArg = (flag, fallback) => {
    const i = process.argv.indexOf(flag);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
  };
  const hostArg = getArg('--host', '127.0.0.1');
  const portArg = Number(getArg('--port', '8635'));
  if (hostArg !== '127.0.0.1' && hostArg !== 'localhost' && !process.argv.includes('--allow-remote')) {
    // 服务无身份认证，非回环绑定默认拒绝；确需暴露时显式 --allow-remote 自担风险
    console.error(`[REFUSED] --host ${hostArg} 是非回环地址且服务无身份认证。`);
    console.error('如确认要暴露到网络，请加 --allow-remote 重新启动（风险自担）。');
    process.exit(1);
  }

  // SDK 1.29 stateless 模式（sessionIdGenerator: undefined）要求每请求一个全新
  // transport + server 实例（复用会抛 'Stateless transport cannot be reused'）。
  const httpServer = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      const store = loadStore();
      let dbOk = true;
      try { dbStats(); } catch { dbOk = false; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: VERSION, auth: Boolean(store.validated_at), database: dbOk }));
      return;
    }
    if (req.method === 'POST' && req.url === '/mcp') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      let parsedBody;
      try {
        parsedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error: Invalid JSON' }, id: null }));
        return;
      }
      try {
        const server = createMcpServer();
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        await server.connect(transport);
        // SDK 1.29 的 handleRequest 第三参期望已解析的 JSON-RPC 对象（传 Buffer 会 zod 校验失败）
        await transport.handleRequest(req, res, parsedBody);
      } catch (e) {
        logger.error({ tool: 'http_transport', status: 'error', error: String(e?.message || e).slice(0, 200) });
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }));
        }
      }
      return;
    }
    res.writeHead(404).end();
  });

  httpServer.listen(portArg, hostArg, () => {
    console.error(`Zhihu MCP++ v${VERSION} HTTP on http://${hostArg}:${portArg}/mcp (healthz: /healthz)`);
  });
}

// 仅直接执行时启动服务；被测试 import（带 ?case= 查询串）时不启动，以便对 handleTool 做单元测试
const invokedDirectly = !import.meta.url.includes('?') &&
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
  });
}

export { handleTool, TOOLS, VERSION };
