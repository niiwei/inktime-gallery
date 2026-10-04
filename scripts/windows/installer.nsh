!macro customUnInstall
  ; The scheduled task is machine-independent and belongs to the current user.
  ; Keep the application data directory so uninstall does not delete the photo library.
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\app.asar.unpacked\scripts\windows\uninstall-wallpaper-task.ps1" -TaskName "InkTime Gallery Wallpaper"'
!macroend
