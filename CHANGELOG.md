# Changelog

## v1.0.0-rc3 (2026-09-23)

第二轮外部审查修复（2 个 P0 硬 bug + 主链正确性 + 发布工程）：

### Fixed（P0）
- `zhihu_auth_import` 漏 `await`：`validateCookieString` 是 async，无 await 时正常 Cookie 也被判 `not_authenticated`——导入功能此前实际不可用；handler 级测试锁死（变异验证：撤掉 await 测试即红）
- `save_browser_answer_md` 把回答 URL 写成问题页 → ingest 按类型推断会把同一问题下多个回答归并成 `question:<qid>` 互相覆盖；改写 `/question/<qid>/answer/<aid>`（无 qid 时回退 `/answer/<aid>`），pytest 回归锁死

### Fixed（正确性）
- `ingest.js` 删自造 URL 正则，复用 `url-resolver.js` 的 `resolveZhihuUrl`（`new URL` + zhihu.com 域名硬校验）——站外 URL（如 `evil.example/question/123/answer/456`）不再可能伪装入库；`url-resolver` 补裸 `/answer/<id>` 分支
- `transport.fetchOnce` 把原始网络异常（AbortError/TypeError/ECONNRESET）归一为 `upstream_timeout`/`network_error` envelope——修复前 retry 层看不到 retryable code，**超时/网络重试实际从未生效**；mock fetch 测试验证 3 次调用
- Search Router 最终排序先剥离 `source` 再算分 → 来源置信度（zhihu 0.9/web 0.7/local 0.95）实际全部落到 0.5；改为先排序后剥离
- `listReplies`/`fetchAnswers` 的 `has_more` 表达式错误（`!undefined ?? x` 永真、后半段死代码）
- CI security 检查的 `|| true` 会在发现违规时吞掉退出码 → 改为显式 `exit 1`

### Changed
- **异步化**：`execFileSync` 全部替换为异步 `spawn`（`runPythonAsync`/`browserLogin`）——HTTP 模式下 6 分钟的扫码登录或 3 分钟的收藏夹爬取不再冻结 event loop（`/healthz` 等并发请求照常响应）
- **增量归档**：`zhihu_save_*` 后只导入本次落盘的文件（mtime > 保存开始时刻），`zhihu_reindex` 才做全量重扫——归档增长后保存成本恒定
- HTTP 非回环地址绑定从"警告"改为**默认拒绝启动**（显式 `--allow-remote` 才放行）
- Cookie 导入语义改为整体替换（`replace: true`），换账号不残留旧键；`user` 字段统一为 `{id, name}` 对象 schema（`normalizeUser`）
- `login.py` 不再打印 Cookie 前 50 字符预览（只显示键名）——对齐"Cookie 不进日志"声明

### Release engineering
- 版本单源化：`index.js` 从 package.json 读版本（不再硬编码）；package.json/pyproject 对齐 `1.0.0-rc3`
- 补 `LICENSE`（AGPL-3.0 全文，根目录与 zhihu-mcp-server/ 各一份）；README License 段写明 Python 爬虫上游授权边界
- GitHub 仓库 description 更新为 27 工具
- 测试：node 37→48（transport 归一+retry 计数/ingest 站外拒绝+增量/credentials replace+schema/handler 级 auth 链路），pytest 51→52（浏览器回答 URL）

## v1.0.0-rc2 (2026-09-23)

发布验收修复（外部验收意见 → 收口）：

### Fixed
- `zhihu_auth_login` 描述与行为不符：handler 误调 `validateCurrent()`（只查现有 Cookie），现改为真正走 `browserLogin()`（DrissionPage 扫码 + 验证闸门）；现有 Cookie 仍有效时快速返回（`skipped_browser: true`）
- `login.py` 登录成功后直写统一凭据库 `~/.zhihu-mcp/credentials.json`（此前只写仓库 config.json，Node 侧需二次迁移才见新凭据）

### Added
- `ingest.js` 归档导入器：`output/` Markdown（YAML front matter）→ SQLite，answer/article/pin/question 四类 URL 形态 + 站外拒绝
- `zhihu_reindex` 兑现文档语义：真实执行「扫描 output/ Markdown → 导入 contents → 物理重建 FTS」（此前只 rebuild 既有行）
- `zhihu_save_question/answer/article/collection`（Python 爬虫路径）落盘后自动同步本地知识库，Markdown 与 SQLite 不再是平行宇宙

### Changed
- README/文档诚实化：Embedding 明确为「可插拔接口，local-hash 仅为链路联调伪向量，非语义 embedding」
- 测试 32 → 37（ingest 5 项）；Python 51 pytest 全过；fresh-store smoke 9/9

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
