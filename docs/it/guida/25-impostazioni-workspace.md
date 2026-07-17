# 25 — Le impostazioni del workspace

La dialog **Impostazioni workspace** (dal menu dell'ingranaggio, nell'app desktop) raccoglie
tutte le regolazioni del workspace attivo. Questo capitolo la percorre voce per voce, con il
rimando al capitolo che approfondisce ciascun tema — è il capitolo-catalogo della parte VI, e
tornerà utile come riferimento.

Due regole generali prima delle voci:

- **al salvataggio il motore del workspace riparte** e la finestra si ricarica: le
  connessioni SSE/WS aperte vengono chiuse (i client riconnettono), e lo stato runtime —
  interruttori globali, cursori delle sequenze, `state` degli handler — si azzera;
- quasi tutto è **locale alla macchina**: le impostazioni vivono in
  `.mockxy/settings.json`, fuori da git ([capitolo 24](24-mock-come-file.md)). L'unica voce
  condivisa è il **titolo**, che sta nel segnaposto `mockxy.json` perché è un'etichetta del
  progetto, non una preferenza personale. Porta e backend URL di una macchina non avrebbero
  senso su quella di un collega — la separazione è progettata così.

Per chi esegue Mockxy in headless: ognuna di queste voci esiste come variabile d'ambiente,
con la stessa semantica — la corrispondenza completa è nel [capitolo 31](31-headless-docker.md).

> 📷 **SCREENSHOT** — `25-dialog-alto.png`
> Cosa mostrare: la parte alta della dialog — cartella (in sola lettura), titolo, porta,
> Backend URL e l'interruttore «Accessibile da tutta la rete» con l'avvertenza visibile.

## Identità e rete

- **Cartella** — il percorso del workspace, in sola lettura: un workspace non si "sposta"
  dalla dialog.
- **Titolo** — il nome mostrato nelle tab, condiviso col team via git; vuoto = nome della
  cartella.
- **Porta** — la porta del motore di questo workspace (1024–65535). Un cambio esplicito
  verso una porta occupata viene rifiutato con un errore, senza applicare nulla; la gestione
  delle porte stabili è nel [capitolo 28](28-desktop-workspace.md).
- **Backend URL** — il backend reale verso cui inoltrare le richieste senza mock; deve
  essere un URL assoluto (`http://localhost:8080`). **Vuoto = modalità solo mock.**
- **Accessibile da tutta la rete** — disattivo (default): solo questo computer
  (`127.0.0.1`); attivo: bind su `0.0.0.0`, raggiungibile da altri dispositivi. L'avvertenza
  che accompagna l'interruttore non è formale: l'admin API esegue codice, e chi raggiunge la
  porta può eseguire codice sulla macchina — il quadro è nel [capitolo 29](29-rete-sicurezza.md).

## Comportamento

> 📷 **SCREENSHOT** — `25-dialog-comportamento.png`
> Cosa mostrare: la sezione Comportamento della dialog con tutti gli interruttori e i campi
> numerici visibili.

- **Proxy fallback** — attivo (default): le richieste senza mock vengono inoltrate al
  backend; disattivo: rispondono 404 (solo mock). Da non confondere con il *proxy totale*
  della runtime bar: il fallback decide il comportamento sui **mock-miss** ed è una
  configurazione persistente; il proxy totale bypassa **tutti** i mock ed è un interruttore
  runtime che non sopravvive al riavvio.
- **CORS automatico** — spento di default: risponde ai preflight del browser e imposta gli
  header CORS su ogni risposta servita, sovrascrivendo la policy dei mock catturati e del
  backend proxato. Serve solo se un frontend su un'altra origin chiama Mockxy direttamente
  ([capitolo 27](27-topologia-proxy.md)).
- **Adatta i cookie del proxy** — attivo di default: rimuove `Domain`, `Secure` e
  `SameSite=None` dai `Set-Cookie` inoltrati dal backend, così i cookie di sessione si
  legano a Mockxy e sopravvivono su http. Si spegne per osservare i `Set-Cookie` originali
  ([capitolo 27](27-topologia-proxy.md)).
- **Riscrivi i redirect del proxy** — attivo di default: i redirect proxati che puntano
  all'indirizzo del backend vengono riscritti verso Mockxy, così il browser non "scappa"
  ([capitolo 27](27-topologia-proxy.md)).
- **Filtri case-insensitive** — attivo di default: i filtri automatici sulle liste
  (`?chiave=valore`) confrontano i valori ignorando le maiuscole
  ([capitolo 11](11-liste-paginazione-filtri.md)).
- **Ritardo globale (ms)** e **Ritardo anche sul proxy** — la latenza simulata
  ([capitolo 14](14-ritardi.md)).
- **Timeout backend (ms)** — default 15000: il tempo massimo di attesa per le richieste
  proxate (fino ai primi header di risposta) **e per l'esecuzione di handler e middleware**
  ([capitoli 15–16 e 26](26-proxy-fallback.md)).

## Monitor · dump su disco

> 📷 **SCREENSHOT** — `25-dialog-dump.png`
> Cosa mostrare: la sezione «Monitor · dump su disco» con i quattro campi numerici e i
> default visibili negli hint.

I quattro parametri dell'archivio su disco del [capitolo 22](22-storico-dump.md):

- **Cadenza flush (ms)** — ogni quanto scrivere su disco (default 30000);
- **Soglia flush (voci)** — il numero di voci in attesa che forza una scrittura anticipata
  (default 100);
- **Dimensione max per file (byte)** — oltre, il file di dump ruota (default 50 MB);
- **Tetto totale cartella (byte)** — superato, i dump più vecchi vengono eliminati; `0`
  disattiva il pruning (default 1 GB).

## Cosa non sta qui

Tre cose che si cercano spesso in questa dialog e stanno altrove: gli **interruttori
runtime** (server, proxy totale, dump) vivono nella runtime bar e non si persistono; le
**preferenze globali dell'app** (lingua, log errori) stanno nella dialog «Preferenze
dell'app» ([capitolo 28](28-desktop-workspace.md)); e le proprietà **per-mock** (delay della
variante, template, sequenze) stanno nei file dei mock, via editor.

Le prossime tre pagine approfondiscono i temi che questa dialog governa: il
[proxy fallback e i suoi errori](26-proxy-fallback.md), la
[topologia browser–proxy–backend](27-topologia-proxy.md), e il
[multi-workspace desktop](28-desktop-workspace.md).
