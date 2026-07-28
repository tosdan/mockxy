# Distribuzione installabile dell'app desktop

Stato: esplorazione tecnica del 28 luglio 2026. Questo documento non rappresenta ancora una
decisione di rilascio e non modifica il packaging corrente.

La checklist di implementazione e lo stato di avanzamento sono mantenuti separatamente in
[PIANO-DISTRIBUZIONE-DESKTOP.md](PIANO-DISTRIBUZIONE-DESKTOP.md).

## Sintesi

Mockxy può essere distribuito come applicazione installabile sia su Windows sia su Linux. La
matrice iniziale consigliata è:

| Piattaforma | Formato | Uso |
|---|---|---|
| Windows | EXE portable | mantenere la distribuzione senza installazione |
| Windows | installer NSIS | download diretto dal sito o da GitHub Releases |
| Microsoft Store | AppX, poi eventualmente MSIX | firma, hosting e aggiornamenti gestiti dallo Store |
| Linux | AppImage | formato portabile e trasversale alle distribuzioni |
| Linux | `.deb` | prima distribuzione realmente installabile, per Debian/Ubuntu/Mint |
| Linux | `.rpm` | aggiunta successiva se richiesta da utenti Fedora/RHEL/openSUSE |
| Linux | Snap/Flatpak | da valutare in seguito, per i vincoli della sandbox |

La firma gratuita dello Store è reale, ma vale per un pacchetto AppX/MSIX caricato e
distribuito tramite Microsoft Store. Non firma anche l'installer NSIS scaricabile direttamente
e non si applica a un EXE/MSI tradizionale semplicemente elencato nello Store.

## Windows: tre prodotti diversi

### Portable

È il formato corrente. Non richiede installazione, può tenere le preferenze accanto
all'eseguibile e rimane utile per chi vuole una copia autonoma su disco o chiavetta.

Svantaggi:

- non crea una normale voce di disinstallazione;
- l'integrazione con menu Start e associazioni è limitata;
- gli aggiornamenti restano a carico dell'utente;
- Windows può mostrare gli avvisi SmartScreen per un eseguibile non firmato.

### Installer NSIS

È il target consigliato da `electron-builder` per un normale installer Windows. Può installare
per il solo utente senza privilegi amministrativi, creare collegamenti e una voce di
disinstallazione. In una prima versione conviene usare l'installazione per utente e mantenere
anche la portable.

La pubblicazione diretta di un installer NSIS non eredita la firma dello Store. Per evitare
«Autore sconosciuto» e ridurre gli avvisi SmartScreen occorre firmarlo separatamente con un
servizio o certificato riconosciuto. In alternativa può essere distribuito non firmato,
accettando l'esperienza peggiore al primo avvio.

L'aggiornamento è una decisione distinta dal formato: si può iniziare con aggiornamenti
manuali, oppure configurare in seguito `electron-updater` e un feed di release.

### Microsoft Store

Microsoft offre due percorsi per le applicazioni desktop Win32:

1. caricare un pacchetto AppX/MSIX;
2. pubblicare nello Store un installer EXE/MSI ospitato dal produttore.

Il primo percorso è quello interessante per Mockxy. Microsoft ospita il pacchetto, lo firma
dopo la certificazione e distribuisce gli aggiornamenti tramite lo Store. Il secondo percorso
richiede invece che il produttore ospiti un installer offline immutabile a un URL HTTPS, lo
firmi con una firma Authenticode attendibile e gestisca gli aggiornamenti.

Fonti Microsoft:

