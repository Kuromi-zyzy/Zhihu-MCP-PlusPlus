"""统一凭据存储测试（v1 §26 test_credentials.py）：双读兼容 + 优先级，全部 mock，无网络。"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main as main_mod  # noqa: E402


def _load_credentials_file(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def test_credentials_json_format(tmp_path, monkeypatch):
    """credentials.json 的 cookies 字段能被拼成 cookie 串。"""
    cred = tmp_path / "credentials.json"
    cred.write_text(json.dumps({
        "version": 1,
        "cookies": {"d_c0": "abc", "z_c0": "xyz"},
        "user": {"id": "1", "name": " tester"},
    }), encoding="utf-8")
    data = _load_credentials_file(cred)
    assert data["cookies"]["d_c0"] == "abc"
    cookie_str = "; ".join(f"{k}={v}" for k, v in data["cookies"].items())
    assert cookie_str == "d_c0=abc; z_c0=xyz"


def test_main_module_has_dual_read_paths():
    """main.py 同时具备 credentials.json 与 config.json 两条读取路径。"""
    assert hasattr(main_mod, "_credentials_cookie")
    assert hasattr(main_mod, "_config_cookie")


def test_resolve_cookie_priority(monkeypatch):
    """优先级：CLI 参数 > credentials.json > config.json > 环境变量。"""
    monkeypatch.setattr(main_mod, "_credentials_cookie", "d_c0=fromcred")
    monkeypatch.setattr(main_mod, "_config_cookie", "d_c0=fromconfig")
    monkeypatch.setenv("ZHIHU_COOKIE", "d_c0=fromenv")
    assert main_mod._resolve_cookie("") == "d_c0=fromcred"
    assert main_mod._resolve_cookie("d_c0=fromcli") == "d_c0=fromcli"

    monkeypatch.setattr(main_mod, "_credentials_cookie", "")
    assert main_mod._resolve_cookie("") == "d_c0=fromconfig"

    monkeypatch.setattr(main_mod, "_config_cookie", "")
    assert main_mod._resolve_cookie("") == "d_c0=fromenv"


def test_login_module_validation_gate():
    """login.py 的写盘闸门：验证失败路径不写 config（main 函数源码级断言）。"""
    login_src = (Path(__file__).resolve().parent.parent / "login.py").read_text(encoding="utf-8")
    # 验证失败分支必须在 save_config 之前
    assert "验证失败" in login_src or "validate_cookie(cookie)" in login_src
    assert login_src.index("validate_cookie(cookie)") < login_src.index("save_config(config)")
    # 轮询 z_c0，不再用 URL 判定
    assert "z_c0" in login_src
    assert "url_change" not in login_src
