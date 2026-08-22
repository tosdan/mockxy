# 28 — L'app desktop fino in fondo: multi-workspace e preferenze

Il capitolo 3 ha coperto l'avvio; qui c'è il resto dell'app desktop: la gestione di **più
workspace in parallelo** — la sua capacità esclusiva — le porte stabili, le preferenze
globali e il log degli errori.

## Più workspace, un motore ciascuno

Ogni workspace aperto ha il **proprio motore sulla propria porta**: configurazioni separate,
backend separati, monitor separati. Il caso d'uso tipico sono due worktree git con due
frontend che puntano a due set di mock diversi, **contemporaneamente** — o il progetto
principale più un workspace di esperimenti.

La **barra dei workspace** li gestisce a schede:

- **aprire** una cartella («Apri…»): se è già un workspace parte il motore; se è una
  cartella qualunque, l'inizializzazione chiede conferma esplicita
  ([capitolo 3](03-installazione-avvio.md)); se è già aperto, si passa alla sua scheda —
  niente doppioni;
- **cambiare** scheda ricarica la finestra sull'interfaccia del motore corrispondente;
- **chiudere** una scheda (con conferma) spegne il motore; i file su disco restano intatti;
- i **recenti** riaprono i workspace usati; rimuovere una voce dai recenti non tocca la
  cartella.

La finestra usa una barra del titolo integrata: la titlebar di sistema è nascosta, ma
minimizza/massimizza/chiudi restano controlli nativi, e la barra dei workspace è anche
l'area di trascinamento della finestra.

> 📷 **SCREENSHOT** — `28-workspace-tabs.png`
> Cosa mostrare: l'app con due o tre workspace aperti nelle schede e il menu «Recenti»
> aperto, con l'azione di rimozione dai recenti visibile su una voce.

## Le porte stabili

Alla prima apertura di un workspace viene assegnata una porta libera e **salvata nelle sue
impostazioni locali**: il workspace riapre sempre lì, così il proxy del frontend configurato
contro quell'indirizzo non va mai ritoccato. Due comportamenti distinti quando una porta
risulta occupata:

- **all'avvio** (la porta salvata è presa da un altro processo): il motore ripiega su una
  porta libera e aggiorna il salvataggio — il workspace parte comunque;
- **a un cambio esplicito** dalla dialog delle impostazioni: la porta occupata viene
  rifiutata con un errore, senza applicare nulla — un cambio intenzionale non deve produrre
  un risultato diverso da quello chiesto.

## Impostazioni del workspace vs Preferenze dell'app

Il menu dell'ingranaggio distingue due livelli, ed è una distinzione da avere chiara:

- **Impostazioni workspace** — per-workspace, salvate in `.mockxy/settings.json` della
  cartella: porta, backend, comportamento del motore, dump ([capitolo 25](25-impostazioni-workspace.md));
- **Preferenze dell'app** — globali, valide per tutti i workspace: la lingua, la geometria
  della finestra, l'elenco dei recenti, e il **log errori** (sotto). Vivono in
  `mockxy-prefs.json` accanto all'eseguibile: nel formato portable, tutto viaggia insieme
  all'exe — spostare la cartella sposta anche le preferenze.

> 📷 **SCREENSHOT** — `28-preferenze-app.png`
> Cosa mostrare: la dialog «Preferenze dell'app» con l'interruttore del log errori e il
> percorso della cartella dei log visibile.

## Il log degli errori

Gli errori finiscono anche su file: una sottocartella **`logs/`** accanto all'eseguibile
(se non scrivibile, il ripiego è la cartella dati utente), un file al giorno
(`errors-AAAA-MM-GG.log`), creato solo quando c'è qualcosa da scrivere.

Ci finiscono sia i guasti dell'app (avvio fallito, workspace che non si apre) sia le **righe
error dei motori** dei workspace aperti — ed è qui che il log diventa prezioso nel lavoro
quotidiano: il dettaglio completo di un `500 Handler Execution Failed` (messaggio, stack,
file incriminato — [capitolo 15](15-handler.md)) nell'app impacchettata non ha nessun'altra
via d'uscita, perché non c'è un terminale da guardare.

La scrittura è attiva di default e si disabilita dalle Preferenze app, con effetto immediato.

## Nota per chi sviluppa l'interfaccia

L'interfaccia è sempre servita dal motore stesso, anche nell'app desktop: ogni workspace è
autosufficiente. Per lo sviluppo della UI si usa il browser (`npm run dev:backend` +
`npm run dev:frontend`, con ricaricamento automatico); l'app desktop usa la UI compilata, e
`npm run dev:electron` la ricostruisce prima di avviarla. La compilazione dell'eseguibile è
nel [capitolo 3](03-installazione-avvio.md).

Un workspace per collega è comodo; un motore raggiungibile *dai* colleghi è un'altra cosa —
e richiede consapevolezza: [l'esposizione in rete](29-rete-sicurezza.md).