- [distribuzione di un'app Win32 tramite Microsoft Store](https://learn.microsoft.com/en-us/windows/apps/distribute-through-store/how-to-distribute-your-win32-app-through-microsoft-store);
- [scelta del percorso di distribuzione](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/choose-distribution-path);
- [firma dei pacchetti MSIX](https://learn.microsoft.com/en-us/windows/msix/package/signing-package-overview);
- [requisiti degli installer EXE/MSI](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-package-requirements).

## Account e pubblicazione nello Store

Il nuovo flusso di registrazione di Microsoft non prevede una quota per gli account
`Individual` o `Company`, ma richiede la verifica dell'identità o dell'azienda. La scelta va
fatta con attenzione: un account Individual non può essere convertito successivamente in
Company. Se Mockxy sarà pubblicato a nome di un'attività registrata, Microsoft indica il tipo
Company.

Fonte: [apertura di un account sviluppatore Partner Center](https://learn.microsoft.com/en-my/windows/apps/publish/partner-center/open-a-developer-account).

Prima di produrre il pacchetto definitivo occorre:

1. creare e verificare l'account Partner Center;
2. riservare il nome dell'app;
3. copiare nel manifest l'identità e il publisher assegnati dallo Store;
4. compilare disponibilità, classificazione per età, proprietà e dichiarazioni;
5. preparare descrizioni, icone, screenshot, contatti di supporto ed eventuale informativa
   privacy;
6. caricare il pacchetto e fornire note di certificazione sufficienti per collaudare l'app.

La versione del pacchetto Windows ha quattro componenti: l'attuale `1.1.0` diventerebbe, per
esempio, `1.1.0.0`. Ogni invio successivo deve incrementarla.

## AppX oppure MSIX

MSIX è il formato moderno raccomandato da Microsoft, ma lo Store continua ad accettare anche
AppX e relativi bundle/upload:

- [formati di pacchetto accettati](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/upload-app-packages).

Nel repository sono installati `Electron 42.4.1` ed `electron-builder 26.15.3`. È
`electron-builder`, non il runtime Electron, a scegliere il formato del pacchetto Windows.
La serie stabile 26 espone il target `appx`, ma non un target `msix`.

Il target MSIX è stato aggiunto in `electron-builder 27`, al momento disponibile come
prerelease alpha, e lo stesso target è ancora dichiarato beta. Può produrre `.msix`,
`.msixbundle` e `.msixupload`:

- [note di migrazione a electron-builder 27](https://github.com/electron-userland/electron-builder/blob/master/website/docs/migration/v27-breaking-changes.md);
- [release di electron-builder](https://github.com/electron-userland/electron-builder/releases).

Aggiornare Electron non è quindi necessario per ottenere MSIX. Adottare subito
`electron-builder 27`, invece, significherebbe affidare la pipeline di rilascio a una
toolchain non ancora stabile e affrontare anche le altre incompatibilità della major 27.

Il percorso meno rischioso è quindi:

1. produrre inizialmente un AppX di prova con la versione attuale;
2. verificare installazione, comportamento e certificazione;
3. valutare separatamente `electron-builder 27` quando sarà stabile, oppure un altro
   passaggio di packaging, per adottare MSIX.

AppX non è un vicolo cieco per la prima pubblicazione: è ancora accettato dallo Store. Non
conviene invece aggiornare la toolchain e introdurre tutti i nuovi formati nello stesso
cambiamento.

## Impatto del pacchetto Store su Mockxy

Un'app Electron impacchettata continua a essere un'app desktop full trust, non diventa
un'applicazione UWP fortemente limitata. Il manifest deve tuttavia dichiarare la capability
ristretta `runFullTrust`, che `electron-builder` prevede per il target AppX e che va motivata
durante la certificazione.

Per Mockxy la motivazione è concreta: l'applicazione avvia processi e server HTTP locali,
legge, osserva e modifica workspace scelti dall'utente ed esegue handler JavaScript contenuti
nei workspace. È opportuno dichiarare soltanto le capability necessarie e descrivere
chiaramente questo comportamento nelle note per i certificatori.

Fonti:

- [dichiarazioni delle capability](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/app-capability-declarations);
- [comportamento delle app desktop impacchettate](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes).

La directory di installazione del pacchetto è protetta e va considerata in sola lettura.
Mockxy già ripiega sulla directory dati utente quando non può scrivere i log accanto
all'eseguibile, ma questo comportamento va coperto da test e reso facilmente osservabile
dall'interfaccia o dalla documentazione.

## Dati e passaggio dalla portable

La portable Windows usa `PORTABLE_EXECUTABLE_DIR` per le preferenze globali; una versione
installata usa invece la directory `userData` di Electron. Di conseguenza:

- i workspace, essendo cartelle autonome scelte dall'utente, non vengono spostati;
- le preferenze globali, la lista dei workspace recenti e la sessione da ripristinare non
  migrano automaticamente dalla portable all'installer;
- NSIS e AppX/MSIX possono avere directory dati o identità differenti e vanno provati anche
  quando convivono sulla stessa macchina.

Prima di pubblicare un installer bisogna scegliere fra:

1. documentare che la versione installata parte con preferenze nuove;
2. offrire un'importazione esplicita dalla portable;
3. realizzare una migrazione automatica, solo se è possibile individuare senza ambiguità la
   vecchia directory.

L'importazione esplicita è probabilmente la soluzione più prevedibile; una scansione
automatica del disco alla ricerca di copie portable sarebbe fragile.

## Linux

`electron-builder` supporta AppImage, deb, rpm, Snap e Flatpak:

- [target Linux di electron-builder](https://www.electron.build/docs/linux/);
- [distribuzione di un'AppImage](https://docs.appimage.org/packaging-guide/distribution.html).

La prima combinazione consigliata è AppImage più `.deb`:

- AppImage resta una singola applicazione scaricabile e avviabile su più distribuzioni, senza
  vera installazione;
- `.deb` offre installazione, menu applicazioni e disinstallazione standard su
  Debian/Ubuntu/Mint;
- `.rpm` estende la copertura, ma richiede un ulteriore artefatto e un'altra famiglia di
  distribuzioni da collaudare;
- Snap e Flatpak offrono store e aggiornamenti, ma la sandbox complica l'accesso a cartelle
  arbitrarie e l'esecuzione dei contenuti dei workspace.

Un file `.deb` o `.rpm` pubblicato su GitHub Releases non costituisce da solo un canale di
aggiornamento. Per gli aggiornamenti nativi serve un repository APT/DNF firmato, oppure si
deve adottare e collaudare un updater applicativo. Anche l'AppImage può essere integrata con
un updater, ma questa può rimanere una fase successiva.

Per Snap andrebbe privilegiato il confinamento stretto con interfacce e portali appropriati;
il confinamento `classic` richiede revisione manuale e non viene concesso automaticamente
soltanto perché un'app deve accedere al filesystem:

- [confinamento degli snap](https://snapcraft.io/docs/explanation/security/snap-confinement/);
- [revisione del confinamento classic](https://snapcraft.io/docs/reference/administration/reviewing-classic-confinement-snaps/).

## Notifica e installazione degli aggiornamenti

Non serve necessariamente un server applicativo sempre attivo. Per Mockxy il setup minimo può
usare le release pubbliche del repository GitHub come archivio HTTPS e CDN. La workflow di
release carica gli artefatti e i manifest di aggiornamento; ogni installazione interroga
periodicamente la release più recente. Non occorrono database, processi residenti sul server
o notifiche push.

`electron-updater` supporta NSIS su Windows e AppImage, deb e rpm su Linux:

- [documentazione auto-update di electron-builder](https://www.electron.build/docs/features/auto-update/).

La matrice consigliata è:

| Distribuzione | Notifica nell'app | Installazione dell'aggiornamento |
|---|---|---|
| Microsoft Store AppX/MSIX | affidata principalmente allo Store | gestita dallo Store, senza `electron-updater` |
| Windows NSIS | tramite `electron-updater` | supportata; consigliabile dopo avere una firma attendibile |
| Windows portable | controllo della release e link al download | non supportata direttamente da `electron-updater`; sostituire l'eseguibile in uso sarebbe un meccanismo personalizzato |
| Linux AppImage | tramite `electron-updater` | supportata se il file AppImage è in una posizione scrivibile |
| Linux deb/rpm | tramite `electron-updater` | supportata, ma l'installazione può richiedere l'autenticazione del package manager |
| Snap/Flatpak | affidata ai rispettivi store | gestita dal relativo store/package manager |

Per la portable conviene quindi limitarsi a mostrare «è disponibile la versione X» con
collegamento alla release o al nuovo eseguibile. Un auto-aggiornamento personalizzato dovrebbe
gestire file in uso, rollback, antivirus, directory non scrivibili e riavvio; non è una buona
prima implementazione.

Per NSIS l'aggiornamento automatico è tecnicamente possibile anche prima di acquistare una
firma, ma la firma aggiunge la verifica dell'identità del produttore e riduce gli avvisi di
Windows. Inizialmente è più prudente offrire la notifica con download esplicito per gli
artefatti Windows non firmati e lasciare l'installazione automatica al pacchetto Store.

### Setup minimo con GitHub Releases

1. Aggiungere `electron-updater` alle dipendenze dell'app Electron.
2. Configurare in `electron-builder` il provider GitHub `tosdan/mockxy`.
3. Creare una workflow di release che, per ogni tag, costruisca gli artefatti e carichi anche
   i file di metadati generati (`latest.yml`, manifest Linux e blockmap pertinenti).
4. Inserire nell'app un piccolo servizio che controlli gli aggiornamenti solo nelle build
   compatibili, esponga gli stati alla UI e distingua «scarica» da «installa e riavvia».
5. Per la portable usare l'API della release più recente o un piccolo manifest JSON statico,
   confrontare la versione e aprire la pagina di download.
6. Disattivare l'updater interno nelle build Store e lasciare gli aggiornamenti a Microsoft.

Il token GitHub serve soltanto alla workflow che pubblica la release e va conservato nei
segreti della CI; non deve essere incluso nell'app. Le installazioni di un repository pubblico
possono leggere manifest e artefatti senza credenziali.

Per evitare che un client trovi una release incompleta, la workflow dovrebbe prepararla come
bozza, caricare tutti gli artefatti Windows e Linux e renderla pubblica solo alla fine. La
prima versione può avere un solo canale `stable`; canali beta, rollout graduali e rollback
automatici possono essere aggiunti in seguito.

## Build e collaudo

Non conviene produrre tutti gli artefatti da una singola macchina. Una workflow di release
dovrebbe costruire su sistemi nativi:

- runner Windows per portable, NSIS e AppX;
- runner Ubuntu per AppImage e `.deb`;
- inizialmente architettura x64, aggiungendo ARM64 soltanto quando esiste una domanda e una
  matrice di test adeguata.

Gli artefatti diretti possono essere allegati a una GitHub Release. Il pacchetto Store segue
invece il proprio ciclo in Partner Center. Le build riproducibili non eliminano la necessità
di provare installazione, aggiornamento e disinstallazione su macchine pulite.

Per ogni formato vanno verificati almeno:

- avvio e blocco della seconda istanza;
- ripristino di più workspace e opzione `--no-restore-workspaces`;
- apertura, lettura, scrittura e file watching di workspace esterni;
- avvio simultaneo dei server dei workspace e ascolto su loopback;
- handler e middleware JavaScript;
- posizione e persistenza di preferenze e log;
- aggiornamento e disinstallazione;
- coesistenza o passaggio dalla portable alla versione installata;
- comportamento senza privilegi amministrativi;
- messaggi SmartScreen per gli artefatti Windows distribuiti direttamente.

## Percorso incrementale consigliato

### Fase 1 — Prototipi installabili

1. Mantenere la portable Windows.
2. Aggiungere un installer NSIS per utente.
3. Mantenere/normalizzare AppImage e aggiungere `.deb`.
4. Aggiungere una workflow di release Windows e Linux x64.
5. Pubblicare soltanto prerelease interne e collaudarle su installazioni pulite.

### Fase 2 — Prova Microsoft Store

1. Aprire l'account corretto e riservare il nome Mockxy.
2. Configurare l'identità AppX ottenuta da Partner Center.
3. Produrre un pacchetto AppX di test.
4. Verificare filesystem, loopback, `runFullTrust` e installazione/aggiornamento.
5. Preparare listing e note di certificazione.
6. Inviare una release privata o limitata prima della disponibilità generale.

### Fase 3 — Aggiornamenti e formati ulteriori

1. Decidere se gli artefatti diretti devono avere aggiornamenti automatici.
2. Valutare MSIX con una toolchain aggiornata.
3. Aggiungere `.rpm` in base alla domanda.
4. Valutare Snap/Flatpak solo dopo avere definito il modello di accesso ai workspace.
5. Valutare ARM64 separatamente.

## Decisione proposta

L'idea è tecnicamente realizzabile e non richiede modifiche radicali all'applicazione. La
prima implementazione dovrebbe produrre quattro artefatti: portable e NSIS su Windows,
AppImage e `.deb` su Linux. In parallelo si può preparare AppX come esperimento dedicato allo
Store.

Il beneficio economico dello Store è concreto, perché il pacchetto AppX/MSIX riceve firma,
hosting e aggiornamenti da Microsoft. Non sostituisce però la firma degli installer Windows
distribuiti direttamente. Il rischio principale per Mockxy non è Electron, ma la corretta
gestione di dati, identità, aggiornamenti e capability nei diversi canali.
