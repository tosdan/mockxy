# 05 — Il tour dell'interfaccia

Un giro completo dell'interfaccia prima di iniziare a lavorarci: cosa c'è nella barra
superiore, quali sono le viste, e — soprattutto — i due interruttori globali che governano
l'intero motore. Tutto il resto della guida dà per acquisita questa geografia.

> 📷 **SCREENSHOT** — `05-barra-superiore.png`
> Cosa mostrare: l'applicazione intera con la barra superiore in evidenza, annotata (frecce o
> riquadri) sulle sue aree: selettore delle viste, runtime bar con gli interruttori, selettore
> della lingua, menu dell'ingranaggio. Nell'app desktop includere anche la barra dei
> workspace a schede.

## Le quattro viste

Il selettore in alto commuta tra le quattro viste dell'applicazione:

- **Catalogo** — l'elenco di tutti gli endpoint mockati, organizzato in collection: è la
  vista di lavoro principale, dove si crea e si modifica ogni mock ([capitolo 6](06-catalogo.md));
- **Monitor** — il traffico in tempo reale che attraversa Mockxy, mockato e proxato, con la
  creazione di mock a partire dalle richieste osservate ([capitolo 20](20-monitor.md));
- **Storico** — l'archivio su disco del traffico catturato, per sfogliare le sessioni passate
  e creare mock anche a distanza di giorni ([capitolo 22](22-storico-dump.md));
- **Dati** — i file JSON riusabili che handler e middleware leggono con `data()`
  ([capitolo 17](17-pagina-dati.md)).

Lo stato delle viste viene **ripristinato durante la navigazione**: filtri impostati,
selezioni e posizioni si ritrovano come lasciati passando da una vista all'altra — si può
saltare dal catalogo al monitor e tornare senza perdere il contesto.

## La runtime bar

Accanto al selettore delle viste vive la **runtime bar**: lo stato del motore e gli
interruttori che lo governano a runtime, sempre visibili qualunque sia la vista attiva.
Da sinistra a destra:

- **Server attivo / Server spento** — l'interruttore principale del motore dei mock;
- **mock attivi / dritto al backend** — l'interruttore del *proxy totale*;
- **Monitor live / in pausa** — l'indicatore della cattura live del traffico, attiva in
  tutte le viste finché non messa in pausa;
- **Dump su disco** — l'interruttore dell'archiviazione del traffico su disco, con il
  conteggio delle richieste in coda e il pulsante di **flush** per scriverle subito
  (dettagli nel capitolo 22).

## I due interruttori, tre modalità

I primi due interruttori sono indipendenti, e producono **tre modalità effettive**:

| Modalità | Mock / handler / middleware / SSE / WS | Monitor | Proxy verso il backend |
|---|---|---|---|
| **Attivo** (default) | sì | registra | solo per le richieste senza mock |
| **Proxy totale** | no | registra | tutto |
| **Server spento** | no | fermo | tutto |

**Proxy totale** («dritto al backend») sospende tutti i mock senza fermare nulla: ogni
richiesta va al backend reale, ma il monitor continua a registrare. È la modalità «osserva il
backend vero» — per confrontare il comportamento reale con i propri mock, o per catturare
traffico da trasformare in mock (il flusso del capitolo 21). In questa modalità nemmeno i
middleware intervengono: il backend si vede davvero com'è.

**Server spento** non termina il processo: il motore resta in piedi come **puro proxy
trasparente**, con i mock sospesi *e* il monitor fermo. Serve a neutralizzare Mockxy senza
toccare la configurazione del frontend che gli punta contro — l'app continua a funzionare
contro il backend reale, e Mockxy in mezzo non fa più niente, nemmeno registrare.

In entrambe le modalità non-attive, senza un backend configurato le richieste ricevono
`501 Backend Not Configured`.

Un dettaglio voluto: lo stato di questi interruttori **non viene salvato** — a ogni riavvio
il motore torna in modalità attiva. Sono interruttori operativi, non dati del workspace: un
«proxy totale» dimenticato acceso non sopravvive alla sessione.

> 📷 **SCREENSHOT** — `05-proxy-totale.png`
> Cosa mostrare: la runtime bar con il proxy totale attivo («dritto al backend»), da
> confrontare con lo screenshot precedente in modalità normale: deve rendersi evidente come
> l'interfaccia segnala la modalità.

## Lingua, ingranaggio e barra dei workspace

Il selettore della **lingua** (italiano / inglese) ha effetto immediato, senza riavvii. Dove
la scelta viene ricordata dipende da come usi Mockxy: nel browser la memorizza il browser
stesso (al primo accesso segue il locale di sistema); nell'app desktop è una preferenza
globale, vale per tutti i workspace e copre anche i dialoghi nativi. I log del motore restano
in inglese in ogni caso.

Il menu dell'**ingranaggio** distingue due destinazioni che è bene non confondere:

- **Impostazioni workspace** — tutto ciò che riguarda il workspace attivo: porta, backend
  URL, comportamento del motore, dump. La dialog completa è il
  [capitolo 25](25-impostazioni-workspace.md);
- **Preferenze dell'app** (solo desktop) — le preferenze globali, indipendenti dal workspace,
  come il log errori su disco ([capitolo 28](28-desktop-workspace.md)).

Nell'app desktop, sopra a tutto c'è la **barra dei workspace**: una scheda per ogni workspace
aperto (ognuno con il proprio motore sulla propria porta), il pulsante «Apri…» e l'elenco dei
recenti. La gestione multi-workspace è approfondita nel capitolo 28.

## Da qui in poi

La geografia è completa: viste, interruttori globali, impostazioni. Il passo successivo è il
lavoro vero, e comincia dalla vista dove passerai la maggior parte del tempo: il
[catalogo dei mock](06-catalogo.md).
