@echo off
chcp 65001 >nul
rem eywa makeedu sync PC - STATUS (read-only: is a sync task registered/running on this PC?).
rem Double-click to run. Korean UI is printed by setup-sync-pc.ps1 (UTF-8 safe).
rem NOTE: keep this .bat content ASCII-only. Korean bytes here desync cmd after chcp 65001.
cd /d "%~dp0"
echo.
echo  ===================================================
echo    [eywa] makeedu sync PC - STATUS  (this PC: %COMPUTERNAME%)
echo  ===================================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-sync-pc.ps1" -Status
echo.
echo  (Press any key to close this window)
pause >nul
