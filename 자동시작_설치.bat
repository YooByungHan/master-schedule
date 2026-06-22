@echo off
title MASTER SCHEDULE - Install
color 1F

echo.
echo  ==========================================
echo   MASTER SCHEDULE Auto Start Install
echo  ==========================================
echo.
echo  [1] Check files...

if exist "C:\schedule\schedule_tray.ps1" (
    echo      schedule_tray.ps1 : OK
) else (
    echo      schedule_tray.ps1 : NOT FOUND
    echo      Please copy to C:\schedule\
    pause & exit
)

if exist "C:\schedule\schedule_tray.vbs" (
    echo      schedule_tray.vbs : OK
) else (
    echo      schedule_tray.vbs : NOT FOUND
    echo      Please copy to C:\schedule\
    pause & exit
)

echo.
echo  [2] Register startup...

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ws=New-Object -ComObject WScript.Shell;$lnk=$ws.CreateShortcut($env:APPDATA+'\Microsoft\Windows\Start Menu\Programs\Startup\MasterSchedule.lnk');$lnk.TargetPath='C:\schedule\schedule_tray.vbs';$lnk.WorkingDirectory='C:\schedule';$lnk.Save()"

if exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\MasterSchedule.lnk" (
    echo      SUCCESS - Startup registered
) else (
    echo      FAILED - Startup not registered
)

echo.
echo  [3] Launch tray app now...
wscript.exe "C:\schedule\schedule_tray.vbs"

echo.
echo  ==========================================
echo   Done! Check tray icon (bottom right ^)
echo  ==========================================
echo.
pause
