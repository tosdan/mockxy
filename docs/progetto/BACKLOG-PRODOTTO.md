# Backlog di prodotto — collaudo del 9 luglio 2026

> Le idee di più ampio respiro (funzionalità da dev server che a Mockxy mancano) vivono in
> [`IDEE-FUTURE.md`](IDEE-FUTURE.md): da lì si pesca, qui si lavora.

Nato da un giro di collaudo **da utente** sui tre scenari d'origine (vedi `docs/it/SCENARI.md`):
app vera nel browser (UI compilata servita dal motore), workspace partito **vuoto**, backend
"reale" finto con endpoint credibili (lista, dettaglio, POST, un 500, uno lento). Ogni
affermazione qui sotto è stata osservata davvero, non dedotta; le ipotesi non verificate sono
marcate come tali. Le voci si cancellano quando implementate, come nel TODO.

## Cosa regge (verificato end-to-end, nessuna azione)

- **Scenario "staging resettato"**: traffico proxato → cattura nel monitor → "Crea mock da
  questa" (un click, senza form) → backend spento → **tutte** le rotte rispondono dal mock coi
  dati catturati, POST col suo 201 e perfino il 500 riprodotti fedelmente.
- **Scenario "contratto avanti al backend"**: mock manuale con parametro `:id` creato dalla
  dialog e servito al primo colpo, prima che il backend lo conosca.
- **Scenario "confine mobile"**: toggle per-endpoint nei due sensi a caldo (mock→backend→mock,
  nessun riavvio) e kill-switch globale Proxy All, verificati entrambi.
- La navigazione **monitor → mock che copre la richiesta** ("Vai al mock") c'è, e le entry
  coperte portano il badge Mock.
- Il watcher crea la cartella dei mock se assente: si parte da un workspace inesistente e si
  lavora subito (fix del 9 lug, esercitato in questo stesso collaudo).

## Attriti da sistemare (ordinati per rapporto valore/costo)

1. ~~Il conteggio "Non mockate" nel monitor~~ **RISOLTO** *(discusso, deciso e implementato il
   9 lug 2026)*. La proposta di trasformarlo in un conteggio di copertura è stata SCARTATA (il
   monitor serve a guardare il traffico, non è una gara a creare mock; il segnale utile è il
   badge storico su ogni riga, che esiste già — **non riproporre versioni del conteggio**).
   Implementata la decisione: il dropdown della provenienza ora ha l'etichetta visibile
   "Servita da" e una voce combinata "Backend vero" (= tutto ciò che non uscì da mock/handler:
   proxy, middleware, miss); il pulsante "Non mockate" col numero è stato eliminato.
2. ~~Stringhe UI sfuggite all'i18n~~ **RISOLTO** *(censite e portate in i18n il 16 lug 2026)*.
   Spostate nelle chiavi: gli stati del Proxy All («straight to backend»/«mocking active»),
   «live» del monitor e il titolo «dal monitor · HH:mm:ss» delle varianti catturate. Restano
   letterali di proposito: i nomi delle feature (Proxy All, Monitor, Dump, Flush) per la regola
   sui termini tecnici, e il marcatore «[da completare]», gemello della costante del motore
   (`dump-to-mock.js`) che la ricerca nel catalogo deve trovare in entrambe le lingue.
3. **Toast di conferma che resta indietro.** Dopo creazioni ravvicinate il toast mostrava
   ancora il testo della creazione precedente (visto creando la fattura subito dopo il mock di
   `instabile`). *(osservato una volta — da riprodurre prima di fixare)*
4. **Ponte mock→handler dove serve.** Il mock nato da un POST catturato rigioca l'eco stantia
   del body catturato (giusto così per un mock statico). Proprio lì — response di un POST, o
   path con `:parametro` e body statico — la UI potrebbe proporre "trasforma in handler" con un
   template precompilato dai dati catturati. *(idea, non verificata l'assenza: il tipo handler
   esiste già nella creazione manuale)*

## Manutenzione mirata (non urgente)

- **Riallineare la pagina del monitor al pattern del catalogo**: è il file più lungo del
  progetto (~813 righe, componente unico con template, stato e logica) mentre la pagina
  `mocks-next` mostra già la forma scelta dal progetto (cartella con sotto-componenti e store
  separato). Da fare la prossima volta che si lavora su quella pagina, con la suite Vitest come
  rete. La policy generale sui refactor è in CONTRIBUTING.md ("Refactoring policy"): niente
  campagne di scomposizione, si estrae ciò che si tocca.

## Da esplorare al prossimo giro (non coperto da questo collaudo)

- **Batch dal monitor live**: il bottone "Seleziona" del live non è stato esercitato (il batch
  create-mocks dallo storico dump è già coperto dai test). Capire se la strada "seleziono 10
  entry del live → creo 10 mock" esiste o passa solo dallo storico.
- **Storico e Dati**: viste non toccate in questo giro.
- **Scenario C a livello di collection**: il toggle di massa esiste (API verificata dai test di
  oggi) ma non è stato provato dalla UI in questo giro.
- **App desktop (Electron)**: il collaudo è stato solo browser; il flusso workspace
  dell'app desktop (apertura cartella, porta per workspace) merita il suo giro.

## Note di metodo

Ambiente riproducibile, ora dentro il repo: `node scripts/dogfood-server.js` avvia il motore
su :3344 con un workspace scratch locale (`.dogfood/`, gitignored) e la UI compilata;
`node scripts/dogfood-backend.js` avvia il backend finto su :9333 (lista utenti, dettaglio,
POST, un 500, uno lento). C'è anche la config `mockxy-dogfood` in `.claude/launch.json`.
Prerequisito: `npm run build:frontend:desktop`. Il collaudo va rifatto a ogni giro di feature
sul flusso toccato: costa ~mezz'ora e ha trovato in un giro ciò che 445 test unitari verdi non
possono vedere.
