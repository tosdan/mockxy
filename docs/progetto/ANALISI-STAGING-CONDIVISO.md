# Analisi — Mockxy come server di staging condiviso

Stato: **analisi chiusa con le decisioni D1–D9 (§9); il piano risultante è in §6**

Data: 25 ottobre 2026

Ambito: assetto di deployment, sicurezza dell'admin API, isolamento tra sviluppatori,
operatività, rete e instradamento, passaggio da mock a reale, monitor in team.

Le sezioni 2–5 sono l'analisi esplorativa di partenza e restano come contesto delle scelte;
dove una decisione di §9 le contraddice, vale la decisione. Questo documento raccoglie cosa manca a Mockxy per servire bene un caso d'uso che oggi è
possibile solo forzandolo. Ogni lacuna riporta lo stato attuale verificato nel codice, perché
conta nello scenario e una proposta di massima. Le proposte non sono specifiche: quando una voce
viene scelta, passa in `BACKLOG-PRODOTTO.md` e riceve un design suo.

## 1. Lo scenario

Un team sviluppa un'applicazione. In un ambiente di **staging interno**, raggiungibile da tutti i
dev e dal QA, Mockxy sta tra il frontend e il backend:

- le chiamate che il backend **già implementa** passano al backend vero;
- le chiamate che il frontend ha implementato **prima del backend** ricevono un mock;
- man mano che il backend matura, il confine si sposta verso il reale.

È lo scenario «Il backend non c'è ancora (e il confine si sposta)» di
[SCENARI.md](../it/SCENARI.md), con una differenza decisiva: non è più un dev solo sulla sua
macchina, ma **un processo condiviso, a lunga vita, usato da molte persone insieme**.

Precisato durante le decisioni (D3): lo staging è un ambiente di prova end-to-end **congelato**,
con il suo frontend deployato. Non è un banco di lavoro a cui i dev puntano il frontend locale
per personalizzarlo; Mockxy riempie i buchi dove il frontend è più avanti del backend.

## 2. Esito in breve

Il motore copre già bene il meccanismo di base (proxy fallback, CORS, cookie, redirect,
`x-mock-source`, varianti, sequenze, handler con stato). Mancano tre cose, in ordine di peso:

1. **Un assetto adatto.** L'immagine standalone, pensata per gli ambienti condivisi, ha il proxy
   spento; l'assetto di sviluppo ha il proxy ma espone un'admin API senza autenticazione che
   esegue codice. Lo scenario cade esattamente tra i due (§4).
2. **L'isolamento tra sviluppatori.** Tutto lo stato che decide la risposta è globale: chi
   seleziona la variante «500» la impone a tutto il team (§5.2).
3. **Gli attrezzi di un servizio**: health check, log strutturati, gestione di un reverse proxy
   davanti, ricarica dei mock senza riavvio (§5.3, §5.4).

Le due funzioni che più renderebbero l'uso **comodo**, oltre che possibile, sono la scelta dello
scenario per singola richiesta (§5.2.2) e la modalità «prima il backend, poi il mock» (§5.5.1).

## 3. Cosa c'è già

Per non riproporre ciò che esiste:

| Bisogno dello scenario | Copertura attuale |
|---|---|
| Mock dove c'è, backend dove manca | [proxy fallback](../it/PROXY.md), per richiesta |
| Spostare il confine | abilitazione per endpoint e per collezione, proxy totale |
| Frontend nel browser su altra origin | `CORS_ENABLED`, con `X-Total-Count` e `x-mock-source` esposti al JS (`src/app.js:931`) |
| Sessioni del backend attraverso Mockxy | `ADAPT_PROXY_COOKIES`, `REWRITE_PROXY_REDIRECTS` |
| Sapere chi ha risposto | header `x-mock-source`, provenienza nel Monitor |
| Stati difficili da riprodurre | varianti, ritardi, sequenze |
| Flussi GET → POST → GET | stato runtime condiviso degli handler |
| Arresto pulito | gestione di `SIGINT`/`SIGTERM` (`src/server.js:553`) |
| Limiti di memoria | body degli handler 2 MB, middleware 10 MB, cattura del Monitor 156 KB, dump a rotazione |
| Mock versionati e condivisi | workspace su file, in git |

## 4. Il buco tra i due assetti

