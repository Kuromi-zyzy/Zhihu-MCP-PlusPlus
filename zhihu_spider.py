import json
import os
import re
import time

from bs4 import BeautifulSoup

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


def _fetch_full_content(crawler, answer_data):
    """获取回答的完整内容（列表API返回的是截断版，单条API才有全文）"""
    answer_id = answer_data.get("id", "")
    if not answer_id:
        return answer_data
    try:
        detail = crawler.get_answer(answer_id)
        if detail and detail.get("content"):
            answer_data["content"] = detail["content"]
        elif detail and detail.get("data", {}).get("content"):
            answer_data["content"] = detail["data"]["content"]
    except Exception:
        pass
    return answer_data


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
            # 列表API内容截断，补单条详情拿全文
            print(f"  获取详情: {ans.get('id', '')}...")
            ans = _fetch_full_content(crawler, ans)
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
        def _item_id(item):
            c = item.get("content", {})
            url = c.get("url", "")
            if "/p/" in url:
                return f"article:{url.split('/p/')[-1].split('?')[0]}"
            if "/answer/" in url:
                return f"answer:{url.split('/answer/')[-1].split('?')[0]}"
            return url
        new_items = [it for it in items if _item_id(it) not in saved_ids]
        skipped = len(items) - len(new_items)

        print(f"\n共获取 {len(items)} 条，下载 {len(new_items)} 条" +
              (f"（跳过 {skipped} 条已存在）" if skipped else "") + "...\n")
        for item in new_items:
            c = item.get("content", {})
            item_url = c.get("url", "")
            item_type = c.get("type", "unknown")

            # 获取全文
            full_data = None
            if item_type == "article" and "/p/" in item_url:
                aid = item_url.split("/p/")[-1].split("?")[0]
                full_data = crawler.get_article(aid)
            elif "/answer/" in item_url:
                aid = item_url.split("/answer/")[-1].split("?")[0]
                full_data = crawler.get_answer(aid)

            if full_data:
                if item_type == "article":
                    save_article_md(full_data, save_dir)
                else:
                    save_answer_md(full_data, save_dir)
            else:
                # 兜底：存摘要
                title = c.get("title", "") or (c.get("question", {}) or {}).get("title", "")
                author = c.get("author", {})
                author_name = author.get("name", "") if isinstance(author, dict) else ""
                voteup = c.get("voteup_count", 0)
                excerpt = c.get("excerpt_title", "") or c.get("excerpt", "")
                filename = sanitize_filename(f"{author_name} - {title}.md" if title else "item.md")
                filepath = os.path.join(save_dir, filename)
                _write_md(filepath, {
                    "title": title, "author": author_name,
                    "voteup": voteup, "url": item_url,
                }, excerpt)
                print(f"  ✓ {filename}（摘要）")

            saved_ids.add(_item_id(item))
            _save_progress(save_dir, saved_ids)
            time.sleep(0.5)

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


