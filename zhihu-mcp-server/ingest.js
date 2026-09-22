// 归档导入器（v1 一体化收口）：把爬虫 output/ 下的 Markdown（YAML front matter + 正文）
// 导入 SQLite contents，使 zhihu_save_*（Python 路径）与 zhihu_save_content（SQLite 路径）
// 产出汇聚到同一知识库，zhihu_local_search 可统一检索。
// front matter 字段由 zhihu_spider._write_md 的各调用点决定：title/author/voteup/url(/created)。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { upsertContent } from './storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// output/ 目录：默认为 zhihu-mcp-server 的上级（爬虫仓库根）下的 output/，可用 ZHIHU_OUTPUT_DIR 覆盖
function outputDir() {
  return process.env.ZHIHU_OUTPUT_DIR || path.resolve(__dirname, '..', 'output');
}

// url → { type, id, question_id }。爬虫产出的 url 形态（zhihu_spider.py 各 _write_md 调用点）：
//   answer:   https://www.zhihu.com/question/<qid>/answer/<aid> | https://www.zhihu.com/answer/<aid>
//   article:  https://zhuanlan.zhihu.com/p/<id>
//   pin:      https://www.zhihu.com/pin/<id>
//   question: https://www.zhihu.com/question/<qid>（浏览器回退模式）
function classifyUrl(url) {
  const u = String(url || '');
  let m = u.match(/\/question\/(\d+)\/answer\/(\d+)/);
  if (m) return { type: 'answer', id: m[2], question_id: m[1] };
  m = u.match(/\/answer\/(\d+)/);
  if (m) return { type: 'answer', id: m[1], question_id: null };
  m = u.match(/zhuanlan\.zhihu\.com\/p\/(\d+)/) || u.match(/\/p\/(\d+)/);
  if (m) return { type: 'article', id: m[1], question_id: null };
  m = u.match(/\/pin\/(\d+)/);
  if (m) return { type: 'pin', id: m[1], question_id: null };
  m = u.match(/\/question\/(\d+)/);
  if (m) return { type: 'question', id: m[1], question_id: m[1] };
  return null;
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
  return {
    content_type: classified.type,
    content_id: classified.id,
    title: meta.title || '',
    author: meta.author || '',
    url: meta.url || '',
    question_id: classified.question_id,
    voteup_count: parseInt(meta.voteup, 10) || 0,
    created_at: meta.created || null,
    content: body,
    file_path: filepath
  };
}

// 扫描 output/ 全部 *.md 并导入。返回 { scanned, inserted, updated, unchanged, skipped, output_dir }
export function importOutputMarkdown() {
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
