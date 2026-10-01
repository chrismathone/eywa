@echo off
chcp 65001 >nul
rem Run only on the existing ClassNote worker PC. Keep this file ASCII-only.
rem Needs aywa-video-oauth.txt (made on another PC) in the Downloads folder. No Google login or Cloud CLI on this PC.
cd /d "%~dp0"
echo [aywa] Connect homework video archive on this worker PC (OAuth values file)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-video-drive-oauth.ps1" %*
if errorlevel 1 echo Setup did not finish. Read the message above before closing.
echo (Press any key to close this window)
pause >nul