| | Assetto di sviluppo (`Dockerfile`, `node index.js`) | Immagine standalone (`Dockerfile.standalone`) |
|---|---|---|
| Proxy fallback | sì | **no** (`PROXY_FALLBACK_ENABLED=false`) |
| Admin API e interfaccia | sì, **senza autenticazione** | no |
| Monitor e Storico | sì | no |
| Ricarica dei mock | watch dei file | **nessuna** (vedi §5.3.4) |
| Esposizione in rete | sconsigliata con admin attiva ([RETE.md](../it/RETE.md)) | sicura |

Lo scenario chiede il proxy della prima colonna e la sicurezza della seconda. Oggi l'unica via è
l'assetto di sviluppo con `HOST=0.0.0.0` su una rete «fidata»: chiunque raggiunga la porta può
creare un handler, cioè eseguire JavaScript sul server di staging.

Una variabile da sola non basta. `PROXY_FALLBACK_ENABLED=true` sulla standalone dà il proxy ma
toglie Monitor, Storico e qualunque modo di cambiare il confine senza un nuovo deploy.

## 5. Le lacune

### 5.1 Sicurezza e assetto

#### 5.1.1 Un profilo «staging condiviso»

**Oggi.** Due profili, nessuno dei due adatto (§4).

**Proposta.** Un terzo profilo, documentato in [DEPLOYMENT.md](../it/DEPLOYMENT.md) e con un suo
compose:

- proxy fallback attivo, `BACKEND_URL` obbligatorio all'avvio;
- mock e file dati montati in sola lettura, aggiornati da git (§5.3.4);
- admin API attiva **in sola lettura** per chiunque: catalogo, Monitor, Storico, stato runtime;
- scritture disponibili solo con credenziali (§5.1.2), e comunque **senza** creazione o modifica
  di codice (handler, middleware) via rete (§5.1.3).

**Da decidere.** Se in questo profilo le scritture sui mock hanno senso, o se il workspace si
cambia solo via git e l'interfaccia resta una vetrina più gli interruttori di sessione (§5.2.2).

#### 5.1.2 Autenticazione dell'admin API

**Oggi.** Nessuna. L'unica guardia è l'allowlist dell'header `Host`
(`ADMIN_ALLOWED_HOSTS`), che difende dal DNS rebinding ma non identifica nessuno.

**Proposta minima.** Un token statico (`ADMIN_TOKEN`, header `Authorization: Bearer`) con due
livelli: lettura e scrittura. L'interfaccia lo chiede una volta e lo conserva nella sessione del
browser. Più avanti, opzionalmente, l'identità da un reverse proxy con SSO (header fidato tipo
`X-Forwarded-User`), che darebbe anche un nome all'audit (§5.6.4).

**Costo.** Medio: tocca l'admin router, l'interfaccia (login, gestione del `401`), le skill e
l'OpenAPI dell'admin. L'app desktop resta senza token.

#### 5.1.3 Niente esecuzione di codice via rete

**Oggi.** Creare o modificare un handler o un middleware scrive JavaScript che il motore esegue.
È la ragione per cui l'admin in rete è pericolosa.

**Proposta.** Nel profilo staging, i tipi di risposta che sono codice si **leggono** ma non si
scrivono via admin: arrivano solo da git, dove passano per una review. Anche con il token di
scrittura. È una difesa in profondità: un token trapelato non diventa esecuzione di codice.

### 5.2 Isolamento tra sviluppatori

#### 5.2.1 Oggi tutto lo stato è globale

Lo stato che decide quale risposta riceve una richiesta è unico per processo:

| Stato | Dove vive | Effetto in team |
|---|---|---|
| Server acceso/spento, proxy totale | `ServerStateStore` (`src/server-state.js`) | uno spegne i mock per tutti |
| Variante selezionata | `selectedResponseFile` nei **file** dell'endpoint | uno sceglie «500», tutti ricevono `500`; e il file in git cambia |
| Avanzamento delle sequenze | `SequenceStateStore`, chiave `METHOD path` | le richieste di dev diversi consumano la stessa sequenza |
| Memoria degli handler | `HandlerStateStore`, chiave `METHOD path` | contatori e stato mescolati |
| Stato condiviso degli handler | `SharedStateStore`, per nome | gli elementi creati da un dev compaiono a tutti; un reset li azzera a tutti |
| Configurazione effimera | `runtime-config` (`PATCH /_admin/api/config`) | un ritardo globale messo da uno rallenta tutti |

