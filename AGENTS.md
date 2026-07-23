# AGENTS.md

知乎内容爬虫。Python 3.11+，Windows 优先。测试用 `uv run pytest`，lint 用 `uv run ruff check .`（规则温和：E/F/W/I）。无 typecheck 配置。

## 入口

`python main.py {question|article|answer|login|config} <id>`。`start.bat` 是交互菜单包装。README 只列了前三种模式，`login`、`config` 子命令同样可用。完整 CLI 选项见 `main.py` argparse：`--sort default|voteups|created`、`--max-pages`、`--proxy`、`--cookie`、`-o`。

## 架构（非显而易见的关键事实）

- **双轨兜底是核心设计**：`zhihu_spider.py` 每个模式都用 `ZhihuCrawler`（requests + 知乎 API）先试，遇 403 或空数据自动切 `BrowserCrawler`（DrissionPage 浏览器）。不要把兜底当 bug 删。
- **真实模块全在根目录**：`crawler.py`（请求层 + 浏览器层）、`parser.py`（HTML→Markdown）、`zhihu_spider.py`（编排 + 文件保存）、`login.py`（Cookie 捕获）。
- **`util/` 是空脚手架，无任何代码引用**。别当包结构来改。
- **`web_search.py` 是独立工具**（DuckDuckGo/Bing 搜索 + URL 抓取，带 SSRF 防护），有自己的 CLI 和 `main()`，不被爬虫导入。改爬虫别动它，反之亦然。

## Cookie 与敏感文件

- `config.json`（`login.py` 写入的会话 Cookie）、`.env`、`.browser_profile/`（Chromium 用户数据）**都已 gitignore，含真实登录令牌**。永远不要提交、不要把内容贴进日志/PR/commit。
- Cookie 优先级（`main.py` `_resolve_cookie`，顺序敏感）：`--cookie` CLI > `config.json` > `.env` / `ZHIHU_COOKIE` 环境变量。
- `login.py` 实际做法：打开登录页 → 等 URL 离开 `/signin` → 读 `page.cookies()` → 过滤 `COOKIE_BLACKLIST` 但显式保留 `z_c0`、`SESSIONID`。**`技术方案.md` 里写的 `page.listen.start` 监听方案是旧设计，与现行代码不符——以代码为准。**

## 浏览器 profile

`BrowserCrawler` 复用项目内 `.browser_profile/` 持久化登录态；加载失败回退临时 profile。不是缓存，别清。

## 输出格式

每个问题 → `output/[<qid>] <title>/` 子目录，文件名 `[<voteup>赞] <author> - <title>.md`，带 YAML front matter。`sanitize_filename` 把 `\/:*?"<>|` 替换成 `、`。改命名要同步改 `zhihu_spider.py` 里三个 `save_*_md` 函数。

## 限速是有意的

API 分页间 `time.sleep(3)`、保存间 `0.5s`、浏览器滚动加载最多 30 轮——都是反爬礼貌，不是性能问题，别优化掉。

## 依赖与编码

- `pyproject.toml` + `uv.lock`（uv，清华 PyPI 镜像）和 `requirements.txt` 并存，依赖列表手动保持一致。`pip install -r requirements.txt` 和 `uv sync` 都能装运行时依赖；dev 工具（ruff/pytest）用 `uv sync --all-groups` 装。
- `main.py`、`web_search.py` 都把 stdout 重配为 utf-8，`.bat` 里 `chcp 65001`。`log.py` 的 `setup_logging()` 也做一次（幂等）。编辑时保留，否则中文在 Windows 控制台乱码。
- `技术方案.md`、`说明.md` 是设计/说明文档，不是可执行真相；和代码冲突时以代码为准。
