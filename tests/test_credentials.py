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
    """login.py 的写盘闸门：验证失败路径不写凭据库（main 函数源码级断言）。"""
    login_src = (Path(__file__).resolve().parent.parent / "login.py").read_text(encoding="utf-8")
    # 验证失败分支必须在 write_credentials_store 之前（rc4 后唯一写入点）
    assert "验证失败" in login_src or "validate_cookie(cookie)" in login_src
    assert login_src.index("validate_cookie(cookie)") < login_src.index("write_credentials_store(cookie, info)")
    # 轮询 z_c0，不再用 URL 判定
    assert "z_c0" in login_src
    assert "url_change" not in login_src


def test_login_single_source_of_truth():
    """rc4 收口：login.py 凭据单一来源——不再写 config.json，只写统一凭据库。"""
    login_src = (Path(__file__).resolve().parent.parent / "login.py").read_text(encoding="utf-8")
    # 1) 不再有对 config.json 的写路径（save_config 已删除）
    assert "def save_config" not in login_src, "save_config 必须删除（config.json 不再是写入目标）"
    assert "load_config" not in login_src, "load_config 已无用途"
    # 2) 数据目录语义与 Node 一致：ZHIHU_MCP_DATA_DIR 优先
    assert 'os.environ.get("ZHIHU_MCP_DATA_DIR")' in login_src
    # 3) 唯一写入点存在且被 main 调用；legacy 迁移存在且只读语义
    assert "def write_credentials_store" in login_src
    assert "write_credentials_store(cookie, info)" in login_src
    assert "def migrate_legacy_once" in login_src
    assert "migrate_legacy_once()" in login_src
    # 4) main 路径中不再出现对 LEGACY_CONFIG_FILE 的写操作（仅 migrate 读）
    assert login_src.count("LEGACY_CONFIG_FILE") >= 1
    write_positions = [i for i in range(len(login_src)) if login_src.startswith("open(LEGACY_CONFIG_FILE, \"w\"", i)]
    assert not write_positions, "legacy config.json 绝不能被写"


def test_main_py_reads_credentials_store_first():
    """main.py 的 cookie 来源优先级：统一凭据库 > legacy config.json 兜底。"""
    main_src = (Path(__file__).resolve().parent.parent / "main.py").read_text(encoding="utf-8")
    assert 'os.environ.get("ZHIHU_MCP_DATA_DIR")' in main_src, "main.py 必须与 Node/login 同语义读 DATA_DIR"
    # 兜底条件：只有凭据库无 cookie 时才读 legacy config
    assert "if not _credentials_cookie and os.path.exists(_config_path)" in main_src
