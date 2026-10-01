# Mockxy 1.5.0

## Italiano

La 1.5.0 permette agli handler e ai middleware di importare helper condivisi dalla radice
della cartella dei mock. I workspace esistenti restano compatibili: nessuna migrazione
obbligatoria e nessun cambiamento dell'admin API.

```js
module.exports = {
  resolveResponse: require("_shared/ravvedimento-flusso").annulla,
};
```

- **Lo stesso riferimento a qualsiasi profondità:** copiando un endpoint verso un'altra
  rotta, l'import dalla radice continua a trovare lo stesso helper. I vecchi `require`
  relativi restano supportati; possono essere aggiornati gradualmente.
- **Reload degli helper condivisi:** le modifiche agli helper e alle loro dipendenze
  locali ricaricano gli script che li usano.
- **Limiti:** gli import dalla radice valgono per lo script handler o middleware di primo
  livello. Gli helper si importano tra loro con percorsi relativi; i pacchetti in
  `node_modules` mantengono la precedenza. Spostare o rinominare un helper richiede ancora
  l'aggiornamento dei suoi riferimenti.
- **Skill per versione:** la procedura allinea le tag del motore, delle skill e dei test
  di accettazione. Installare le skill dalla tag corrispondente evita di usare istruzioni
  per funzioni non presenti nel proprio motore.

[Guida handler](https://github.com/tosdan/mockxy/blob/v1.5.0/docs/it/HANDLER.md#helper-condivisi-tra-pi%C3%B9-mock)
· [Skill](https://github.com/tosdan/mockxy-skills)
· [Note dettagliate](https://github.com/tosdan/mockxy/blob/v1.5.0/docs/progetto/NOTE-RILASCIO-next.md#v150)

## English

Version 1.5.0 lets handlers and middleware import shared helpers from the root of the mocks
directory. Existing workspaces remain compatible: no mandatory migration and no admin API
changes.

```js
module.exports = {
  resolveResponse: require("_shared/ravvedimento-flusso").annulla,
};
```

- **The same reference at any depth:** copying an endpoint to another route preserves
  root imports. Existing relative `require` calls remain supported and can be updated
  gradually.
- **Shared-helper reload:** changes to helpers and their local dependencies reload the
  scripts using them.
- **Limits:** root imports apply to the top-level handler or middleware script. Helpers
  import each other with relative paths; packages in `node_modules` retain precedence.
  Moving or renaming a helper still requires updating its references.
- **Versioned skills:** the release procedure aligns engine, skills and acceptance-suite
  tags. Installing skills from the matching tag avoids instructions for features absent
  from the installed engine.

[Handler guide](https://github.com/tosdan/mockxy/blob/v1.5.0/docs/en/HANDLER.md#helpers-shared-across-mocks)
· [Skills](https://github.com/tosdan/mockxy-skills)
· [Detailed release notes (Italian)](https://github.com/tosdan/mockxy/blob/v1.5.0/docs/progetto/NOTE-RILASCIO-next.md#v150)

## Download

- **Windows x64:** `Mockxy-1.5.0-portable.exe`
- **Linux x64:** `Mockxy-1.5.0-x86_64.AppImage`
- **SHA-256:** `SHA256SUMS.txt`

[All changes / Tutte le modifiche](https://github.com/tosdan/mockxy/compare/v1.4.2...v1.5.0)
