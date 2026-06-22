# MASTER SCHEDULE Tray Application
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$WORK_DIR  = "C:\schedule"
$NODE_CMD  = "node"
$SERVER_JS = "server.js"
$URL_LOCAL = "http://localhost:3000"
$URL_STAFF = "http://10.10.152.16:3000"

$script:serverProc = $null

function Start-Server {
    if ($script:serverProc -and !$script:serverProc.HasExited) { return }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName         = $NODE_CMD
    $psi.Arguments        = $SERVER_JS
    $psi.WorkingDirectory = $WORK_DIR
    $psi.WindowStyle      = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $psi.CreateNoWindow   = $true
    $psi.UseShellExecute  = $false
    $script:serverProc    = [System.Diagnostics.Process]::Start($psi)
    Update-TrayIcon
}

function Stop-Server {
    if ($script:serverProc -and !$script:serverProc.HasExited) {
        $script:serverProc.Kill()
        $script:serverProc.WaitForExit(3000)
    }
    $script:serverProc = $null
}

function Get-ServerStatus {
    if ($script:serverProc -and !$script:serverProc.HasExited) { return $true }
    return $false
}

function Update-TrayIcon {
    if (Get-ServerStatus) {
        $tray.Icon = [System.Drawing.SystemIcons]::Information
        $tray.Text = "MASTER SCHEDULE - Server Running"
    } else {
        $tray.Icon = [System.Drawing.SystemIcons]::Warning
        $tray.Text = "MASTER SCHEDULE - Server Stopped"
    }
}

# Tray icon
$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon    = [System.Drawing.SystemIcons]::Information
$tray.Text    = "MASTER SCHEDULE"
$tray.Visible = $true

# Context menu
$menu = New-Object System.Windows.Forms.ContextMenuStrip

$itemStatus = New-Object System.Windows.Forms.ToolStripMenuItem
$itemStatus.Text    = "● Server Running | localhost:3000"
$itemStatus.Enabled = $false
$itemStatus.Font    = New-Object System.Drawing.Font("Arial", 9, [System.Drawing.FontStyle]::Bold)
$menu.Items.Add($itemStatus) | Out-Null
$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$itemOpen = New-Object System.Windows.Forms.ToolStripMenuItem
$itemOpen.Text = "Open in Browser  (localhost:3000)"
$itemOpen.Add_Click({ Start-Process $URL_LOCAL })
$menu.Items.Add($itemOpen) | Out-Null

$itemCopy = New-Object System.Windows.Forms.ToolStripMenuItem
$itemCopy.Text = "Copy Staff URL  (10.10.152.16:3000)"
$itemCopy.Add_Click({
    [System.Windows.Forms.Clipboard]::SetText($URL_STAFF)
    $tray.ShowBalloonTip(1500, "MASTER SCHEDULE", "Copied: " + $URL_STAFF, [System.Windows.Forms.ToolTipIcon]::Info)
})
$menu.Items.Add($itemCopy) | Out-Null

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$itemRestart = New-Object System.Windows.Forms.ToolStripMenuItem
$itemRestart.Text = "Restart Server"
$itemRestart.Add_Click({
    Stop-Server
    Start-Sleep -Milliseconds 800
    Start-Server
    $tray.ShowBalloonTip(2000, "MASTER SCHEDULE", "Server restarted.", [System.Windows.Forms.ToolTipIcon]::Info)
    Update-MenuStatus
})
$menu.Items.Add($itemRestart) | Out-Null

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$itemExit = New-Object System.Windows.Forms.ToolStripMenuItem
$itemExit.Text = "Exit (Stop Server)"
$itemExit.Add_Click({
    $confirm = [System.Windows.Forms.MessageBox]::Show(
        "Stop the server and exit?",
        "MASTER SCHEDULE",
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Warning
    )
    if ($confirm -eq [System.Windows.Forms.DialogResult]::Yes) {
        Stop-Server
        $tray.Visible = $false
        $tray.Dispose()
        [System.Windows.Forms.Application]::Exit()
    }
})
$menu.Items.Add($itemExit) | Out-Null

function Update-MenuStatus {
    if (Get-ServerStatus) {
        $itemStatus.Text      = "● Server Running  |  localhost:3000"
        $itemStatus.ForeColor = [System.Drawing.Color]::Green
    } else {
        $itemStatus.Text      = "● Server Stopped"
        $itemStatus.ForeColor = [System.Drawing.Color]::Red
    }
}

$menu.Add_Opening({ Update-MenuStatus })
$tray.Add_DoubleClick({ Start-Process $URL_LOCAL })
$tray.ContextMenuStrip = $menu

# Start server
Start-Server
$tray.ShowBalloonTip(3000, "MASTER SCHEDULE", "Server started. Right-click tray icon for menu.", [System.Windows.Forms.ToolTipIcon]::Info)

# Watchdog timer (30s)
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 30000
$timer.Add_Tick({
    if (!(Get-ServerStatus)) {
        Start-Server
        $tray.ShowBalloonTip(2000, "MASTER SCHEDULE", "Server auto-restarted.", [System.Windows.Forms.ToolTipIcon]::Warning)
    }
    Update-TrayIcon
})
$timer.Start()

[System.Windows.Forms.Application]::Run()
