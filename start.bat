@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo   ZhihuSpider - 一键启动
echo ========================================
echo.
echo  1. 登录并捕获 Cookie（首次使用）
echo  2. 爬取问题下的回答
echo  3. 爬取专栏文章
echo  4. 查看帮助
echo.
set /p sel="请选择 (1-4): "

if "%sel%"=="1" (
    python main.py login
) else if "%sel%"=="2" (
    set /p qid="请输入问题ID: "
    python main.py question %qid%
) else if "%sel%"=="3" (
    set /p aid="请输入文章ID: "
    python main.py article %aid%
) else if "%sel%"=="4" (
    python main.py config
) else (
    echo 无效输入
)
pause
