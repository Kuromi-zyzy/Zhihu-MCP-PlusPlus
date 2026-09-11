# AGENTS.md

知乎内容爬虫。Python 3.11+，Windows 优先。

## 命令

- 测试: `uv run pytest`（纯函数，不依赖网络/浏览器）
- Lint: `uv run ruff check .`（规则: E/F/W/I, line-length 120, 忽略 E501）
- 运行: `python main.py {question|article|answer|collection|login|config} [id]`
  - 选项: `--sort {default|voteups|created}`, `--max-pages N`, `--proxy URL`, `--cookie STR`, `-o DIR`
  - `start.bat` 是交互菜单（不含 answer 模式）；`login`/`config` 不需要 id
- 装依赖: `uv sync` 或 `pip install -r requirements.txt`
- 装 dev 工具: `uv sync --all-groups`

## 架构

- **三层递进**: `ZhihuCrawler` 现在有三层反爬策略——带签名 requests（zse96 v2）→ Android API 通道 → `BrowserCrawler` 浏览器兜底。遇 403 自动降级。
- **`zse_signer.py`**: 从 zhihu-plus-plus 移植的 zse96 v2 签名算法，`sign_request(url, d_c0)` → `2.0_[signature]`。ZhihuCrawler 有 d_c0 时自动签名。
- **`zhihu-mcp-server/`**: Node.js MCP 服务（来自 iteng007/zhihu-mcp-server），14 个工具 = 10 个纯 HTTP 查询 + 4 个 save_*（内部 `execSync('python main.py ...', cwd=SPIDER_DIR)`，`SPIDER_DIR=path.resolve(__dirname,'..')` 指向本项目根）。部署双端：WSL 副本 `/home/tang/zhihu-mcp/` 的相对路径指不回本项目 → save_* 断链；Windows 侧 ZCode 2026-09-08 起指回本原生位置 → save_* 仅 Windows 侧可用（Windows Python314 已装全依赖）。爬虫登录态走 config.json/.env（login.py），与 MCP 的 `~/.zhihu-mcp` cookies 互相独立。
- **模块全在根目录**: `crawler.py`、`parser.py`、`zse_signer.py`、`zhihu_spider.py`、`login.py`。`util/` 和 `zhihu/` 都是空脚手架，无代码引用。
- **`web_search.py` 是独立工具**（DuckDuckGo/Bing 搜索），有自己的 CLI 和 `main()`，不被爬虫导入。改爬虫别动它。

## Cookie 与敏感文件

- `config.json`、`.env`、`.browser_profile/` 都已 gitignore，含真实登录令牌。永不提交。
- Cookie 优先级: `--cookie` CLI > `config.json` > `.env` > `ZHIHU_COOKIE` 环境变量
- `login.py` 做法：打开登录页 → 等 URL 离开 `/signin` → 读 cookies → 过滤黑名单但显式保留 `z_c0`、`SESSIONID` → 写入 `config.json` → 调用 `/api/v4/me` 验证。**`技术方案.md` 旧设计（page.listen.start）与代码不符。**

## 浏览器

- `BrowserCrawler` 默认 visible（`headless=False`），复用 `.browser_profile/` 持久化登录态；启动失败回退临时 profile。不是缓存，别清理。
- 滚动加载最多 30 轮，连续 2 次高度不变提前退出。

## 输出与断点续传

- `output/[<qid>] <title>/` 子目录，文件名 `[{voteup}赞] {author} - {title}.md`，带 YAML front matter。
- `sanitize_filename` 把 `\/:*?"<>|` → `、`。
- 输出目录自动维护 `.progress.json` 记录已保存 answer_id，支持断点续传。
- 改命名要同步三个 `save_*_md` 函数。

## 测试

- 纯函数测试，不依赖网络/浏览器。覆盖 parser 标签分支 + sanizite + _write_md + progress 读写。

## 限速是有意的

API 分页间 `time.sleep(3)`、保存间 `0.5s`、浏览器滚动 2s/轮——都是反爬礼貌，不是性能问题。

## 编码

- `main.py`、`web_search.py`、`log.py` 都把 stdout 重配为 utf-8。`.bat` 里 `chcp 65001`。编辑时保留，否则中文在 Windows 控制台乱码。

## 文档 v.s. 代码

`技术方案.md`、`说明.md` 是设计/说明文档，与代码冲突时以代码为准。
