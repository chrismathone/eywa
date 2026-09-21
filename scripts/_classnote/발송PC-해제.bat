@echo off
chcp 65001 >nul
rem aywa ClassNote send PC - REMOVE this PC (delete scheduler task + stop running watcher).
rem Double-click to run. Korean UI is printed by setup-classnote-pc.ps1 (UTF-8 safe).
rem Move the send PC: run this REMOVE bat on the old PC, then the ASSIGN bat on the new PC.
rem NOTE: keep this .bat content ASCII-only. Korean bytes here desync cmd after chcp 65001.
cd /d "%~dp0"
echo.
echo  ===================================================
echo    [aywa] ClassNote send PC - REMOVE  (this PC: %COMPUTERNAME%)
echo  ===================================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-classnote-pc.ps1" -Remove
echo.
echo  (Press any key to close this window)
pause >nul
