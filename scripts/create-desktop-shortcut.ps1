$WshShell = New-Object -comObject WScript.Shell
$desktopPath = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopPath "God's Eye View.lnk"
$Shortcut = $WshShell.CreateShortcut($shortcutPath)
$Shortcut.TargetPath = "C:\workspace\gods-eye-view\node_modules\electron\dist\electron.exe"
$Shortcut.Arguments = "C:\workspace\gods-eye-view"
$Shortcut.WorkingDirectory = "C:\workspace\gods-eye-view"
$Shortcut.Description = "God's Eye View - Native Situation Room App"
$Shortcut.Save()
Write-Host "Desktop shortcut created at $shortcutPath"