Per un dev solo è il comportamento giusto. In uno staging condiviso è la principale fonte di
interferenze, ed è il punto che più distingue «possibile» da «comodo».

#### 5.2.2 Scelta per richiesta: header o cookie di sessione

**Proposta.** Il client può dichiarare, per la singola richiesta, come vuole essere servito,
senza toccare lo stato globale:

- `x-mockxy-variant: <endpoint>=<variante>` o, meglio, `x-mockxy-scenario: <nome>` che rimanda a
  un preset di varianti (l'idea n. 2 di [IDEE-FUTURE.md](IDEE-FUTURE.md) diventa qui il
  fondamento);
- `x-mockxy-bypass: 1` per forzare il backend vero solo per sé («com'è il reale su questa
  chiamata?»);
- gli stessi valori da un **cookie** impostato dall'interfaccia di Mockxy, così il dev non deve
  modificare il frontend: sceglie lo scenario nell'interfaccia e il suo browser lo porta con sé.

Le richieste senza header né cookie ricevono il comportamento di default del workspace, quello
in git.

**Rischio.** Il cookie viaggia solo se frontend e Mockxy condividono il dominio (o con CORS e
credenziali); il caso «stesso host dietro reverse proxy» è quello naturale. Gli header vanno
tolti prima di inoltrare la richiesta al backend.

#### 5.2.3 Sequenze e stato degli handler per sessione

**Proposta.** Una chiave di sessione (dal cookie di §5.2.2, o da un header) che entra nella
chiave di `SequenceStateStore`, `HandlerStateStore` e, opzionalmente, `SharedStateStore`.
Senza sessione, comportamento attuale. Il flusso GET → POST → GET di un dev non sporca quello
di un altro, e il reset di uno non azzera gli altri.

**Costo.** Alto per lo stato condiviso, che ha limiti di memoria pensati per un solo spazio:
con N sessioni vanno ripensati quote ed eviction (oggi esplicitamente escluse, §19.21 di
[ANALISI-STATO-RUNTIME-CONDIVISO.md](ANALISI-STATO-RUNTIME-CONDIVISO.md)). Sequenze e memoria
degli handler sono più semplici.

#### 5.2.4 Gli interruttori globali vanno protetti

Anche con §5.2.2, server spento, proxy totale e configurazione effimera restano globali. Nel
profilo staging andrebbero dietro il livello di scrittura (§5.1.2) e mostrati in modo vistoso
nell'interfaccia di tutti quando non sono al default.

### 5.3 Operatività

#### 5.3.1 Health e readiness

**Oggi.** Nessun endpoint dedicato. `GET /_admin/api/runtime/status` esiste ma vive sotto
l'admin, che nella standalone è spenta.

**Proposta.** `GET /_mockxy/health` (o simile, fuori dal namespace dei mock e senza admin) con:
stato del registro dei mock, errori di caricamento, raggiungibilità del backend (§5.3.5). Serve
a Docker, Kubernetes e al load balancer. Il prefisso va scelto in modo da non collidere con i
percorsi dei mock, come oggi `/_admin`.

#### 5.3.2 Log strutturati

**Oggi.** Già coperti: il logger scrive JSON su stdout (`src/utils/logger.js`), con una riga
«Request completed» per richiesta che riporta metodo, percorso, provenienza (`mode`), status e
durata (`src/app.js:1062`). Con l'admin spenta (D2) sono l'unica finestra sul traffico dello
staging.

**Proposta.** Solo arricchirli: la variante servita (file della response) e l'id dell'endpoint,
per sapere *quale* mock ha risposto, non solo *che* ha risposto un mock.

#### 5.3.3 Metriche

**Proposta.** Contatori minimi, eventualmente in formato Prometheus: richieste per provenienza
(`mock`, `backend`, `handler`, …), `502` verso il backend, latenza dell'upstream. Dicono a colpo
d'occhio quanto dello staging è ancora finto.

#### 5.3.4 Ricarica dei mock senza riavvio

