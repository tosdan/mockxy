# 26 — La porta, il backend e il proxy fallback

Il proxy fallback è già comparso in ogni capitolo — è il cuore di Mockxy. Qui lo si guarda da
vicino: la decisione completa richiesta per richiesta, la modalità solo-mock e i suoi 404
"parlanti", gli errori e i timeout del proxy, e la tabella di riferimento di
`x-mock-source`.

## La decisione, per intero

Per ogni richiesta in arrivo (esclusi i percorsi riservati `/_admin/...`):

1. **Controlli globali** — a server spento o in proxy totale, nessun mock, handler o
   middleware interviene: tutto va dritto al backend (senza backend configurato: `501`).
2. **Preflight CORS** — con il CORS automatico attivo, gli `OPTIONS` di preflight ricevono
   risposta automatica (un mock `OPTIONS` esplicito ha la precedenza).
3. **Match di rotta** — la convenzione dei path del [capitolo 7](07-creare-endpoint.md):
   prima il percorso (vince il più specifico), poi il metodo. Se la rotta scelta definisce
   il metodo, risponde la variante selezionata — mock, handler, o middleware (che passa
   comunque dal backend).
4. **Nessun mock** — decide il **proxy fallback**:
   - attivo e backend configurato → inoltro al backend reale;
   - disattivo → **`404 Mock Not Found`**;
   - attivo ma senza backend → **`501 Backend Not Configured`**.

## La modalità solo-mock

Fallback disattivo (o Backend URL vuoto) = **solo-mock**: ciò che non è mockato non esiste.
I casi in cui è la modalità giusta:

- **demo e lavoro offline** — nessuna dipendenza da ambienti esterni: il workspace è
  l'intera "API";
- **determinismo nei test** — la certezza che il frontend non tocchi mai un ambiente reale:
  una chiamata non prevista fallisce con un 404 invece di produrre effetti veri;
- **sviluppo prima del backend** — quando un backend semplicemente non c'è ancora.

I 404 solo-mock sono uno strumento diagnostico, non un vicolo cieco: il body dichiara la
ragione del mancato match. **`path_not_mocked`** — nessuna rotta combacia: controllare
prefissi (`/api` di troppo o in meno) e il fatto che il match copre l'intero percorso.
**`method_not_mocked`** — la rotta c'è ma non definisce quel metodo: e per la regola dei due
tempi non si ripiega su rotte meno specifiche. Sono i primi due sintomi del
[troubleshooting](33-troubleshooting.md).

> 📷 **SCREENSHOT** — `26-404-solo-mock.png`
> Cosa mostrare: il dettaglio nel monitor di una richiesta «miss» in modalità solo-mock, con
> il body del 404 visibile (`path_not_mocked` e la rotta coinvolta).

## Cosa viene inoltrato

Quando la richiesta va al backend: l'URL è la base configurata più percorso e query così come
sono; gli header passano tutti tranne gli *hop-by-hop* (quelli che appartengono alla singola
tratta, come `Connection`), con `Host` riscritto a quello del backend; il body viaggia **in
streaming**, senza buffering — anche gli upload grandi non occupano memoria. La risposta
torna con status e header originali, più gli adattamenti di cookie, redirect e CORS del
[capitolo 27](27-topologia-proxy.md) quando attivi.

## Errori e timeout

- **Backend irraggiungibile** (connessione rifiutata, DNS fallito) → **`502 Bad Gateway`**.
- **Timeout** (`requestTimeoutMs`, default 15 s): copre connessione, invio della richiesta e
  attesa dei **primi header di risposta**; superato, ancora `502`. Una volta che la risposta
  è iniziata il timeout non si applica più: uno stream può tacere per minuti senza essere
  troncato — un upstream morto a metà si manifesta come errore di connessione.
- **Errore a risposta già iniziata**: con gli header ormai inviati non c'è più uno status da
  cambiare; la connessione viene chiusa in modo brusco, così il client percepisce il
  troncamento invece di scambiarlo per una risposta completa.
- **Client che abbandona**: la tratta verso il backend viene chiusa subito.

Per il frontend, la regola pratica: un `502` da Mockxy parla del **backend** (giù, o lento a
*iniziare* a rispondere), un `504` parla di un **handler** locale che non ha risposto in
tempo, un `501` dice che serviva il backend ma non è configurato.

## `x-mock-source`: la tabella di riferimento

| Valore | Significato |
|---|---|
| `mock` | risposta statica di un mock |
| `handler` | generata da un handler locale |
| `middleware` | risposta del backend trasformata da un middleware |
| `backend` | proxata al backend senza trasformazioni (incluso il bypass dei middleware su stream e risposte oltre soglia) |
| `mock-only` | `404` con proxy fallback disattivo |
| `backend-unconfigured` | `501` per assenza di backend configurato |
| `cors-preflight` | preflight `OPTIONS` gestito dal CORS automatico |

Gli stessi valori popolano la colonna «Servita da» del monitor; il filtro combinato «Backend
vero» raccoglie tutto ciò che non è uscito dai mock e dagli handler del workspace.

Il proxy inoltra fedelmente — ma tra un browser e un backend pensato per essere raggiunto
direttamente, la fedeltà assoluta romperebbe login e navigazione. I tre adattamenti che lo
evitano sono il [prossimo capitolo](27-topologia-proxy.md).
