# Mockxy: piano per script condivisi e reload semplice

## Stato del documento

Piano adottato l'8 ottobre 2026. Raccoglie la direzione concordata fra il proprietario di Mockxy e gli agenti che hanno analizzato il problema (Opus e due istanze di Codex/Astra), con le verifiche sui workspace reali. Il confronto tecnico è chiuso senza obiezioni aperte.

Le analisi e il prototipo sono basati sulla versione 1.5.0, commit `c81d9b01acb88729ed5b36b820ce7fc274397332`, che coincide con il `main` da cui parte l'implementazione.

### Decisioni finali del proprietario

1. **Versione: 1.6.0**, come eccezione esplicita alla politica di versionamento (vedi §6.A).
2. **Avvisi del runtime nello stato del runtime**, visibili nell'app e via API, senza modificare lo stato di applicazione del caricamento (vedi §6.B).
3. **Implementazione sul branch `feat/shared-scripts-alias`**, nell'ordine del §8. Fino a nuova indicazione l'unico commit autorizzato è quello di questo piano; le modifiche di sviluppo restano fuori dallo staging e non si esegue alcun push.
4. **Le skill** (`mockxy-skills`) si allineano dopo l'implementazione nel motore.

## 1. Obiettivo e decisioni consolidate

L'obiettivo è consentire agli autori dei mock di riutilizzare script con import indipendenti dalla profondità degli endpoint, mantenendo prevedibile il reload.

Il proprietario privilegia semplicità e robustezza, accetta vincoli ragionevoli e una migrazione dei workspace. Non è legato alla sintassi `_shared/...` della 1.5.0.

La direzione condivisa è:

1. **Una sola cartella condivisa: `mocks/_shared/`.** L'organizzazione per dominio avviene tramite sottocartelle; non serve una seconda cartella convenzionale `_lib`.
2. **Un solo alias standard: `#shared/`.** Si usa il meccanismo nativo `imports` di Node, con configurazione locale al workspace.
3. **CommonJS per gli script dei mock.** Il codice locale viene caricato con dipendenze statiche e immediate; lo stato del mock vive nelle primitive di Mockxy.
4. **Nessun loader a generazioni.** I riferimenti acquisiti durante il caricamento permettono alle richieste già iniziate e alle rotte conservate di continuare con il codice precedente.
5. **Eliminazione di `scriptDefinitionCache`.** A ogni scansione si ricompilano gli script selezionati degli endpoint abilitati, dopo la pulizia della cache dei moduli locali del workspace.
6. **Stesso contratto per CLI, Docker ed Electron.** Gli alias appartengono al workspace; non richiedono un resolver speciale per il desktop.

La rimozione della cache incrementale è l'aggiunta conclusiva alla direzione iniziale: è stata provata sui workspace VU e GT e risulta adeguata. Il precedente problema di invalidazione tramite data e dimensione non richiede più un algoritmo sostitutivo basato su hash.

## 2. Configurazione standard del workspace

`mocks/package.json`:

```json
{
  "private": true,
  "type": "commonjs",
  "imports": {
    "#shared/*": "./_shared/*"
  }
}
```

Esempio di struttura e utilizzo:

```text
mocks/
  package.json
  _shared/
    ravvedimento/
      flusso.js
      dati.js
  operazioni/
    POST.endpoint.json
    POST.responses/
      001.response.json
      001.handler.js
```

```js
// 001.handler.js
const { annulla } = require('#shared/ravvedimento/flusso.js');

module.exports = {
  resolveResponse: annulla,
};
```

L'alias funziona anche dentro gli helper transitivi. Gli helper possono continuare a importarsi relativamente, per esempio con `require('./dati.js')`: non occorre migrare ogni import relativo.

Con questa mappa le estensioni sono **obbligatorie**: `#shared/flusso.js`, non `#shared/flusso`. Non si fa affidamento sulla ricerca automatica dell'estensione o di `index.js`. La stessa convenzione di percorsi espliciti si applica alle dipendenze locali relative.

**Precisazione emersa nella revisione:** Node consente i relativi senza estensione; qui il vincolo resta una scelta di robustezza del contratto. È stato riprodotto questo caso: `require('./helper')` carica `helper/index.js`; successivamente compare `helper.js`; dopo la pulizia della cache dei moduli il processo continua a risolvere il vecchio `helper/index.js`, mentre un processo nuovo risolve `helper.js`. La cache di risoluzione è distinta da quella delle definizioni che eliminiamo. Scrivere `./helper/index.js` o `./helper.js` evita questa ambiguità senza aggiungere invalidazioni interne di Node. Il validatore completo tratta quindi l'omissione come violazione del contratto; il normale runtime mantiene il comportamento Node. Fonte sul comportamento standard dei relativi: [Node 24, risoluzione dei moduli](https://github.com/nodejs/node/blob/v24.18.0/doc/api/packages.md#module-resolution-and-loading); la persistenza della risoluzione è stata verificata con il probe allegato alle evidenze locali.

