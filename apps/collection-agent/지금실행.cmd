@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\AYWA\Collection\bin\Run.ps1"
if errorlevel 1 (echo Collection failed. Check status.json and the web connection status.) else (echo Collection check completed.)
pause
