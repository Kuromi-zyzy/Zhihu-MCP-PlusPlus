# 架构（v1.0）

## 数据流

```text
Agent (stdio | Streamable HTTP)
   │  MCP tools/call
   ▼
index.js ── 工具分发 + envelope 包装 + 结构化日志
   │
   ├─ Search Router ──► 知乎站内 search_v3 ─┐
   │                     Bing site:zhihu ──┤→ normalize → canonicalize → dedupe → 确定性排序
   │                     本地 SQLite FTS5 ──┘
   ├─ Content Service ─► transport(web 签名 → android) → normalizeContent → ZhihuContent
   ├─ Archive ─────────► runSpider(Python main.py) → Markdown(output/)
   │                 └► upsertContent → SQLite(contents + FTS5 + embeddings)
   └─ Auth ───────────► DrissionPage 登录 → /api/v4/me 验证 → credentials.json
```

## Transport 层

| 通道 | 端点基址 | 签名 | 说明 |
|---|---|---|---|
| web | `www.zhihu.com/api/v4/*` | zse96 v2（需 d_c0） | 详情/搜索/评论主通道 |
| android | `api.zhihu.com/*` | 无 | 热榜、pin、楼中楼、web 被拦时的 fallback |

Fallback 编排（`withFallback`）：`not_found / invalid_input / not_authenticated` 直接上抛；`anti_bot_blocked / network_error / upstream_timeout` 降级下一通道。重试仅针对 timeout/网络/5xx，≤2 次指数退避；403/429 不重试（撞墙无意义，fallback 优先）。

## 统一数据模型

**Envelope**（§5）：

```json
{ "ok": true, "schema_version": "1.0", "data": {}, "meta": { "source": "zhihu_web", "cached": false, "duration_ms": 0 } }
{ "ok": false, "schema_version": "1.0", "error": { "code": "not_authenticated", "message": "...", "retryable": false }, "meta": {} }
```

**ZhihuContent**（§6）：`type / id / canonical_url / title / author{name,url_token} / content / excerpt / voteup_count / comment_count / created_at / updated_at / question / topics`，各类型允许扩展字段（如 question 的 `answer_count`）。

**错误码**（14 个）：`invalid_input / not_authenticated / permission_denied / not_found / rate_limited / anti_bot_blocked / network_error / upstream_timeout / upstream_changed / parse_error / browser_error / storage_error / unsupported_content_type / internal_error`。

## 本地知识库

- 主存储：Markdown（`output/`，人类可读，Python 爬虫写入，带 YAML front matter 与断点续传）
- 一体化：`ingest.js` 把 `output/` Markdown 导入 SQLite——`zhihu_save_*`（Python 路径）执行后自动导入，`zhihu_reindex` 全量重扫；两条保存路径（`zhihu_save_content` 直写 / 爬虫 Markdown）汇聚同一查询层
- 查询层：`~/.zhihu-mcp/index.sqlite`
  - `contents` 表：content_id（`{type}:{id}` 复合主键）、content_hash（SHA-256，归一化 CRLF 后）
  - `contents_fts`：FTS5 **trigram** tokenizer（unicode61 对连续中文是整 token，实测无法子串命中；trigram 支持 ≥3 字子串，<3 字符 LIKE 兜底）
  - `embeddings` 表 + `ZHIHU_EMBEDDING_PROVIDER`：可选能力，未配置时 semantic/hybrid 降级 keyword
- 去重：hash 相同不重写（`unchanged`），变化则 `updated` 并记 `updated_at`——为"这个回答最近改没改"打基础

## 凭据与安全

- `<数据目录>/credentials.json`：统一 Credential Store（唯一登录态存储），数据目录由 `ZHIHU_MCP_DATA_DIR` 统一控制（Python/Node 同语义）——`login.py` 验证通过后直写（唯一写入点），Node（credentials.js）读取验证；旧两处 config.json 已停止写入，仅首次只读迁移
- 验证闸门：任何写入路径都必须先过 `/api/v4/me`（HTTP 200 + 用户身份）
- 边界：无 execSync 字符串执行；Cookie 不进 Git/日志/客户端响应；HTTP 默认 127.0.0.1；v1 无知乎远端写操作

## 端点情报（2026-09-22 实测）

- 评论：`comment_v5/{questions|answers|articles}/<id>/root_comment`（现行端点；旧 `root_comments` 已 404）
- 楼中楼：`api.zhihu.com/comments/<cid>/child_comments`（Android 老通道仍在服务；comment_v5 无楼中楼端点）
- 站内搜索混 `ai_zhida` 推广位、部分结果无 title，Router 归一化时过滤
- cn.bing.com 对中文多词查询会静默丢弃 `site:` → 结果必须按 `zhihu.com` 域名硬过滤
- DDG 大陆直连 100% 超时，不作为回退引擎