def crawl_topic_essence(topic_id, output_dir, cookie="", proxies=None, max_pages=None):
    def api_attempt():
        crawler = ZhihuCrawler(cookie=cookie, proxies=proxies)
        info = crawler.get_topic_info(topic_id)
        topic_name = info.get("name", f"topic_{topic_id}") if info else f"topic_{topic_id}"
        print(f"话题: {topic_name}")

        dir_name = sanitize_filename(f"[{topic_id}] {topic_name}")
        save_dir = os.path.join(output_dir, dir_name)
        os.makedirs(save_dir, exist_ok=True)

        items = crawler.get_topic_essence(topic_id, max_pages=max_pages)
        if not items:
            return False

        saved_ids = _load_progress(save_dir)
        def _item_key(it):
            t = it.get("target", {})
            return t.get("url", "")
        new_items = [it for it in items if _item_key(it) not in saved_ids]
        skipped = len(items) - len(new_items)

        print(f"\n共获取 {len(items)} 条，保存 {len(new_items)} 条" +
              (f"（跳过 {skipped} 条已存在）" if skipped else "") + "...\n")
        for item in new_items:
            t = item.get("target", {})
            item_url = t.get("url", "")
            item_type = t.get("type", "unknown")
            title = t.get("title", "") or (t.get("question", {}) or {}).get("title", "")
            author = t.get("author", {})
            author_name = author.get("name", "") if isinstance(author, dict) else ""
            voteup = t.get("voteup_count", 0)

            content_md = html_to_markdown(t.get("content", ""))
            front_matter = {
                "title": title,
                "author": author_name,
                "type": item_type,
                "voteup": voteup,
                "url": item_url,
            }

            filename = sanitize_filename(f"{author_name} - {title}.md" if title else f"{item_type}.md")
            filepath = os.path.join(save_dir, filename)
            _write_md(filepath, front_matter, content_md)
            print(f"  ✓ {filename}")

            saved_ids.add(item_url)
            _save_progress(save_dir, saved_ids)
            time.sleep(0.3)

        print(f"\n完成！共保存 {len(new_items)} 条精华到: {save_dir}")
        return True

    _crawl_with_fallback(
        "话题精华", topic_id, api_attempt,
        lambda: print("\n  [!] 话题精华浏览器兜底暂未实现"),
    )


def crawl_user(user_token, mode, output_dir, cookie="", proxies=None, max_pages=None):
    """mode: 'answers' 或 'articles'"""
    label = "用户回答" if mode == "answers" else "用户文章"
    bc = None
    try:
        bc = BrowserCrawler(cookie=cookie)
        page = bc._get_page()
        url = f"https://www.zhihu.com/people/{user_token}/{'answers' if mode == 'answers' else 'posts'}"
        print("  → 正在打开用户页面...")
        page.get(url)
        time.sleep(5)

        user_name = user_token
        try:
            name_el = page.ele("t:span@class=ProfileHeader-name", timeout=5)
            if name_el:
                user_name = name_el.text
        except Exception:
            pass
        print(f"用户: {user_name}")

        dir_name = sanitize_filename(f"[{user_token}] {user_name} - {label}")
        save_dir = os.path.join(output_dir, dir_name)
        os.makedirs(save_dir, exist_ok=True)

        # 滚动加载
        print("  → 正在滚动加载...")
        last_h = page.run_js("return document.body.scrollHeight")
        stable = 0
        scroll_rounds = max_pages * 2 if max_pages else 30
        for _ in range(scroll_rounds):
            page.run_js("window.scrollTo(0, document.body.scrollHeight)")
            time.sleep(2)
            new_h = page.run_js("return document.body.scrollHeight")
            if new_h == last_h:
                stable += 1
                if stable >= 2:
                    break
            else:
                stable = 0
                last_h = new_h

        cards = page.eles("t:div@class=ContentItem")
        print(f"  → 检测到 {len(cards)} 个内容元素")

        saved_ids = _load_progress(save_dir)
        count = 0
        for card in cards:
            html = card.html if hasattr(card, "html") else str(card)
            soup = BeautifulSoup(html, "html.parser")
            link = soup.find("a", href=re.compile(r"/(answer|p)/"))
            if not link:
                continue
            url_str = f"https://www.zhihu.com{link['href']}"
            item_id = url_str.split("/")[-1].split("?")[0]
            if item_id in saved_ids:
                continue

            voteup = "0"
            ve = soup.find("button", class_=re.compile(r"VoteButton"))
            if ve:
                voteup = ve.get_text(strip=True) or "0"
            title = ""
            title_el = soup.find("h2") or soup.find("a", class_=re.compile(r"Title"))
            if title_el:
                title = title_el.get_text(strip=True)
            author_el = soup.find("a", class_=re.compile(r"UserLink-link"))
            author = author_el.get_text(strip=True) if author_el else user_name

            content_div = soup.find("div", class_=re.compile(r"RichContent-inner"))
            content_html = str(content_div) if content_div else ""
            content_md = html_to_markdown(content_html)

            filename = sanitize_filename(f"[{voteup}赞] {author} - {title}.md" if title else f"{author} - {item_id}.md")
            filepath = os.path.join(save_dir, filename)
            _write_md(filepath, {
                "title": title,
                "author": author,
                "voteup": voteup,
                "url": url_str,
            }, content_md)
            print(f"  ✓ {filename}")
            saved_ids.add(item_id)
            _save_progress(save_dir, saved_ids)
            count += 1
            time.sleep(0.3)

        print(f"\n完成！共保存 {count} 条{label}到: {save_dir}")
    finally:
        if bc:
            bc.close()


