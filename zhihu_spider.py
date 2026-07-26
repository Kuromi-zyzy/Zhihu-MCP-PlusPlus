import json
import os
import re
import time

from crawler import BrowserCrawler, ZhihuCrawler
from parser import extract_article_metadata, extract_metadata, html_to_markdown


def timestamp_to_date(ts):
    import datetime
    return datetime.datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")


def sanitize_filename(name):
    name = re.sub(r'[\\/:*?"<>|]', "、", name)
    name = name.strip()
    return name or "untitled"


def _load_progress(save_dir):
    """读取已保存的 answer_id 集合，用于断点续传。"""
    progress_file = os.path.join(save_dir, ".progress.json")
    if os.path.exists(progress_file):
        try:
            with open(progress_file, "r", encoding="utf-8") as f:
                return set(json.load(f).get("saved_ids", []))
        except (json.JSONDecodeError, IOError):
            pass
    return set()


def _save_progress(save_dir, saved_ids):
    """更新进度文件。"""
    progress_file = os.path.join(save_dir, ".progress.json")
    with open(progress_file, "w", encoding="utf-8") as f:
        json.dump({"saved_ids": list(saved_ids)}, f)


def _write_md(filepath, front_matter, body):
    """写 Markdown：YAML front matter + 正文。统一所有 save 路径的写文件逻辑。"""
    header = "---\n"
    for key, value in front_matter.items():
        header += f"{key}: {value}\n"
    header += "---\n\n"
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(header)
        f.write(body)
    return filepath


def save_answer_md(answer_data, output_dir):
    meta = extract_metadata(answer_data)
    content_md = html_to_markdown(answer_data.get("content", ""))

    title = sanitize_filename(meta["title"])
    author = sanitize_filename(meta["author"])
    voteup = meta.get("voteup", 0)
    filename = f"[{voteup}赞] {author} - {title}.md" if voteup else f"{author} - {title}.md"
    filename = sanitize_filename(filename)
    filepath = os.path.join(output_dir, filename)
    created = timestamp_to_date(meta["created_time"]) if meta["created_time"] else "N/A"

    _write_md(filepath, {
        "title": meta["title"],
        "author": meta["author"],
        "voteup": meta["voteup"],
        "url": meta["url"],
        "created": created,
    }, content_md)
    print(f"  ✓ 已保存: {filename}")
    return filepath


def save_browser_answer_md(answer_data, output_dir):
    content_md = html_to_markdown(answer_data.get("content", ""))

    author = sanitize_filename(answer_data.get("author", "匿名用户"))
    title = sanitize_filename(answer_data.get("question_title", "未知问题"))
    voteup = answer_data.get("voteup", "0")
    answer_id = answer_data.get("id", "")
    filename = f"[{voteup}赞] {author} - {title[:30]}.md"
    if answer_id:
        filename = f"[{voteup}赞] {author} - {answer_id}.md"
    filepath = os.path.join(output_dir, filename)

    _write_md(filepath, {
        "title": answer_data.get("question_title", ""),
        "author": answer_data.get("author", ""),
        "voteup": voteup,
        "url": f"https://www.zhihu.com/question/{answer_data.get('question_id', '')}",
    }, content_md)
    print(f"  ✓ 已保存: {filename}")
    return filepath


def save_article_md(article_data, output_dir):
    meta = extract_article_metadata(article_data)
    content_md = html_to_markdown(article_data.get("content", ""))

    title = sanitize_filename(meta["title"])
    author = sanitize_filename(meta["author"])
    filename = sanitize_filename(f"{author} - {title}.md")
    filepath = os.path.join(output_dir, filename)
    created = timestamp_to_date(meta["created_time"]) if meta["created_time"] else "N/A"

    _write_md(filepath, {
        "title": meta["title"],
        "author": meta["author"],
        "voteup": meta["voteup"],
        "url": meta["url"],
        "created": created,
    }, content_md)
    print(f"  ✓ 已保存: {filename}")
    return filepath


def _crawl_with_fallback(label, target_id, api_attempt, browser_fallback):
    """先试 API，失败切浏览器。api_attempt 返回 True 表示成功已保存。"""
    print(f"\n{'='*50}")
    print(f"开始爬取{label}: {target_id}")
    print(f"{'='*50}\n")
    if api_attempt():
        return
    print("\n[!] API 请求被拦截，切换到浏览器模式...")
    browser_fallback()


