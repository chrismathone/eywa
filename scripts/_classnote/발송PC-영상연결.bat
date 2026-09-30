@echo off
chcp 65001 >nul
rem Run only on the existing ClassNote worker PC. Keep this file ASCII-only.
cd /d "%~dp0"
echo [aywa] Connect homework video archive on this worker PC
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-video-drive.ps1" -Account chrismathone@gmail.com -FolderId 1r4PhTUJoCqLdlbdfGN8IhnGrokKK5DmK -RestartWorker
if errorlevel 1 echo Setup did not finish. Read the message above before closing.
echo (Press any key to close this window)
pause >nul
