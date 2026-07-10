# Architettura dei server per i test e2e — indagine sul guasto di `ng serve`

Nota di decisione (ADR) scritta il 6 lug 2026, durante la stesura dei test end-to-end Playwright
(vedi `archived/PIANO-E2E.md`, punto E10). Documenta il guasto osservato con `ng serve`, le **due indagini**
che lo hanno sezionato, e la scelta dell'architettura. Storia delle revisioni: la prima stesura
diceva "causa non confermata"; l'indagine 1 (esperimento controllato) ha isolato il fattore
scatenante *apparente* (riuso di server orfani); i dati successivi hanno mostrato che non bastava
(morte anche a metà run con server fresco); **l'indagine 2 (harness strumentato, in fondo) ha
catturato il guasto in flagrante e ne ha stabilito la causa radice: terminazione esterna silenziosa
dell'intero albero di processi, con ogni indizio che punta al modulo comportamentale
dell'antivirus (Bitdefender ATC).**

---

## Cosa deve fare la suite e2e

Gli e2e guidano un browser vero contro l'app vera: serve **il backend** (Node/Express, API sotto
`/_admin/api`) e **la UI** (Angular). Le due parti devono parlarsi come in produzione — è il contratto
HTTP che le suite unitarie (con stub) non esercitano.

## Prima architettura (E0→E9): `ng serve` + proxy

Due processi avviati da Playwright (`webServer`): backend `node index.js` su `:3101`; UI
`ng serve --port 4301 --proxy-config proxy.e2e.conf.json` (proxa `/_admin/api` → `:3101`). Scelta
iniziale per l'hot reload durante la scrittura dei test.

## Il problema osservato

Ogni file di spec isolato: verde. Al **run completo** (54 test, ~1–2 min) la suite diventava
inaffidabile in modo **intermittente**: un run 51/54, il successivo 28/54 con **25**
`net::ERR_CONNECTION_REFUSED` su `:4301`. Caratteristiche: nulla ascolta più sulla porta della UI
(il processo `ng serve` è morto), fallimenti concentrati **verso la fine** del run, **nessun crash
esplicito** nei log.

## L'indagine (esperimento controllato)

Per non condannare `ng serve` su un'ipotesi, ho riprodotto il guasto variando **un fattore per
volta**, con la stessa suite (path di navigazione reso parametrico via `E2E_UI_PATH`) e l'output dei
server catturato. Condizioni originali riprodotte: due `ng serve` attivi (il preview di sviluppo +
quello e2e), macchina invariata.

