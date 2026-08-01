; Personalizzazione circoscritta dell'installer one-click. Mantiene il flusso standard di
; electron-builder, aggiungendo soltanto una conferma iniziale e il collegamento di recupero.

LangString mockxyInstallConfirmation 1033 "Install Mockxy for the current user?$\r$\nNo administrator privileges are required."
LangString mockxyInstallConfirmation 1040 "Installare Mockxy per l'utente corrente?$\r$\nNon sono richiesti privilegi di amministratore."
LangString mockxyRecoveryShortcutName 1033 "Mockxy - start without workspaces"
LangString mockxyRecoveryShortcutName 1040 "Mockxy - avvio senza workspace"
LangString mockxyRecoveryShortcutDescription 1033 "Start Mockxy without reopening the saved workspaces"
LangString mockxyRecoveryShortcutDescription 1040 "Avvia Mockxy senza riaprire i workspace salvati"

!macro customInit
  ${IfNot} ${Silent}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "$(mockxyInstallConfirmation)" IDYES mockxy_confirm_install
    Abort
    mockxy_confirm_install:
  ${EndIf}
!macroend

!macro customInstall
  StrCpy $R0 "$SMPROGRAMS\$(mockxyRecoveryShortcutName).lnk"
  CreateShortCut "$R0" "$appExe" "--no-restore-workspaces" "$appExe" 0 "" "" "$(mockxyRecoveryShortcutDescription)"
  ClearErrors
  ; Un'identità diversa impedisce a Windows 11 di deduplicare questa voce con l'avvio normale.
  WinShell::SetLnkAUMI "$R0" "${APP_ID}.recovery"
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "MockxyRecoveryShortcut" "$R0"
!macroend

!macro customUnInstall
  ReadRegStr $R0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "MockxyRecoveryShortcut"
  ${If} $R0 != ""
    WinShell::UninstShortcut "$R0"
    Delete "$R0"
  ${EndIf}
!macroend
