; Close running Lyric Studio (all its processes) automatically instead of asking the user
!macro customCheckAppRunning
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /im "${APP_EXECUTABLE_FILENAME}" /t`
  Sleep 1500
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "${APP_EXECUTABLE_FILENAME}" /t`
  Sleep 1000
!macroend