Il package delimita l'ambito CommonJS anche quando il progetto contenitore usa `"type": "module"`. Il contratto prevede un unico ambito per gli script: niente `package.json` annidati fra la radice dei mock e gli script/helper, esclusi i normali package installati in `node_modules`.

### Momento di inizializzazione

Per offrire gli alias, il file deve esistere ed essere valido **prima del primo caricamento di uno script di quel workspace nel processo**. Questo ordine deve valere per scansione iniziale, validazione admin, anteprime e ogni altro percorso che compila script. Se il file è assente e non può essere creato, per esempio in un mount in sola lettura, si applica l'eccezione del §6.C: avviso e normale tentativo di caricamento dei mock, senza bloccare globalmente quelli che non necessitano dell'alias.

Node può conservare anche l'esito negativo della ricerca di `package.json`. Aggiungerlo dopo aver caricato script relativi può quindi lasciare gli alias non risolvibili nonostante la pulizia della cache CommonJS.

La configurazione degli alias è configurazione di avvio:

- aggiungere, rimuovere o cambiare un helper sotto un pattern già configurato usa il normale reload;
- introdurre o cambiare la configurazione del package dopo il primo caricamento richiede il riavvio del **processo che esegue gli script**;
- nell'app desktop il motore gira nello stesso processo dell'app e il runtime viene ricreato a ogni cambio di workspace (verificato nel codice: `electron/` non avvia processi separati). Chiudere e riaprire il workspace non equivale quindi al riavvio: l'azione da indicare all'utente è riavviare l'app. Resta da collaudare sull'app impacchettata;
- rilevare cambiamenti rilevanti alla configurazione e segnalare il riavvio necessario, evitando di promettere che un reload ordinario li applichi.

La conoscenza della configurazione già osservata appartiene al **processo**, indicizzata per percorso reale del package, e deve sopravvivere alla chiusura e riapertura del runtime di un workspace. Se il file era assente, identificare la posizione tramite la radice reale del workspace e registrare anche tale assenza; non si può chiamare `realpath` su un file che non esiste.

Non serve invalidare le cache interne di risoluzione dei package di Node.

## 3. Contratto per gli autori degli script

Queste regole valgono per handler, middleware e helper transitivi locali.

| Aspetto | Regola |
|---|---|
| Punti di ingresso | I file `*.handler.js` e `*.middleware.js` sono punti di ingresso e non vengono importati da altri script. Le implementazioni riusabili si estraggono in helper. |
| Dipendenze locali | `require` sincroni, con stringa letterale e percorso esplicito, eseguiti incondizionatamente durante il caricamento del modulo. |
| Caricamenti durante richieste | Le funzioni di risposta usano i riferimenti già acquisiti. Non risolvono codice locale alla prima richiesta, dopo un `await`, in un timer o tramite percorsi calcolati. |
| Stato per endpoint | Si usa `state`. |
| Stato fra endpoint | Si usa `sharedState`, rispettando il contratto esistente di inizializzazione e `seedKey`. |
| Variabili del modulo | Funzioni, costanti e configurazioni non mutate sono ammesse. Contatori, cache mutabili e oggetti modificati fra richieste non costituiscono lo stato del mock. Una dichiarazione `const` da sola non garantisce immutabilità. |
| Identità dei moduli | Il comportamento fra endpoint non dipende dall'identità condivisa di oggetti, funzioni o classi esportati dagli helper. |
| Effetti al caricamento | Il caricamento non avvia timer, listener o server e non produce scritture o altri effetti persistenti. |
| Operazioni durante la richiesta | Restano consentiti `async`, variabili locali mutabili, accesso ai dati e operazioni previste dalle API di Mockxy. Gli helper possono ricevere il contesto. |
| Confine del reload | Il codice locale ricaricabile resta sotto la radice reale dei mock. Moduli Node e pacchetti npm mantengono il normale ciclo di vita esterno al reload del workspace. |

Gli import relativi a helper nella stessa cartella rimangono validi. Non occorre imporre che ogni funzione di supporto viva in `_shared`; quella è la collocazione convenzionale del codice condiviso fra endpoint.

Questo è un contratto per script fidati di sviluppo, non una sandbox né il supporto al reload di applicazioni Node arbitrarie. ESM locale, dipendenze esterne che rientrano nel workspace e codice raggiunto fuori dalla sua radice reale non ricevono garanzie aggiuntive di hot reload.

