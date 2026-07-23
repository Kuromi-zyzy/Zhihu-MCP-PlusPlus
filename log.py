"""统一日志配置，替代散落的 print，便于追踪和定位。

用法（main.py 启动时调用一次）：
    from log import setup_logging
    setup_logging()

各模块按需获取自己的 logger：
    import logging
    log = logging.getLogger("zhihu.crawler")
    log.info("...")
    log.warning("...")
"""

import logging
import sys

_DEFAULT_FORMAT = "[%(levelname)s] %(name)s: %(message)s"


def setup_logging(level: int = logging.INFO) -> None:
    """配置根 logger。Windows 控制台 utf-8，幂等可重复调用。"""
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(level)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(_DEFAULT_FORMAT))
    root.addHandler(handler)


def get_logger(name: str) -> logging.Logger:
    """各模块取 logger 的快捷入口，名字建议 zhihu.<module>。"""
    return logging.getLogger(name)
