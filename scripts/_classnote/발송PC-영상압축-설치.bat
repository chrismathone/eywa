@echo off
chcp 65001 >nul
rem Install ffmpeg for homework video compression on the ClassNote worker PC. Keep this file ASCII-only.
rem Run as the SAME Windows user that runs the worker: winget installs ffmpeg per user.
rem No worker restart is needed: the worker looks for ffmpeg again within 10 minutes.
cd /d "%~dp0"
echo [aywa] Install ffmpeg (homework video compression) on this worker PC
where winget >nul 2>nul
if errorlevel 1 (
  echo winget was not found. Install "App Installer" from Microsoft Store, then run this again.
  goto :end
)
winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
set "FF="
if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\ffmpeg.exe" set "FF=%LOCALAPPDATA%\Microsoft\WinGet\Links\ffmpeg.exe"
if not defined FF if exist "%ProgramFiles%\WinGet\Links\ffmpeg.exe" set "FF=%ProgramFiles%\WinGet\Links\ffmpeg.exe"
rem Accounts that cannot create links get the package folder on PATH instead. The worker also looks there.
if not defined FF for /d %%P in ("%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg*") do for /d %%B in ("%%P\ffmpeg-*") do if exist "%%B\bin\ffmpeg.exe" set "FF=%%B\bin\ffmpeg.exe"
if not defined FF (
  echo ffmpeg was not found after install. Read the message above before closing.
  goto :end
)
"%FF%" -hide_banner -version | findstr /b /c:"ffmpeg version"
echo Done. New homework videos will be compressed before Drive upload.
:end
echo (Press any key to close this window)
pause >nul
