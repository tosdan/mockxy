# L'app desktop

L'app desktop per Windows è un singolo eseguibile **portable**: nessuna installazione, motore e
interfaccia integrati, preferenze che viaggiano accanto all'eseguibile. È il modo più rapido di
usare Mockxy — e l'unico che offre **più workspace in parallelo**.

L'interfaccia è sempre servita dal motore stesso, anche in sviluppo: così ogni workspace è
autosufficiente e si comporta allo stesso modo in ogni contesto.

## Più workspace, un motore ciascuno

Ogni workspace aperto ha il **proprio motore su una propria porta** — il caso d'uso tipico sono
due worktree git con due frontend che puntano a due set di mock diversi, contemporaneamente. La
barra dei workspace li gestisce a schede:

- **aprire** una cartella: se è già un workspace parte il motore; se è una cartella qualunque,
  l'inizializzazione richiede una **conferma esplicita** ([cosa viene creato](WORKSPACE.md));
  se è già aperto, si passa alla sua scheda (niente doppioni);
- **cambiare** workspace ricarica la finestra sull'interfaccia del motore attivo;
- **chiudere** una scheda (con conferma) spegne il motore; i file su disco restano intatti;
- i **recenti** riaprono i workspace usati; rimuovere una voce dai recenti non tocca la
  cartella.

**Le porte sono stabili**: alla prima apertura viene assegnata una porta libera e salvata nelle
impostazioni locali — il workspace riapre sempre lì, così i frontend configurati non vanno
ritoccati. Se all'avvio la porta salvata risulta occupata, il motore ripiega su una libera e
aggiorna il salvataggio; un **cambio esplicito** verso una porta occupata, invece, viene
rifiutato con un errore, senza applicare nulla.

## Le impostazioni di workspace

La dialog delle impostazioni governa una regola semplice: il **titolo** è l'unica voce
condivisa (vive nel segnaposto del workspace, in git — è un'etichetta del progetto); tutto il
resto è **locale** alla macchina: porta, backend URL, esposizione in rete (con la sua
[avvertenza](RETE.md)), le opzioni di comportamento del motore e la retention dei dump. Le voci
sono censite, con i default, in [CONFIGURAZIONI.md](CONFIGURAZIONI.md).

Al salvataggio le modifiche si applicano **riavviando il motore del workspace** e ricaricando
la finestra; la cartella è mostrata in sola lettura (un workspace non si "sposta" dalla
dialog). Il file delle impostazioni e la sua natura locale sono documentati
nell'[anatomia del workspace](WORKSPACE.md) — e non toccano mai la versione headless, che si
configura solo con variabili d'ambiente.

## Il log degli errori (`logs/`)

Gli errori finiscono anche su file, in una sottocartella **`logs/`** accanto a ciò che hai
lanciato: l'AppImage su Linux, l'exe portabile su Windows, l'eseguibile installato altrove
(in sviluppo: `electron/logs/`, ignorata da git). Se quella posizione non è scrivibile, il
ripiego è la cartella dati utente. Un file al giorno (`errors-AAAA-MM-GG.log`), creato solo
quando c'è qualcosa da scrivere.

Ci trovi sia i guasti dell'app (avvio fallito, workspace che non si apre, eccezioni
impreviste) sia le **righe error dei motori** dei workspace aperti — ad esempio il dettaglio
completo di un `500 Handler Execution Failed`, che nell'app impacchettata non avrebbe
nessun'altra via d'uscita ([troubleshooting](TROUBLESHOOTING.md)).

## Preferenze globali e pacchetto

Le preferenze **globali** — lingua, geometria della finestra, elenco dei recenti — vivono
accanto all'eseguibile: in formato portable, tutto viaggia insieme all'exe. Per compilare:

```bash
npm run install:all
npm run dist:electron
# risultato in electron/dist/Mockxy-<versione>-portable.exe
```

L'eseguibile non è firmato: al primo avvio SmartScreen può chiedere conferma («Ulteriori
informazioni» → «Esegui comunque»).

Per lo **sviluppo** dell'interfaccia si usa il browser (`npm run dev:backend` +
`npm run dev:frontend`, con ricaricamento automatico); l'app desktop usa la UI compilata, che
`npm run dev:electron` ricostruisce prima di avviarla.