## 4. Comportamento del caricamento e del reload

Ogni scansione ordinaria deve:

1. Verificare i prerequisiti della configurazione degli script.
2. Pulire dalla cache CommonJS i moduli locali appartenenti al workspace, usando un confronto coerente con i percorsi reali.
3. Caricare da disco le configurazioni e ricompilare gli script delle varianti effettivamente selezionate, compresi gli step selezionati tramite una sequence.
4. Installare le definizioni risultanti usando il comportamento esistente dei registri e la gestione attuale degli errori per endpoint.

La rimozione di `scriptDefinitionCache` comprende firme, confronti, potatura e rami presenti solo per sostenerla. Non si introduce una cache equivalente con un altro nome. La cache CommonJS di Node continua invece a servire i normali `require` durante il caricamento: non va svuotata fra un handler e il successivo della stessa scansione.

Gli helper vengono caricati come dipendenze degli script; non è richiesto eseguire preventivamente ogni file di `_shared` a ogni reload.

### Garanzie da conservare

- Una richiesta già iniziata conserva i riferimenti al codice che aveva acquisito; una nuova richiesta, dopo l'installazione, usa la nuova definizione.
- Un endpoint che non si carica può conservare la precedente versione valida secondo il comportamento `retained` già presente, con diagnostica visibile. Gli altri endpoint validi si aggiornano.
- La semplice ricompilazione non azzera `state` o `sharedState`.
- Le sequenze mantengono il cursore quando la configurazione rilevante non cambia; restano validi i reset già previsti quando cambia lo scenario.
- Le connessioni Server-Sent Events (SSE) e WebSocket restano aperte quando la configurazione effettiva dello stream non cambia; si mantengono le attuali regole di riconciliazione.

La scansione non è una fotografia atomica del filesystem. Un salvataggio durante la scansione può richiedere un giro successivo; bisogna preservare la coda di reload esistente e verificare la convergenza dopo l'ultimo salvataggio. Ricompilare tutto non elimina questa concorrenza.

La garanzia riguarda i riferimenti al codice. `data()` può leggere dati aggiornati e vecchie e nuove rotte condividono lo stesso `sharedState`; non si promette una fotografia immutabile di dati o stato per richiesta.

### Percorsi reali e collegamenti

La pulizia basata sul solo `path.resolve(mocksDir)` è insufficiente quando il workspace è raggiunto tramite un collegamento simbolico e Node registra i moduli con il percorso reale.

La correzione deve coprire il percorso configurato e quello reale, verificando l'effettiva appartenenza al workspace senza confonderlo con directory sorelle dal prefisso simile. La scelta delle primitive di canonicalizzazione va verificata rispetto al comportamento del loader sulle piattaforme supportate, inclusi Windows e junction.

L'effetto richiesto è circoscritto: aggiornare gli helper locali del workspace corretto senza purgare i moduli di altri workspace o trasformare le dipendenze npm in codice soggetto al suo reload.

## 5. Validazione e diagnostica

La validazione degli script deve appartenere al progetto Mockxy ed essere utilizzabile anche fuori dalle skill. Le skill possono invocarla e spiegare il contratto; non devono esserne l'unico luogo di applicazione.

Separare due operazioni:

- **Reload ordinario:** carica le varianti attive.
- **Validazione completa:** controlla tutti i `*.handler.js` e `*.middleware.js`, inclusi endpoint disabilitati e varianti non selezionate, e le dipendenze locali raggiunte. Esclude `node_modules`.

La validazione deve riutilizzare le stesse regole di compilazione e risoluzione del runtime. L'esecuzione del top-level è parte del caricamento, non una mera verifica sintattica. Una validazione nel processo del server va coordinata con le scansioni: evitare una pulizia indipendente della cache nel mezzo di un altro caricamento. Riutilizzare il coordinamento disponibile senza introdurre un secondo sistema di loader.

### Punti di ingresso e parser

Prevedere **una sola implementazione del validatore**, esposta tramite:

- una rotta admin dedicata, ingresso principale per app desktop e strumenti collegati al server, coordinata con la coda di caricamento/reload;
- un comando o un'opzione CLI per l'uso senza server, che esegue la stessa validazione ed espone un esito utilizzabile dagli strumenti automatici.

Scegliere nomi, schema della risposta e convenzioni HTTP coerenti con il progetto. La validazione completa restituisce il rapporto senza installare nuove rotte né azzerare lo stato del runtime. Non deve modificare i sorgenti per correggerli automaticamente.

Lo script autonomo delle skill mantiene i controlli di formato senza dipendenze. Quando il motore corretto è raggiungibile può chiamare la rotta; senza server può usare il comando se disponibile, altrimenti dichiara esplicitamente che la verifica del contratto e del caricamento non è stata eseguita. Deve verificare il workspace di destinazione, senza assumere che un server qualunque su una porta locale sia quello giusto.

