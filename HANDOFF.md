# HANDOFF.md — zhihuspider（知乎爬虫 + zhihu-mcp + 豆包连接器）

> 项目实时状态记录；规则见同目录 `AGENTS.md`，文档与代码冲突以代码为准。
> 建立于 2026-09-12（知乎 MCP → 豆包接入执行当日）。

## 当前状态（2026-09-12）

- **知乎 MCP → 豆包电脑版接入全链路已打通并实测通过**。完整执行记录见桌面《知乎MCP接入豆包执行书.md》v3 附录 C。
- 链路：豆包连接器「知乎」（`http://127.0.0.1:8635/mcp`，Streamable HTTP）→ supergateway → `zhihu-mcp-server/index.js`（stdio）→ zhihu.com。豆包对话实测热榜前 3 正常返回。
- 2026-09-12 的 401 故障根因 = cookie 过期（扫码更新后恢复），**zse 签名（zse96 v2 / 101_3_3.0）未坏**。
- 本仓库代码零改动：接入只写了运行时配置（`config.json`，已 gitignore）与仓库外文件。

## 仓库外新增文件（不入库）

| 文件 | 用途 |
|---|---|
| `~\.zhihu-mcp\config.json` | zhihu-mcp 登录态（d_c0/z_c0），2026-09-12 扫码更新，旧版有 `.bak-*` 备份 |
| `~\.zhihu-mcp\qr_login.py` | **加固版扫码登录**（推荐）：轮询 cookie 出现 z_c0 为准 + `/api/v4/me` 自动验证 + 一次性同步本仓库 `config.json` 与 `~\.zhihu-mcp` 两处 |
| `~\.zhihu-mcp\sync_cookie.py` | 旧路径：仅从本仓库 `config.json` 同步到 `~\.zhihu-mcp`（功能已被 qr_login 覆盖） |
| `~\.zhihu-mcp\bridge-doubao.bat` | 桥接启动脚本：supergateway 监听 8635 → zhihu-mcp-server，日志写 `bridge.log` |
| 启动文件夹 `zhihu-mcp-doubao-bridge.lnk` | Windows 登录自启桥接（最小化运行；**关窗 = 停服务**） |

## 维护三步曲（豆包报知乎工具 401 时）

1. `python %USERPROFILE%\.zhihu-mcp\qr_login.py` → 浏览器扫码（240 秒窗口），看到「Cookie 有效」即可
2. 结束旧桥接进程：`netstat -ano | findstr :8635` 查 PID → `taskkill /F /PID <PID>`
3. 双击 `%USERPROFILE%\.zhihu-mcp\bridge-doubao.bat` 重新拉起（或注销重登让启动项接管）

**已知坑**：本仓库 `login.py` 的「等 URL 离开 /signin」判定实测会被知乎登录页自身重定向误触发（未扫码即误报成功、抓到无 z_c0 的无效 cookie），故维护走 `qr_login.py`。是否把该修正回流到 `login.py` 待另行决策。

## 回滚（逐项独立）

删豆包连接器「知乎」；删启动文件夹 lnk；杀 8635 进程；删 `~\.zhihu-mcp` 下新增脚本；`~\.zhihu-mcp\config.json` 恢复 `.bak-*`。ZCode 侧 stdio 配置与官方 CLI（`AppData\Local\ZhihuCLI`，每日额度制）均未改动，CLI 是签名失效时的退路。

## 现场（2026-09-12 交接）

- git：`AGENTS.md`、`README.md` 各有一处 2026-09-08 时段遗留的未提交文档修改（MCP 工具数与 save_* 部署差异说明），经用户授权于本次一并提交推送 GitHub；此外无其他未跟踪内容。
- MCP 权威位置维持 AGENTS.md 既有结论：Windows 原生 `D:\Tools\zhihuspider\zhihu-mcp-server\`（14 工具全可用）；WSL 副本 `/home/tang/zhihu-mcp/` save_* 断链，未处理。

## 更名记录（2026-09-22）

- GitHub 仓库已更名：`Kuromi-zyzy/ZhihuSpider` → **`Kuromi-zyzy/Zhihu-MCP-PlusPlus`**（GitHub 仓库名不允许 `+`，中文名「知乎 MCP++」体现在 README 题头与仓库描述）。旧 URL 已验证 301 重定向，本地 `origin` remote 已同步更新。
- README 新增「致谢」段：两位原作者 = **Milloyy**（2019 年原始 ZhihuSpider，账号/仓库现已 404，仅能以 git 历史留名）+ **Foxgeek36 (Decimal)**（fork 直接来源，用户确认两者成果由本人结合后继续开发）；另致谢 zly2006/zhihu-plus-plus（zse96 v2 签名移植来源）与 meurz/zhihu-mcp-server（MCP 上游；原 `iteng007/zhihu-mcp-server` 已转移/改名）。
- 提交 `a502e87`（仅 README，+16/−2）已推送 origin/master，仓库 description 同步更新。本次为用户授权的改名+致谢操作，代码零改动。
- 操作口径备忘：gh CLI token 已失效（`gh auth login` 可恢复，本次未动）；API 操作改从 git credential fill 取 GCM 里的 gho_ token；PATCH /repos 必须带 `Content-Type: application/json`（缺了返回 400）；Windows python 读不了 Git Bash `/tmp`，临时 JSON 用 `$TEMP` 落盘。

## zhihu_search_web 新增（2026-09-22）

- 用户观察「知乎站内搜索不好用，Bing 能检索到高质量的」→ 7 轮对比实测后新增 MCP 工具 `zhihu_search_web`（14→15 工具）。代码只在 `zhihu-mcp-server/index.js`，纯 fetch+正则，零新依赖。
- **对比实测结论**（同组查询两路对照）：
  - 知乎站内 `search_v3`（zse 签名）强在头部热答带 voteup 排序（机械键盘 Top 答案 3 万赞、C++ 学习 99 赞答都能出），但每页混 `ai_zhida` 广告位、部分结果 title 为空；对长尾专栏文章覆盖明显弱于 Bing。
  - Bing `site:zhihu.com` 确实能检索到站内搜不到的高质量专栏长文，但**对中文多词查询会静默丢弃 site: 限制**（7 轮探针验证：掺百度百科/微软官网/CSDN，`mkt`/`setlang`/`ensearch`/词序调整都救不回来，单 query 内两轮结果完全一致=非随机抖动）；DDG 大陆直连 100% 超时。
- **工具实现要点**：查询自动附加 `site:zhihu.com`（已含则原样透传）；结果按 `zhihu.com` 域名硬过滤（这是设计核心，不是装饰）；`classifyZhihuUrl` 从 URL 提取 type+id（question/answer/pin/article/user/collection，`/tardis/bd/art/<id>` 镜像页映射回 `zhuanlan.zhihu.com/p/<id>`），返回结构可直接喂 `zhihu_get_*`/`zhihu_save_*`；请求带随机 UA + 0.3–1s 抖动。
- **验证**：`node --check` 通过；stdio 端到端（MCP initialize→tools/list=15→tools/call）3 组查询实测通过（机械键盘 4 条全知乎、C++ 学习路线 2 条、site:zhuanlan.zhihu.com 透传 2 条，类型/ID 提取正确）。
- 未动：豆包 8635 桥接进程需手动重启（`bridge-doubao.bat`）才能列出第 15 个工具；login.py 误判回流与 save_* execSync 注入两个 P0 仍未修。
