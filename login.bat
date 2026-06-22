@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在打开浏览器，请在知乎页面扫码登录...
python main.py login
pause
