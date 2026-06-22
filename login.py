"""
login.py -- 自动打开浏览器登录知乎，捕获 Cookie

用法:
    python login.py                    # 交互式登录，捕获 Cookie
    python login.py --headless          # 无界面模式

依赖:
    DrissionPage (pip install DrissionPage)
"""

import os
import re
import json
import sys
import time

CONFIG_FILE = os.path.join(os.path.dirname(__file__), "config.json")
LOGIN_URL = "https://www.zhihu.com/signin?next=%2F"

_ChromiumPage = None

def _get_browser():
    global _ChromiumPage
    if _ChromiumPage is None:
        try:
            from DrissionPage import ChromiumPage as CP
            _ChromiumPage = CP
        except ImportError:
            print("[!] 需要 DrissionPage，请执行:  pip install DrissionPage")
            sys.exit(1)
    return _ChromiumPage

# 无关 Cookie 黑名单（统计分析/防刷类，与登录态无关）
# 注：z_c0 是知乎登录令牌（老版），必须保留，不能进黑名单
COOKIE_BLACKLIST = [
    "tgw_l7_", "_xsrf", "HMACCOUNT", "Hm_lvt_", "Hm_lpvt_",
    "trc_cookie_storage", "KLBRSID",
]


def load_config() -> dict:
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                return {}
    return {}


def save_config(config: dict):
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=4, ensure_ascii=False)
    print(f"\n  ✓ Config saved to: {CONFIG_FILE}")


def is_useful_cookie(name: str) -> bool:
    for black in COOKIE_BLACKLIST:
        if name.startswith(black):
            return False
    return True


def capture_cookie(headless: bool = False) -> str:
    ChromiumPage = _get_browser()
    page = ChromiumPage()
    cookie_str = ""

    try:
        print("\n  → 正在打开知乎登录页...")
        print("  → 请用微信/QQ/手机号登录（120 秒超时）")
        page.get(LOGIN_URL)

        # 等待 URL 离开 /signin，说明登录成功
        page.wait.url_change(LOGIN_URL, timeout=120)
        time.sleep(3)

        # 登录成功后再跳转到首页，确保所有 Cookie 都刷新
        print("  → 登录成功！正在获取 Cookie...")
        page.get("https://www.zhihu.com/")
        time.sleep(3)

        # 从浏览器获取全部 Cookie
        all_cookies = page.cookies()
        pairs = []
        seen = set()
        for c in all_cookies:
            name = c.get("name", "")
            value = c.get("value", "")
            if name and value and is_useful_cookie(name) and name not in seen:
                pairs.append(f"{name}={value}")
                seen.add(name)

        cookie_str = "; ".join(pairs)
        if cookie_str:
            print(f"  ✓ Cookie 捕获成功！({len(pairs)} 项)")
            print(f"  📋 预览: {cookie_str[:50]}...")
            # 检查关键 Cookie 是否存在
            has_zco = any("z_c0" in p for p in pairs)
            has_session = any("SESSIONID" in p for p in pairs)
            if has_zco:
                print("  ✓ 关键 Cookie 'z_c0' 已捕获")
            if has_session:
                print("  ✓ 关键 Cookie 'SESSIONID' 已捕获")
        else:
            print("  ✗ 未捕获到有效 Cookie")

    finally:
        try:
            page.quit()
        except Exception:
            pass

    return cookie_str


def main(headless: bool = False):
    print("=" * 50)
    print("  ZhihuSpider - 知乎 Cookie 自动捕获")
    print("=" * 50)

    while True:
        cookie = capture_cookie(headless=headless)
        if cookie:
            config = load_config()
            config["cookie"] = cookie
            save_config(config)
            print("\n  💡 现在可以运行爬虫了:")
            print("      python main.py question <问题ID>")
            print("      python main.py article  <文章ID>")
            print("      python main.py answer   <回答ID>")
            break
        else:
            again = input("\n  重新登录？(y/n): ").strip().lower()
            if again != "y":
                print("  已取消")
                break


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="ZhihuSpider - Cookie 捕获工具")
    parser.add_argument("--headless", action="store_true", help="无界面模式（不推荐）")
    args = parser.parse_args()
    main(headless=args.headless)
