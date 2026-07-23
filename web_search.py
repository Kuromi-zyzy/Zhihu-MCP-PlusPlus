import argparse
import ipaddress
import json
import random
import re
import socket
import sys
import time
import urllib.parse

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

UA_POOL = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
]

BASE_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

SAFE_SCHEMES = ("http", "https")
MAX_FETCH_BYTES = 5 * 1024 * 1024
MAX_TEXT_CHARS = 50000

DECOMPOSE_TAGS = [
    "script", "style", "nav", "footer", "header", "aside",
    "noscript", "template", "form", "svg", "iframe", "button",
]


def _headers(referer=None):
    h = dict(BASE_HEADERS)
    h["User-Agent"] = random.choice(UA_POOL)
    if referer:
        h["Referer"] = referer
    return h


def make_session():
    s = requests.Session()
    retry = Retry(
        total=3,
        backoff_factor=0.6,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],
    )
    adapter = HTTPAdapter(max_retries=retry)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    return s


def _make_soup(html):
    return BeautifulSoup(html, "html.parser")


def _strip_raw_tags(html):
    html = re.sub(
        r"<script\b[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE
    )
    html = re.sub(
        r"<style\b[^>]*>.*?</style>", "", html, flags=re.DOTALL | re.IGNORECASE
    )
    return html


def _fix_encoding(resp):
    if not resp.encoding or resp.encoding.lower() == "iso-8859-1":
        resp.encoding = resp.apparent_encoding or "utf-8"
    return resp


def is_safe_url(url):
    try:
        p = urllib.parse.urlparse(url)
    except Exception:
        return False, "invalid url"
    if p.scheme not in SAFE_SCHEMES:
        return False, f"scheme not allowed: {p.scheme}"
    if not p.hostname:
        return False, "no hostname"
    try:
        ip = ipaddress.ip_address(socket.gethostbyname(p.hostname))
    except OSError:
        return False, "dns resolve failed"
    if (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
    ):
        return False, f"internal ip blocked: {ip}"
    return True, ""


def search_duckduckgo(query, max_results=8, session=None):
    session = session or make_session()
    url = f"https://html.duckduckgo.com/html/?q={urllib.parse.quote_plus(query)}"
    try:
        resp = session.get(
            url, headers=_headers(referer="https://duckduckgo.com/"), timeout=6
        )
        resp.raise_for_status()
        _fix_encoding(resp)
        soup = _make_soup(resp.text)
        results = []
        for item in soup.select(".result")[:max_results]:
            title_el = item.select_one(".result__title a")
            snippet_el = item.select_one(".result__snippet")
            if title_el:
                results.append(
                    {
                        "title": title_el.get_text(strip=True),
                        "url": title_el.get("href", ""),
                        "snippet": snippet_el.get_text(strip=True) if snippet_el else "",
                    }
                )
        if not results and soup.select_one(".result"):
            return {
                "success": False,
                "error": "duckduckgo selector mismatch (likely blocked)",
                "engine": "duckduckgo",
            }
        return {
            "success": True,
            "results": results,
            "count": len(results),
            "engine": "duckduckgo",
        }
    except (requests.Timeout, requests.ConnectionError) as e:
        return {"success": False, "error": f"network: {e}", "engine": "duckduckgo"}
    except requests.HTTPError as e:
        code = e.response.status_code if e.response is not None else "?"
        return {"success": False, "error": f"http {code}", "engine": "duckduckgo"}
    except Exception as e:
        return {
            "success": False,
            "error": f"unexpected: {type(e).__name__}: {e}",
            "engine": "duckduckgo",
        }