Usare un parser JavaScript, per esempio **Acorn**, nel validatore completo e nella validazione degli script salvati tramite admin. Condividere questa analisi; non replicarla nelle skill e non usare una semplice espressione regolare per distinguere codice, commenti e stringhe. La configurazione del parser deve accettare la sintassi CommonJS supportata dal runtime di riferimento.

La scansione ordinaria resta senza analisi sintattica aggiuntiva. Può segnalare gli entrypoint importati dal grafo dei moduli e i problemi di configurazione/risoluzione osservabili. I `require` tardivi non vengono certificati durante il normale reload: sono controllati dalla validazione esplicita o al salvataggio admin. Non trasformare l'assenza di avvisi del reload in una dichiarazione di piena conformità.

A filesystem e configurazione invariati, validazione e reload devono usare la stessa risoluzione e vedere contenuti aggiornati, anche per gli helper. La validazione può segnalare ulteriori violazioni del contratto che il runtime tollera e controlla varianti inattive. Non garantisce gli stessi byte fra due operazioni separate se nel frattempo un editor salva altri cambiamenti.

Occorrono messaggi che distinguano almeno:

- configurazione degli alias mancante, invalida o incompatibile;
- configurazione aggiunta o cambiata dopo il primo caricamento, con riavvio necessario;
- `package.json` annidato che cambia l'ambito di risoluzione;
- percorso senza estensione o file effettivamente assente;
- vecchio import dalla radice, per esempio `require('_shared/x.js')`, con indicazione della sostituzione `require('#shared/x.js')` quando il caso è riconosciuto;
- import di un handler/middleware come dipendenza;
- comuni violazioni del contratto sui `require` locali tardivi o dinamici.

Non basare questa distinzione sull'uguaglianza del testo dell'errore di Node: i messaggi possono differire, per esempio mostrando il percorso risolto quando manca l'estensione. Conservare la causa originale insieme alla spiegazione utile.

### Correzione alla proposta sui require tardivi

L'aumento dell'insieme dei file dipendenti non è un rilevatore completo. Un modulo può importare un helper al caricamento e richiedere nuovamente **lo stesso helper** durante una richiesta: l'insieme dei percorsi resta identico, ma dopo una pulizia della cache quel secondo `require` può ricevere codice diverso.

Questo controesempio è stato riprodotto: vecchio riferimento e `require` tardivo restituiscono rispettivamente versione 1 e versione 2 senza un nuovo percorso nell'insieme delle dipendenze.

Il controllo del grafo dei moduli può aiutare a segnalare entrypoint importati. Per i casi ordinari di import tardivo serve un controllo sintattico mirato, condiviso dagli strumenti di validazione. Non occorre dimostrare la purezza di JavaScript arbitrario. La sola ispezione del grafo dopo la compilazione non deve essere presentata come verifica completa del contratto.

## 6. Decisioni sui dettagli operativi

La revisione ha confermato rimozione del resolver legacy, severità differenziata fra runtime e validatore e preservazione dei package preesistenti. Seguono le condizioni operative precisate nella revisione.

### A. Rimozione della sintassi legacy dalla radice

**Raccomandazione: rimuovere il supporto speciale a `require('_shared/...')` e agli altri import dalla radice aggiunta manualmente ai percorsi del modulo.** Rimangono gli alias nativi, i normali relativi, i pacchetti npm e i moduli Node.

È una modifica incompatibile per alcuni workspace. Documentarla esplicitamente: il fatto che la funzionalità fosse difettosa non elimina l'impatto della migrazione.

**Versione decisa dal proprietario: 1.6.0.** La politica documentata in `docs/progetto/PROCEDURA-RILASCIO.md`, §1, assegna una major alle incompatibilità dei workspace: applicandola senza eccezioni il numero sarebbe 2.0.0. La scelta di 1.6.0 è un'eccezione esplicita, motivata così:

- la sintassi ritirata è esistita solo nella 1.5.0, pubblicata il 1° ottobre 2026, ed era difettosa proprio nei caricamenti indiretti;
- i due workspace noti (VU e GT) non l'hanno adottata: la migrazione di VU è stata annullata e i percorsi relativi precedenti, che restano supportati, continuano a funzionare;
- un workspace che l'avesse adottata riceve una diagnostica dedicata con la sostituzione da applicare. L'unico canale noto di diffusione sono le skill alla tag `v1.5.0`, che la raccomandavano.

