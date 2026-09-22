#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
ZhihuSpider - 知乎内容爬虫

用法:
    python main.py question <question_id> [-o <输出目录>]
    python main.py article <article_id> [-o <输出目录>]
    python main.py answer <answer_id> [-o <输出目录>]
    python main.py collection <collection_id> [-o <输出目录>]
    python main.py topic <topic_id> [-o <输出目录>]
    python main.py user <user_token> [answers|articles] [-o <输出目录>]
    python main.py column <column_id> [-o <输出目录>]
    python main.py config                      # 显示配置说明

示例:
    python main.py question 320078376
    python main.py article 66900790
    python main.py answer 475819518
    python main.py collection 960833771
    python main.py topic 19776749
    python main.py user ai-fan-er answers
    python main.py column zhihu
"""

import argparse
import json
import os

# 从 .env 文件加载 Cookie（支持引号包裹的值）
_env_path = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(_env_path):
    with open(_env_path, "r", encoding="utf-8") as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _v = _line.split("=", 1)
                _v = _v.strip().strip('"').strip("'")
                os.environ.setdefault(_k.strip(), _v)

# 从 credentials.json 加载 Cookie（v1 统一凭据存储，Python/Node 共用）
# 位置：~/.zhihu-mcp/credentials.json 的 cookies 字段
_cred_path = os.path.join(os.path.expanduser("~"), ".zhihu-mcp", "credentials.json")
_credentials_cookie = ""
if os.path.exists(_cred_path):
    try:
        with open(_cred_path, "r", encoding="utf-8") as _f:
            _cred = json.load(_f)
            _pairs = _cred.get("cookies", {})
            if _pairs:
                _credentials_cookie = "; ".join(f"{k}={v}" for k, v in _pairs.items())
    except (json.JSONDecodeError, IOError):
        pass

# 从 config.json 加载 Cookie（旧路径，兼容保留；login.py 生成）
_config_path = os.path.join(os.path.dirname(__file__), "config.json")
_config_cookie = ""
if os.path.exists(_config_path):
    try:
        with open(_config_path, "r", encoding="utf-8") as _f:
            _cfg = json.load(_f)
            _config_cookie = _cfg.get("cookie", "")
    except (json.JSONDecodeError, IOError):
        pass

from zhihu_spider import (  # noqa: E402
    crawl_article,
    crawl_collection,
    crawl_column,
    crawl_question_answers,
    crawl_single_answer,
    crawl_topic_essence,
    crawl_user,
)


def print_config_help():
    print("""
═══════════════════════════════════════════
  ZhihuSpider - 配置说明
═══════════════════════════════════════════

本工具通过知乎 API 爬取内容，知乎目前对未登录请求有限制。

【获取 Cookie 的方式（推荐）】

    python login.py
    会自动打开浏览器 → 登录知乎 → 自动捕获 Cookie

【其他方式】

方式一：.env 文件
    复制 .env.example 为 .env，填入 Cookie 即可

方式二：环境变量
    set ZHIHU_COOKIE=你的cookie值

方式三：直接传参
    python main.py question 320078376 --cookie "你的cookie值"

【代理配置】
    python main.py question 320078376 --proxy "http://127.0.0.1:7890"

【注意事项】
- 优先顺序：--cookie 参数 > config.json > .env > 环境变量
- 请控制请求频率（默认 3 秒间隔）
- 仅用于个人学习和研究
═══════════════════════════════════════════
""")


def _resolve_cookie(cli_cookie: str) -> str:
    """Cookie 优先级: CLI 参数 > credentials.json(统一凭据) > config.json > .env/环境变量"""
    if cli_cookie:
        return cli_cookie
    if _credentials_cookie:
        return _credentials_cookie
    if _config_cookie:
        return _config_cookie
    return os.environ.get("ZHIHU_COOKIE", "")


def main():
    from log import setup_logging
    setup_logging()

    parser = argparse.ArgumentParser(description="ZhihuSpider - 知乎内容爬虫")
    parser.add_argument("mode", nargs="?", choices=["question", "article", "answer", "collection", "topic", "user", "column", "config", "login"],
                        help="爬取模式")
    parser.add_argument("id", nargs="?", help="目标 ID")
    parser.add_argument("-o", "--output", default=os.path.join(os.path.dirname(__file__), "output"),
                        help="输出目录 (默认: ./output)")
    parser.add_argument("--cookie", default="",
                        help="知乎 Cookie (优先级最高)")
    parser.add_argument("--proxy", default="", help="代理地址, 如 http://127.0.0.1:7890")
    parser.add_argument("--sort", default="default", choices=["default", "voteups", "created"],
                        help="回答排序方式 (default/voteups/created)")
    parser.add_argument("--max-pages", type=int, default=None, help="最大爬取页数")

    args = parser.parse_args()

    if args.mode == "login":
        try:
            from login import main as login_main
            login_main()
        except ImportError:
            print("[!] 需要 DrissionPage，请执行:  pip install DrissionPage")
        return

    if args.mode == "config" or args.mode is None:
        print_config_help()
        return

    cookie = _resolve_cookie(args.cookie)
    proxies = None
    if args.proxy:
        proxies = {"http": args.proxy, "https": args.proxy}

    os.makedirs(args.output, exist_ok=True)

    if args.mode == "question":
        if not args.id:
            print("[!] 请提供 question_id")
            return
        crawl_question_answers(
            question_id=args.id,
            output_dir=args.output,
            cookie=cookie,
            proxies=proxies,
            sort_by=args.sort,
            max_pages=args.max_pages,
        )
    elif args.mode == "article":
        if not args.id:
            print("[!] 请提供 article_id")
            return
        crawl_article(
            article_id=args.id,
            output_dir=args.output,
            cookie=cookie,
            proxies=proxies,
        )
    elif args.mode == "answer":
        if not args.id:
            print("[!] 请提供 answer_id")
            return
        crawl_single_answer(
            answer_id=args.id,
            output_dir=args.output,
            cookie=cookie,
            proxies=proxies,
        )
    elif args.mode == "collection":
        if not args.id:
            print("[!] 请提供 collection_id")
            return
        crawl_collection(
            collection_id=args.id,
            output_dir=args.output,
            cookie=cookie,
            proxies=proxies,
            max_pages=args.max_pages,
        )
    elif args.mode == "topic":
        if not args.id:
            print("[!] 请提供 topic_id")
            return
        crawl_topic_essence(
            topic_id=args.id,
            output_dir=args.output,
            cookie=cookie,
            proxies=proxies,
            max_pages=args.max_pages,
        )
    elif args.mode == "user":
        if not args.id:
            print("[!] 请提供 user_token")
            return
        import sys
        sub_mode = sys.argv[sys.argv.index("user") + 2] if len(sys.argv) > sys.argv.index("user") + 2 else "answers"
        crawl_user(
            user_token=args.id,
            mode=sub_mode,
            output_dir=args.output,
            cookie=cookie,
            proxies=proxies,
            max_pages=args.max_pages,
        )
    elif args.mode == "column":
        if not args.id:
            print("[!] 请提供 column_id")
            return
        crawl_column(
            column_id=args.id,
            output_dir=args.output,
            cookie=cookie,
            proxies=proxies,
            max_pages=args.max_pages,
        )


if __name__ == "__main__":
    main()
