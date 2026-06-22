@echo off
title MASTER SCHEDULE - Remove
color 4F
echo.
echo  ==========================================
echo   MASTER SCHEDULE Auto Start Remove
echo  ==========================================
echo.

taskkill /F /IM wscript.exe >nul 2>&1

if exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\MasterSchedule.lnk" (
    del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\MasterSchedule.lnk"
    echo  [OK] Startup removed
) else (
    echo  [--] Not registered
)
echo.
pause