L'eccezione va registrata nella procedura e nelle note di rilascio, con tre indicazioni: il meccanismo di import dalla radice della 1.5.0 è ritirato; i percorsi relativi continuano a funzionare senza migrazione; chi ha usato `require('_shared/...')` passa a `require('#shared/...')`, con estensione e `package.json` nei mock. Non presentare il rilascio come compatibile per tutti i workspace e non modificare silenziosamente la regola generale. Questo documento non esegue un bump delle versioni.

La rimozione riguarda il resolver speciale. Non richiede una riscrittura generale del meccanismo attuale di compilazione CommonJS né la sostituzione contestuale delle API Node già usate dal loader.

### B. Severità delle violazioni del contratto

**Raccomandazione: avviso nel runtime per le violazioni rilevabili che non impediscono il caricamento; errore nel validatore completo.** Quest'ultimo deve appartenere a Mockxy ed essere invocabile dalle skill, non essere disponibile soltanto nelle skill.

**Canale degli avvisi del runtime (decisione del proprietario):** lo stato del runtime (`GET /runtime/status`) espone un elenco `warnings` accanto a `errors`. Gli avvisi non cambiano lo stato dell'ultimo tentativo: un caricamento con soli avvisi resta `applied`. Sono visibili nell'app e via API. È un'aggiunta al contratto dell'admin API, da riportare nello spec OpenAPI e nell'interfaccia. Prima di questa decisione lo stato del runtime aveva solo errori e un avviso finiva soltanto nel log.

**Al salvataggio tramite admin, le violazioni del contratto sono avvisi non bloccanti:** lo script viene salvato, gli avvisi sono restituiti nella risposta API e resi visibili nell'editor. Vale anche per gli agenti che usano la stessa API. I normali errori che già impediscono il salvataggio, inclusi compilazione e risoluzione, restano bloccanti con le attuali regole di preservazione/ripristino. La severità di errore per una mera violazione del contratto si applica alla validazione completa esplicita. Questo permette di modificare dall'app uno script funzionante ma non ancora migrato, per esempio un handler che importa un altro handler.

Gli errori effettivi di compilazione o risoluzione continuano a essere errori di caricamento per gli script interessati. L'assenza di un package che non si può creare non diventa un errore globale di avvio: vale l'eccezione sotto. Un package presente ma illeggibile o invalido non equivale invece a uno assente. Un workspace avviabile con avvisi non è per questo conforme al contratto né beneficia delle sue garanzie nei casi vietati. Usare i canali diagnostici esistenti, senza nuovi codici HTTP o protocolli trasversali.

### C. Package preesistente

**Raccomandazione:**

- assente e creabile: creare il file standard prima del primo caricamento e segnalare l'operazione nel log o nella diagnostica;
- assente e non creabile: emettere un avviso e proseguire con il normale caricamento. Gli endpoint che non necessitano dell'alias non devono essere bloccati solo da questa condizione; gli import `#shared/` privi della configurazione richiesta ricevono una diagnostica specifica. Non ripristinare il resolver legacy come ripiego;
- presente e semanticamente compatibile: usarlo senza riscriverlo; campi aggiuntivi innocui non sono di per sé un problema;
- presente ma incompatibile: preservarlo e spiegare esattamente quali campi richiedono intervento;
- file presente ma illeggibile o JSON invalido: distinguere l'errore dall'assenza, preservare il file e riportare la causa senza trattarlo come configurazione valida.

Compatibilità del package preesistente:

1. Il contenuto è un oggetto JSON valido e `imports` è un oggetto con `"#shared/*": "./_shared/*"`.
2. `type` è assente oppure vale `"commonjs"`. Il file generato dal motore include sempre `"type": "commonjs"`.
3. Gli altri campi sono preservati. Altri alias sono tollerati con un avviso del validatore e rimangono fuori dal contratto, purché non ridefiniscano lo spazio `#shared/`.

**Precisazione sugli alias aggiuntivi:** la sola presenza della mappa standard non basta se altre chiavi la specializzano. È stato verificato che `"#shared/value.js": "./elsewhere.js"` prevale su `"#shared/*": "./_shared/*"`. Per mantenere semplice la regola, oltre alla chiave standard non ammettere altre chiavi dedicate a `#shared` o che inizino con `#shared/`. Un package che le contiene va preservato ma segnalato come incompatibile, senza tentare una normalizzazione automatica.

I workspace di esempio e di test versionati nel repository del motore e nelle suite di accettazione devono includere il package standard nel repository. I mount in sola lettura con package già valido funzionano normalmente anche con gli alias. La creazione automatica riguarda gli altri workspace e non deve sporcare sistematicamente i fixture del progetto.

Se un workspace viene caricato senza package e il file diventa disponibile in seguito, continua a valere la regola di riavvio del processo: l'avviso iniziale non disattiva la registrazione della configurazione osservata.

