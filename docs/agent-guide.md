# Agent 使用指南

给 AI 助手的工作流约定。**遵循它能显著提高回答质量并降低被封风险。**

## 推荐链路

```text
1. zhihu_search        # source=auto（默认），三源合并
2. zhihu_resolve_url   # 只有不规范的 URL 时才需要
3. zhihu_get_content   # 对感兴趣的对象取详情（include_content=false 先看摘要也可以）
4. zhihu_list_comments # 需要争议/观点时
5. zhihu_save_content  # 重要内容存档（直写本地索引；zhihu_save_* 爬虫路径落盘 Markdown 后也自动入索引）
```

## 第二次提问走本地

用户问「我之前保存的内容里……」时，直接：

```text
zhihu_local_search(mode=hybrid)   # 无 embedding 时自动降级 keyword
```

不必重新访问知乎。

## 预算纪律

- 列表类调用保持 `limit ≤ 10`；先 `include_content=false` 看标题摘要，再对个别对象取全文
- 需要 `fields` 投影时只取需要的字段（title/author/voteup_count/url…）
- 全文默认截断在 12000 字符（`content_truncated: true` 表示截过）

## 节流纪律

- **不要并行轰炸**：服务端已按 source 限速（知乎 1s、Bing 1s），Agent 再并发只会排队
- 不要循环重试 403/429——那是反爬拦截，错误码 `anti_bot_blocked`；换 `source` 或稍后再试
- 单次任务建议总请求数 < 30

## 认证

- 查询类工具大多需要 `d_c0`（签名用）；`zhihu_hot_list` / `zhihu_search_web` 无 Cookie 也可用
- Cookie 过期的典型症状：`not_authenticated` 或 `anti_bot_blocked`
- 修复：`zhihu_auth_login`（浏览器扫码）或 `zhihu_auth_import`（导入键值对）
- 排查：`zhihu_diagnostics` 一次看全 认证/SQLite/Bing/知乎可达性

## 结果结构

所有工具返回统一 envelope：

```json
{ "ok": true,  "schema_version": "1.0", "data": { "...": "" }, "meta": { "source": "zhihu_web", "cached": true } }
{ "ok": false, "schema_version": "1.0", "error": { "code": "invalid_input", "message": "...", "retryable": false }, "meta": {} }
```

`error.retryable=true` 时可以重试；`=false` 时改变参数或换 source。
