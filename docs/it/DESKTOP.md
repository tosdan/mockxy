# L'app desktop

L'app desktop per Windows è disponibile come eseguibile **portable** e come installer **NSIS per
utente**. Entrambi contengono motore e interfaccia e offrono **più workspace in parallelo**. La
portable non richiede installazione e conserva le preferenze accanto all'eseguibile; l'installer
crea invece una voce nel menu Start e conserva i dati nella directory utente di Windows.

Su Linux sono previsti sia l'**AppImage portabile** sia il pacchetto installabile **deb x64**
per Debian e Ubuntu. Il pacchetto deb integra Mockxy nel menu applicazioni e nel package manager;
l'AppImage resta disponibile per chi preferisce un singolo file senza installazione.

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

Con la versione installata, lo stesso flag può essere passato a `Mockxy.exe` dalla cartella di
installazione. Con l'attuale installer one-click il comando completo è:

```powershell
& "$env:LOCALAPPDATA\Programs\mockxy-desktop\Mockxy.exe" --no-restore-workspaces
```

L'installer crea anche la voce **Mockxy - avvio senza workspace** nel menu Start, che esegue
direttamente questo comando. La voce normale trascinata dal menu Start può invece diventare un
riferimento applicativo `com.mockxy.desktop`, senza un campo Destinazione modificabile.

```bash
./Mockxy-<versione>.AppImage --no-restore-workspaces
```

Con il pacchetto deb installato lo stesso avvio di recupero è disponibile da terminale:

```bash
mockxy --no-restore-workspaces
```

Il launcher Linux espone inoltre l'azione contestuale **Avvio senza workspace** negli ambienti
desktop che supportano le Desktop Actions.

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

Gli errori finiscono anche su file, in una sottocartella **`logs/`**. Per la portable Windows e
l'AppImage Linux si trova accanto all'artefatto avviato; per l'installazione NSIS si trova nella
directory dati utente, così sopravvive ad aggiornamenti e disinstallazioni. In sviluppo viene
usata `electron/logs/`, ignorata da git. Se la posizione primaria non è scrivibile, il ripiego è
la directory dati utente. Viene creato un file al giorno (`errors-AAAA-MM-GG.log`), soltanto
quando c'è qualcosa da scrivere.

Il pacchetto deb usa direttamente la directory dati utente, evitando tentativi di scrittura
sotto `/opt`; log e preferenze sopravvivono alla rimozione del pacchetto.

Ci trovi sia i guasti dell'app (avvio fallito, workspace che non si apre, eccezioni
impreviste) sia le **righe error dei motori** dei workspace aperti — ad esempio il dettaglio
completo di un `500 Handler Execution Failed`, che nell'app impacchettata non avrebbe
nessun'altra via d'uscita ([troubleshooting](TROUBLESHOOTING.md)).

La scrittura è attiva di default. Dal menu dell'ingranaggio si apre **Preferenze app** e si
può disabilitare o riabilitare il log senza riavviare; la scelta globale `errorLogEnabled`
viene salvata in `mockxy-prefs.json` ([configurazioni](CONFIGURAZIONI.md)).

## Notifica degli aggiornamenti

Le build desktop pacchettizzate, portable, NSIS e AppImage comprese, controllano se esiste
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
formato portable, così tutto viaggia insieme all'exe. La versione NSIS e Linux usano invece la
directory dati utente. Le preferenze della portable non vengono importate automaticamente
nell'installazione, mentre le cartelle dei workspace restano indipendenti e possono essere aperte
da entrambe.

L'installer NSIS è one-click, x64 e limitato all'utente corrente: prima di installare chiede una
conferma esplicita, non richiede privilegi amministrativi, crea nel menu Start il collegamento
normale e quello di recupero ma non collegamenti sul desktop, quindi avvia Mockxy al termine. La
disinstallazione rimuove entrambi i collegamenti e l'app, ma conserva preferenze, sessione e log;
non elimina mai i workspace. Per aggiornare si scarica ed esegue manualmente il setup della nuova
versione.

Il pacchetto deb x64 installa l'applicazione sotto `/opt/Mockxy`, espone il comando
`/usr/bin/mockxy` e crea `mockxy.desktop` nel menu applicazioni. L'installazione consigliata usa
`apt`, che mostra il riepilogo, risolve le dipendenze e richiede l'autenticazione amministrativa:

```bash
sudo apt install ./mockxy_<versione>_amd64.deb
```

Per rimuovere l'app si usa `sudo apt remove mockxy`. La rimozione non cancella i workspace e non
elimina preferenze o log nelle home degli utenti. Il file scaricato da GitHub Releases non
costituisce un repository APT: per aggiornare si scarica il nuovo deb e lo si installa manualmente.

Per compilare i singoli artefatti:

```bash
npm run install:all
npm run dist:electron:win
# electron/dist/Mockxy-<versione>-portable.exe

npm run dist:electron:nsis
# electron/dist/Mockxy-<versione>-setup-x64.exe

npm run dist:electron:linux
# electron/dist/Mockxy-<versione>-x86_64.AppImage

npm run dist:electron:deb
# electron/dist/mockxy_<versione>_amd64.deb
```

La portable e l'installer scaricati direttamente non sono firmati: SmartScreen può chiedere
conferma («Ulteriori informazioni» → «Esegui comunque»). La firma e l'aggiornamento automatico
verranno valutati separatamente.

Per lo **sviluppo** dell'interfaccia si usa il browser (`npm run dev:backend` +
`npm run dev:frontend`, con ricaricamento automatico); l'app desktop usa la UI compilata, che
`npm run dev:electron` ricostruisce prima di avviarla.