## 7. Evidenze già raccolte

### Workspace reali

Le verifiche su VU e GT sono state eseguite su copie isolate, non sui workspace serviti dalle istanze in uso.

| Audit | VU | GT |
|---|---:|---:|
| Script handler/middleware | 55 | 70 |
| Chiamate `require` esaminate nei JavaScript | 35 | 170 |
| `require` con argomento dinamico | 0 | 0 |
| `require` dentro funzioni | 0 | 0 |
| Handler distinti importati da altri moduli | 2 | 3 |

I 205 `require` rispettano già i vincoli sintattici osservati su argomento e collocazione; questo non dimostra l'intero contratto. La separazione degli entrypoint richiede l'estrazione di cinque implementazioni e l'audit sintattico non dimostra l'assenza di ogni mutazione nascosta.

Nelle prove precedenti: caricamento riuscito di tutti i 125 script con alias nativi; 58 test VU passati; 12 confronti sulle varianti di dettaglio GT con risposte identiche. Queste prove precedono il prototipo senza cache incrementale.

### Prototipo senza cache incrementale

Misurata `loadEndpointRouteGroups` su copie con alias nativi, con processo separato per ciascuna combinazione, 5 scansioni di riscaldamento e 40 campioni. Tempi mediani, Node v24.21.0 su Linux/WSL:

| Workspace | Caso | Cache attuale | Ricompilazione completa |
|---|---|---:|---:|
| VU | Scansione senza modifiche | 30,4 ms | 32,2 ms |
| VU | Un handler modificato | 32,8 ms | 31,6 ms |
| GT | Scansione senza modifiche | 40,6 ms | 33,7 ms |
| GT | Un handler modificato | 44,0 ms | 34,5 ms |

Sono tempi della scansione, senza debounce, interfaccia grafica o richieste HTTP. La copia GT usa ancora `#lib` oltre a `#shared`: dimostra il costo del caricamento, non costituisce la migrazione definitiva alla singola cartella. Non si deduce che la ricompilazione sia sempre più veloce; il costo locale è adeguato alla scelta di semplicità.

Sul prototipo, con Node v24.18.0:

- 144 test esistenti passati in 12 suite su loader, reload, stato, sequence e serving/riconciliazione SSE e WebSocket;
- 1 nuovo test di integrazione passato con runtime, richieste HTTP e reload reali: nuova definizione installata, `state` e `sharedState` conservati, sequence proseguita, diagnostica senza errori;
- escluso un test che richiedeva la mancata riesecuzione degli script invariati, comportamento deliberatamente abbandonato;
- aggiornamento corretto di un helper anche conservando esattamente data e dimensione;
- prova separata riuscita su richiesta in corso, helper transitivo e rotta `retained` accanto a una rotta aggiornata.

Il primo giro del nuovo test aveva un errore della fixture nell'arrotondamento del timestamp; corretto imponendo un timestamp intero prima del caricamento. I risultati sopra distinguono i 144 test esistenti dal nuovo test corretto. Non si tratta dell'intera suite del prodotto.

Opus ha inoltre riportato prove positive con Node di Electron tramite `ELECTRON_RUN_AS_NODE` e Jest. Queste non equivalgono al collaudo dell'app Electron impacchettata. Windows/junction e il ciclo di vita reale dei processi desktop rimangono da verificare durante l'implementazione.

Nella revisione conclusiva Opus ha confermato di aver riprodotto anche la precedenza della chiave esatta `#shared/value.js` e il caso del relativo senza estensione. Ha inoltre riportato l'esito positivo dei casi file assente poi creato, anche in una nuova sottocartella, e helper rimosso: il primo diventa risolvibile dopo reload, il secondo dà errore. Queste ulteriori prove sono attribuite alla tua verifica; non cambiano il piano né dimostrano l'assenza generale di ogni cache negativa di Node, in particolare quella relativa ai package descritta nel §2.

## 8. Ordine di implementazione e criteri di completamento

1. **Riconciliare piano e codice corrente.** Individuare i punti che caricano script, la coda di reload, le diagnostiche e gli strumenti di validazione già disponibili. Completato quando sono note le differenze rispetto alla 1.5.0 analizzata e sono recepite le decisioni operative del §6.

   **Completato l'8 ottobre 2026.** Nessuna differenza rispetto al commit analizzato. Gli ingressi che compilano script sono quattro e passano da due funzioni: avvio del runtime e reload (`loadEndpointRouteGroups`, da `src/server.js`), salvataggio di uno script dall'admin (`loadScriptModule` tramite `src/admin/mock-validation.js`) e validazione di una sequence dall'admin (`loadSequenceSteps`, da `src/admin/endpoint-operations.js`). Non esistono oggi una rotta di validazione, un comando da riga di comando né un parser nel motore. I tre workspace versionati (`workspace`, `workspace-test`, `workspace-agent-test`) non hanno `mocks/package.json`. Rischio emerso: la creazione automatica del package tocca ogni cartella di mock, comprese quelle dei test che ne controllano il contenuto.
