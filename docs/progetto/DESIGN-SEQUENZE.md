# Design — Sequenze di varianti (proposta, da discutere)

Stato: **bozza per discussione** — non implementato.

## Il problema

Un client fa polling su un endpoint e si aspetta che **dopo un po' la risposta cambi**: prima
`{"status":"processing"}`, poi `{"status":"completed"}`. Oggi le strade sono due, entrambe
insoddisfacenti:

- **cambio variante a mano** mentre il client polla: funziona ed è già un pattern legittimo, ma
  richiede presenza e tempismo, e non è riproducibile né condivisibile;
- **handler con l'orologio** (`new Date().getSeconds() > 50`): un accrocchio — gli handler non
  hanno memoria tra le chiamate né nozione di "prima richiesta", quindi l'unico tempo
  disponibile è quello assoluto.

Il modello attuale è pensato per risposte stabili nel tempo: manca un modo dichiarativo di dire
«questo endpoint evolve».

## Il principio

**La sequenza è una politica di selezione sopra le varianti esistenti, non un nuovo tipo di
risposta.** «processing» e «completed» sono normali varianti in `<METODO>.responses/`; la
sequenza dice solo in che ordine e per quanto servirle. Ne discendono le proprietà chiave:

- la **definizione** sta nel file endpoint → condivisa in git col team, come tutto il resto;
- il **cursore** (a che punto siamo) è stato runtime in-memory, effimero per natura;
- i contenuti non si duplicano: la sequenza referenzia varianti che esistono già e restano
  utilizzabili anche nella selezione classica.

## Formato nel file endpoint

```json
{
  "method": "GET",
  "path": "/api/operazioni/:id",
  "enabled": true,
  "responseFiles": ["001.response.json", "002.response.json"],
  "selectedResponseFile": "001.response.json",
  "sequence": {
    "enabled": true,
    "steps": [
      { "response": "001.response.json", "times": 3 },
      { "response": "002.response.json" }
    ],
    "onEnd": "stay",
    "resetAfterMs": 30000
  }
}
```

- **`sequence`** — facoltativo; assente = comportamento attuale, nessun impatto sui workspace
  esistenti.
- **`sequence.enabled`** — la sequenza si può spegnere **senza perderne la definizione**: a
  `false` (o con `sequence` assente) vale la selezione classica (`selectedResponseFile`). È il
  toggle che la UI mostra accanto alla selezione varianti.
- **`steps`** — almeno 2 voci (con 1 sola equivale alla selezione classica: rifiutata in
  validazione per non avere due modi di dire la stessa cosa). Ogni step:
  - **`response`** — nome file di una variante elencata in `responseFiles` (stessa variante
    riusabile in più step);
  - **criterio di avanzamento**, al più uno dei due:
    - **`times`** — intero ≥ 1: lo step risponde a N richieste, poi si avanza;
    - **`forMs`** — intero ≥ 1: lo step risponde per N millisecondi **a partire dalla sua prima
      richiesta** (non da quando è diventato corrente): il timer di «processing dura 15s» parte
      quando il client inizia a chiedere, che è la semantica del caso d'uso;
  - l'**ultimo step può non avere criterio**: è lo stato terminale (con `onEnd: "stay"`).
    Gli step non terminali **devono** averne uno.
- **`onEnd`** — `"stay"` (default): esaurito l'ultimo step ci si ferma lì; `"loop"`: si riparte
  dal primo (per demo cicliche). Con `loop`, anche l'ultimo step deve avere un criterio.
- **`resetAfterMs`** — facoltativo, default assente (= mai): con un valore, se non arrivano
  richieste per quel tempo il cursore riparte dal primo step. È il tassello ergonomico del caso
  d'uso: il polling si ferma quando il client vede «completed», e alla sessione di prova
  successiva la sequenza riparte da sola, zero clic. La UI lo propone precompilato (30s) alla
  creazione della sequenza.

`selectedResponseFile` resta obbligatorio e valido anche con sequenza attiva: è ciò che si serve
quando la si spegne, e l'ancora del comportamento classico.

### Validazione