**Oggi.** Nella standalone il watch è spento (`DEV_WATCH=false`) e l'admin anche: dopo un
`git pull` i mock **non** si ricaricano fino al riavvio del container (`startMockWatcher` esce
subito senza watch, `src/server.js:224`). [DEPLOYMENT.md](../it/DEPLOYMENT.md) dice invece che
si aggiornano «senza rebuild né riavvio»: la frase va corretta indipendentemente da questa
analisi.

**Proposta.** Uno fra: ricarica su `SIGHUP`; endpoint di ricarica protetto (webhook dal CI dopo
il merge); watch in polling anche in produzione, attivabile. Insieme, la **versione servita**
(commit dei mock, se il workspace è un repository git) visibile nell'interfaccia e nell'health:
«quale versione dei mock sta rispondendo?» è la prima domanda quando qualcosa non torna.

#### 5.3.5 Stato del backend

**Proposta.** Un controllo periodico leggero del backend, o semplicemente la statistica degli
ultimi errori di connessione, mostrato nella barra di stato e nell'health: «backend
irraggiungibile da 5 minuti» spiega una pioggia di `502` prima che qualcuno apra un bug.

### 5.4 Rete e instradamento

#### 5.4.1 Dietro un reverse proxy

**Oggi.**

- La riscrittura dei redirect produce sempre `http://` (`src/proxy/proxy.js:188`): dietro un
  reverse proxy HTTPS il browser riceve un `Location` in chiaro.
- `X-Forwarded-Host` e `X-Forwarded-Proto` non sono letti (nessuna occorrenza nel codice):
  l'host usato nella riscrittura è quello visto da Mockxy, non quello pubblico.
- In HTTPS il default di `ADAPT_PROXY_COOKIES` toglie `Secure` e `SameSite=None`: corretto in
  locale su http, sbagliato quando il frontend è servito in HTTPS.

**Proposta.** `TRUST_PROXY=true` (o una lista di proxy fidati): legge `X-Forwarded-Proto` e
`X-Forwarded-Host` per scheme e host della riscrittura e per decidere l'adattamento dei cookie.
Il profilo staging (§5.1.1) ne fissa i default.

#### 5.4.2 L'IP del client verso il backend

**Oggi.** Gli header `X-Forwarded-*` non sono hop-by-hop (`HOP_BY_HOP_HEADERS`,
`src/proxy/proxy.js:87`): quelli impostati da un reverse proxy davanti a Mockxy arrivano al
backend così come sono, con l'IP vero del client. Mockxy non aggiunge il proprio passaggio alla
catena, e senza reverse proxy davanti il backend vede l'IP di Mockxy.

**Proposta.** Nessuna, salvo una domanda concreta: nella topologia con reverse proxy il backend
riceve già ciò che gli serve. Aggiungere il proprio passaggio a `X-Forwarded-For` conta solo per
backend che contano i proxy fidati per posizione.

#### 5.4.3 Più backend per prefisso

**Oggi.** Un solo `BACKEND_URL` per workspace.

**Proposta.** L'idea n. 4 di [IDEE-FUTURE.md](IDEE-FUTURE.md): regole per prefisso
(`/api/ordini` → servizio A, `/auth` → servizio B), con eventuale riscrittura del prefisso. In
uno staging a microservizi è spesso la condizione per poter mettere Mockxy davanti a tutto.

#### 5.4.4 TLS verso il backend

**Oggi.** Il proxy usa `https` di Node senza opzioni TLS proprie. Una CA interna funziona già con
`NODE_EXTRA_CA_CERTS` (da documentare); mTLS e certificati client no.

**Proposta.** Documentare `NODE_EXTRA_CA_CERTS`; aggiungere certificato client e chiave solo
davanti a una domanda concreta.

#### 5.4.5 Header iniettati verso il backend

**Proposta.** Header fissi aggiunti alle richieste inoltrate (token tecnico, header di ambiente,
`X-Mockxy: 1` perché il backend sappia di essere dietro Mockxy). Piccola, utile anche fuori dallo
staging.

### 5.5 Il passaggio da mock a reale

È il cuore dello scenario: il confine si sposta di continuo, e oggi lo sposta a mano qualcuno
che deve ricordarsene.

#### 5.5.1 Prima il backend, poi il mock

**Proposta.** Una modalità per endpoint (o per collezione): la richiesta va **prima al backend**;
se risponde `404`, `405`, `501` o non è raggiungibile, risponde il mock. Quando il backend
implementa l'endpoint, il mock smette da solo di rispondere, senza che nessuno debba spegnerlo.
`x-mock-source` dice ogni volta chi ha risposto.

