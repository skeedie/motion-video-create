; Before installing or uninstalling: close Lyric Studio and anything else started from its folder
; (ffmpeg.exe and helper processes), so the old version's files are not locked.
!macro customCheckAppRunning
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /im "${APP_EXECUTABLE_FILENAME}" /t`
  Sleep 1000
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "${APP_EXECUTABLE_FILENAME}" /t`
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "Get-Process | Where-Object { $$_.Path -and $$_.Path.StartsWith('$INSTDIR', [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue"`
  Sleep 1500
!macroend