Al caricamento (stessa degradazione per-endpoint di oggi: endpoint saltato con warning, alla
ricarica a caldo resta l'ultima versione valida):

- ogni `steps[].response` è elencato in `responseFiles`;
- `times`/`forMs` mutuamente esclusivi, interi nei range; step non terminali con criterio;
- `onEnd` riconosciuto; con `loop` criterio anche sull'ultimo step;
- **tutte le varianti referenziate dagli step vengono caricate e validate** come oggi si valida
  la selezionata (la sequenza le rende tutte "selezionabili a runtime"). Una variante rotta in
  uno step = endpoint degradato, coerente con la filosofia attuale.

Gli step possono referenziare varianti **mock e handler, anche miste**: «processing» statico e
«completed» calcolato da un handler è una combinazione legittima e utile. Gli step
**middleware sono esclusi in v1**: la loro esecuzione vive nel percorso proxy (registry
separato, richiesta inoltrata al backend), e attraversarlo dal serving locale non vale la
complessità finché non emerge il bisogno. Uno step middleware è un errore di validazione.

## Semantica runtime

### Il cursore

Per ogni endpoint con sequenza attiva il motore tiene in memoria:

```
{ stepIndex, servedInStep, stepStartedAt, lastRequestAt }
```

A ogni richiesta servita dall'endpoint: prima si applica l'eventuale auto-reset
(`lastRequestAt` più vecchio di `resetAfterMs` → cursore azzerato — controllo pigro alla
richiesta, nessun timer), poi si fa avanzare il cursore oltre gli step `forMs` scaduti, si serve
la variante dello step corrente e si aggiornano i contatori. Tutto sincrono dentro il registry
(processo singolo): niente corse tra richieste concorrenti.

### Cosa azzera il cursore

1. **riavvio del motore** (stato in-memory);
2. **reset manuale** — pulsante in UI / admin API (sotto);
3. **auto-reset per inattività** (`resetAfterMs`);
4. **modifica della definizione della sequenza**. Nota di design: la ricarica a caldo
   ricostruisce il registry, quindi l'implementazione ingenua azzererebbe il cursore a *ogni*
   modifica del file endpoint (anche solo la descrizione, o il salvataggio di tutt'altro campo
   dalla UI). Proposta: il cursore sopravvive alla ricarica se la **firma della sequenza**
   (steps + onEnd + resetAfterMs, normalizzati) non è cambiata; cambia la firma → reset. Così
   ritoccare la descrizione non falsa un test di polling in corso.

### Cursore condiviso

Il cursore è **globale per endpoint**, non per client: due client che pollano insieme fanno
avanzare la stessa sequenza. È la semantica giusta per il caso d'uso (l'operazione schedulata è
una) ed è semplice da spiegare; sequenze per-client (chiave da header/query) sono un'estensione
futura esplicitamente fuori scope.

## Impatto sul motore

Il punto architetturale: oggi `loadSelectedResponse` carica **solo** la variante selezionata e
la rotta viene registrata con quella risposta già risolta. Con la sequenza:

- il loader carica le risposte di **tutti gli step** (array di risposte risolte, stessa
  pipeline di validazione di oggi) e monta nel route group una **funzione di scelta** invece
  della risposta singola;
- il registry ospita i cursori, con le firme delle sequenze per la sopravvivenza alla ricarica;
- il percorso senza sequenza resta identico a oggi (risposta singola, zero overhead).

Le risposte servite da uno step seguono le regole della loro natura (ritardi, paginazione e
filtri automatici sui body array, no-cache degli handler, ecc.): la sequenza decide *quale*
variante risponde, non *come*.

## Admin API

| Metodo e percorso | Cosa fa |
|---|---|
| `GET /mocks/:id` | il dettaglio include `sequence` (definizione) e `sequenceState` runtime: `{ stepIndex, servedInStep, stepStartedAt }`, o `null` se spenta |
| `PUT /mocks/:id` | aggiorna anche `sequence` (è un campo della definizione, come oggi `selectedResponseFile`) |
| `POST /mocks/:id/sequence/reset` | azzera il cursore; risponde con lo stato azzerato. Utile anche per script di test |
| `GET /mocks` | ogni endpoint espone un flag sintetico (es. `sequenceActive`) per il badge di catalogo |

## Monitor

Ogni voce del monitor relativa a un endpoint con sequenza registra **variante servita e
posizione** (es. `step 1/2 — 001.response.json "Processing"`): la progressione si deve *vedere*,
altrimenti il debugging di una sequenza è cieco. Nessun header aggiuntivo sulla risposta di
default (non inquinare il contratto osservato dal client); un header diagnostico opzionale
`x-mock-sequence-step` può essere valutato a parte.

## Interfaccia

### Punto d'ingresso

Nella scheda dell'endpoint, un pulsante **«Sequenza»** a destra del pulsante «Copia», con
icona di stato leggibile a colpo d'occhio (tinta `brand` quando la sequenza è attiva, neutra
quando è spenta). Apre la dialog. Nel **catalogo**, badge (es. «SEQ») sulle righe con sequenza
attiva, per vedere lo stato senza aprire la scheda.

### La dialog

```
┌ Sequenza — GET /api/operazioni/:id ──────────────────────────────┐
│ [◉] Sequenza attiva                                              │
│ Modalità: (per richieste | a tempo)   Alla fine: (resta | loop)  │
│ Auto-reset dopo [30000] ms senza richieste (vuoto = mai)         │
│ ────────────────────────────────────────────────────────────────│
│ ▶ 1  [Processing — 001.response.json ▾]  [ 3 ] volte   [↑][↓][🗑]│
│   2  [Completed  — 002.response.json ▾]  ( finale )    [↑][↓][🗑]│
│ [+ Aggiungi step]                                                │
│ ── stato ────────────────────────────────────────────────────────│
│ Step corrente: 1 · 2/3 richieste servite   [Riparti dall'inizio] │
│                                            [Annulla]  [Salva]   │
└──────────────────────────────────────────────────────────────────┘
```