**Rischi.**

- Il body della richiesta va bufferizzato per poterlo rigiocare sul mock (o sull'handler) dopo
  il tentativo: serve un limite, come per i middleware.
- Gli status che significano «non implementato» variano tra backend: la lista va configurabile.
- Una POST non idempotente arriva al backend anche quando poi risponde il mock: accettabile solo
  se il backend non l'ha eseguita (`404`/`501`). Il caso «backend raggiungibile ma `500`» non
  deve ricadere sul mock.
- Latenza doppia sugli endpoint ancora mockati.

#### 5.5.2 Modalità ombra e deriva del contratto

**Proposta.** Per gli endpoint mockati, Mockxy chiama anche il backend in parallelo, solo GET
(o metodi dichiarati sicuri), senza usarne la risposta, e annota:

- «il backend ora risponde `2xx` su questa rotta: il mock si può spegnere»;
- «la forma della risposta reale differisce dal mock in questi campi» (confronto strutturale di
  chiavi e tipi, non dei valori).

Il team scopre quali mock sono superflui o ormai disallineati senza fare il confronto a mano.

**Costo.** Medio-alto; il confronto strutturale è la parte delicata. Si appoggia al Monitor per
mostrare gli esiti.

#### 5.5.3 Quadro d'avanzamento

**Proposta.** Una vista o un report: endpoint mockati, già reali, mai chiamati, con le date
dell'ultimo traffico. Con una specifica OpenAPI importata, il confronto con la specifica dice
anche cosa manca del tutto. Si costruisce sui dati che Monitor e Storico già raccolgono.

#### 5.5.4 Risposta finta riconoscibile

**Oggi.** `x-mock-source` è già esposto al JS cross-origin; il nome della variante no.

**Proposta.** Un header con la variante servita (`x-mockxy-variant`) e una ricetta documentata
in [FRONTEND.md](../it/FRONTEND.md) per mostrare nel frontend di staging un badge «dati finti».
Senza, il QA apre bug su dati mockati.

### 5.6 Team e workspace

#### 5.6.1 Più workspace su un'istanza

**Proposta.** Workspace scelti per prefisso di percorso o per host (`feature-x.mock.staging…`),
per i branch del frontend che hanno bisogno di mock diversi. Alternativa senza modifiche al
motore: un container per workspace dietro il reverse proxy, documentato come ricetta. Da
valutare se la seconda basta.

#### 5.6.2 Monitor con più utenti

**Oggi.**

- Il Monitor tiene **250 voci** in memoria (`DEFAULT_MONITOR_LIMIT`,
  `src/monitoring/request-monitor.js:5`): con un team intero scorrono in pochi minuti.
- Le voci non registrano l'indirizzo del client; si può risalire solo dagli header.

**Proposta.** Limite configurabile; indirizzo del client (con `X-Forwarded-For` se fidato,
§5.4.1) e un filtro per client, user agent o identità (header o `sub` del JWT). Ogni dev vede il
proprio traffico. Lo Storico copre già il traffico più vecchio.

#### 5.6.3 Dati personali

Dallo staging arrivano body con dati realistici, talvolta personali, che finiscono anche negli
archivi su disco. Servono retention a tempo (oggi solo a dimensione) e mascheramento
configurabile di campi del body, oltre a quello già presente per gli header sensibili.

#### 5.6.4 Audit

Se nel profilo staging restano scritture via admin: chi ha cambiato quale endpoint, variante o
interruttore, e quando. Ha senso solo con un'identità (§5.1.2).

### 5.7 Robustezza

- **Istanza singola.** Sequenze e stato degli handler vivono nel processo: un riavvio li azzera
  e non si può scalare su più repliche. Per uno staging va bene; va scritto chiaramente nella
  guida del profilo, con la conseguenza pratica (niente repliche dietro il load balancer).
- **Concorrenza.** Nessun limite alle richieste concorrenti verso il backend: da valutare solo
  se lo staging mostra problemi reali.

## 6. Piano risultante

Le decisioni di §9 riducono il lavoro a poche modifiche al motore e a una guida. Il «profilo
staging» non è un'immagine nuova: è l'immagine standalone di oggi con `PROXY_FALLBACK_ENABLED=true`,
`BACKEND_URL` e `TRUST_PROXY=true`.

**Motore.**

1. **`TRUST_PROXY`** (D5): con l'opzione attiva, redirect riscritti con protocollo e host da
   `X-Forwarded-Proto`/`X-Forwarded-Host`; con `X-Forwarded-Proto: https` i cookie perdono solo
   `Domain`. Nuova voce in `src/config.js`, nel censimento delle configurazioni e in `.env.example`.
2. **`GET /_admin/health`** servito anche con l'admin spenta (D7): `200`, o `503` con i file
   rotti del workspace; riporta `MOCKS_VERSION`.
3. **`MOCKS_VERSION`** (D7) nell'health e nel log di avvio.
4. **Endpoint e variante** nella riga di log «Request completed» (D7).

**Documentazione.**

5. **Correzione di [DEPLOYMENT.md](../it/DEPLOYMENT.md)** (D6): con watch e admin spenti, i mock
   aggiornati richiedono il riavvio. Da fare anche da sola, è un errore di oggi.
6. **Guida del profilo staging**, in `docs/it` e `docs/en`, con:
   - il compose d'esempio (l'attuale `docker-compose.staging.yml` è solo-mock: da decidere in
     fase di implementazione se affiancarne uno o parametrizzarlo);
   - la topologia tipica: reverse proxy che serve il frontend e manda `/api` a Mockxy, stessa
     origine, CORS non necessario, `TRUST_PROXY=true` (D5);
   - l'aggiornamento: `git pull`, riavvio con `MOCKS_VERSION=$(git rev-parse --short HEAD)`,
     controllo dell'health (D6, D7);
   - `NODE_EXTRA_CA_CERTS` per la CA interna; header tecnici nel reverse proxy (D9);
   - l'admin spenta e perché (D2); un backend per istanza (D8);
   - le regole per i mock destinati allo staging: varianti di default in git, sequenze con
     `resetAfterMs`, stato condiviso come database azzerato al riavvio (D3);
   - il processo per spostare il confine: una PR che disabilita il mock quando il backend
     rilascia l'endpoint, da legare alla checklist di rilascio del backend (D4).

