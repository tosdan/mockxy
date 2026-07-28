# L'app desktop

L'app desktop per Windows è un singolo eseguibile **portable**: nessuna installazione, motore e
interfaccia integrati, preferenze che viaggiano accanto all'eseguibile. È il modo più rapido di
usare Mockxy — e l'unico che offre **più workspace in parallelo**.

L'interfaccia è sempre servita dal motore stesso, anche in sviluppo: così ogni workspace è
autosufficiente e si comporta allo stesso modo in ogni contesto.

La finestra usa una barra del titolo integrata nella UI: la titlebar di sistema è nascosta,
ma minimizza/massimizza/chiudi restano controlli nativi. La barra dei workspace è anche l'area
di trascinamento e riserva automaticamente lo spazio dei controlli finestra.

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

Le schede aperte vengono salvate a ogni apertura, cambio o chiusura. Al successivo avvio
l'app riapre tutti quei workspace e torna sulla scheda che era attiva; se una cartella non
esiste più o un workspace non riesce ad avviarsi, gli altri vengono comunque ripristinati.

Per un avvio di recupero, senza riaprire alcun workspace, si può usare il flag monouso
`--no-restore-workspaces`. Non cancella la sessione salvata:

```powershell
.\Mockxy-<versione>-portable.exe --no-restore-workspaces
```

```bash
./Mockxy-<versione>.AppImage --no-restore-workspaces
```

Gli argomenti da riga di comando arrivano normalmente all'app Electron in entrambi i formati.
Su Linux il file AppImage deve essere eseguibile; se Mockxy viene lanciato da una voce
`.desktop`, il flag può essere aggiunto temporaneamente alla sua riga `Exec`, oppure si può
usare il terminale.

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

La scrittura è attiva di default. Dal menu dell'ingranaggio si apre **Preferenze app** e si
può disabilitare o riabilitare il log senza riavviare; la scelta globale `errorLogEnabled`
viene salvata in `mockxy-prefs.json` ([configurazioni](CONFIGURAZIONI.md)).

## Notifica degli aggiornamenti

Le build desktop pacchettizzate, portable Windows e AppImage comprese, controllano se esiste
una nuova release stabile su `tosdan/mockxy`. Il primo controllo parte circa cinque secondi
dopo l'apertura della finestra e non viene ripetuto automaticamente più di una volta ogni
24 ore. Lo sviluppo locale non esegue controlli automatici; le future build Microsoft Store
li lasciano invece interamente allo Store.

Il controllo interroga la GitHub Releases API senza credenziali e salva nelle preferenze
globali soltanto data dell'ultimo successo e metadati dell'ultima release trovata. Un errore
di rete, un timeout o un limite temporaneo di GitHub non impediscono l'avvio e non mostrano
avvisi automatici.

Quando è disponibile una versione più recente compare un banner non bloccante. **Vedi
release** apre nel browser la pagina verificata della release; **Ignora questa versione**
nasconde soltanto quella versione, quindi la successiva verrà proposta normalmente. Da
**Preferenze app → Aggiornamenti** si possono vedere versione installata e ultima trovata e
avviare **Controlla aggiornamenti**: il controllo manuale mostra anche «aggiornato» o
l'eventuale indisponibilità del servizio.

Questa prima implementazione **non scarica e non installa automaticamente** alcun file:
l'utente sceglie l'artefatto dalla pagina della release e mantiene il controllo
dell'aggiornamento.

## Preferenze globali e pacchetto

L'ingranaggio distingue le **impostazioni del workspace** attivo dalle **Preferenze app**.
Le preferenze globali — lingua, geometria della finestra, sessione dei workspace, elenco dei
recenti, log errori e stato degli aggiornamenti — vivono accanto all'eseguibile Windows in
formato portable, così tutto viaggia insieme all'exe; su Linux usano la cartella dati utente.
Per compilare:

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
