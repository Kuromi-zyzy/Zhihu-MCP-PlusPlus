// 归档导入器（v1 一体化收口）：把爬虫 output/ 下的 Markdown（YAML front matter + 正文）
// 导入 SQLite contents，使 zhihu_save_*（Python 路径）与 zhihu_save_content（SQLite 路径）
// 产出汇聚到同一知识库，zhihu_local_search 可统一检索。
// front matter 字段由 zhihu_spider._write_md 的各调用点决定：title/author/voteup/url(/created)。
// URL 分类复用 url-resolver.js 的 resolveZhihuUrl（new URL + zhihu.com 域名硬校验），不另设第二套正则。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { upsertContent } from './storage.js';
import { resolveZhihuUrl } from './url-resolver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// output/ 目录：默认为 zhihu-mcp-server 的上级（爬虫仓库根）下的 output/，可用 ZHIHU_OUTPUT_DIR 覆盖
function outputDir() {
  return process.env.ZHIHU_OUTPUT_DIR || path.resolve(__dirname, '..', 'output');
}

// url → { type, id, question_id }。非知乎域名/不可识别 URL 一律 null（resolveZhihuUrl 内部做域名硬校验）
function classifyUrl(url) {
  const r = resolveZhihuUrl(url);
  if (!r) return null;
  return { type: r.type, id: r.id, question_id: r.question_id ?? null };
}

// 解析单个 Markdown 文件 → upsertContent 入参；无 front matter 或 URL 不可识别返回 null
export function parseMarkdownFile(filepath) {
  let raw;
  try {
    raw = fs.readFileSync(filepath, 'utf8');
  } catch {
    return null;
  }
  const text = String(raw).replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return null;
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const classified = classifyUrl(meta.url);
  if (!classified || !/^\d+$/.test(classified.id)) return null;
  const body = text.slice(m[0].length).trim();
  // question 类型时 question_id 与自身 id 相同（ingest 契约：过滤/关联字段不为空）
  const questionId = classified.type === 'question' ? classified.id : classified.question_id;
  return {
    content_type: classified.type,
    content_id: classified.id,
    title: meta.title || '',
    author: meta.author || '',
    url: meta.url || '',
    question_id: questionId,
    voteup_count: parseInt(meta.voteup, 10) || 0,
    created_at: meta.created || null,
    content: body,
    file_path: filepath
  };
}

// 扫描 output/ 下 *.md 并导入。since（ms 时间戳）给定时只处理 mtime 晚于它的文件——
// zhihu_save_* 用增量（保存开始时间），zhihu_reindex 不传即全量。
// 返回 { scanned, inserted, updated, unchanged, skipped, output_dir }
export function importOutputMarkdown({ since = 0 } = {}) {
  const dir = outputDir();
  const stats = { scanned: 0, inserted: 0, updated: 0, unchanged: 0, skipped: 0, output_dir: dir };
  if (!fs.existsSync(dir)) return stats;

  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        if (since) {
          try {
            if (fs.statSync(full).mtimeMs <= since) continue;
          } catch { continue; }
        }
        stats.scanned++;
        const item = parseMarkdownFile(full);
        if (!item) { stats.skipped++; continue; }
        const r = upsertContent(item);
        if (r === 'inserted') stats.inserted++;
        else if (r === 'updated') stats.updated++;
        else stats.unchanged++;
      }
    }
  };
  walk(dir);
  return stats;
}

// CLI：node ingest.js 直接执行导入（zhihu_reindex 调同一路径）
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
    (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
  const r = importOutputMarkdown();
  console.log(JSON.stringify(r, null, 2));
}
