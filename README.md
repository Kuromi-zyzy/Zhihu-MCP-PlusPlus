# 知乎 MCP++ v1.0

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
| **Archive** | `zhihu_save_content`（统一保存）、`zhihu_save_question/answer/article/collection/pin` |
| **Local Knowledge** | `zhihu_local_search`（keyword/semantic/hybrid）、`zhihu_reindex` |
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
├── storage.js          # SQLite + FTS5(trigram 中文) + SHA-256 去重 + 可选 embedding
├── credentials.js      # 统一凭据库 ~/.zhihu-mcp/credentials.json（Python/Node 共用）
├── auth.js             # /api/v4/me 验证闸门
├── errors.js           # 14 个标准错误码 + envelope + context budget
├── cache.js            # SQLite TTL 缓存（详情10min/搜索5min/热榜2min，refresh 可绕过）
├── rate-limiter.js     # 按 source 限速
└── logger.js           # 结构化日志（自动脱敏 Cookie）
```

Python 侧（爬虫）：`crawler.py` 真三层递进（签名 Web API → 无签名 → Android API）→ `BrowserCrawler`（DrissionPage）浏览器兜底；`login.py` 轮询 `z_c0` + 验证后写盘。

### 关键设计

- **统一 Credential Store**：`~/.zhihu-mcp/credentials.json`（version/cookies/user/validated_at），Python 与 Node 双读；旧 `config.json` 只读迁移兼容。Cookie 不进 Git、不进日志、不回传客户端。
- **重试策略**：仅 timeout/网络错误/5xx 重试（≤2 次指数退避）；401/403/429 立即 fallback，不撞墙。
- **Context Budget**：读取工具统一支持 `fields`（字段投影）、`include_content`、`max_content_chars`（截断带标记）。
- **中文检索**：FTS5 trigram tokenizer（unicode61 会把连续中文当整块 token，实测）；<3 字符关键词 LIKE 兜底。
- **Embedding 可选**：`ZHIHU_EMBEDDING_PROVIDER=local-hash` 等配置启用；未配置时 semantic/hybrid 自动降级 keyword，绝不阻塞启动。

## Security

- 凭据集中存储于用户目录，POSIX 下 `0600`；`zhihu_auth_status` 只回键名不回值；日志自动脱敏
- MCP `save_*` 全部 `execFileSync` 数组传参（不经过 shell）+ ID/枚举/整数白名单校验
- HTTP 模式默认绑定 `127.0.0.1`，显式绑公网会输出显著警告；v1 无远端写操作

## 开发

```bash
python -m pytest -q                       # Python 侧 51 测试
cd zhihu-mcp-server
npm test                                  # Node 侧 32 测试
node scripts/smoke-test.mjs               # 集成 smoke（无账号可跑）
```

CI：GitHub Actions 三 job——Python 3.11/3.12（ruff+pytest）、Node 20/22（npm ci + 全模块语法检查 + 测试 + smoke）、安全基线（敏感文件未跟踪、无 shell 串执行）。

更多文档：[docs/architecture.md](docs/architecture.md) · [docs/agent-guide.md](docs/agent-guide.md) · [CHANGELOG.md](CHANGELOG.md)

## 免责声明

- 请求间隔受统一限流约束，反爬礼貌
- 仅用于个人学习和研究，请遵守知乎用户协议与 robots 协议

## 致谢

本项目由两位原作者的工作结合发展而来：

- **Milloyy** — ZhihuSpider 原始作者，2019 年完成最初实现。原仓库与账号现已不可访问，谨以 git 历史留此致谢。
- **[Foxgeek36 (Decimal)](https://github.com/Foxgeek36)** — 在 Milloyy 版本基础上维护并扩展，本仓库 fork 自 `Foxgeek36/ZhihuSpider`，将两者结合后继续开发至今。

另外感谢：

- [zly2006/zhihu-plus-plus](https://github.com/zly2006/zhihu-plus-plus) — `zse_signer.py` 的 zse96 v2 签名算法移植来源
- [meurz/zhihu-mcp-server](https://github.com/meurz/zhihu-mcp-server)（原名 `iteng007/zhihu-mcp-server`）— MCP 服务器的最初上游

## License

MCP 服务器部分（`zhihu-mcp-server/`）继承上游为 AGPL-3.0；其余部分暂未设许可证（如需使用请先开 issue 沟通）。
