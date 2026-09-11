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