def crawl_question_answers(question_id, output_dir, cookie="", proxies=None, sort_by="default", max_pages=None):
    def api_attempt():
        crawler = ZhihuCrawler(cookie=cookie, proxies=proxies)
        title = crawler.get_question_title(question_id)
        if not title:
            return False
        print(f"问题标题: {title}")
        dir_name = sanitize_filename(f"[{question_id}] {title}")
        save_dir = os.path.join(output_dir, dir_name)
        os.makedirs(save_dir, exist_ok=True)

        answers = crawler.get_answers(question_id, sort_by=sort_by, max_pages=max_pages)
        if not answers:
            return False
        saved_ids = _load_progress(save_dir)
        new_answers = [a for a in answers if str(a.get("id", "")) not in saved_ids]
        if not new_answers:
            print(f"\n所有 {len(answers)} 条回答已存在，跳过。")
            return True
        skipped = len(answers) - len(new_answers)
        print(f"\n共获取 {len(answers)} 条，保存 {len(new_answers)} 条" + (f"（跳过 {skipped} 条已存在）" if skipped else "") + "...\n")
        for ans in new_answers:
            save_answer_md(ans, save_dir)
            saved_ids.add(str(ans.get("id", "")))
            _save_progress(save_dir, saved_ids)
            time.sleep(0.5)
        print(f"\n完成！共保存 {len(new_answers)} 条回答到: {save_dir}")
        return True

    _crawl_with_fallback(
        "问题", question_id, api_attempt,
        lambda: _browser_crawl_question(question_id, output_dir, cookie=cookie),
    )


def _browser_crawl_question(question_id, output_dir, cookie=""):
    bc = None
    try:
        bc = BrowserCrawler(cookie=cookie)
        title = bc.get_question_title(question_id)
        print(f"问题标题: {title}" if title else f"问题 ID: {question_id}")

        dir_name = sanitize_filename(f"[{question_id}] {title}") if title else f"[{question_id}]"
        save_dir = os.path.join(output_dir, dir_name)
        os.makedirs(save_dir, exist_ok=True)

        answers = bc.get_answers(question_id)
        if not answers:
            print("\n[!] 未获取到任何回答。")
            return

        saved_ids = _load_progress(save_dir)
        new_answers = [a for a in answers if str(a.get("id", "")) not in saved_ids]
        if not new_answers:
            print(f"\n所有 {len(answers)} 条回答已存在，跳过。")
            return
        skipped = len(answers) - len(new_answers)
        print(f"\n共获取 {len(answers)} 条，保存 {len(new_answers)} 条" + (f"（跳过 {skipped} 条已存在）" if skipped else "") + "...\n")
        for ans in new_answers:
            save_browser_answer_md(ans, save_dir)
            saved_ids.add(str(ans.get("id", "")))
            _save_progress(save_dir, saved_ids)
            time.sleep(0.3)

        print(f"\n{'='*50}")
        print(f"完成！共保存 {len(new_answers)} 条回答到: {save_dir}")
        print(f"{'='*50}")
    finally:
        if bc:
            bc.close()


def crawl_article(article_id, output_dir, cookie="", proxies=None):
    def api_attempt():
        crawler = ZhihuCrawler(cookie=cookie, proxies=proxies)
        article_data = crawler.get_article(article_id)
        if not article_data:
            return False
        meta = extract_article_metadata(article_data)
        title = sanitize_filename(meta["title"]) if meta["title"] else f"article_{article_id}"
        save_dir = os.path.join(output_dir, title)
        os.makedirs(save_dir, exist_ok=True)

        save_article_md(article_data, save_dir)
        print(f"\n完成！文章已保存到: {save_dir}")
        return True

    _crawl_with_fallback(
        "文章", article_id, api_attempt,
        lambda: _browser_crawl_article(article_id, output_dir, cookie=cookie),
    )


def _browser_crawl_article(article_id, output_dir, cookie=""):
    bc = None
    try:
        bc = BrowserCrawler(cookie=cookie)
        article_data = bc.get_article(article_id)
        if not article_data:
            print("\n[!] 未获取到文章内容。")
            print("    可能原因: 文章 ID 不存在或网络异常")
            return

        title = sanitize_filename(article_data.get("title", "")) or f"article_{article_id}"
        save_dir = os.path.join(output_dir, title)
        os.makedirs(save_dir, exist_ok=True)

        content_md = html_to_markdown(article_data.get("content", ""))
        author = article_data.get("author", "")
        filepath = os.path.join(save_dir, f"{author} - {title}.md")
        _write_md(filepath, {
            "title": article_data.get("title", ""),
            "author": author,
            "url": f"https://zhuanlan.zhihu.com/p/{article_id}",
        }, content_md)
        print(f"\n完成！文章已保存到: {filepath}")
    finally:
        if bc:
            bc.close()


def crawl_single_answer(answer_id, output_dir, cookie="", proxies=None):
    def api_attempt():
        crawler = ZhihuCrawler(cookie=cookie, proxies=proxies)
        answer_data = crawler.get_answer(answer_id)
        if not answer_data:
            return False
        meta = extract_metadata(answer_data)
        title = sanitize_filename(meta["title"]) if meta["title"] else f"answer_{answer_id}"
        save_dir = os.path.join(output_dir, title)
        os.makedirs(save_dir, exist_ok=True)

        save_answer_md(answer_data, save_dir)
        print(f"\n完成！回答已保存到: {save_dir}")
        return True

    _crawl_with_fallback(
        "回答", answer_id, api_attempt,
        lambda: _browser_crawl_answer(answer_id, output_dir, cookie=cookie),
    )


