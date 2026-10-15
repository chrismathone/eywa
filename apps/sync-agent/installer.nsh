!macro customInstall
  CreateDirectory "$SMPROGRAMS\AYWA"
  CreateShortcut "$SMPROGRAMS\AYWA\AYWA 연동.lnk" "$INSTDIR\AywaSync.exe"
  CreateShortcut "$DESKTOP\AYWA 연동.lnk" "$INSTDIR\AywaSync.exe"
!macroend
!macro customUnInstall
  Delete "$DESKTOP\AYWA 연동.lnk"
  Delete "$SMPROGRAMS\AYWA\AYWA 연동.lnk"
  RMDir "$SMPROGRAMS\AYWA"
  ; app.setLoginItemSettings registers "electron.app.<product name>"; the old name was never written. Keep it on upgrades.
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.AYWA 연동"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "AYWA 연동"
  ${endIf}
!macroend