def search_bing(query, max_results=8, session=None):
    session = session or make_session()
    url = (
        f"https://cn.bing.com/search?q={urllib.parse.quote_plus(query)}&setlang=zh-CN"
    )
    try:
        time.sleep(random.uniform(0.4, 1.2))
        resp = session.get(
            url, headers=_headers(referer="https://cn.bing.com/"), timeout=15
        )
        resp.raise_for_status()
        _fix_encoding(resp)
        soup = _make_soup(resp.text)
        results = []
        for item in soup.select("#b_results > li.b_algo")[:max_results]:
            title_el = item.select_one("h2 a")
            snippet_el = item.select_one(".b_caption p")
            if title_el:
                results.append(
                    {
                        "title": title_el.get_text(strip=True),
                        "url": title_el.get("href", ""),
                        "snippet": snippet_el.get_text(strip=True) if snippet_el else "",
                    }
                )
        if not results and soup.select_one("#b_results"):
            return {
                "success": False,
                "error": "bing selector mismatch (likely blocked)",
                "engine": "bing",
            }
        return {
            "success": True,
            "results": results,
            "count": len(results),
            "engine": "bing",
        }
    except (requests.Timeout, requests.ConnectionError) as e:
        return {"success": False, "error": f"network: {e}", "engine": "bing"}
    except requests.HTTPError as e:
        code = e.response.status_code if e.response is not None else "?"
        return {"success": False, "error": f"http {code}", "engine": "bing"}
    except Exception as e:
        return {
            "success": False,
            "error": f"unexpected: {type(e).__name__}: {e}",
            "engine": "bing",
        }


def search_all(query, max_results=8):
    session = make_session()
    errors = []
    for fn in (search_bing, search_duckduckgo):
        result = fn(query, max_results, session)
        if result.get("success") and result.get("count", 0) > 0:
            return result
        if not result.get("success"):
            errors.append(f"[{result.get('engine')}] {result.get('error', '')}")
    return {
        "success": False,
        "error": "all engines failed: " + " | ".join(errors),
        "engine": "none",
        "results": [],
        "count": 0,
    }


def fetch_text(url, timeout=30):
    ok, reason = is_safe_url(url)
    if not ok:
        return {"success": False, "error": f"url blocked: {reason}"}
    session = make_session()
    try:
        resp = session.get(
            url, headers=_headers(), timeout=timeout, stream=True
        )
        resp.raise_for_status()
        content_type = resp.headers.get("Content-Type", "")
        if "text" not in content_type and "html" not in content_type:
            resp.close()
            return {"success": False, "error": f"not a text page: {content_type}"}
        cl = int(resp.headers.get("Content-Length", 0) or 0)
        if cl and cl > MAX_FETCH_BYTES:
            resp.close()
            return {"success": False, "error": f"response too large: {cl} bytes"}
        raw = b""
        too_large = False
        for chunk in resp.iter_content(8192):
            raw += chunk
            if len(raw) > MAX_FETCH_BYTES:
                too_large = True
                break
        encoding = resp.encoding
        if not encoding or encoding.lower() == "iso-8859-1":
            encoding = resp.apparent_encoding or "utf-8"
        final_url = resp.url
        resp.close()
        if too_large:
            return {
                "success": False,
                "error": f"response exceeded {MAX_FETCH_BYTES} bytes",
            }
        text = raw.decode(encoding, errors="replace")
        text = _strip_raw_tags(text)
        soup = _make_soup(text)
        for tag in soup(DECOMPOSE_TAGS):
            tag.decompose()
        main = soup.find("main") or soup.find("article") or soup.body or soup
        body_text = main.get_text(separator="\n", strip=True)
        body_text = _strip_raw_tags(body_text)
        body_text = "\n".join(
            line for line in body_text.split("\n") if line.strip()
        )
        return {
            "success": True,
            "title": soup.title.get_text(strip=True) if soup.title else "",
            "url": final_url,
            "final_url": final_url,
            "content_type": content_type,
            "encoding": encoding,
            "content_length": len(body_text),
            "truncated": len(body_text) > MAX_TEXT_CHARS,
            "content": body_text[:MAX_TEXT_CHARS],
        }
    except (requests.Timeout, requests.ConnectionError) as e:
        return {"success": False, "error": f"network: {e}"}
    except requests.HTTPError as e:
        code = e.response.status_code if e.response is not None else "?"
        return {"success": False, "error": f"http {code}"}
    except Exception as e:
        return {
            "success": False,
            "error": f"unexpected: {type(e).__name__}: {e}",
        }


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="web search/fetch tool")
    sub = parser.add_subparsers(dest="action", required=True)
    s = sub.add_parser("search", help="search <query> [--max N]")
    s.add_argument("query")
    s.add_argument("--max", type=int, default=8)
    f = sub.add_parser("fetch", help="fetch <url> [--timeout S]")
    f.add_argument("url")
    f.add_argument("--timeout", type=int, default=30)
    args = parser.parse_args()

    if args.action == "search":
        result = search_all(args.query, args.max)
    else:
        result = fetch_text(args.url, args.timeout)

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
