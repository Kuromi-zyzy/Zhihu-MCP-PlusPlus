# 知乎 MCP++ v1.0.0-rc4

<p align="left">
  <img alt="Python" src="https://img.shields.io/badge/Python-3.11%2B-3776AB?logo=python&logoColor=white">
  <img alt="Node" src="https://img.shields.io/badge/Node.js-22.5%2B-339933?logo=node.js&logoColor=white">
  <img alt="MCP" src="https://img.shields.io/badge/tools-27-8A2BE2">
  <img alt="CI" src="https://img.shields.io/badge/CI-GitHub_Actions-2088FF?logo=githubactions&logoColor=white">
</p>

> **面向 AI Agent 的知乎检索、阅读、研究、归档与本地知识库后端。**
> 前身 `ZhihuSpider`，由 [Milloyy](https://github.com/Milloyy)（2019 年原始实现）与 [Foxgeek36 (Decimal)](https://github.com/Foxgeek36)（fork 来源）两位原作者的工作结合发展而来，完整致谢见文末。

## 这是什么

知乎 MCP++ 把知乎变成 AI 助手（Claude Desktop / Cursor / 豆包等任何 MCP 客户端）可用的知识源：

```text
Discovery（多源检索）──► Retrieval（统一内容读取）──► Archive（Markdown + 本地知识库）
   知乎站内 / Bing /          question/answer/article/        SQLite FTS5 全文索引
   本地归档三源合并            pin/user/collection            可选语义检索
```

**安全边界**：只读检索 + 本地归档，不提供任何知乎账户写操作（不点赞、不关注、不发评论）。

## Quick Start

```bash
git clone https://github.com/Kuromi-zyzy/Zhihu-MCP-PlusPlus.git
cd Zhihu-MCP-PlusPlus
pip install -r requirements.txt          # Python 爬虫侧
cd zhihu-mcp-server && npm ci             # MCP 侧（Node ≥ 22.5，node:sqlite 内置）
```

登录（验证通过才写凭据）：

```bash
python login.py        # 浏览器扫码，轮询 z_c0 + /api/v4/me 验证
```

### 接入 AI 客户端

stdio（Claude Desktop / Cursor / Cline 通用）：

```json
{
  "mcpServers": {
    "zhihu": {
      "command": "node",
      "args": ["/absolute/path/to/Zhihu-MCP-PlusPlus/zhihu-mcp-server/index.js"]
    }
  }
}
```

原生 Streamable HTTP（无需 supergateway）：

```bash
node zhihu-mcp-server/index.js --http --port 8635
# MCP 端点 http://127.0.0.1:8635/mcp，健康检查 /healthz（默认仅绑定 127.0.0.1）
```

## 工具总览（27 个，按类别）

| 类别 | 工具 |
|---|---|
| **Search** | `zhihu_search`（多源路由 auto/zhihu/web/local）、`zhihu_resolve_url` |
| **Content** | `zhihu_get_content`（统一入口，url 或 type+id）、`zhihu_get_question/answer/article/pin/user`、`zhihu_question_answers`、`zhihu_hot_list`、`zhihu_hot_search` |
| **Discussion** | `zhihu_list_comments`、`zhihu_list_replies`（楼中楼） |
| **Archive** | `zhihu_save_content`（统一保存）、`zhihu_save_question/answer/article/collection/pin`（爬虫落盘后自动入知识库） |
| **Local Knowledge** | `zhihu_local_search`（keyword/semantic/hybrid）、`zhihu_reindex`（扫描 Markdown 重建索引） |
| **Auth** | `zhihu_auth_status/login/import/logout` |
| **Diagnostics** | `zhihu_get_config`、`zhihu_diagnostics` |

全部工具带统一响应 envelope（`ok / schema_version / data|error / meta`）与 MCP annotations（查询只读、保存幂等）。

## 架构

```text
zhihu-mcp-server/
├── index.js            # MCP 装配：27 工具注册 + stdio/Streamable HTTP 双 transport + healthz
├── transport.js        # 统一知乎通道：web(zse96 签名) / android，fallback 编排 + 重试策略
├── content-service.js  # ZhihuContent 归一化 + get/comments/replies 统一业务层
├── search/
│   ├── bing.js         # Bing site:zhihu.com（域名硬过滤 + 15s 超时 + trigram 解析）
│   └── router.js       # 多源搜索路由：合并、去重、确定性排序
├── storage.js          # SQLite + FTS5(trigram 中文) + SHA-256 去重 + 可插拔 embedding 接口
├── ingest.js           # 归档导入器：output/ Markdown（YAML front matter）→ SQLite
├── credentials.js      # 统一凭据库 ~/.zhihu-mcp/credentials.json（Python/Node 共用）
├── auth.js             # /api/v4/me 验证闸门
├── errors.js           # 14 个标准错误码 + envelope + context budget
├── cache.js            # SQLite TTL 缓存（详情10min/搜索5min/热榜2min，refresh 可绕过）
├── rate-limiter.js     # 按 source 限速
└── logger.js           # 结构化日志（自动脱敏 Cookie）
```

Python 侧（爬虫）：`crawler.py` 真三层递进（签名 Web API → 无签名 → Android API）→ `BrowserCrawler`（DrissionPage）浏览器兜底；`login.py` 轮询 `z_c0` + 验证后写盘。

### 关键设计

- **统一 Credential Store（单一来源）**：`<数据目录>/credentials.json`（version/cookies/user/validated_at）是唯一登录态存储——`login.py` 验证通过后直写（唯一写入点），MCP 读取；数据目录由 `ZHIHU_MCP_DATA_DIR` 统一控制（Python/Node 同语义，默认 `~/.zhihu-mcp`，测试隔离靠它）。旧 `config.json` 已停止写入，仅首次使用时只读迁移。Cookie 不进 Git、不进日志、不回传客户端。
- **重试策略**：仅 timeout/网络错误/5xx 重试（≤2 次指数退避）；401/403/429 立即 fallback，不撞墙。
- **Context Budget**：读取工具统一支持 `fields`（字段投影）、`include_content`、`max_content_chars`（截断带标记）。
- **中文检索**：FTS5 trigram tokenizer（unicode61 会把连续中文当整块 token，实测）；<3 字符关键词 LIKE 兜底。
- **归档一体化（增量）**：`zhihu_save_*`（Python 爬虫路径）落盘 Markdown 后**增量**导入 SQLite（只扫本次新文件）；`zhihu_reindex` 才做全量重扫 + FTS 物理重建。两条保存路径（`zhihu_save_content` 直写 / 爬虫 Markdown）汇聚同一知识库，`zhihu_local_search` 统一检索。
- **Embedding 为可插拔接口**：支持 `ZHIHU_EMBEDDING_PROVIDER` 配置；内置 `local-hash` 仅为链路联调的确定性伪向量（非语义 embedding）。未配置真实 provider 时 semantic/hybrid 自动降级 keyword 检索，绝不阻塞启动。

## Security

- 凭据集中存储于用户目录，POSIX 下 `0600`；`zhihu_auth_status` 只回键名不回值；日志与登录脚本输出均不打印 Cookie 内容（自动脱敏 + 只显示键名）
- MCP `save_*` 全部异步 `spawn` 数组传参（不经过 shell、不阻塞 event loop）+ ID/枚举/整数白名单校验
- HTTP 模式默认绑定 `127.0.0.1`；非回环地址绑定默认**拒绝启动**，确需暴露须显式 `--allow-remote`（风险自担）；v1 无远端写操作

## 开发

```bash
python -m pytest -q                       # Python 侧 52 测试
cd zhihu-mcp-server
npm test                                  # Node 侧 52 测试
node scripts/smoke-test.mjs               # 集成 smoke 9 项（隔离数据目录，无账号可跑）
```

CI：GitHub Actions 五 job——Python 3.11/3.12（ruff+pytest）、Node 22/24（npm ci + 全模块语法检查 + 测试 + smoke，隔离数据目录）、安全基线（敏感文件未跟踪、禁止同步子进程 API、强制异步 spawn）。

更多文档：[docs/architecture.md](docs/architecture.md) · [docs/agent-guide.md](docs/agent-guide.md) · [CHANGELOG.md](CHANGELOG.md)

## 免责声明

- 请求间隔受统一限流约束，反爬礼貌
- 仅用于个人学习和研究，请遵守知乎用户协议与 robots 协议

## 致谢

### 原作者

本项目由两位原作者的工作结合发展而来：

- **[Milloyy](https://github.com/Milloyy)**（<42117644+Milloyy@users.noreply.github.com>）— ZhihuSpider 原始作者，2019 年完成最初实现并持续维护至 2020 年（本仓库 git 历史中保留其 14 个提交，含爬虫核心与 README）。其账号与原仓库现已注销（404），谨以 git 历史留此存档。
- **[Foxgeek36 (Decimal)](https://github.com/Foxgeek36)**（[鲜衣怒马仍少年](https://github.com/Foxgeek36)）— 本仓库 fork 的直接来源 `Foxgeek36/ZhihuSpider`（79 stars）的创建者与维护者：收留并保留了 Milloyy 的全部工作，使其在 Milloyy 退场后仍可被找到与复用，本项目正是在这份遗产上结合两作继续发展至今。

### 设计参照

- **[zly2006](https://github.com/zly2006)**（[zhihu-plus-plus](https://github.com/zly2006/zhihu-plus-plus)，4.1k stars）及社区贡献者 [123Duo3](https://github.com/123Duo3)、[chenx-dust](https://github.com/chenx-dust) 等 — `zse_signer.py` 的 zse96 v2 签名算法移植来源
- **[meurz](https://github.com/meurz)**（[zhihu-mcp-server](https://github.com/meurz/zhihu-mcp-server)，原名 iteng007/zhihu-mcp-server，原作者 iteng007 账号已注销）— MCP 服务器的最初上游

### 贡献者

- **[Kuromi-zyzy](https://github.com/Kuromi-zyzy)** — 当前维护者：MCP 服务器架构（27 工具）、双 transport、Search Router、本地知识库（SQLite FTS5 trigram）、凭据体系与 CI

欢迎 PR；贡献前请先阅读 [docs/architecture.md](docs/architecture.md) 了解分层约定。

## License

- `zhihu-mcp-server/`：AGPL-3.0（继承上游，全文见 [LICENSE](zhihu-mcp-server/LICENSE) 与根目录 [LICENSE](LICENSE)）
- 其余部分（Python 爬虫，源自 Milloyy/Foxgeek36 的 ZhihuSpider）：上游未声明许可证，本项目沿用同样口径——暂未设许可证，如需使用请先开 issue 沟通
