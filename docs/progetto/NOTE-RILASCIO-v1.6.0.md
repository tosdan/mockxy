# Mockxy 1.6.0

## Italiano

La 1.6.0 cambia il modo di importare gli helper condivisi tra mock e ricompila gli script a ogni
ricarica. **Richiede un intervento solo ai workspace che usano `require("_shared/…")`, la forma
introdotta nella 1.5.0:** quella forma è ritirata. I `require` relativi continuano a funzionare.

```js
const { annulla } = require("#shared/ravvedimento/flusso.js");

module.exports = { resolveResponse: annulla };
```

- **Alias `#shared/`:** gli helper stanno in `mocks/_shared/` e si importano con
  `require("#shared/….js")`. L'import è lo stesso a qualsiasi profondità e vale in handler,
  middleware e helper. È l'alias nativo di Node, definito da `mocks/package.json`: Mockxy crea il
  file al primo script del workspace, se manca, e non riscrive mai un file già presente. Va
  versionato insieme ai mock.
- **Ritirato `require("_shared/…")`:** funzionava solo per lo script caricato direttamente dal
  motore e falliva quando un handler era riusato da un'altra variante o da un helper. Uno script
  che lo usa non si carica più; il messaggio indica la sostituzione.
- **Come migrare:** sostituire `require("_shared/nome")` con `require("#shared/nome.js")`,
  estensione compresa, e versionare `mocks/package.json`. Se quel file viene aggiunto o modificato
  mentre Mockxy è in esecuzione serve un riavvio; nell'app desktop va riavviata l'app.
- **Ricarica senza cache:** a ogni ricarica il motore ricompila tutti gli script selezionati.
  Il riconoscimento delle modifiche non dipende più da data e dimensione dei file, che in alcuni
  casi lasciava serviti dati non aggiornati. `state`, `sharedState`, sequenze e connessioni SSE e
  WebSocket si conservano come prima.
- **Contratto degli script:** poche regole rendono sicura la ricompilazione, tra cui `require`
  locali in cima al modulo con l'estensione e stato solo in `state` e `sharedState`. Chi non le
  rispetta non viene bloccato: le violazioni compaiono come avvisi al salvataggio e nella barra
  di stato dell'app.
- **Validazione completa:** `node index.js validate <workspace>` controlla tutti gli script,
  compresi quelli degli endpoint disabilitati e delle varianti non selezionate, senza avviare il
  server. Qui le violazioni del contratto sono errori. La stessa verifica è la rotta
  `POST /_admin/api/scripts/validate`.
- **Admin API:** `GET /runtime/status` e le risposte ai salvataggi degli script hanno un campo
  `warnings` in più. Un client che confronta le risposte per uguaglianza esatta deve tenerne
  conto.
- **Perché una minor:** il ritiro di una sintassi chiederebbe una versione major. È un'eccezione
  dichiarata: la forma ritirata è esistita solo nella 1.5.0 ed era difettosa proprio nei casi
  d'uso reali.
- **Skill:** le skill alla tag `v1.6.0` descrivono l'alias, il contratto e la validazione.

[Guida handler](https://github.com/tosdan/mockxy/blob/v1.6.0/docs/it/HANDLER.md#helper-condivisi-tra-pi%C3%B9-mock)
· [Contratto degli script](https://github.com/tosdan/mockxy/blob/v1.6.0/docs/it/HANDLER.md#il-contratto-degli-script)
· [Skill](https://github.com/tosdan/mockxy-skills)
· [Note dettagliate](https://github.com/tosdan/mockxy/blob/v1.6.0/docs/progetto/NOTE-RILASCIO-next.md#v160)

## English

Version 1.6.0 changes how mocks import shared helpers and recompiles scripts at every reload.
**Only workspaces using `require("_shared/…")`, the form introduced in 1.5.0, need a change:**
that form is withdrawn. Relative `require` calls keep working.

```js
const { annulla } = require("#shared/ravvedimento/flusso.js");

module.exports = { resolveResponse: annulla };
```

- **`#shared/` alias:** helpers live in `mocks/_shared/` and are imported with
  `require("#shared/….js")`. The import is the same at any depth and works in handlers,
  middleware and helpers. It is Node's native alias, defined by `mocks/package.json`: Mockxy
  creates the file at the first script of the workspace when it is missing, and never rewrites an
  existing one. Commit it together with the mocks.
- **`require("_shared/…")` withdrawn:** it worked only for a script the engine loaded directly
  and failed when a handler was reused by another variant or by a helper. A script using it no
  longer loads; the message names the replacement.
- **How to migrate:** replace `require("_shared/name")` with `require("#shared/name.js")`,
  extension included, and commit `mocks/package.json`. If that file is added or changed while
  Mockxy is running, a restart is needed; in the desktop app, restart the app.
- **Reload without a cache:** at every reload the engine recompiles all selected scripts.
  Detecting a change no longer depends on file time and size, which in some cases left stale data
  being served. `state`, `sharedState`, sequences and SSE and WebSocket connections are kept as
  before.
- **Script contract:** a few rules make recompilation safe, among them local `require` calls at
  the top of the module with the extension, and state only in `state` and `sharedState`. Scripts
  that break them are not blocked: violations show up as warnings on save and in the app's
  status bar.
- **Full validation:** `node index.js validate <workspace>` checks every script, including those
  of disabled endpoints and unselected variants, without starting the server. Here contract
  violations are errors. The same check is the `POST /_admin/api/scripts/validate` route.
- **Admin API:** `GET /runtime/status` and the responses to script saves have one more field,
  `warnings`. A client comparing responses for exact equality must take it into account.
- **Why a minor:** withdrawing a syntax would call for a major version. This is a declared
  exception: the withdrawn form existed only in 1.5.0 and was defective in the very cases it was
  meant for.
- **Skills:** the skills at tag `v1.6.0` describe the alias, the contract and the validation.

[Handler guide](https://github.com/tosdan/mockxy/blob/v1.6.0/docs/en/HANDLER.md#helpers-shared-across-mocks)
· [Script contract](https://github.com/tosdan/mockxy/blob/v1.6.0/docs/en/HANDLER.md#the-script-contract)
· [Skills](https://github.com/tosdan/mockxy-skills)
· [Detailed release notes (Italian)](https://github.com/tosdan/mockxy/blob/v1.6.0/docs/progetto/NOTE-RILASCIO-next.md#v160)

## Download

- **Windows x64:** `Mockxy-1.6.0-portable.exe`
- **Linux x64:** `Mockxy-1.6.0-x86_64.AppImage`
- **SHA-256:** `SHA256SUMS.txt`

[All changes / Tutte le modifiche](https://github.com/tosdan/mockxy/compare/v1.5.0...v1.6.0)
