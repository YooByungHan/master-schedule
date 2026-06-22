' ============================================
'  MASTER SCHEDULE — 무창 실행기
'  PowerShell 창 없이 트레이 앱 실행
'  위치: C:\schedule\schedule_tray.vbs
' ============================================
Dim shell
Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\schedule\schedule_tray.ps1""", 0, False
Set shell = Nothing