**Rimandato** (da riprendere su domanda concreta): interfaccia di sola consultazione (D2);
scenari e isolamento per sessione (D3); ricaduta automatica sul mock e segnali sui mock superflui
(D4); metriche (D7); più backend per prefisso (D8); header iniettati e mTLS (D9).

## 7. Domande aperte

Nessuna sulle scelte di fondo: le domande della prima stesura hanno trovato risposta in D1–D4.
Restano dettagli da sciogliere in implementazione: il compose del profilo staging (punto 6),
e se l'health espone i nomi dei file rotti o solo il loro numero.

## 8. Fuori ambito

- **Multi-tenant vero** (utenti, permessi per workspace, persistenza in database): Mockxy resta
  uno strumento di sviluppo, non un servizio gestito.
- **Alta disponibilità e repliche** (§5.7): un'istanza per ambiente di staging.
- **Più workspace su un'istanza** (§5.6.1): con un ambiente congelato (D3) e il rilascio per
  pull e riavvio (D6), ogni staging ha il suo container.
- **Tunnel pubblici**: già scartati in [IDEE-FUTURE.md](IDEE-FUTURE.md) per la stessa ragione di
  sicurezza, che qui pesa ancora di più.

## 9. Decisioni

Le questioni si affrontano una alla volta, nell'ordine in cui ogni scelta semplifica le
successive. Ogni decisione registra l'alternativa scelta e il perché.

### D1 — I mock dello staging si modificano solo via git

Nel profilo staging l'admin API non scrive file del workspace: niente creazione o modifica di
endpoint, varianti, collezioni, file dati, handler e middleware, niente «crea mock» dal Monitor
o dallo Storico. I mock si cambiano con una PR sul repository (preparati in locale con l'app
desktop); dopo il merge lo staging si ricarica (§5.3.4).

**Perché.** È coerente con il principio della standalone (l'applicazione si distribuisce, i dati
si montano) e con il flusso naturale di Mockxy: si scrive in locale, lo staging serve. Toglie in
un colpo l'esecuzione di codice via rete (§5.1.3), la deriva del server rispetto a git e
l'interferenza delle modifiche permanenti. Il bisogno di chi è in staging («questo endpoint in
errore, solo per me») è coperto dalla scelta per sessione (§5.2.2), che non scrive niente.

