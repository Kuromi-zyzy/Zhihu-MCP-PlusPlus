# 知乎 MCP++

<p align="left">
  <img alt="Python" src="https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white">
  <img alt="Node" src="https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white">
  <img alt="MCP" src="https://img.shields.io/badge/MCP-15%20tools-8A2BE2">
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux-blue">
</p>

> 前身 `ZhihuSpider`，2026-09-22 更名为「知乎 MCP++」。**致谢两位原作者**：[Milloyy](https://github.com/Milloyy)（2019 年原始实现）与 [Foxgeek36 (Decimal)](https://github.com/Foxgeek36)（fork 来源），本项目由两者结合发展而来，详见文末「致谢」。

知乎内容爬虫 + MCP 服务器：zse96 v2 API 签名 → Android API → 浏览器兜底三层反爬策略，批量保存为 Markdown；同时以 MCP（Model Context Protocol）服务器的形式把 15 个工具暴露给 Claude / Cursor / 豆包等 AI 助手，在对话中实时查知乎。

## 功能一览

**Python 爬虫（CLI）**
- 爬取问题下的回答（排序、分页、断点续传）、单篇回答、专栏文章、收藏夹
- 三层递进反爬：`zse96 v2 签名 requests → Android API → DrissionPage 浏览器兜底`，遇 403 自动降级
- 自动 Cookie 捕获（控制浏览器扫码登录）、支持代理、YAML front matter 元数据

**MCP 服务器（`zhihu-mcp-server/`，Node.js）**
- 15 个工具 = 11 个查询 + 4 个本地保存，接入任意支持 MCP 的 AI 客户端
- 双搜索信源：知乎站内搜索（头部热答、带点赞数）+ **Bing `site:zhihu.com` 检索**（长尾专栏文章覆盖更好），Bing 结果自动过滤站外噪音并提取知乎 ID，可直接串联 `zhihu_save_*` 存档

## 安装

```bash
git clone https://github.com/Kuromi-zyzy/Zhihu-MCP-PlusPlus.git
cd Zhihu-MCP-PlusPlus
pip install -r requirements.txt

# MCP 服务器依赖（Node ≥ 18）
cd zhihu-mcp-server && npm install
```

## 快速开始

### 登录（爬虫需要）

```bash
python login.py
# 自动打开浏览器 → 扫码登录知乎 → 自动捕获 Cookie 到 config.json
```

### 爬取内容（CLI）

```bash
# 爬取问题下的回答
python main.py question <问题ID>

# 爬取单篇回答
python main.py answer <回答ID>

# 爬取专栏文章
python main.py article <文章ID>

# 爬取收藏夹
python main.py collection <收藏夹ID>
```

示例：

```bash
python main.py question <问题ID> --sort voteups          # 按点赞排序
python main.py question <问题ID> --max-pages 5           # 限制抓取页数
python main.py question <问题ID> --proxy http://127.0.0.1:7890  # 走代理
```

## 架构

三层递进反爬策略，遇 403 自动降级：

```
带签名 requests（zse96 v2） → Android API → BrowserCrawler（DrissionPage）
```

- **zse_signer.py** — 从 zhihu-plus-plus 移植的 zse96 v2 签名算法
- **ZhihuCrawler** — requests + API，Cookie 有 d_c0 时自动签名
- **BrowserCrawler** — DrissionPage 浏览器自动化，兜底
- **断点续传** — 输出目录维护 `.progress.json`，重复运行跳过已保存

## MCP 服务器

目录 `zhihu-mcp-server/` 内置知乎 MCP 服务，15 个工具（11 查询 + 4 保存）：

```
zhihu_hot_list       — 热榜
zhihu_search         — 搜索（知乎站内）
zhihu_search_web     — Bing 搜索知乎内容（site:zhihu.com，附类型/ID，可接 save_*）
zhihu_hot_search     — 热搜词
zhihu_get_question   — 问题详情
zhihu_get_answer     — 回答详情
zhihu_get_article    — 文章详情
zhihu_question_answers — 回答列表
zhihu_get_user       — 用户信息
zhihu_set_cookies    — 设置 Cookie
zhihu_get_config     — 查看配置
zhihu_save_question  — 保存问题全部回答（调本爬虫）
zhihu_save_answer    — 保存单条回答（调本爬虫）
zhihu_save_article   — 保存专栏文章（调本爬虫）
zhihu_save_collection — 保存收藏夹（调本爬虫）
```

### 接入 AI 客户端

以 Claude Desktop / Cursor 等标准 MCP 客户端为例（stdio 方式）：

```json
{
  "mcpServers": {
    "zhihu": {
      "command": "node",
      "args": ["<仓库路径>/zhihu-mcp-server/index.js"]
    }
  }
}
```

- Cookie 存放于 `~/.zhihu-mcp/config.json`，可经 `zhihu_set_cookies` 工具写入，或手动编辑；至少需要 `d_c0` 才能签名
- `zhihu_save_*` 四个保存工具会在内部调用本仓库的 Python 爬虫，**因此 MCP 必须从本仓库内的 `zhihu-mcp-server/` 启动**（`SPIDER_DIR` 相对路径才成立），且需要本机装有 Python 与依赖；只把 `index.js` 拷走的话查询工具可用，保存工具会断链
- 爬虫登录态（仓库根 `config.json`）与 MCP 登录态（`~/.zhihu-mcp/config.json`）互相独立

### 双搜索信源说明

- `zhihu_search`（站内）：头部热答质量高、带点赞数，但长尾覆盖弱，结果混 `ai_zhida` 推广位
- `zhihu_search_web`（Bing）：能检索到站内搜不到的专栏长文；实测 Bing 对中文多词查询会静默放宽 `site:` 限制，本工具已按 `zhihu.com` 域名硬过滤，并在结果中标注知乎类型（question/answer/article/pin/user/collection）与 ID，可直接喂给 `zhihu_get_answer` / `zhihu_save_article` 等；劣化查询可能返回 0 条（宁缺毋滥）

## Cookie

优先级：`--cookie` 命令行 > `config.json`（login.py 生成） > `.env` > `ZHIHU_COOKIE` 环境变量

## 输出

```
output/[<id>] <title>/
├── [<voteup>赞] <author> - <title>.md  # YAML front matter + Markdown
└── .progress.json                       # 断点续传
```

## 项目结构

```
├── main.py               # CLI 入口：question / answer / article / collection / login
├── crawler.py            # ZhihuCrawler（签名 API）+ BrowserCrawler（浏览器兜底）
├── zse_signer.py         # zse96 v2 签名
├── parser.py             # HTML → Markdown + YAML front matter
├── zhihu_spider.py       # 业务编排、断点续传、文件保存
├── login.py              # DrissionPage 扫码登录、Cookie 捕获
├── web_search.py         # 独立的 Bing/DuckDuckGo 搜索小工具（不被爬虫引用）
├── zhihu-mcp-server/     # Node.js MCP 服务器（15 工具）
└── tests/                # pytest 纯函数测试（python -m pytest）
```

## 免责声明

- 请求间隔 3 秒，反爬礼貌，不是性能问题
- 仅用于个人学习和研究，请遵守知乎用户协议与 robots 协议，勿用于商业用途

## 致谢

本项目由两位原作者的工作结合发展而来：

- **Milloyy** — ZhihuSpider 原始作者，2019 年完成最初实现。原仓库与账号现已不可访问，谨以 git 历史留此致谢。
- **[Foxgeek36 (Decimal)](https://github.com/Foxgeek36)** — 在 Milloyy 版本基础上维护并扩展，本仓库 fork 自 `Foxgeek36/ZhihuSpider`，将两者结合后继续开发至今。

另外感谢：

- [zly2006/zhihu-plus-plus](https://github.com/zly2006/zhihu-plus-plus) — `zse_signer.py` 的 zse96 v2 签名算法移植来源
- [meurz/zhihu-mcp-server](https://github.com/meurz/zhihu-mcp-server)（原名 `iteng007/zhihu-mcp-server`）— `zhihu-mcp-server/` 的上游项目

## License

MCP 服务器部分（`zhihu-mcp-server/`）继承上游为 AGPL-3.0；其余部分暂未设许可证（如需使用请先开 issue 沟通）。
