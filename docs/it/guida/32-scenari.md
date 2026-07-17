# 32 — Scenari completi, dall'inizio alla fine

I capitoli precedenti hanno coperto le funzionalità una per una; qui si mettono insieme.
Cinque scenari ricorrenti dello sviluppo frontend, ciascuno percorso per intero — contesto,
sequenza di azioni, risultato — con i rimandi ai capitoli di dettaglio. Sono gli stessi
scenari da cui il design di Mockxy è nato.

## 1. «Il backend non esiste ancora»

**Contesto.** Progetto nuovo: l'API è concordata, esiste una specifica OpenAPI, il backend
arriverà tra un mese. Il frontend deve partire adesso.

1. Si crea il workspace nel repository del frontend ([capitolo 3](03-installazione-avvio.md))
   e si **importa la specifica** ([capitolo 23](23-import-openapi.md)): un mock per ogni
   endpoint, organizzati in collection dai tag, in pochi secondi.
2. Si lavora in **modalità solo-mock** — Backend URL vuoto, o fallback spento
   ([capitolo 26](26-proxy-fallback.md)): ciò che non è mockato fallisce in modo esplicito,
   e nessuna chiamata finisce nel vuoto.
3. Man mano che le schermate prendono forma, si **rifiniscono i mock che contano**: dati
   sensati sui body campionati ([capitolo 9](09-editor-response-mock.md)), un dataset da 50
   elementi sull'endpoint della tabella per paginazione e filtri
   ([capitolo 11](11-liste-paginazione-filtri.md)), le varianti d'errore sui flussi critici
   ([capitolo 8](08-scheda-endpoint.md)).
4. Il backend comincia a esistere: si imposta `BACKEND_URL`, si accende il **proxy
   fallback**, e si **disabilitano i mock una zona alla volta** — a collection intere
   ([capitolo 6](06-catalogo.md)). Le richieste di quelle zone tornano a fluire verso il
   reale; il resto resta mockato. Niente viene buttato: i mock disabilitati restano pronti
   per la prossima regressione del backend.
5. Per il confronto rapido «come si comporta il backend su *tutto*?» c'è il **proxy totale**
   ([capitolo 5](05-tour-interfaccia.md)), che sospende i mock senza perderli.

**Risultato.** Il frontend non ha mai aspettato il backend, e la transizione al reale è
avvenuta un'area alla volta, reversibilmente.

## 2. «Lo staging è stato resettato di nuovo»

**Contesto.** Il backend condiviso funziona, ma i dati inseriti a mano per provare le
interfacce spariscono a ogni reseeding notturno.

1. Si lavora normalmente con il **fallback attivo** verso staging: nessun mock, tutto reale.
   A inizio sessione conviene accendere il **dump su disco**
   ([capitolo 22](22-storico-dump.md)): la vista live dimentica, l'archivio no.
2. Si fa **data entry dalle maschere dell'app**, finché gli scenari sono ben popolati — il
   cliente con tre ordini aperti, la pratica nello stato che serve.
3. Nel **monitor** si selezionano le risposte che rappresentano gli scenari
   ([capitolo 20](20-monitor.md)) e si **creano i mock in blocco**
   ([capitolo 21](21-cattura-mock.md)) — o lo si fa domani dallo **storico**, con calma.
4. Da quel momento quegli endpoint rispondono con i dati congelati: il prossimo reset non li
   tocca. E i mock sono **file in git** ([capitolo 24](24-mock-come-file.md)): lo scenario
   si condivide con il team nel prossimo commit.

**Risultato.** La mattinata di data entry è diventata un asset permanente del repository.

## 3. «Devo provare il caso d'errore»

**Contesto.** Serve vedere come il frontend reagisce a un 500, a un timeout, a una lista
vuota — e l'ambiente reale non li produce a comando.

1. Sull'endpoint interessato (esistente, o catturato al volo dal monitor) si aggiungono le
   **varianti**: il preset «500 Internal Server Error», la lista vuota, la variante con
   **delay** oltre il timeout del client per il caso timeout
   ([capitoli 8, 9 e 14](08-scheda-endpoint.md)).
2. Si **seleziona la variante d'errore**, si prova la UI, si torna alla variante normale: un
   click per direzione. Tutto il resto dell'applicazione continua a parlare con il backend
   vero.
3. Per il caso «si rompe e poi si riprende» c'è la **sequenza**
   ([capitolo 12](12-sequenze.md)): 503 per 30 secondi, poi di nuovo 200 — con l'auto-reset
   che riarma lo scenario tra un giro di prova e l'altro.
4. Se il caso d'errore serve **nei test e2e**, la selezione della variante si automatizza
   via **admin API** ([capitolo 30](30-admin-api.md)): il test la attiva, verifica, e
   ripristina.

**Risultato.** I rami d'errore del frontend — spesso i meno testati — diventano riproducibili
a comando, per sempre.

## 4. «Il contratto è avanti rispetto al backend»

**Contesto.** La specifica è stata aggiornata e il client API rigenerato, ma l'endpoint
reale risponde ancora nel formato vecchio.

Due strade, a seconda di quanto contano i dati veri:

- **dati veri, forma nuova** — un **middleware** sulla rotta aggiunge i campi che il nuovo
  contratto prevede, sopra la risposta reale ([capitolo 16](16-middleware.md)): si continua
  a lavorare con dati vivi, e quando il backend si allinea si spegne la variante;
- **forma nuova e basta** — si **cattura** la risposta vera dal monitor, la si trasforma in
  mock e si aggiungono i campi a mano ([capitolo 21](21-cattura-mock.md)); oppure si
  rilancia l'**import** della specifica aggiornata, che è incrementale e non tocca
  l'esistente ([capitolo 23](23-import-openapi.md)).

**Risultato.** Frontend e contratto avanzano insieme, senza aspettare il backend e senza
rinunciare ai dati reali dove servono.

## 5. «Demo domani, e dev'essere offline»

**Contesto.** Una demo dal cliente, rete non garantita, ambienti di test instabili: serve
un'applicazione completamente autonoma e con dati presentabili.

1. Si parte dal workspace esistente e si verifica la **copertura**: si naviga l'intera demo
   con il monitor aperto e il filtro «Backend vero» ([capitolo 20](20-monitor.md)) — ciò che
   compare lì è ciò che ancora dipende dalla rete. Si cattura tutto in blocco.
2. Si passa in **solo-mock** ([capitolo 26](26-proxy-fallback.md)): da ora un endpoint
   scoperto fallisce in prova, non davanti al cliente.
3. Si curano i **dati** (nomi plausibili, niente `test123` — [capitolo 17](17-pagina-dati.md)
   per i dataset) e la **credibilità**: un ritardo globale moderato
   ([capitolo 14](14-ritardi.md)) perché l'app non sembri finta, le sequenze per i flussi
   asincroni che la demo attraversa ([capitolo 12](12-sequenze.md)).
4. Il workspace della demo si committa su un branch o si copia: è una cartella
   autosufficiente ([capitolo 24](24-mock-come-file.md)) — riutilizzabile alla prossima
   occasione, o servibile ai colleghi con l'immagine standalone
   ([capitolo 31](31-headless-docker.md)).

**Risultato.** La demo gira dal portatile, identica in albergo e in sala riunioni.

---

Cinque scenari, un'idea sola: il confine tra mockato e reale è **uno strumento di lavoro**,
non una scelta d'architettura. Quando qualcosa lungo la strada non si comporta come
previsto, il capitolo che segue è la cassetta degli attrezzi:
[troubleshooting](33-troubleshooting.md).