**Scartate.** Scrittura dall'interfaccia con token (deriva rispetto a git, commit automatici,
audit); strato temporaneo sopra git (il più costoso, concetto nuovo nel motore e
nell'interfaccia).

**Conseguenza.** §5.1.2 si riduce a chi può leggere il traffico e chi può usare le azioni
runtime che non scrivono file; §5.6.4 (audit) esce dall'ambito.

### D2 — Nello staging l'admin API è spenta

Nella prima fase il profilo staging non espone l'admin API né l'interfaccia, come oggi
l'immagine standalone: nessuna lettura (catalogo, Monitor, Storico) e nessuna azione runtime
(interruttori, configurazione effimera, reset, push SSE/WS). Il comportamento si cambia solo con
git (D1) e con la configurazione del deploy.

**Perché.** Toglie in un colpo l'intera superficie da proteggere: niente token, niente identità,
niente dati del traffico consultabili. Si decide in un secondo momento se e come aprire una
consultazione.

**Rimandato.** Un'interfaccia di **sola consultazione** (catalogo, Monitor, Storico, stato del
runtime), senza azioni. Da progettare in futuro insieme a chi può vederla: le opzioni valutate
(lettura libera, token in lettura, identità dal reverse proxy) restano in §5.1.2.

**Conseguenze.**

- Health (§5.3.1) e ricarica dei mock (§5.3.4) devono funzionare **fuori** dall'admin API.
- Gli interruttori globali (§5.2.4) e l'audit (§5.6.4) escono dall'ambito; il Monitor per più
  utenti (§5.6.2) e il quadro d'avanzamento (§5.5.3) aspettano l'interfaccia di consultazione.
- Senza reset da admin, sequenze e stato condiviso degli handler si azzerano solo con
  `resetAfterMs`, una ricarica o un riavvio: l'isolamento per sessione (§5.2.3) pesa di più.

### D3 — Lo staging è un ambiente congelato: nessun isolamento per utente

**Chiarimento dello scenario.** Lo staging è un ambiente di prova end-to-end con il **suo
frontend deployato**, non un backend a cui i dev puntano il frontend della propria macchina per
svilupparlo. Chi lo usa riceve l'ambiente così com'è, **congelato** nella versione deployata.
Il frontend deployato è spesso più avanti del backend: per gli endpoint che il backend non ha
ancora, rispondono i mock. Mockxy è un **riempitivo dei buchi**, non un banco di lavoro.

**Decisione.** Nessun meccanismo di isolamento o personalizzazione per utente: niente header di
sessione, scenari per richiesta o cookie (§5.2.2, §5.2.3 fuori ambito per lo staging). Tutti
ricevono il comportamento scritto in git.

**Conseguenze sui mock destinati allo staging.**

- Lo stato condiviso degli handler è accettabile: si comporta come il database di staging, e si
  azzera al riavvio o cambiando la `seedKey` via git.
- Le sequenze hanno un cursore unico per endpoint: con più utenti si consumano a vicenda. Nei
  mock destinati allo staging vanno usate con `resetAfterMs`, o evitate.
- Gli stati alternativi (errori, liste vuote, casi limite) si provano in locale con l'app
  desktop, non in staging.

### D4 — Il confine mock → reale si sposta solo via git

Quando il backend rilascia un endpoint in staging, una PR disabilita (o rimuove) il mock
corrispondente. Mockxy non introduce né la ricaduta automatica sul mock (§5.5.1) né segnali
sui mock diventati superflui (§5.5.2).

**Perché.** È coerente con l'ambiente congelato (D3): il comportamento dello staging cambia solo
con un commit, tracciabile e revisionato. La ricaduta automatica rischierebbe di coprire `404`
legittimi del backend proprio nei test end-to-end.

**Rischio accettato.** Un mock dimenticato continua a rispondere anche dopo il rilascio del
backend. Si gestisce con il processo del team (per esempio una voce nella checklist di rilascio
del backend), non con il motore.

### D5 — Dietro un reverse proxy: `TRUST_PROXY` esplicito

Una nuova opzione del motore, `TRUST_PROXY` (default `false`). Attiva, Mockxy legge
`X-Forwarded-Proto` e `X-Forwarded-Host` quando presenti:

