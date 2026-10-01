# Verifica del rilascio 1.5.0

Verifiche del 1 ottobre 2026. La release stabile
[Mockxy 1.5.0](https://github.com/tosdan/mockxy/releases/tag/v1.5.0) è pubblicata.
Il commit del motore è `b8a3236fbec9add0de9e81ee782bde3b1cb4042c`, con tag
`v1.5.0`. Questo documento non modifica la tag né gli artefatti.

## Preparazione e test locali

- Root, GUI ed Electron allineati alla 1.5.0 nei sei file di versione.
  `check:versions`, `check:release-tag -- v1.5.0`, `check:admin-openapi` e
  `git diff --check` passati.
- Motore e moduli Electron: **93 suite, 1.101 test passati**.
- GUI: **41 file, 526 test passati**.
- E2E Chromium, con build desktop: **119 test passati senza retry**.
- Il primo giro con backend e GUI contemporanei aveva timeout e un worker
  terminato. Le suite sono state rieseguite separatamente; per la GUI sono
  stati usati un worker Vitest e due worker di build, con configurazione
  temporanea esterna al repository. Nessun test o timeout è stato modificato.
- Validatore delle skill sul commit associato alla release: **8 test passati**.

## Pipeline e artefatti

- [Pipeline della tag](https://github.com/tosdan/mockxy/actions/runs/36894069109):
  tutti i cinque job passati, inclusi test, portable Windows x64, AppImage Linux
  x64 e creazione della bozza.
- [CI ordinaria](https://github.com/tosdan/mockxy/actions/runs/36894066174):
  passata sullo stesso commit, inclusi i test del motore su Windows.
- [Accettazione esterna](https://github.com/tosdan/mockxy/actions/runs/36894066076):
  **197 test passati**, sul commit esatto della tag del motore e con la suite
  `bc941948b3b6888d25c2092320cc2ddc44f80a85`.
- Il bundle `release-assets-v1.5.0` contiene i tre allegati attesi. Entrambi
  i checksum sono verificati; l'AppImage collaudato coincide con quello del
  bundle finale e con l'allegato pubblicato.

| Artefatto | SHA-256 |
| --- | --- |
| `Mockxy-1.5.0-portable.exe` | `84fe0c99e41ad7ad01b20f09583c9da46e835eac4efedb00ec4d1dfcdb1dd751` |
| `Mockxy-1.5.0-x86_64.AppImage` | `659148ef8f72dac24e1fa668a60850a504d955bf8ad18b7e791fddaf2fabc37b` |

## Collaudo Linux

GUI e motore dell'AppImage scaricato sono stati eseguiti su display virtuale,
con workspace e preferenze temporanei. Il controllo Electron automatizzato
usa l'eseguibile estratto dall'AppImage.

- App e `/info` riportano **1.5.0**.
- Il workspace si apre e viene ripristinato alla riapertura dell'app.
- Un handler importa `_shared/flow`, che carica a sua volta una dipendenza
  relativa. L'endpoint risponde correttamente anche dopo Copy a maggiore profondità.
- Gli hash delle definizioni originali restano invariati.
- Gli identificativi SSE/WS nello spec sono interi; la creazione di un mock
  da una cattura esclude l'header runtime `x-mock-source`.
- Il controllo aggiornamenti reale restituisce `up-to-date`, versione corrente
  1.5.0, ultima pubblica 1.4.2 e canale `appimage`: risultato atteso prima della
  pubblicazione della nuova release.

## Collaudo Windows

La [prova automatizzata su Windows](https://github.com/tosdan/mockxy/actions/runs/36894817138)
è passata su `windows-latest`, lanciando direttamente
`Mockxy-1.5.0-portable.exe` dal bundle finale dopo la verifica del checksum.
Il ramo temporaneo di verifica non modifica il codice alla tag della release.

- Il motore pacchettizzato riporta **1.5.0**.
- Apertura del workspace e ripristino della sessione dopo chiusura e riavvio
  della portable verificati, con preferenze salvate accanto all'eseguibile.
- Import dalla radice, dipendenza relativa dell'helper e Copy a maggiore
  profondità verificati prima e dopo il riavvio. Gli script originali non cambiano.
- Il controllo aggiornamenti reale restituisce `up-to-date`, versione corrente
  1.5.0, ultima pubblica 1.4.2 e canale `portable`.
- Il run conserva report JSON, screenshot delle due aperture e log nel bundle
  `portable-1.5.0-smoke-evidence`.

## Pubblicazione e allineamento

Le [note curate in italiano e inglese](NOTE-RILASCIO-v1.5.0.md) sono inserite
nella release pubblica. La pipeline ordinaria continua a creare soltanto bozze.
Per questa pubblicazione è stato avviato un
[job dedicato](https://github.com/tosdan/mockxy/actions/runs/36896173600)
dopo i collaudi: verifica i quattro run verdi, il commit della tag e gli
allegati prima di pubblicare. È stato necessario perché il token CLI locale
non può modificare le bozze e il browser disponibile non è autenticato.

Le tre tag semplici `v1.5.0` identificano:

| Repository | Commit |
| --- | --- |
| mockxy | `b8a3236fbec9add0de9e81ee782bde3b1cb4042c` |
| mockxy-skills | `483b2cb2f772b0c146f53e98d0a962e174516dd8` |
| mockxy-acceptance-tests | `bc941948b3b6888d25c2092320cc2ddc44f80a85` |

Il commit della suite è lo stesso della tag `v1.4.2`, ma la verifica dei
197 test è stata rieseguita sul motore alla tag `v1.5.0`.

La discovery del comando seguente trova le quattro skill alla tag `v1.5.0`.
Il controllo aggiornamenti sul canale stabile, dopo la pubblicazione, restituisce
`available` e `latestVersion: "1.5.0"` per un client con versione `1.4.2`.

Installazione delle skill corrispondenti:

```bash
npx skills@latest add https://github.com/tosdan/mockxy-skills/tree/v1.5.0
```