2. **Preparare la configurazione prima del caricamento.** Introdurre il comportamento concordato per `mocks/package.json` in tutti i percorsi di ingresso. Completato quando startup e validazione rispettano l'ordine e il riavvio necessario viene spiegato correttamente.
3. **Semplificare risoluzione e reload.** Usare gli alias nativi, applicare la decisione sul resolver legacy, eliminare la cache incrementale e correggere la pulizia dei moduli per i percorsi reali. Completato quando helper modificati si aggiornano e gli altri workspace restano indipendenti.
4. **Integrare validazione e messaggi.** Esporre la stessa verifica completa via admin e CLI, usando il parser per i controlli del contratto e la compilazione condivisa con il runtime. Completato quando anche script inattivi errati o non conformi vengono individuati, gli strumenti delle skill dichiarano le verifiche effettivamente svolte e il caso dei `require` tardivi ripetuti non viene falsamente certificato dal solo grafo.
5. **Consolidare i test.** Integrare nel repository le prove utili, aggiornare il test della vecchia compilazione incrementale al nuovo contratto e verificare le piattaforme supportate. Completato quando i criteri della sezione successiva sono coperti, con eventuali limiti dichiarati.
6. **Allineare documentazione, esempi e skill.** Un solo contratto e una sola sintassi consigliata; istruzioni di migrazione, estensioni obbligatorie e riavvio spiegati; package incluso nei workspace versionati. Completato quando gli esempi generati non reintroducono le forme ritirate e i fixture in sola lettura sono autosufficienti.
7. **Migrare VU e GT con il motore pronto.** Attività sulla macchina che possiede i repository; l'implementazione nel motore non deve presumere di avervi accesso. Completato dopo baseline, migrazione e verifiche comparative descritte sotto.

Regole di lavoro: vedi «Decisioni finali del proprietario» in testa al documento.

## 9. Criteri di accettazione

| Area | Risultato richiesto |
|---|---|
| Alias transitivi | Handler → helper → helper tramite `#shared` funziona a profondità diverse, senza dipendenza dall'ordine di caricamento. Copiare un endpoint a un'altra profondità non richiede cambiare l'import condiviso. |
| Ambito del package | Funzionamento sotto un progetto contenitore ESM e indipendenza di due workspace con alias identici. |
| Inizializzazione | Package assente preparato prima del primo script quando creabile, con creazione segnalata; package incompatibile preservato; modifica/introduzione tardiva riconosciuta anche dopo chiusura e riapertura del runtime nello stesso processo. |
| Workspace in sola lettura | Con package valido funzionano gli alias; senza package, impossibilità di creazione segnalata e normali script senza alias ancora caricabili. Testare anche endpoint statici e nessuna scrittura riuscita nel workspace. |
| Compatibilità degli alias | Accettato il package standard con `type` assente o CommonJS; preservati campi innocui; alias esterni al contratto segnalati; ulteriori mapping nello spazio `#shared/` individuati come incompatibili. |
| Diagnostica | Distinti file assente, estensione mancante, ambito annidato e configurazione non applicata; import legacy dalla radice spiegato con la migrazione corretta; causa originale disponibile. |
| Dipendenze e confini | Relativi locali, moduli Node e pacchetti npm funzionano; la pulizia del workspace non modifica il ciclo di vita di npm o di altri workspace. |
| Reload degli helper | Aggiornati helper diretti e transitivi, anche con data e dimensione identiche; un errore e la successiva correzione non lasciano codice obsoleto permanente. |
| Richieste in corso | Una richiesta sospesa durante il reload conserva i riferimenti precedenti; una nuova richiesta usa il nuovo codice. |
| Endpoint con errore | La rotta valida precedente è conservata secondo la politica corrente, la diagnostica lo segnala e gli endpoint validi vengono aggiornati. |
| Stato e sequenze | La ricompilazione conserva `state`, `sharedState` e cursori a configurazione invariata; restano corretti i reset espliciti o conseguenti a cambi di scenario. |
| Stream | SSE e WebSocket invariati restano aperti; le modifiche rilevanti chiudono solo le connessioni previste dalle regole correnti. |
| Copertura completa | Validazione di endpoint disabilitati, varianti inattive e middleware; corretta attivazione successiva di una variante validata. |
| Accesso alla validazione | Stesso nucleo via admin e CLI; comando utilizzabile senza server; skill esplicita quando ha svolto soltanto controlli di formato. La validazione non installa rotte né resetta gli store. |
| Salvataggio admin | Script compilabile e risolvibile con violazione del contratto salvato con avvisi nella risposta API e visibili nell'editor; lo stesso script produce errore nella validazione completa esplicita. Errori effettivi di compilazione/risoluzione continuano a impedire il salvataggio con il comportamento attuale. |
| Coerenza fra validazione e reload | A file e configurazione invariati, stessa risoluzione e contenuti freschi per gli script controllati da entrambi; differenze limitate alla severità prevista e alla copertura degli inattivi. Nessuna purga di una validazione intercalata a una scansione in corso. |
| Contratto degli import | Segnalazione degli entrypoint importati e dei comuni `require` tardivi/dinamici, incluso il caso che richiede nuovamente un helper già noto. |
| Parser e percorsi espliciti | Stringhe/commenti non scambiati per import; parser compatibile con il CommonJS del motore; relativi senza estensione segnalati dal validatore e relative dipendenze esplicite stabili rispetto all'aggiunta di candidati alternativi. |
| Percorsi e desktop | Radice raggiunta via symlink su Linux, junction/percorso reale su Windows e alias nel runtime Electron impacchettato. Verifica dell'effettivo riavvio del processo degli script. |
| Salvataggi concorrenti | Modifiche durante una scansione confluiscono nel giro successivo senza perderne la richiesta; esito finale coerente dopo l'ultimo salvataggio. |
| Prestazioni | Nessuna regressione significativa rispetto al benchmark locale sui workspace rappresentativi; non trasformare i valori misurati in una soglia universale. |

