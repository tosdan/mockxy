# Risoluzione dei problemi di sviluppo

Problemi che riguardano chi lavora **sul codice di Mockxy** (ambiente, test, build), non chi lo
usa: per i sintomi a runtime del prodotto c'è [la pagina di troubleshooting](../it/TROUBLESHOOTING.md).

## `npm test` esce con `-1073740791` (0xC0000409) a caso, senza alcun output — Node 24.15.0

**Sintomo.** Su Windows la suite (tipicamente quella grossa, `admin-api.integration`) muore
in modo **intermittente** (~1 run su 5) con exit code `-1073740791` (0xC0000409, un fastfail
nativo), in un punto **diverso a ogni occorrenza**. Nessun output utile: il crash azzera i
buffer di jest e non produce né messaggi di assert, né eventi WER, né dump (Node sopprime
l'error reporting di Windows).

**Causa.** Regressione di **Node 24.15.0** su Windows, non del codice del repo: a parità di
tutto, 25+ run consecutive su Node 22.23.1 e su Node 24.18.0 non crashano mai, mentre la
24.15.0 crasha ~1 volta su 5 — anche sul codice di commit precedenti e anche senza
`--experimental-vm-modules`. Combacia con [nodejs/node#62991](https://github.com/nodejs/node/issues/62991)
(crash nativi intermittenti su Windows introdotti proprio dalla 24.15.0, attribuiti a una
modifica al pooling dei buffer e a un cherry-pick di V8; la 24.14.1 e le patch successive
sono pulite).

**Rimedio.** Il progetto pinna Node **24.18.0** via Volta (campo `volta` in `package.json`):
chi usa Volta è a posto automaticamente. Chi non lo usa: qualunque Node ≥ 24.16 va bene —
l'importante è **non usare la 24.15.0** per lanciare i test. La CI non è affetta
(`node-version: 24` risolve sempre l'ultima patch).

**Diagnosi rapida.** Se la suite muore senza summary, controlla `node --version`: se è
`v24.15.0`, è quasi certamente questo. Per confermare il carattere intermittente, rilancia in
loop: il crash cambia punto a ogni occorrenza (non è mai lo stesso test).

## `npm test` muore con un assert di libuv (`fs-event.c`) su Windows

**Sintomo.** La suite si interrompe di colpo, senza il riepilogo di Jest, con:

```
Assertion failed: !_wcsnicmp(filename, dir, dirlen), file src\win\fs-event.c, line 72
```

Il colpevole è `test/watch.integration.test.js` (l'unico che avvia il watcher del filesystem),
ma l'assert abbatte l'intero processo, quindi non si vede nemmeno quali altri test sarebbero
passati. Il comportamento può essere **diverso da terminale a terminale sulla stessa macchina**
(vedi sotto il perché).

**Causa.** Il watcher di libuv (usato da chokidar via `fs.watch`) ha un bug noto su Windows:
se la directory osservata contiene un componente in **forma corta 8.3** (es.
`C:\Users\MARIOR~1.ROS\...`), gli eventi arrivano con il nome **lungo**
(`C:\Users\mario.rossi\...`), il confronto di prefisso interno fallisce e l'assert termina il
processo. I test creano le cartelle temporanee in `os.tmpdir()`: se `TEMP`/`TMP` valgono un
percorso in forma corta, il watcher del test osserva una cartella 8.3 → crash.

Da dove salta fuori la forma corta, se nel pannello delle variabili d'ambiente `TEMP` è
`%USERPROFILE%\AppData\Local\Temp`? L'espansione avviene **una volta sola**, quando un processo
costruisce il proprio blocco d'ambiente: se un antenato della shell (un launcher, un'app che ha
avviato il terminale) aveva `USERPROFILE` in forma corta in quel momento, la stringa corta viene
ereditata letteralmente da tutti i discendenti. Per questo un terminale aperto in un altro modo
può avere la `TEMP` lunga e non riprodurre il crash. Serve inoltre uno **username più lungo di 8
caratteri** (o con caratteri fuori dal set 8.3): solo allora la cartella profilo ha un alias
corto (`mario.rossi` → `MARIOR~1.ROS`); con uno username corto il problema non può presentarsi.

**Diagnosi rapida** (PowerShell):

```powershell
$env:TEMP                                                  # ereditata dal processo
[System.Environment]::GetEnvironmentVariable('TEMP','User') # espansa ora dal registro
```

Se la prima è in forma corta e la seconda no, sei nel caso descritto.

**Come è mitigato nel repo.**

- `createTempDir` in `test/helpers.js` canonicalizza con `fs.promises.realpath` la cartella
  appena creata: qualunque alias 8.3 viene espanso e tutti i test lavorano su percorsi lunghi.
- Il motore fa lo stesso in `startMockWatcher` (`src/server.js`) con
  `fs.realpathSync.native` prima di avviare chokidar, così anche un **utente reale** che lancia
  Mockxy con una `mocksDir` in forma corta non subisce il crash del server in modalità watch.

Attenzione alla trappola delle API: la `realpath` "JS" di Node (`fs.realpathSync` senza
`.native`) risolve i symlink ma **non espande gli alias 8.3**; servono `fs.realpathSync.native`
o `fs.promises.realpath` (che usa la semantica nativa).