- la riscrittura dei redirect (`REWRITE_PROXY_REDIRECTS`) usa protocollo e host pubblici invece
  di `http://` e dell'header `Host` visto da Mockxy (§5.4.1);
- con `X-Forwarded-Proto: https`, l'adattamento dei cookie (`ADAPT_PROXY_COOKIES`) toglie solo
  `Domain` e lascia `Secure` e `SameSite=None`, così lo staging si comporta come la produzione.

Spenta, il comportamento resta quello di oggi. La documentazione aggiunge una ricetta della
topologia tipica (reverse proxy che serve il frontend e manda `/api` a Mockxy, stessa origine,
CORS non necessario) e il profilo staging (§5.1.1) la imposta a `true`.

**Perché esplicita.** È il comportamento più conservativo e in linea con Express e strumenti
simili: Mockxy si fida degli header di un proxy solo quando gli si dice che il proxy c'è.

**Scartate.** Lettura sempre attiva (cambio di default, anche se a basso rischio); solo
documentazione con `proxy_redirect` di nginx (non copre Traefik e Ingress, e i cookie perdono
comunque `Secure`).

### D6 — I mock arrivano con `git pull` sul server e riavvio del container

Il profilo staging monta mock e file dati dal filesystem dell'host, come la standalone di oggi.
Dopo il merge di una modifica ai mock (D1), sul server si esegue `git pull` e si riavvia il
container. Nessun meccanismo di ricarica a caldo; il riavvio azzera anche lo stato condiviso
degli handler e le sequenze, coerente con un ambiente congelato (D3).

**Da fare comunque.** Correggere [DEPLOYMENT.md](../it/DEPLOYMENT.md), che oggi promette
l'aggiornamento dei mock «senza rebuild né riavvio»: con watch e admin spenti serve il riavvio.

**Scartate.** Immagine derivata per ogni versione dei mock (build in CI a ogni modifica);
ricarica a caldo su segnale o con watch in polling (codice nuovo e gestione dello stato
degradato).

### D7 — Health, versione dei mock e variante nei log

- **Health.** `GET /_admin/health`, servito anche con l'admin API spenta (fuori dal suo router;
  `/_admin` è già un prefisso riservato, mai mockato). `200` se il workspace è caricato senza
  errori, `503` con i file rotti altrimenti: lo staging non risulta «sano» con un endpoint
  mockato sparito per un file rotto arrivato dal merge (rischio introdotto da D6).
- **Versione dei mock.** Variabile `MOCKS_VERSION`, impostata dallo script di riavvio (per esempio
  `MOCKS_VERSION=$(git rev-parse --short HEAD)`), riportata nell'health e nel log di avvio. La
  ricetta va nella guida del profilo staging.
- **Log.** La riga «Request completed» riporta anche l'endpoint e la variante (file della
  response) che hanno risposto.

**Scartate per ora.** Metriche in formato Prometheus (§5.3.3): i log JSON danno le stesse
informazioni a chi li aggrega; da riprendere se il team avrà un Prometheus da alimentare.

### D8 — Un solo backend per istanza

Resta un `BACKEND_URL` per istanza (§5.4.3 fuori ambito). Se lo staging espone più servizi
separatamente, lo smistamento per prefisso lo fa il reverse proxy davanti a Mockxy; se servono
mock su più servizi, si usa un'istanza di Mockxy per servizio.

**Perché.** Ogni pezzo fa il suo mestiere e il costo è zero; l'instradamento multiplo toccherebbe
il cuore del proxy (WebSocket in passthrough, riscrittura di redirect e cookie legate a un'unica
origine del backend). L'idea n. 4 di [IDEE-FUTURE.md](IDEE-FUTURE.md) resta nel vivaio per
l'uso locale.

### D9 — Verso il backend: solo documentazione

La guida del profilo staging documenta `NODE_EXTRA_CA_CERTS` (variabile standard di Node, con il
file della CA montato nel container) per i backend in HTTPS con una CA interna. Eventuali header
tecnici richiesti dal backend li aggiunge il reverse proxy davanti a Mockxy (D5), che li
inoltra intatti. Niente header iniettati dal motore (§5.4.5) né mTLS (§5.4.4), salvo una
domanda concreta.
