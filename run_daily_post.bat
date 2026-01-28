
@echo off
chcp 65001
cd /d "%~dp0"
echo Starting Daily Wikipedia Poster...
echo.
cd automation
node index.js %*
echo.
echo ==============================================
echo  Task Completed. Check the output above.
echo ==============================================
pause
