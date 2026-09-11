# ZhihuSpider

知乎内容爬虫，支持 API 签名鉴权 + 浏览器兜底，批量保存为 Markdown 文件。

## 功能

- 爬取问题下的回答（支持排序、分页、断点续传）
- 爬取单篇回答、专栏文章
- **爬取收藏夹（收藏夹 → Markdown）**
- **三层反爬策略**：zse96 v2 签名 → Android API 通道 → 浏览器兜底
- 自动 Cookie 捕获（DrissionPage 控制浏览器登录）
- 支持代理、元数据保存（YAML front matter）
- 内置 MCP 服务器，AI 助手可实时查知乎

## 安装

```bash
pip install -r requirements.txt
```

## 快速开始

### 登录

```bash
python login.py
# 自动打开浏览器 → 登录知乎 → 自动捕获 Cookie
```

### 爬取内容

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

### 示例

```bash
python main.py question 320078376 --sort voteups
python main.py collection 960833771
python main.py question 320078376 --proxy "http://127.0.0.1:7890"
python main.py question 320078376 --max-pages 5  # 限制抓取页数
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

目录 `zhihu-mcp-server/` 内置知乎 MCP 服务（14 个工具 = 10 个查询 + 4 个保存），接入 ZCode/opencode/Claude 后可在 AI 对话中实时查知乎：

```
zhihu_hot_list       — 热榜
zhihu_search         — 搜索
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

> 部署注意（2026-09-08）：save_* 四工具经 `SPIDER_DIR=..` 调用本爬虫，只有 MCP 代码住在 `zhihu-mcp-server/` 原生位置时路径才成立。Windows 侧 ZCode 指回 `D:\Tools\zhihuspider\zhihu-mcp-server\index.js` 可用全部 14 个工具；WSL 侧副本 `/home/tang/zhihu-mcp/` 仅 10 个查询工具可用（save_* 断链）。爬虫登录态（config.json/.env）与 MCP 的 `~/.zhihu-mcp` cookies 互相独立。

## Cookie

优先级：`--cookie` 命令行 > `config.json`（login.py 生成） > `.env` > `ZHIHU_COOKIE` 环境变量

## 输出

```
output/[<id>] <title>/
├── [<voteup>赞] <author> - <title>.md  # YAML front matter + Markdown
└── .progress.json                       # 断点续传
```

## 注意事项

- 请求间隔 3 秒，反爬礼貌，不是性能问题
- 仅用于个人学习和研究
