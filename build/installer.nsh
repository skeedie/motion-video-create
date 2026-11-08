; Lyric Studio installer hooks.
; The update must not depend on the old version's uninstaller: it fails when any file in the
; app folder is busy (leftover ffmpeg.exe, helper processes), and Windows then asks to reboot.
; So: close everything started from the app folder and write the new version over the old one.

!macro lsCloseAll
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /im "${APP_EXECUTABLE_FILENAME}" /t`
  Sleep 1200
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "${APP_EXECUTABLE_FILENAME}" /t`
  !ifndef BUILD_UNINSTALLER
    ; anything else running from the app folder (ffmpeg.exe and similar)
    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "Get-Process | Where-Object { $$_.Path -and $$_.Path.StartsWith('$INSTDIR', [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue"`
  !endif
  Sleep 800
!macroend

!macro lsSkipOldUninstaller
  ; without UninstallString the installer does not run the old uninstaller and simply overwrites the files;
  ; the new version writes fresh uninstall entries at the end of installation
  DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" "QuietUninstallString"
  DeleteRegValue HKLM "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  DeleteRegValue HKLM "${UNINSTALL_REGISTRY_KEY}" "QuietUninstallString"
  !ifdef UNINSTALL_REGISTRY_KEY_2
    DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
    DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY_2}" "QuietUninstallString"
    DeleteRegValue HKLM "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
    DeleteRegValue HKLM "${UNINSTALL_REGISTRY_KEY_2}" "QuietUninstallString"
  !endif
  ClearErrors
!macroend

!macro customCheckAppRunning
  !insertmacro lsCloseAll
  !ifndef BUILD_UNINSTALLER
    !insertmacro lsSkipOldUninstaller
  !endif
!macroend

; all-users install: the elevated instance does not call customCheckAppRunning, do the same here
!macro customInit
  !ifndef BUILD_UNINSTALLER
    ${If} ${UAC_IsInnerInstance}
      !insertmacro lsCloseAll
      !insertmacro lsSkipOldUninstaller
    ${EndIf}
  !endif
!macroend
