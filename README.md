# 知乎 MCP++

> 原名 `ZhihuSpider`，2026-09-22 更名为「知乎 MCP++」（GitHub 仓库名：`Zhihu-MCP-PlusPlus`）。

知乎内容爬虫 + MCP 服务器，支持 API 签名鉴权 + 浏览器兜底，批量保存为 Markdown 文件。

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

目录 `zhihu-mcp-server/` 内置知乎 MCP 服务（15 个工具 = 11 个查询 + 4 个保存），接入 ZCode/opencode/Claude 后可在 AI 对话中实时查知乎：

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

> 部署注意（2026-09-08）：save_* 四工具经 `SPIDER_DIR=..` 调用本爬虫，只有 MCP 代码住在 `zhihu-mcp-server/` 原生位置时路径才成立。Windows 侧 ZCode 指回 `D:\Tools\zhihuspider\zhihu-mcp-server\index.js` 可用全部 15 个工具；WSL 侧副本 `/home/tang/zhihu-mcp/` 仅 10 个查询工具可用（save_* 断链）。爬虫登录态（config.json/.env）与 MCP 的 `~/.zhihu-mcp` cookies 互相独立。

> `zhihu_search_web`（2026-09-22 新增）：Bing 信源检索知乎。对比实测：知乎站内搜索强在头部热答（带点赞数），但收录窄、无登录态时长尾覆盖差；Bing 能检索到站内搜不到的专栏长文，但对中文多词查询会静默放宽 `site:` 限制，掺入站外结果——工具内已按域名硬过滤，并在结果中标注知乎类型（question/answer/article/pin/user/collection）与 ID，可直接喂给 `zhihu_get_answer` / `zhihu_save_article` 等。

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

## 致谢

本项目由两位原作者的工作结合发展而来：

- **Milloyy** — ZhihuSpider 原始作者，2019 年完成最初实现。原仓库与账号现已不可访问，谨以 git 历史留此致谢。
- **[Foxgeek36 (Decimal)](https://github.com/Foxgeek36)** — 在 Milloyy 版本基础上维护并扩展，本仓库 fork 自 `Foxgeek36/ZhihuSpider`，将两者结合后继续开发至今。

另外感谢：

- [zly2006/zhihu-plus-plus](https://github.com/zly2006/zhihu-plus-plus) — `zse_signer.py` 的 zse96 v2 签名算法移植来源
- [meurz/zhihu-mcp-server](https://github.com/meurz/zhihu-mcp-server)（原名 `iteng007/zhihu-mcp-server`）— `zhihu-mcp-server/` 的上游项目
