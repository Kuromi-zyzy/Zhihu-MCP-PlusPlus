import json
import random
import re
import sys
import time
import traceback

import requests
from bs4 import BeautifulSoup

# ========== API 端点 (requests 方式, 会被知乎反爬拦截) ==========

def answers_api(question_id, limit=20, offset=0, sort_by="default"):
    return (
        f"https://www.zhihu.com/api/v4/questions/{question_id}/answers?"
        f"include=data[*].voteup_count,content&limit={limit}&offset={offset}&sort_by={sort_by}"
    )

def answer_api(answer_id):
    return f"https://www.zhihu.com/api/v4/answers/{answer_id}?include=data[*].voteup_count,content"

def article_api(article_id):
    return f"https://api.zhihu.com/articles/{article_id}"

def question_info_api(question_id):
    return f"https://www.zhihu.com/api/v4/questions/{question_id}?include=title"

# ========== requests 方式（备用，可能被 403） ==========

UA_POOL = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
]

BASE_HEADERS = {
    "Referer": "https://www.zhihu.com/",
    "Origin": "https://www.zhihu.com",
}

class ZhihuCrawler:
    def __init__(self, cookie="", proxies=None, timeout=15, retries=3):
        self.session = requests.Session()
        self.session.headers.update(BASE_HEADERS)
        self.session.headers["User-Agent"] = random.choice(UA_POOL)
        if cookie:
            self.session.headers["Cookie"] = cookie
        if proxies:
            self.session.proxies.update(proxies)
        self.timeout = timeout
        self.retries = retries

    def _request(self, url):
        for i in range(self.retries):
            try:
                resp = self.session.get(url, timeout=self.timeout)
                if resp.status_code == 200:
                    return resp
                if resp.status_code == 403:
                    return None
                print(f"[!] HTTP {resp.status_code}")
            except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
                print(f"[!] 请求异常 ({type(e).__name__}): {e}")
            if i < self.retries - 1:
                time.sleep(2 * (i + 1))
        return None

    def get_answers(self, question_id, sort_by="default", max_pages=None):
        offset = 0
        page = 0
        all_answers = []
        while True:
            url = answers_api(question_id, offset=offset, sort_by=sort_by)
            resp = self._request(url)
            if resp is None:
                break
            try:
                data = resp.json()
            except json.JSONDecodeError:
                break
            items = data.get("data", [])
            if not items:
                break
            all_answers.extend(items)
            offset += len(items)
            page += 1
            print(f"  → 已获取 {len(all_answers)} 条回答")
            if max_pages and page >= max_pages:
                break
            paging = data.get("paging", {})
            if not paging.get("is_end", True):
                time.sleep(3)
            else:
                break
        return all_answers

    def get_answer(self, answer_id):
        url = answer_api(answer_id)
        resp = self._request(url)
        if resp is None:
            return None
        try:
            return resp.json()
        except json.JSONDecodeError:
            return None

    def get_article(self, article_id):
        url = article_api(article_id)
        resp = self._request(url)
        if resp is None:
            return None
        try:
            return resp.json()
        except json.JSONDecodeError:
            return None

    def get_question_title(self, question_id):
        url = question_info_api(question_id)
        resp = self._request(url)
        if resp is None:
            return None
        try:
            return resp.json().get("title", "")
        except json.JSONDecodeError:
            return None


# ========== DrissionPage 浏览器方式（推荐，不会被拦截） ==========

# 浏览器 profile 持久化路径（复用登录态，避免每次裸启动）
import os as _os  # noqa: E402

_BROWSER_PROFILE = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), ".browser_profile")

# 回答卡片选择器（多级兜底，知乎改版时只需更新这里）
ANSWER_CARD_SELECTORS = [
    "t:div@class=List-item",
    "t:div@class=ContentItem",
    "t:div@class=AnswerCard",
    "t:div@class=Card",
]

# 文章正文选择器
ARTICLE_CONTENT_SELECTORS = [
    "t:div@class=Post-RichText",
    "t:div@class=RichText",
    "t:article",
    "tag:div@class^=RichText",
]

# 单回答正文选择器
ANSWER_CONTENT_SELECTORS = [
    "t:div@class=RichContent-inner",
    "t:div@class=RichText",
]


