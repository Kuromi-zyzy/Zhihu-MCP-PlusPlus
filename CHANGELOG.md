# Changelog

## v1.0.0 (2026-09-22)

一次性交付版本。定位：**面向 AI Agent 的知乎检索、阅读、研究、归档与本地知识库后端**。

### Security
- MCP `save_*` 从 `execSync(拼串)` 迁移到 `execFileSync` 数组传参，Agent 输入不再进入 shell
- 全部 ID/枚举/整数参数白名单校验，校验失败返回 `invalid_input` envelope
- 统一 Credential Store `~/.zhihu-mcp/credentials.json`（Python/Node 双读，旧 config 只读迁移，POSIX 0600）
- Cookie 不进 Git、不进日志（logger 自动脱敏）、不进客户端响应（auth_status 只回键名）

### Added
- 统一认证工具：`zhihu_auth_status / login / import / logout`（登录必须 `/api/v4/me` 验证通过才落盘）
- 统一响应 envelope（ok/schema_version/data|error/meta）与 14 个标准错误码
- `zhihu_resolve_url`：URL → {type, id, canonical_url}（含 tardis 镜像页）
- `zhihu_get_content`：统一内容入口（url 或 type+id → 归一化 ZhihuContent）
- `zhihu_get_pin` / `zhihu_save_pin`：补齐想法类型
- `zhihu_list_comments` / `zhihu_list_replies`：评论与楼中楼（limit ≤ 20 分页）
- Search Router：`zhihu_search(source=auto|zhihu|web|local)` 三源合并去重
- Context Budget：读取工具统一支持 `fields` / `include_content` / `max_content_chars`
- 本地知识库：SQLite + FTS5（trigram 中文）+ SHA-256 内容去重；`zhihu_local_search`（keyword/semantic/hybrid）、`zhihu_reindex`
- 可选 Embedding（`ZHIHU_EMBEDDING_PROVIDER`），缺失时自动降级 keyword 不阻塞
- 原生 Streamable HTTP transport（`--http`）+ `/healthz`，不再依赖 supergateway
- TTL 缓存（详情 10min / 搜索 5min / 热榜 2min）、统一限流、结构化日志、`zhihu_diagnostics`
- 全部 27 工具带 MCP annotations；Agent 指南（docs/agent-guide.md）与架构文档（docs/architecture.md）

### Changed
- `login.py`：轮询 Cookie `z_c0` 判定登录（旧 URL 判定会被登录页重定向误触发）；`/api/v4/me` 验证通过才写 config
- `crawler.py get_answers`：真正三层递进（签名 Web → 无签名 Web → Android API）
- Bing 检索模块化（`search/bing.js`），15s 超时，实体二次解码修复
- 旧工具（`zhihu_get_question/answer/article`、`zhihu_save_*`、`zhihu_hot_list` 等）全部保留，标记 legacy-compatible，内部走同一 service

### Tests / CI
- Python：51 pytest（parser/spider/credentials 等，全离线）
- Node：32 node --test（Bing fixture 回归 / schema / resolver / storage 状态机 / 注入载荷拒绝）
- 集成 smoke：`scripts/smoke-test.mjs`（无账号可跑 8 项）
- GitHub Actions：Python 3.11/3.12 × Node 20/22 矩阵 + 安全基线（敏感文件未跟踪、无 shell 串执行）

### v1 明确不做
点赞 / 关注 / 发评论 / 发回答 / 发文章 / 私信 / 自动运营——read · research · archive only。

## 更早

- 2026-09-22 早前提交：仓库更名 ZhihuSpider → Zhihu-MCP-PlusPlus；`zhihu_search_web`（Bing 信源，域名硬过滤）；安全加固 P0（execFileSync + login.py 轮询 z_c0）；三层反爬接通；测试与 CI 基础版。