## 10. Migrazione dei workspace VU e GT

Repository disponibili sulla macchina dell'altro agente:

- `/home/tosdan/projects/vu-web-mockxy`
- `/home/tosdan/projects/gt-web-mockxy`

Questa migrazione sostituisce il vecchio incarico limitato ai prefissi relativi verso `_shared`: include ora il package del workspace, gli import negli helper quando necessario, la ricollocazione di `_lib` e l'estrazione delle implementazioni dagli entrypoint.

Procedura:

1. Verificare la build effettivamente in uso con `GET /_admin/api/info` e che includa il nuovo contratto. La sola condizione «versione successiva alla 1.4.2» del vecchio incarico non certifica queste modifiche.
2. Partire da un working tree pulito su un nuovo branch, senza cancellare o accantonare automaticamente lavoro altrui.
3. Registrare prima della migrazione: caricamento di tutti gli script, test disponibili, diagnostica `GET /_admin/api/runtime/status` e risposte rappresentative. Separare gli errori preesistenti.
4. Preparare `mocks/package.json` e pianificare un avvio del processo che lo veda prima del primo script. La migrazione di un workspace già caricato richiede il riavvio effettivo.
5. Risolvere davvero ogni import dalla cartella del chiamante. Migrare verso `#shared/...` i riferimenti agli helper ricollocati/condivisi, mantenere i relativi locali validi, non modificare pacchetti npm o moduli Node. Un percorso mancante si segnala e non si indovina.
6. Portare gli helper di GT da `_lib` a sottocartelle appropriate di `_shared`, aggiornando i riferimenti e verificando collisioni di nomi e percorsi relativi interni. Non serve riscrivere la logica funzionale degli helper.
7. Estrarre le implementazioni riusabili dei due handler VU e tre handler GT individuati dall'audit; i punti di ingresso e le altre varianti importano gli helper, senza importarsi fra loro.
8. Eseguire il validatore completo con il nuovo contratto, i test dei workspace e il reload reale. Controllare anche modifiche transitive e attivazione di varianti inattive.
9. Chiamare almeno un endpoint migrato per ogni helper condiviso interessato e confrontare status, corpo e header significativi con la baseline. Per i flussi stateful riprodurre lo stesso stato iniziale e la stessa sequenza di richieste; spiegare eventuali campi variabili senza ignorare differenze funzionali.
10. Confermare assenza di errori runtime nuovi e produrre un resoconto: versione/build, file modificati, import cambiati, import lasciati invariati con motivazione, errori preesistenti e risultati delle verifiche. Nessun commit o push automatico.

## 11. Chiusura del confronto

Non restano obiezioni architetturali aperte fra le revisioni: l'accordo tecnico comprende alias nativi, contratto degli script, ricompilazione completa, diagnostiche e validatore condiviso. Il chiarimento sul salvataggio admin è accolto nel §6.B e nei criteri del §9.

Il lavoro segue l'ordine del §8. Ogni resoconto di implementazione distingue differenze del codice corrente, interventi eseguiti e copertura dei test.
