import os
import time
import re
from crawler import ZhihuCrawler, BrowserCrawler
from parser import html_to_markdown, extract_metadata, extract_article_metadata


def timestamp_to_date(ts):
    import datetime
    return datetime.datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")


def sanitize_filename(name):
    name = re.sub(r'[\\/:*?"<>|]', "、", name)
    name = name.strip()
    return name or "untitled"


def save_answer_md(answer_data, output_dir):
    meta = extract_metadata(answer_data)
    content_html = answer_data.get("content", "")
    content_md = html_to_markdown(content_html)

    title = sanitize_filename(meta["title"])
    author = sanitize_filename(meta["author"])
    voteup = meta.get("voteup", 0)
    filename = f"[{voteup}赞] {author} - {title}.md" if voteup else f"{author} - {title}.md"
    filename = sanitize_filename(filename)
    filepath = os.path.join(output_dir, filename)

    header = f"""---
title: {meta["title"]}
author: {meta["author"]}
voteup: {meta["voteup"]}
url: {meta["url"]}
created: {timestamp_to_date(meta["created_time"]) if meta["created_time"] else "N/A"}
---

"""
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(header)
        f.write(content_md)

    print(f"  ✓ 已保存: {filename}")
    return filepath


def save_browser_answer_md(answer_data, output_dir):
    content_html = answer_data.get("content", "")
    content_md = html_to_markdown(content_html)

    author = sanitize_filename(answer_data.get("author", "匿名用户"))
    title = sanitize_filename(answer_data.get("question_title", "未知问题"))
    voteup = answer_data.get("voteup", "0")
    filename = f"[{voteup}赞] {author}.md"
    filepath = os.path.join(output_dir, filename)

    header = f"""---
title: {answer_data.get("question_title", "")}
author: {answer_data.get("author", "")}
voteup: {voteup}
url: https://www.zhihu.com/question/{answer_data.get("question_id", "")}
---

"""
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(header)
        f.write(content_md)

    print(f"  ✓ 已保存: {filename}")
    return filepath


def save_article_md(article_data, output_dir):
    meta = extract_article_metadata(article_data)
    content_html = article_data.get("content", "")
    content_md = html_to_markdown(content_html)

    title = sanitize_filename(meta["title"])
    author = sanitize_filename(meta["author"])
    filename = f"{author} - {title}.md"
    filename = sanitize_filename(filename)
    filepath = os.path.join(output_dir, filename)

    header = f"""---
title: {meta["title"]}
author: {meta["author"]}
voteup: {meta["voteup"]}
url: {meta["url"]}
created: {timestamp_to_date(meta["created_time"]) if meta["created_time"] else "N/A"}
---

"""
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(header)
        f.write(content_md)

    print(f"  ✓ 已保存: {filename}")
    return filepath


def crawl_question_answers(question_id, output_dir, cookie="", proxies=None, sort_by="default", max_pages=None):
    print(f"\n{'='*50}")
    print(f"开始爬取问题: {question_id}")
    print(f"{'='*50}\n")

    # 方式一：先用 requests + API（可能被 403）
    crawler = ZhihuCrawler(cookie=cookie, proxies=proxies)
    title = crawler.get_question_title(question_id)

    if title:
        print(f"问题标题: {title}")
        dir_name = sanitize_filename(f"[{question_id}] {title}")
        save_dir = os.path.join(output_dir, dir_name)
        os.makedirs(save_dir, exist_ok=True)

        answers = crawler.get_answers(question_id, sort_by=sort_by, max_pages=max_pages)
        if answers:
            print(f"\n共获取 {len(answers)} 条回答，正在保存...\n")
            for ans in answers:
                save_answer_md(ans, save_dir)
                time.sleep(0.5)
            print(f"\n完成！共保存 {len(answers)} 条回答到: {save_dir}")
            return

    # 方式二：requests 失败，用浏览器爬
    print("\n[!] API 请求被拦截，切换到浏览器模式...")
    _browser_crawl_question(question_id, output_dir)


def _browser_crawl_question(question_id, output_dir):
    bc = None
    try:
        bc = BrowserCrawler()
        title = bc.get_question_title(question_id)
        print(f"问题标题: {title}" if title else f"问题 ID: {question_id}")

        dir_name = sanitize_filename(f"[{question_id}] {title}") if title else f"[{question_id}]"
        save_dir = os.path.join(output_dir, dir_name)
        os.makedirs(save_dir, exist_ok=True)

        answers = bc.get_answers(question_id)
        if not answers:
            print("\n[!] 未获取到任何回答。")
            return

        print(f"\n共获取 {len(answers)} 条回答，正在保存...\n")
        for ans in answers:
            save_browser_answer_md(ans, save_dir)
            time.sleep(0.3)

        print(f"\n{'='*50}")
        print(f"完成！共保存 {len(answers)} 条回答到: {save_dir}")
        print(f"{'='*50}")
    finally:
        if bc:
            bc.close()


def crawl_article(article_id, output_dir, cookie="", proxies=None):
    print(f"\n{'='*50}")
    print(f"开始爬取文章: {article_id}")
    print(f"{'='*50}\n")

    crawler = ZhihuCrawler(cookie=cookie, proxies=proxies)
    article_data = crawler.get_article(article_id)

    if not article_data:
        print("\n[!] 未获取到文章内容。")
        print("    可能原因: 需要有效的 Cookie 或文章 ID 不存在")
        return

    meta = extract_article_metadata(article_data)
    title = sanitize_filename(meta["title"]) if meta["title"] else f"article_{article_id}"
    save_dir = os.path.join(output_dir, title)
    os.makedirs(save_dir, exist_ok=True)

    save_article_md(article_data, save_dir)
    print(f"\n完成！文章已保存到: {save_dir}")


def crawl_single_answer(answer_id, output_dir, cookie="", proxies=None):
    print(f"\n{'='*50}")
    print(f"开始爬取回答: {answer_id}")
    print(f"{'='*50}\n")

    crawler = ZhihuCrawler(cookie=cookie, proxies=proxies)
    answer_data = crawler.get_answer(answer_id)

    if not answer_data:
        print("\n[!] 未获取到回答内容。")
        return

    meta = extract_metadata(answer_data)
    title = sanitize_filename(meta["title"]) if meta["title"] else f"answer_{answer_id}"
    save_dir = os.path.join(output_dir, title)
    os.makedirs(save_dir, exist_ok=True)

    save_answer_md(answer_data, save_dir)
    print(f"\n完成！回答已保存到: {save_dir}")
