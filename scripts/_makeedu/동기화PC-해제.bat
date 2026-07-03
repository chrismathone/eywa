@echo off
chcp 65001 >nul
rem eywa makeedu sync PC - REMOVE this PC (delete scheduler tasks + stop running watcher).
rem Double-click to run. Korean UI is printed by setup-sync-pc.ps1 (UTF-8 safe).
rem Move the sync PC: run this REMOVE bat on the old PC, then the ASSIGN bat on the new PC.
rem NOTE: keep this .bat content ASCII-only. Korean bytes here desync cmd after chcp 65001.
cd /d "%~dp0"
echo.
echo  ===================================================
echo    [eywa] makeedu sync PC - REMOVE  (this PC: %COMPUTERNAME%)
echo  ===================================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-sync-pc.ps1" -Remove
echo.
echo  (Press any key to close this window)
pause >nul