- **Toggle «Sequenza attiva»** (mappa `sequence.enabled`): da spento, tutti i controlli di
  modifica sono disabilitati (la definizione resta visibile, non si perde).
- **Modalità times/forMs globale** per la sequenza: un solo toggle in testata, niente scelta
  per-step — più semplice da capire, copre il caso d'uso. Il **formato file resta per-step**
  (`times` o `forMs` su ogni step): la UI v1 scrive sequenze uniformi, il formato regge il caso
  misto futuro senza migrazione.
- **«Alla fine»** (`onEnd`): resta sull'ultimo / ricomincia. Con «resta», l'input valore
  dell'ultimo step è disabilitato e mostra «finale»; con «ricomincia» torna obbligatorio.
- **Auto-reset** (`resetAfterMs`): campo opzionale, vuoto = mai; precompilato a 30s alla prima
  attivazione della sequenza.
- **Righe step**: dropdown della variante (titolo + nome file, scelte tra le varianti esistenti
  dell'endpoint; la stessa variante può comparire in più step), input del valore (ms o volte a
  seconda della modalità), pulsanti sposta su/giù ed elimina. **«Aggiungi step»** in coda.
- **Sezione stato (runtime)**, separata visivamente dalla definizione: indicatore dello step
  corrente (riga evidenziata + contatore «2/3 richieste» o tempo trascorso) e pulsante
  **«Riparti dall'inizio»** (`POST /mocks/:id/sequence/reset`). Il reset è un'azione immediata;
  il resto della dialog si applica col Salva — la separazione visiva comunica la differenza.
- **Footer Annulla/Salva** come la dialog impostazioni workspace: Salva abilitato solo con una
  modifica valida (almeno 2 step, variante su ogni step, valori ≥ 1 dove richiesti), errori
  inline sotto i campi.
- **Caso limite**: endpoint con una sola variante → controlli disabilitati e hint «crea almeno
  un'altra variante per usare le sequenze».

Il flusso di creazione non cambia: prima si creano le varianti (come oggi), poi le si ordina in
sequenza. Niente wizard dedicato in prima battuta.

## Complementare: memoria per gli handler

Primitive minime nel contesto di `resolveResponse` (indipendenti dalla sequenza, ma stessa
famiglia di bisogni — e aprono casi che la sequenza non copre: esiti dipendenti dal body,
macchine a stati per-risorsa):

- **`state`** — oggetto mutabile **per endpoint**, persistente tra le chiamate (in-memory),
  condiviso tra le varianti dell'endpoint; azzerato dagli stessi eventi che azzerano il cursore
  (riavvio, reset manuale, modifica dell'endpoint);
- **`callCount`** — numero progressivo di invocazioni dell'handler per questo endpoint;
- **`firstRequestAt`** — timestamp (ms epoch) della prima invocazione dal reset: `Date.now() -
  firstRequestAt` è l'`elapsed` senza accrocchi d'orologio.

L'esempio del polling scritto a mano diventa:

```js
module.exports = {
  resolveResponse({ firstRequestAt }) {
    const elapsed = Date.now() - firstRequestAt;
    if (elapsed < 15000) return { status: 200, jsonBody: { status: "processing" } };
    return { status: 200, jsonBody: { status: "completed" } };
  },
};
```

Documentazione con avvertenza esplicita: lo stato è effimero e locale al motore — non è un
database, e un reload lo azzera.

## Non-obiettivi (per ora)

- sequenze **per-client** (chiave da header/query);
- **persistenza del cursore** tra riavvii;
- scheduling assoluto («dopo X secondi dall'avvio del server»): il tempo parte dalla prima
  chiamata, non dall'orologio di sistema;
- `type: "sequence"` come tipo di variante: la sequenza sta *sopra* le varianti, non dentro.

## Fasi di implementazione proposte

1. **Motore**: formato + validazione, loader multi-variante, cursore/reset/firma, admin API;
2. **UI**: editor sequenza nel dettaglio endpoint, badge catalogo, indicatore live + reset;
3. **Monitor**: variante/step nelle voci;
4. **Handler state** (`state`, `callCount`, `firstRequestAt`): indipendente, può procedere in
   parallelo o dopo.

## Questioni aperte

1. `resetAfterMs`: default assente (proposto, prevedibile) o default 30s (ergonomico ma
   magico)?
2. Cursore che sopravvive alla ricarica a firma invariata: vale la complessità della firma, o
   per la v1 basta «ogni reload azzera» documentato?
3. `sequenceState` nel `GET /mocks/:id`: la UI lo mostra live — serve un polling dedicato
   della UI o si appoggia a refresh esistenti?
4. Header diagnostico `x-mock-sequence-step`: utile o rumore?
5. `state` degli handler condiviso tra varianti dello stesso endpoint (proposto) o per singola
   variante?
