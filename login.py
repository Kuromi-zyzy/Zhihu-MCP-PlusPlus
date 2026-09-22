"""
login.py -- 自动打开浏览器登录知乎，捕获 Cookie

用法:
    python login.py                    # 交互式登录，捕获 Cookie
    python login.py --headless          # 无界面模式

依赖:
    DrissionPage (pip install DrissionPage)

判定逻辑（2026-09-22 加固，回流自用户目录 qr_login.py）:
    不再以「URL 离开 /signin」判定登录——知乎登录页自身重定向会误触发，
    导致未扫码就抓到匿名 Cookie。改为轮询 Cookie 出现登录令牌 z_c0 为准，
    且 /api/v4/me 验证通过后才写入 config.json（验证失败不落盘）。
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
HOME_URL = "https://www.zhihu.com/"
WAIT_ZC0_SECONDS = 240  # 扫码窗口

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
BLACKLIST_EXACT = {"BEC"}


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


CRED_STORE = os.path.join(os.path.expanduser("~"), ".zhihu-mcp", "credentials.json")


def sync_credentials_store(cookie_str: str, user_name: str):
    """登录成功后直写统一凭据库（v1 §3：Python/Node 共用同一份登录态）。

    只更新 cookies/user/validated_at/updated_at，不覆盖库内其他字段；
    写失败只告警不中断——config.json 仍是权威副本，credentials.js 可从它迁移。
    """
    try:
        pairs = {}
        for pair in cookie_str.split(";"):
            i = pair.find("=")
            if i > 0:
                pairs[pair[:i].strip()] = pair[i + 1:].strip()
        store = {"version": 1, "cookies": {}, "user": None, "validated_at": None, "updated_at": None}
        if os.path.exists(CRED_STORE):
            with open(CRED_STORE, "r", encoding="utf-8") as f:
                try:
                    store = json.load(f)
                except json.JSONDecodeError:
                    pass  # 损坏则重建
        store.setdefault("version", 1)
        store["cookies"] = pairs
        store["user"] = user_name
        store["validated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        store["updated_at"] = store["validated_at"]
        os.makedirs(os.path.dirname(CRED_STORE), exist_ok=True)
        with open(CRED_STORE, "w", encoding="utf-8") as f:
            json.dump(store, f, indent=2, ensure_ascii=False)
        if os.name == "posix":
            os.chmod(CRED_STORE, 0o600)
        print(f"  ✓ 统一凭据库已同步: {CRED_STORE}")
    except OSError as e:
        print(f"  ⚠ 统一凭据库写入失败（不影响爬虫使用）: {e}")


def is_useful_cookie(name: str) -> bool:
    if name in BLACKLIST_EXACT:
        return False
    for black in COOKIE_BLACKLIST:
        if name.startswith(black):
            return False
    return True


def capture_cookie(headless: bool = False) -> str:
    """打开登录页，轮询 z_c0 出现才算登录成功，返回含 z_c0 的 Cookie 串（否则为空）。"""
    ChromiumPage = _get_browser()
    page = ChromiumPage()
    cookie_str = ""

    try:
        print("\n  → 正在打开知乎登录页...")
        print(f"  → 请用微信/QQ/手机号登录（{WAIT_ZC0_SECONDS} 秒超时）")
        page.get(LOGIN_URL)

        # 轮询 Cookie 出现 z_c0 为准，不看 URL（URL 判定会被登录页自身重定向误触发）
        deadline = time.time() + WAIT_ZC0_SECONDS
        zc0_seen = False
        while time.time() < deadline:
            names = {c.get("name", "") for c in page.cookies()}
            if "z_c0" in names:
                zc0_seen = True
                break
            time.sleep(2)

        if not zc0_seen:
            print("  ✗ 超时未捕获到 z_c0（未扫码或扫码未确认）")
            return ""

        print("  → 检测到 z_c0，跳转首页刷新 Cookie...")
        page.get(HOME_URL)
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
            if "z_c0" not in cookie_str:
                print("  ✗ 捕获结果异常（无 z_c0），视为未登录")
                cookie_str = ""
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
            # 先验证，验证通过才写 config.json（避免无效 Cookie 覆盖旧有效值）
            print("\n  → 正在验证 Cookie 有效性...")
            ok, info = validate_cookie(cookie)
            if not ok:
                print(f"  ✗ Cookie 验证失败: {info}，不写入 config.json")
                again = input("  重新登录？(y/n): ").strip().lower()
                if again != "y":
                    print("  已取消（原 config.json 未改动）")
                    break
                continue
            print(f"  ✓ Cookie 有效！登录用户: {info}")
            config = load_config()
            config["cookie"] = cookie
            save_config(config)
            sync_credentials_store(cookie, info)
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