| Configurazione | Run con `ERR_CONNECTION_REFUSED` |
|---|---|
| `ng serve` avviato **a mano** (fuori dal `webServer` di Playwright) | **0 / 3** |
| Playwright `webServer` + `reuseExistingServer: **true**` (come l'originale) | **1 / 4** (10 refused in un run) |
| Playwright `webServer` + `reuseExistingServer: **false**` | **0 / 4** |

### Cosa è stato ESCLUSO (con dati, non congetture)

- **Memoria.** Macchina con **125,7 GB** di RAM, **~87 GB liberi** durante i test. Nessun OOM
  possibile. (L'ipotesi iniziale "due `ng serve` saturano la RAM" era **falsa**.)
- **`ng serve` instabile di suo.** Gestito **a mano**, sotto lo stesso carico Playwright, ha retto
  **3 run su 3** senza un solo refused. E con `reuseExistingServer: false` ha retto **4 su 4**. Il
  dev server non è il problema.
- **Il carico dei test.** Identico nelle tre configurazioni; regge in due su tre.

### La conclusione dell'indagine 1 (poi rivista dall'indagine 2)

Il refused compariva **solo** con `webServer` + **`reuseExistingServer: true`**. Meccanismo ricostruito
allora:

1. Playwright avvia `ng serve` tramite una **catena di processi** `npm.cmd → node(npm) → node(ng)
   → esbuild`. Su Windows la terminazione dei processi **figli/nipoti** non è pulita: alla fine di un
   run può restare un `ng serve` **orfano** in ascolto sulla porta.
2. `reuseExistingServer: true` fa sì che il run **successivo riusi** quell'orfano invece di avviarne
   uno fresco.
3. L'orfano moriva **a metà** del run che lo stava riusando → `ERR_CONNECTION_REFUSED` sui test
   restanti.

La lettura di allora ("non era `ng serve`, era il riuso di un orfano") spiegava la correlazione con
`reuse:true`, ma il passo 3 attribuiva la morte dell'orfano a una "pulizia dell'OS" — che era una
**congettura**: Windows non raccoglie i processi orfani. L'indagine 2 (in fondo) ha poi mostrato che
la morte a metà run colpisce **anche i server freschi**, e ne ha catturato la vera natura.

## Rivalutazione onesta

Questo cambia il quadro rispetto alla prima stesura. La vecchia architettura **non era
irrimediabilmente rotta**: sarebbe bastato `reuseExistingServer: false` (server fresco a ogni run)
per renderla affidabile — dimostrato, 4 run su 4 puliti. Quindi la scelta tra le due architetture è
un **trade-off di merito**, non "una funziona e l'altra no".

### Opzione A — tornare a `ng serve` con `reuseExistingServer: false`

- ➕ hot reload del dev server (irrilevante per e2e, che non sviluppano la UI);
- ➖ due processi + proxy da mantenere; ➖ testa il **dev server**, non il bundle di produzione;
- ➖ server fresco a ogni run = avvio `ng serve` (~15–30 s) ogni volta, quindi il presunto vantaggio
  di velocità sparisce comunque.

### Opzione B — UI compilata servita dal backend

Il backend `node index.js` serve **sia l'API sia la UI compilata** sotto `/_admin/ui` (`UI_DIST_DIR`),
come l'**app desktop** in produzione. `baseURL` = `:3101`, UI su `/_admin/ui/mocks`; `test:e2e` fa
`ng build` prima di Playwright.

- ➕ **un solo processo**, e per giunta `node` diretto (non una catena npm): Playwright lo termina
  pulitamente, il problema-orfani **non si applica**;
- ➕ **testa l'artefatto di produzione reale** (bundle, base-href, asset) — cattura regressioni di
  build che il dev server nasconderebbe;
- ➕ niente proxy; ➕ è l'architettura vera del prodotto desktop;
- ➖ `ng build` ~15 s prima della suite (durante l'iterazione: `npx playwright test <file>` dopo un
  build fresco salta il rebuild).

## Decisione finale (6 lug 2026): opzione B — UI compilata servita dal backend

Inizialmente era stata scelta A (`ng serve` + `reuse:false`), sulla base di un campione piccolo (4
run puliti). Continuando a stressare la suite è emerso il dato definitivo sopra — `ng serve` **muore
a metà run ~1 volta su 3** anche con `reuse:false` + cleanup — che ha **ribaltato la scelta a B**.

Config attuale: **un solo `webServer`**, il backend `node index.js` (`:3101`) con `UI_DIST_DIR` che
serve la UI compilata sotto `/_admin/ui`. `baseURL` = `:3101`, UI su `/_admin/ui/mocks`. `test:e2e`
= `ng build` (base-href `/_admin/ui/`) + `playwright test`. La suite **non usa più** i residui di A: `test:e2e` non invoca né il proxy e2e, né lo script
`start:e2e`, né il cleanup orfani. Questi due però — `mockxy-ui/proxy.e2e.conf.json` e lo script
`start:e2e` — **restano nel repo di proposito**: li usa l'harness di indagine (§ Indagine 2–3,
`e2e/investigation/ng-serve-instrumented.js`) per riprodurre l'architettura A e studiare i kill
dell'AV, fenomeno non ancora chiarito al 100%. Non rimuoverli senza aggiornare prima l'harness.

## Validazione empirica

- Architettura A (`ng serve`): dai 25/54 refused (reuse=true) a **~1 run su 3 con refused** (reuse=
  false + cleanup) — `ng serve` collassa a metà run.
- **Architettura B (attuale, UI compilata): 11 run completi, 0 `ERR_CONNECTION_REFUSED`.** Il server
  non muore mai.
- Flaky di timing residui (~2/61 sparsi, test di scrittura con verifica dopo update ottimistico +
  reload): assorbiti da **`retries: 1`** (in CI: 2), la pratica standard Playwright. Con i retry:
  **5 run consecutivi 61/61, 0 fallimenti finali.**

## Orfani residui: `reuse:false` non basta → cleanup automatico

`reuse: false` evita di *riusare* un orfano, ma **non impedisce** che `ng serve` ne lasci uno: la
catena `npm → ng → esbuild` su Windows non viene terminata pulitamente da Playwright a fine run.
Osservato in pratica in modo **intermittente ma frequente**: un run 54/54 pulito, e il successivo
**25/54 con refused** perché trova l'orfano del precedente. Quindi `reuse:false` da solo **non rende
la suite affidabile su run consecutivi**.

**Mitigazione: cleanup pre-run.** Lo script `test:e2e` esegue `node e2e/kill-stale-servers.js` prima
di Playwright: libera le porte **3101 e 4301** da eventuali orfani in ascolto (tocca solo quelle due
porte e2e). Riduce molto i fallimenti, ma **non li elimina** — vedi sotto.

## ⚠️ Aggiornamento decisivo: `ng serve` muore ANCHE durante il run (non solo orfani)

Con più run ripetuti è emerso il dato che ribalta la conclusione precedente. In un run fallito
(48/61, 11 refused):

- il cleanup pre-run ha riportato **"porte già libere"** → **nessun orfano** pre-esistente;
- Playwright ha avviato `ng serve` fresco, che ha servito **49 test su 61** correttamente;
- poi `ng serve` è **morto a metà run** (dal test 50 in poi, tutti `ERR_CONNECTION_REFUSED`).

Quindi il problema **non è (solo) il riuso di orfani**: `ng serve` **collassa intermittentemente
durante un run lungo** su Windows, in modo indipendente da `reuse` e dal cleanup. Frequenza
osservata: **~1 run su 3** anche con tutte le mitigazioni. Questo **non era un'ipotesi** — è
misurato: `ng serve` gestito da Playwright non è affidabile per questa suite su questa piattaforma.
**Il perché di questo collasso è stato stabilito dall'indagine 2, sotto.**

**Conseguenza.** L'opzione B (UI compilata servita dal backend, `node` diretto, niente `ng serve`)
non ha questo problema: quando testata, **5 run consecutivi 54/54, 0 refused**. È l'unica delle due
che regge i run lunghi in modo affidabile.

## Altri flaky risolti nella stabilizzazione (non legati ai server)

- **`fill` su input Angular appena renderizzato** (campo valore header): l'evento può arrivare prima
  che l'handler sia agganciato ed essere perso → campo azzerato da un re-render. Rimedio:
  `pressSequentially` (un evento per carattere).
- **`page.reload()` subito dopo una scrittura ottimistica** (test "persiste dopo reload"): la PUT al
  backend è ancora in volo, il reload rilegge lo stato vecchio. Rimedio: helper `reloadStable(page)`
  = `waitForAdminApiIdle` (attende le scritture del browser) + reload.

## Lezioni trasversali

- **`reuseExistingServer: true` con un dev server avviato via `npm` è rischioso su Windows** (orfani
  riusati). Con un processo `node` diretto (come il backend) è sicuro.
- Il guasto è emerso **solo nel run completo**, mai in isolamento: confermare l'intera suite a ogni
  chiusura resta la pratica giusta.
- Non escludere un'architettura su un'ipotesi: l'esperimento controllato (un fattore per volta) ha
  ribaltato la diagnosi iniziale (non era la memoria, non era `ng serve`).

---

## Indagine 2 (6 lug 2026, sera): la causa radice della morte a metà run

L'indagine 1 aveva isolato *quando* il guasto si presenta, non *perché* un `ng serve` fresco muoia a
metà run. Per chiuderla è stato costruito un **harness strumentato** che riproduce fedelmente
l'architettura A e osserva il dev server mentre muore.

### Strumentazione (in `e2e/investigation/`, config `playwright.ngprobe.config.js`)

- **Wrapper** (`ng-serve-instrumented.js`), usato come comando `webServer` al posto della catena
  npm nuda: avvia `npm --prefix mockxy-ui run start:e2e` (stessa catena dell'epoca:
  `cmd → npm → cmd → node ng → esbuild`) e registra **in scrittura sincrona** (sopravvive al
  taskkill di fine run): ogni riga di output del dev server; l'**evento di uscita** del figlio con
  codice/segnale; ogni 3 s un campione di **RSS dell'albero di processi** e dei **contatori TCP**
  (TIME_WAIT globali, stato della `:4301`); ogni 2 s un **probe HTTP indipendente** su `:4301` e
  `:3101`; al guasto, un'**autopsia automatica** (netstat, processi vivi, registro eventi Windows).
- **Config di riproduzione**: gli stessi 61 test dell'epoca (esclusi i 3 spec monitor/storico nati
  dopo il passaggio a B), `retries: 0`, percorsi UI alla radice (`E2E_UI_PATH=/mocks`).