class BrowserCrawler:
    """基于 DrissionPage 的浏览器爬虫，绕过知乎反爬"""

    def __init__(self, headless=False, cookie=""):
        self.headless = headless
        self.cookie = cookie
        self._page = None

    def _get_page(self):
        if self._page is None:
            from DrissionPage import ChromiumOptions, ChromiumPage
            co = ChromiumOptions()
            if _os.path.exists(_BROWSER_PROFILE):
                co.set_user_data_path(_BROWSER_PROFILE)
            co.set_argument("--disable-blink-features=AutomationControlled")
            if self.headless:
                co.headless()
            try:
                self._page = ChromiumPage(co)
            except Exception as e:
                print(f"  [!] 持久 profile 启动失败，改用临时 profile: {type(e).__name__}", file=sys.stderr)
                co_tmp = ChromiumOptions()
                co_tmp.set_argument("--disable-blink-features=AutomationControlled")
                if self.headless:
                    co_tmp.headless()
                self._page = ChromiumPage(co_tmp)
            if self.cookie:
                self._inject_cookie(self.cookie)
        return self._page

    def _inject_cookie(self, cookie_str):
        """将 cookie 字符串注入浏览器，复用 requests 捕获的登录态"""
        if not cookie_str:
            return
        for pair in cookie_str.split(";"):
            pair = pair.strip()
            if "=" not in pair:
                continue
            name, value = pair.split("=", 1)
            try:
                self._page.set.cookies({
                    "name": name.strip(),
                    "value": value.strip(),
                    "domain": ".zhihu.com",
                    "path": "/",
                })
            except Exception as e:
                print(f"  [!] cookie 注入失败 ({name}): {e}")

    def close(self):
        if self._page:
            try:
                self._page.quit()
            except Exception:
                pass
            self._page = None

    def get_question_title(self, question_id):
        page = self._get_page()
        url = f"https://www.zhihu.com/question/{question_id}"
        print("  → 正在打开问题页面...")
        page.get(url)
        time.sleep(4)
        try:
            title_el = page.ele("tag:h1", timeout=10)
            return title_el.text if title_el else None
        except Exception as e:
            print(f"  [!] 获取标题失败: {type(e).__name__}: {e}", file=sys.stderr)
            return None

    def get_answers(self, question_id, max_answers=None):
        page = self._get_page()
        url = f"https://www.zhihu.com/question/{question_id}"
        answers = []

        print("  → 正在打开问题页面...")
        page.get(url)
        time.sleep(5)

        # 检测页面是否有效（是否有 404）
        current_url = page.url
        if "question/not-found" in current_url or "404" in current_url:
            print("  [!] 问题不存在 (404)")
            return answers

        # 获取标题
        question_title = ""
        try:
            title_el = page.ele("tag:h1", timeout=5)
            question_title = title_el.text if title_el else ""
            if question_title:
                print(f"  ✓ 标题: {question_title}")
        except Exception as e:
            print(f"  [!] 获取标题失败: {type(e).__name__}: {e}", file=sys.stderr)

        # 滚动到底部多次，触发懒加载
        print("  → 正在滚动加载更多回答...")
        last_height = page.run_js("return document.body.scrollHeight")
        stable_scrolls = 0

        for scroll_round in range(30):
            page.run_js("window.scrollTo(0, document.body.scrollHeight)")
            time.sleep(2)

            new_height = page.run_js("return document.body.scrollHeight")
            if new_height == last_height:
                stable_scrolls += 1
                if stable_scrolls >= 2:
                    break
            else:
                stable_scrolls = 0
                last_height = new_height

            if scroll_round % 3 == 0:
                print(f"  → 滚动中... ({scroll_round + 1}/30)")

        time.sleep(2)

        # 提取所有回答卡片
        try:
            # 多级选择器兜底，知乎改版时只需更新 ANSWER_CARD_SELECTORS
            items = []
            for selector in ANSWER_CARD_SELECTORS:
                items = page.eles(selector)
                if items:
                    break

            print(f"  → 检测到 {len(items)} 个内容元素")

            fail_count = 0
            for i, item in enumerate(items):
                try:
                    answer_data = self._extract_answer(item, question_id, question_title)
                    if answer_data and answer_data.get("content", "").strip():
                        answers.append(answer_data)
                except Exception as e:
                    fail_count += 1
                    if fail_count <= 3:
                        print(f"  [!] 第 {i+1} 条提取失败: {type(e).__name__}: {e}", file=sys.stderr)
            if fail_count > 3:
                print(f"  [!] 另有 {fail_count - 3} 条提取失败（省略）", file=sys.stderr)

        except Exception as e:
            print(f"  [!] 提取失败: {type(e).__name__}: {e}", file=sys.stderr)
            traceback.print_exc()

        return answers

    def _extract_answer(self, card_el, question_id, question_title):
        """从浏览器元素提取回答数据"""
        html = ""
        if hasattr(card_el, 'html'):
            try:
                html = card_el.html
            except Exception:
                pass
        if not html:
            html = str(card_el)
        soup = BeautifulSoup(html, "html.parser")

        # 提取点赞数
        voteup = "0"
        vote_el = soup.find("button", class_=re.compile(r"VoteButton"))
        if vote_el:
            voteup = vote_el.get_text(strip=True)
        if not voteup or voteup == "△":
            voteup = "0"

        # 提取作者
        author = ""
        author_link = soup.find("a", class_=re.compile(r"UserLink-link"))
        if author_link:
            author = author_link.get_text(strip=True)
        if not author:
            meta_name = soup.find("meta", itemprop="name")
            if meta_name:
                author = meta_name.get("content", "")
        if not author:
            author = "匿名用户"

        # 提取作者主页
        author_url = ""
        if author_link:
            author_url = author_link.get("href", "")
            if author_url and not author_url.startswith("http"):
                author_url = "https://www.zhihu.com" + author_url

        # 提取回答内容（HTML）
        content_html = ""
        content_div = soup.find("div", class_=re.compile(r"RichContent-inner"))
        if not content_div:
            content_div = soup.find("span", class_=re.compile(r"RichText"))
        if not content_div:
            content_div = soup.find("div", class_=re.compile(r"ContentItem"))
        if content_div:
            content_html = str(content_div)

        # 提取回答 ID
        answer_id = ""
        if hasattr(card_el, 'attr'):
            try:
                answer_id = card_el.attr('data-za-detail-entity-id') or ""
            except Exception:
                pass

        return {
            "id": answer_id,
            "author": author,
            "author_url": author_url,
            "voteup": voteup,
            "content": content_html,
            "question_id": question_id,
            "question_title": question_title,
        }

    def get_article(self, article_id):
        """浏览器模式获取文章"""
        page = self._get_page()
        url = f"https://zhuanlan.zhihu.com/p/{article_id}"
        print("  → 正在打开文章页面...")
        page.get(url)
        time.sleep(5)

        current_url = page.url
        if "404" in current_url or "not-found" in current_url:
            print("  [!] 文章不存在 (404)")
            return None

        try:
            title_el = page.ele("tag:h1", timeout=10)
            title = title_el.text if title_el else ""
            content_html = ""
            for selector in ARTICLE_CONTENT_SELECTORS:
                try:
                    content_el = page.ele(selector, timeout=3)
                    if content_el:
                        content_html = content_el.html
                        if content_html and len(content_html) > 100:
                            break
                except Exception:
                    continue
            author = ""
            try:
                author_el = page.ele("t:div@class=AuthorInfo", timeout=3)
                if author_el:
                    name_el = author_el.ele("tag:meta[itemprop=name]", timeout=2)
                    if name_el:
                        author = name_el.attr("content") or ""
            except Exception:
                pass

            return {
                "id": article_id,
                "title": title,
                "author": author,
                "author_url": "",
                "voteup": 0,
                "content": content_html,
            }
        except Exception as e:
            print(f"  [!] 文章提取失败: {type(e).__name__}: {e}", file=sys.stderr)
            return None

    def get_answer(self, answer_id):
        """浏览器模式获取单个回答"""
        page = self._get_page()
        url = f"https://www.zhihu.com/answer/{answer_id}"
        print("  → 正在打开回答页面...")
        page.get(url)
        time.sleep(4)

        try:
            content_el = None
            for i, selector in enumerate(ANSWER_CONTENT_SELECTORS):
                content_el = page.ele(selector, timeout=10 if i == 0 else 5)
                if content_el:
                    break
            content_html = content_el.html if content_el else ""
            title = ""
            title_el = page.ele("tag:h1", timeout=5)
            if title_el:
                title = title_el.text
            author = "匿名用户"
            author_el = page.ele("t:a@class=UserLink-link", timeout=3)
            if author_el:
                author = author_el.text or author
            voteup = "0"
            vote_el = page.ele("t:button@class=VoteButton", timeout=3)
            if vote_el:
                voteup = vote_el.text or "0"

            return {
                "id": answer_id,
                "title": title,
                "author": author,
                "content": content_html,
                "voteup": voteup,
                "question_title": title,
            }
        except Exception as e:
            print(f"  [!] 回答提取失败: {type(e).__name__}: {e}", file=sys.stderr)
            return None
