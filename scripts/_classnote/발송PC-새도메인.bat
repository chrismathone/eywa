@echo off
chcp 65001 >nul
rem aywa ClassNote send PC - set report link domain to https://www.aywa.co.kr, pin tenant, restart daemons.
rem Double-click to run. Korean UI is printed by set-share-domain.ps1 (UTF-8 safe).
rem NOTE: keep this .bat content ASCII-only. Korean bytes here desync cmd after chcp 65001.
cd /d "%~dp0"
echo.
echo  ===================================================
echo    [aywa] ClassNote send PC - NEW DOMAIN  (this PC: %COMPUTERNAME%)
echo  ===================================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0set-share-domain.ps1"
echo.
echo  (Press any key to close this window)
pause >nul
