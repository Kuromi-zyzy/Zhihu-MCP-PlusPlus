"""
login.py -- 自动打开浏览器登录知乎，捕获 Cookie

用法:
    python login.py                    # 交互式登录，捕获 Cookie
    python login.py --headless          # 无界面模式

依赖:
    DrissionPage (pip install DrissionPage)
"""

import json
import os
import sys
import time

import requests

# stdout 重配 utf-8，避免 Windows 控制台 GBK 编码报错
sys.stdout.reconfigure(encoding="utf-8")

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


def validate_cookie(cookie_str):
    """验证 Cookie 是否有效：调用 /api/v4/me 检查登录态。返回 (ok, info)。"""
    try:
        resp = requests.get(
            "https://www.zhihu.com/api/v4/me",
            headers={
                "Cookie": cookie_str,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            timeout=10,
        )
        if resp.status_code == 200:
            data = resp.json()
            name = data.get("name", "") or data.get("id", "")
            return True, name
        return False, f"HTTP {resp.status_code}"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


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
            print("\n  → 正在验证 Cookie 有效性...")
            ok, info = validate_cookie(cookie)
            if ok:
                print(f"  ✓ Cookie 有效！登录用户: {info}")
            else:
                print(f"  ⚠ Cookie 可能无效: {info}")
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
