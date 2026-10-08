!macro customInstall
  CreateDirectory "$SMPROGRAMS\AYWA"
  CreateShortcut "$SMPROGRAMS\AYWA\AYWA 연동.lnk" "$INSTDIR\AywaSync.exe"
  CreateShortcut "$DESKTOP\AYWA 연동.lnk" "$INSTDIR\AywaSync.exe"
!macroend
!macro customUnInstall
  Delete "$DESKTOP\AYWA 연동.lnk"
  Delete "$SMPROGRAMS\AYWA\AYWA 연동.lnk"
  RMDir "$SMPROGRAMS\AYWA"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "AYWA 연동"
!macroend