def _browser_crawl_answer(answer_id, output_dir, cookie=""):
    bc = None
    try:
        bc = BrowserCrawler(cookie=cookie)
        answer_data = bc.get_answer(answer_id)
        if not answer_data:
            print("\n[!] 未获取到回答内容。")
            return

        title = sanitize_filename(answer_data.get("title", "")) or f"answer_{answer_id}"
        save_dir = os.path.join(output_dir, title)
        os.makedirs(save_dir, exist_ok=True)

        content_md = html_to_markdown(answer_data.get("content", ""))
        author = answer_data.get("author", "匿名用户")
        filepath = os.path.join(save_dir, f"[{answer_data.get('voteup', '0')}赞] {author}.md")
        _write_md(filepath, {
            "title": title,
            "author": author,
            "url": f"https://www.zhihu.com/answer/{answer_id}",
        }, content_md)
        print(f"\n完成！回答已保存到: {filepath}")
    finally:
        if bc:
            bc.close()


def crawl_collection(collection_id, output_dir, cookie="", proxies=None, max_pages=None):
    def api_attempt():
        crawler = ZhihuCrawler(cookie=cookie, proxies=proxies)

        info = crawler.get_collection_info(collection_id)
        coll_title = info.get("title", f"collection_{collection_id}") if info else f"collection_{collection_id}"
        print(f"收藏夹: {coll_title}")

        dir_name = sanitize_filename(f"[{collection_id}] {coll_title}")
        save_dir = os.path.join(output_dir, dir_name)
        os.makedirs(save_dir, exist_ok=True)

        items = crawler.get_collection_items(collection_id, max_pages=max_pages)
        if not items:
            return False

        saved_ids = _load_progress(save_dir)
        def _item_url(item):
            return item.get("content", {}).get("url", "")
        new_items = [it for it in items if _item_url(it) not in saved_ids]
        skipped = len(items) - len(new_items)

        print(f"\n共获取 {len(items)} 条，保存 {len(new_items)} 条" +
              (f"（跳过 {skipped} 条已存在）" if skipped else "") + "...\n")
        for item in new_items:
            c = item.get("content", {})
            item_url = _item_url(item)
            item_type = c.get("type", "unknown")
            title = c.get("title", "") or (c.get("question", {}) or {}).get("title", "")
            author = c.get("author", {})
            author_name = author.get("name", "") if isinstance(author, dict) else ""
            voteup = c.get("voteup_count", 0)

            front_matter = {
                "title": title,
                "author": author_name,
                "type": item_type,
                "voteup": voteup,
                "url": item_url,
            }
            excerpt = c.get("excerpt_title", "") or c.get("excerpt", "")
            item_id = ""
            if "/p/" in item_url:
                item_id = item_url.split("/p/")[-1].split("?")[0]
                front_matter["article_id"] = item_id
            elif "/answer/" in item_url:
                item_id = item_url.split("/answer/")[-1].split("?")[0]
                front_matter["answer_id"] = item_id

            filename = sanitize_filename(f"{author_name} - {title}.md" if title else f"{item_type}_{item_id}.md")
            filepath = os.path.join(save_dir, filename)
            _write_md(filepath, front_matter, excerpt)
            print(f"  ✓ {filename}")

            saved_ids.add(item_url)
            _save_progress(save_dir, saved_ids)
            time.sleep(0.3)

        print(f"\n完成！共保存 {len(new_items)} 条收藏到: {save_dir}")
        return True

    _crawl_with_fallback(
        "收藏夹", collection_id, api_attempt,
        lambda: _browser_crawl_collection(collection_id, output_dir, cookie=cookie),
    )


def _browser_crawl_collection(collection_id, output_dir, cookie=""):
    bc = None
    try:
        bc = BrowserCrawler(cookie=cookie)
        items, coll_title = bc.get_collection_items(collection_id)
        if not items:
            print("\n[!] 未获取到收藏夹内容。")
            return

        dir_name = sanitize_filename(f"[{collection_id}] {coll_title}")
        save_dir = os.path.join(output_dir, dir_name)
        os.makedirs(save_dir, exist_ok=True)

        print(f"\n共获取 {len(items)} 条...\n")
        for item in items:
            title = item.get("title", "")
            author = item.get("author", "匿名用户")
            url_str = item.get("url", "")
            excerpt = item.get("content", {}).get("excerpt_title", "")

            filename = sanitize_filename(f"{author} - {title}.md" if title else f"{url_str.split('/')[-1]}.md")
            filepath = os.path.join(save_dir, filename)
            _write_md(filepath, {
                "title": title,
                "author": author,
                "url": url_str,
            }, excerpt)
            print(f"  ✓ {filename}")

        print(f"\n完成！共保存 {len(items)} 条收藏到: {save_dir}")
    finally:
        if bc:
            bc.close()
