@echo off
chcp 65001 >nul
rem aywa ClassNote send PC - FIX BASE URL typo in .env.local, then restart daemon.
rem Double-click to run. Korean UI is printed by fix-classnote-base.ps1 (UTF-8 safe).
rem Background: SCREENSHOT_BASE was mistyped "eywa-alpha-vercel.app" (hyphen) instead of
rem "eywa-alpha.vercel.app" (dot) - worker screenshot failed with ERR_NAME_NOT_RESOLVED.
rem NOTE: keep this .bat content ASCII-only. Korean bytes here desync cmd after chcp 65001.
cd /d "%~dp0"
echo.
echo  ===================================================
echo    [aywa] ClassNote send PC - FIX BASE URL  (this PC: %COMPUTERNAME%)
echo  ===================================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0fix-classnote-base.ps1"
echo.
echo  (Press any key to close this window)
pause >nul