def crawl_column(column_id, output_dir, cookie="", proxies=None, max_pages=None):
    bc = None
    try:
        bc = BrowserCrawler(cookie=cookie)
        page = bc._get_page()
        url = f"https://www.zhihu.com/column/{column_id}"
        print("  → 正在打开专栏页面...")
        page.get(url)
        time.sleep(5)

        col_title = column_id
        try:
            title_el = page.ele("tag:h1", timeout=5)
            if title_el:
                col_title = title_el.text
        except Exception:
            pass
        print(f"专栏: {col_title}")

        dir_name = sanitize_filename(f"[{column_id}] {col_title}")
        save_dir = os.path.join(output_dir, dir_name)
        os.makedirs(save_dir, exist_ok=True)

        print("  → 正在滚动加载...")
        last_h = page.run_js("return document.body.scrollHeight")
        stable = 0
        scroll_rounds = max_pages * 2 if max_pages else 20
        for _ in range(scroll_rounds):
            page.run_js("window.scrollTo(0, document.body.scrollHeight)")
            time.sleep(2)
            new_h = page.run_js("return document.body.scrollHeight")
            if new_h == last_h:
                stable += 1
                if stable >= 2:
                    break
            else:
                stable = 0
                last_h = new_h

        cards = page.eles("t:div@class=ColumnArticleItem")
        if not cards:
            cards = page.eles("t:div@class=ContentItem")
        print(f"  → 检测到 {len(cards)} 个内容元素")

        saved_ids = _load_progress(save_dir)
        count = 0
        for card in cards:
            html = card.html if hasattr(card, "html") else str(card)
            soup = BeautifulSoup(html, "html.parser")
            link = soup.find("a", href=re.compile(r"/p/"))
            if not link:
                continue
            article_id = link["href"].split("/p/")[-1].split("?")[0]
            if article_id in saved_ids:
                continue

            title = ""
            title_el = soup.find("h2") or soup.find("a", class_=re.compile(r"Title"))
            if title_el:
                title = title_el.get_text(strip=True)
            author_el = soup.find("a", class_=re.compile(r"UserLink-link"))
            author = author_el.get_text(strip=True) if author_el else ""
            voteup = "0"
            ve = soup.find("button", class_=re.compile(r"VoteButton"))
            if ve:
                voteup = ve.get_text(strip=True) or "0"

            excerpt = ""
            excerpt_el = soup.find("div", class_=re.compile(r"RichText"))
            if excerpt_el:
                excerpt = excerpt_el.get_text(strip=True)[:200]

            filename = sanitize_filename(f"{author} - {title}.md" if title else f"{article_id}.md")
            filepath = os.path.join(save_dir, filename)
            _write_md(filepath, {
                "title": title,
                "author": author,
                "voteup": voteup,
                "url": f"https://zhuanlan.zhihu.com/p/{article_id}",
            }, excerpt)
            print(f"  ✓ {filename}")
            saved_ids.add(article_id)
            _save_progress(save_dir, saved_ids)
            count += 1
            time.sleep(0.3)

        print(f"\n完成！共保存 {count} 篇文章到: {save_dir}")
    finally:
        if bc:
            bc.close()
