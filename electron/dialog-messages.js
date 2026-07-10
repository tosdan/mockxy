// Stringhe dei dialoghi nativi dell'app desktop, nelle due lingue dell'interfaccia (it/en).
// L'app ha un selettore lingua: i dialoghi di sistema devono seguirlo, non restare in italiano.
// Modulo puro (niente Electron) così la completezza delle traduzioni è verificabile con Jest.

const MESSAGES = {
  it: {
    cancel: "Annulla",
    workspaceNotFoundTitle: "Workspace non trovato",
    workspaceNotFoundDetail: (root) => `La cartella non esiste più:\n${root}`,
    openFailedTitle: "Apertura workspace fallita",
    openDialogTitle: "Apri workspace",
    initTitle: "Inizializzare come workspace?",
    initMessage: (folderName) => `La cartella "${folderName}" non è ancora un workspace.`,
    initDetail: (root, markerFile) =>
      `Verrà inizializzata come workspace Mockxy qui:\n${root}\n\nDentro la cartella verranno creati ${markerFile}, la cartella mocks/ e una riga nel .gitignore.`,
    initConfirm: "Inizializza",
    closeTitle: "Chiudi workspace",
    closeMessage: (name) => `Chiudere il workspace "${name}"?`,
    closeDetail:
      "Il server del workspace verrà fermato. I mock restano su disco e puoi riaprirlo dai recenti.",
    closeConfirm: "Chiudi",
    removeRecentTitle: "Rimuovi dai recenti",
    removeRecentMessage: (name) => `Rimuovere "${name}" dai workspace recenti?`,
    removeRecentDetail:
      "Sparisce solo dall'elenco dei recenti: la cartella e i suoi mock restano su disco.",
    removeRecentConfirm: "Rimuovi",
    startupFailedTitle: "Avvio fallito",
  },
  en: {
    cancel: "Cancel",
    workspaceNotFoundTitle: "Workspace not found",
    workspaceNotFoundDetail: (root) => `The folder no longer exists:\n${root}`,
    openFailedTitle: "Failed to open workspace",
    openDialogTitle: "Open workspace",
    initTitle: "Initialize as a workspace?",
    initMessage: (folderName) => `The folder "${folderName}" is not a workspace yet.`,
    initDetail: (root, markerFile) =>
      `It will be initialized as a Mockxy workspace here:\n${root}\n\nInside the folder, ${markerFile}, a mocks/ folder and a .gitignore line will be created.`,
    initConfirm: "Initialize",
    closeTitle: "Close workspace",
    closeMessage: (name) => `Close the workspace "${name}"?`,
    closeDetail:
      "The workspace server will be stopped. Your mocks stay on disk and you can reopen it from the recent list.",
    closeConfirm: "Close",
    removeRecentTitle: "Remove from recents",
    removeRecentMessage: (name) => `Remove "${name}" from the recent workspaces?`,
    removeRecentDetail:
      "It only disappears from the recent list: the folder and its mocks stay on disk.",
    removeRecentConfirm: "Remove",
    startupFailedTitle: "Startup failed",
  },
};

// Restituisce il set di stringhe per la lingua; per lingue sconosciute ripiega sull'inglese.
function getDialogMessages(lang) {
  return MESSAGES[lang] || MESSAGES.en;
}

module.exports = { getDialogMessages, MESSAGES };