- **Supervisore** (`supervisor.sh`): N run consecutivi con bonifica porte tra un run e l'altro.
- Versioni: Node 24.15.0, npm 11.12.1, Angular CLI 21.2.8, Playwright 1.61.1, Windows 11 Pro 26200.

### Esito dei 9 run

| Run | Esito | Note |
|---|---|---|
| 1 | 60/61 | 1 flaky di timing noto (retries:0), refused 0 |
| 2 | 61/61 | |
| 3 | 60/61 | 1 flaky di timing noto, refused 0 |
| **4** | **35 passati → 26 falliti, 25 refused** | **collasso catturato** |
| 5–7 | 61/61 | |
| 8–9 | 60/61 | 1 flaky di timing noto ciascuno, refused 0 |

### Il collasso del run 4, minuto per minuto

- `21:13:04` il wrapper avvia la catena npm; `~21:13:07` bundle pronto, server su `:4301`.
- `21:13:40` test 35 verde (E2 · filtri, **sola lettura**: digitazione in un campo di ricerca).
- `21:13:46` **l'intero albero muore in blocco**: `CHILD-EXIT code=3221226505 (0xC0000409)
  signal=null`, **zero righe di output** — né `FATAL ERROR` V8, né stack, né il banner d'errore che
  npm stampa *sempre* quando uno script fallisce. Al campione successivo l'albero è **vuoto**
  (entrambi i cmd, entrambi i node, esbuild: spariti).
- `21:13:48+` i 25 test restanti falliscono con `ERR_CONNECTION_REFUSED` su `:4301`. Il backend
  su `:3101` resta vivo.

### Cosa i dati ESCLUDONO

- **OOM del processo** (l'ipotesi che l'indagine 1 non aveva davvero escluso — il limite heap V8 è
  per-processo, ~4 GB, indipendente dai 125 GB della macchina): RSS massimo del node di ng serve
  **823 MB**, nessun messaggio di heap. Escluso.
- **Esaurimento porte effimere / TIME_WAIT**: massimo osservato 1707 su ~16k disponibili. Escluso.
- **Crash applicativo interno** (bug V8/esbuild/vite): un crash in-process uccide UN processo, e
  npm avrebbe stampato il suo banner d'errore prima di uscire. Qui **due node indipendenti (npm e
  ng) sono morti nello stesso istante, in silenzio**: nessun crash interno produce questo. Escluso.
- **Il carico dei test**: al momento della morte girava un test di sola lettura; nessuna rebuild,
  nessuna scrittura. Escluso.
- **Playwright o il supervisore**: il teardown di Playwright avviene a fine suite (qui mancavano 26
  test) e con `taskkill` (exit code 1, non 0xC0000409); la bonifica del supervisore gira solo tra i
  run (timestamp: 42 s prima). Esclusi.
- **Un crash nativo "normale"**: nessun evento nei registri Windows — Application, System, WER,
  CodeIntegrity, Security-Mitigations: **tutti vuoti** nella finestra del guasto. Un crash vero
  lascia l'evento "Application Error 1000"; qui niente. Escluso.

### Cosa i dati DIMOSTRANO — e a chi puntano

Restano solo terminazioni **esterne, simultanee e silenziose dell'intero albero**, con exit code
0xC0000409 (`STATUS_STACK_BUFFER_OVERRUN`, il codice del *fail-fast* di Windows — usato anche dai
kill "iniettati" che scavalcano di proposito Windows Error Reporting, ed è per questo che i
registri sono vuoti).

Sulla macchina l'antivirus attivo è **Bitdefender** (Windows Defender è in modalità passiva —
verificato via SecurityCenter2). Bitdefender include **ATC / Active Threat Control** ("Advanced
Threat Defense" nella UI): un modulo **comportamentale** che accumula punteggio di sospetto su un
albero di processi e, superata la soglia, lo **termina in blocco, senza dialogo e senza eventi
Windows** (la cartella `C:\ProgramData\Bitdefender\Atc` esiste sulla macchina). I report della
community Bitdefender documentano esattamente questo comportamento sui tool di sviluppo Node.

L'attribuzione ad ATC spiega **tutte** le osservazioni storiche in un colpo solo:

- **intermittenza ~1/3**: il punteggio comportamentale dipende da timing e accumulo, non è
  deterministico;
- **morte a ~30–60 s dall'avvio** del server, mai all'avvio: è la finestra di scoring;
- **asimmetria manuale vs Playwright** (a mano 0 morti, sotto Playwright ~1/3): gli euristici
  comportamentali pesano l'**ancestry** — una catena `node(test runner) → cmd → npm → cmd → node →
  esbuild` che apre porte e riceve traffico da un browser automatizzato è molto più sospetta della
  stessa catena avviata da un terminale interattivo;
- **gli "orfani" dell'indagine 1**: un kill parziale dell'albero (o il kill del solo ramo padre)
  lascia esattamente i superstiti che allora chiamavamo orfani — e la loro "morte a metà run
  successivo" era lo stesso killer, non una "pulizia dell'OS";
- **reperto collaterale**: nel run 1 il *backend* ha loggato un `EPERM: operation not permitted,
  rename …tmp → GET.endpoint.json` (scrittura atomica fallita per un lock esterno sul file appena
  scritto) — la firma classica dello **scanner on-access** che tiene il file aperto. Parte dei
  "flaky di timing" residui della suite potrebbe avere questa stessa origine.

### Stato epistemico dopo l'indagine 2

- **Confermato dai dati**: la morte a metà run è una **terminazione esterna silenziosa dell'intero
  albero** (0xC0000409, zero output, zero eventi, processi indipendenti morti insieme). Non è un
  difetto di `ng serve`, di Node, di Playwright o della suite.
- **Fortemente indiziato**: **Bitdefender ATC**. Il test A/B che segue (indagine 3) ha poi
  ristretto l'attribuzione proprio al modulo comportamentale.

## Indagine 3 (7 lug 2026, notte): test A/B con lo scudo antivirus disattivato

L'utente ha disattivato l'antivirus dalla UI di Bitdefender; condizione registrata via
SecurityCenter2: **scudo real-time di Bitdefender spento** (bit di protezione attiva a zero) e
**Windows Defender rimasto passivo** ("Not running"). Verifica cruciale sui driver, però: il driver
kernel **`atc` (Active Threat Control) e `Trufos` risultavano ANCORA in esecuzione**, insieme a
tutti i servizi Bitdefender — l'interruttore usato spegne lo *scanner*, ma **l'Advanced Threat
Defense ha un interruttore separato ed è rimasto armato**. Il test A/B è quindi diventato, di
fatto: *scanner spento, modulo comportamentale acceso* — perfetto per separare i due.

Stesso harness, **24 run**:

| Metrica | Ieri (tutto acceso), 9 run | Oggi (scudo OFF, ATC ON), 24 run |
|---|---|---|
| Kill dell'albero (0xC0000409 silenzioso) | 1 (run 4) | **3** (run 19 intero, run 20 **parziale**, run 24 intero) |
| Tasso kill | ~11% | ~12% — **invariato** |
| Run con `EPERM` su rename atomiche del backend | **7 su 9** | **2 su 24** — **crollato** |

**La doppia dissociazione chiude l'attribuzione:** i kill seguono il modulo rimasto acceso (ATC),
al tasso di sempre; gli EPERM seguono il modulo spento (scanner on-access), e sono spariti con lui.

**Il run 20 ha regalato il pezzo mancante: la genesi degli "orfani" ripresa dal vivo.** Il kill ha
colpito solo la CIMA dell'albero (wrapper e primo cmd) lasciando vivi npm → ng serve → esbuild: un
`ng serve` orfano funzionante (la suite ha chiuso 61/61 su quel server decapitato). Gli "orfani"
dell'indagine 1 erano questo: **superstiti di kill parziali di ATC**, non figli mal ripuliti da
Playwright. Nota tecnica emersa: gli orfani ereditano gli handle Windows delle pipe di output e
possono tenere in ostaggio chi legge quelle pipe (il supervisore è stato reso immune scrivendo
l'output su file, senza pipe).

**Conclusione finale.** Il killer è il **modulo comportamentale di Bitdefender (ATC / Advanced
Threat Defense)**: termina in blocco (a volte parzialmente) la catena `npm → node → esbuild`
avviata dal test runner, in silenzio, ~30–60 s dopo l'avvio del server, ~1 run su 8–9,
indipendentemente dallo scudo antivirus. Per neutralizzarlo servirebbe disattivare *quello
specifico modulo* o aggiungere eccezioni ATD; per la suite non serve: l'architettura B (un solo
`node` diretto, mai colpito in nessun run di nessuna condizione) resta la scelta.

### Conseguenze sulla decisione

La scelta dell'**architettura B resta giusta**, e per ragioni ora più solide: non "ng serve è
fragile" (non lo è — la colpa non era sua), ma **la catena di processi npm sotto un test runner è
il bersaglio preferito dell'euristica comportamentale dell'AV**, mentre il singolo processo `node
index.js` con ancestry semplice non è mai stato colpito (0 kill in tutti i run B, storici e
odierni). In più B testa l'artefatto di produzione. Un'eventuale esclusione AV renderebbe A di
nuovo percorribile, ma non c'è motivo di tornarci.

### Rieseguire l'indagine

```bash
# loop di N run strumentati (default 9); i log per run in <dir>/run-N/
bash e2e/investigation/supervisor.sh <dir-log> [N]
# analisi di un run
node e2e/investigation/analyze-run.js <dir-log>/run-N
```
