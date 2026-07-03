@echo off
chcp 65001 >nul
rem eywa makeedu sync PC - ASSIGN this PC (register + start scheduler tasks).
rem Double-click to run. Korean UI is printed by setup-sync-pc.ps1 (UTF-8 safe).
rem Move the sync PC: run the REMOVE bat on the old PC, then this ASSIGN bat on the new PC.
rem NOTE: keep this .bat content ASCII-only. Korean bytes here desync cmd after chcp 65001.
cd /d "%~dp0"
echo.
echo  ===================================================
echo    [eywa] makeedu sync PC - ASSIGN  (this PC: %COMPUTERNAME%)
echo  ===================================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-sync-pc.ps1"
echo.
echo  (Press any key to close this window)
pause >nul
