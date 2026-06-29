@echo off
cd /d "%~dp0"
title Terminus Pro - AI Server

where node >nul 2>nul && goto RUN

echo [Terminus] Node.js is not installed.
where winget >nul 2>nul && goto WINGET
echo Please install Node.js LTS from https://nodejs.org then run this file again.
start "" https://nodejs.org/en/download
pause
exit /b

:WINGET
echo Installing Node.js LTS via winget...
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
echo.
echo Install finished. Please run this file again to start.
pause
exit /b

:RUN
echo Starting Terminus Pro AI server (port 3100)...
start "Terminus AI Server" cmd /c "node ai-server.js"
timeout /t 2 >nul
start "" "Terminus_master_schedule.html"
echo Opened. Keep the "Terminus AI Server" window open while using AI analysis.
timeout /t 3 >nul
exit /b
