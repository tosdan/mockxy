# Piano operativo: aggiornamenti e distribuzione desktop

Stato del piano: **attivo**
Ultimo aggiornamento: 29 luglio 2026

Questo documento è la checklist operativa per introdurre, nell'ordine:

1. la notifica della disponibilità di una nuova versione;
2. la distribuzione tramite Microsoft Store;
3. le restanti build Windows e Linux e, dove appropriato, il loro aggiornamento automatico.

La ricerca tecnica e le motivazioni delle scelte sono raccolte in
[DISTRIBUZIONE-DESKTOP.md](DISTRIBUZIONE-DESKTOP.md). Questo file deve invece descrivere
sempre lo stato reale dell'implementazione.

## Come aggiornare questa checklist

- `[ ]` significa non iniziato o non ancora verificato.
- `[x]` significa completato e verificato secondo i criteri di accettazione della fase.
- La checkbox va spuntata nello stesso commit che completa l'attività.
- Una fase è conclusa soltanto quando sono soddisfatti anche test, documentazione e criteri di
  accettazione, non appena il codice principale sembra funzionare.
- Le decisioni che cambiano il perimetro vanno annotate nella sezione «Registro decisioni».
- Ogni release pubblica deve provenire da un tag e da una working tree pulita.

## Stato sintetico

| Ordine | Obiettivo | Stato | Dipende da |
|---:|---|---|---|
| 0 | Fondamenta della pubblicazione | In corso | — |
| 1 | Notifica di un aggiornamento disponibile | In corso | obiettivo 0 |
| 2 | Build e pubblicazione Microsoft Store | Da iniziare | obiettivi 0 e 1 |
| 3 | Altre build Windows e Linux | Da iniziare | obiettivo 0; preferibilmente 1 e 2 |
| 4 | Aggiornamenti automatici e formati aggiuntivi | Da iniziare | artefatti della fase 3 |

## Attività già concluse

- [x] Verificata la possibilità di impedire l'avvio di una seconda istanza.
- [x] Implementato il ripristino di più workspace.
- [x] Implementato `--no-restore-workspaces` per l'avvio di emergenza.
- [x] Analizzata la fattibilità delle build AppX/MSIX, NSIS, AppImage, deb e rpm.
- [x] Verificato che il Microsoft Store accetta ancora AppX.
- [x] Verificato che firma e onboarding Store possono essere gratuiti usando il nuovo flusso.
- [x] Scelto l'ordine di lavoro: notifica, Store, altre build.

---

## Obiettivo 0 — Fondamenta della pubblicazione

Scopo: definire una sola fonte affidabile per versione, release e URL prima di collegare
l'app a un servizio remoto.

### 0.1 Repository e canale di release

- [x] Confermare il repository pubblico canonico dal quale saranno pubblicate le release:
      `tosdan/mockxy`.
- [x] Confermare l'URL pubblico che l'app potrà aprire per mostrare una release:
      `https://github.com/tosdan/mockxy/releases`.
- [x] Decidere se `tosdan/mockxy` è il repository definitivo o un riferimento temporaneo.
- [x] Aggiungere i metadati `repository`, `homepage` e `bugs` ai `package.json` pertinenti.
- [ ] Decidere il valore pubblico del metadato `author`.
- [x] Usare inizialmente un solo canale, `stable`.
- [x] Stabilire la convenzione dei tag: `v<major>.<minor>.<patch>`.
- [x] Stabilire che draft e prerelease GitHub non siano proposti agli utenti `stable`.

### 0.2 Versione unica

- [x] Verificare che lo script di bump aggiorni tutte le copie della versione usate da
      backend, UI ed Electron.
- [x] Aggiungere un controllo CI che fallisca se le versioni divergono.
- [x] Fare in modo che la versione mostrata nell'app provenga da `app.getVersion()`.
- [ ] Definire la conversione per i pacchetti Windows a quattro componenti
      (`1.2.3` → `1.2.3.0`).

### 0.3 Workflow di release minimo

- [ ] Creare una workflow avviata da un tag di versione.
- [ ] Eseguire test backend, Electron, frontend ed E2E prima della pubblicazione.
- [ ] Costruire almeno gli artefatti già distribuiti oggi.
- [ ] Creare inizialmente la GitHub Release come bozza.
- [ ] Caricare artefatti, checksum e note di rilascio.
- [ ] Rendere pubblica la release soltanto dopo il completamento di tutti i job obbligatori.
- [ ] Conservare token e credenziali esclusivamente nei secret della CI.
- [ ] Verificare che nessun token venga incluso in `app.asar`, manifest o artefatti.
- [ ] Documentare una procedura manuale di annullamento o ritiro di una release difettosa.

### Criteri di accettazione dell'obiettivo 0

- [ ] Un tag di prova produce una draft release completa senza operazioni locali non
      documentate.
- [ ] Versione, tag e versione mostrata dall'app coincidono.
- [ ] Una release incompleta non diventa visibile ai client.
- [ ] Nessuna credenziale è presente negli artefatti.

---

## Obiettivo 1 — Notifica di un aggiornamento disponibile

Scopo: informare l'utente senza scaricare o installare automaticamente nulla. Questa prima
implementazione deve funzionare anche con la portable.

### 1.1 Contratto del controllo aggiornamenti

- [x] Creare per il main process un modulo isolato per il controllo delle release.
- [x] Evitare che renderer e UI conoscano direttamente GitHub o il formato della sua API.
- [x] Definire un risultato stabile con almeno:
  - versione corrente;
  - ultima versione stabile;
  - disponibilità dell'aggiornamento;
  - URL della release;
  - titolo o sintesi delle note;
  - data di pubblicazione;
  - eventuale errore classificato.
- [x] Confrontare le versioni come SemVer, non come semplici stringhe.
- [x] Ignorare draft, prerelease e release con versione non valida.
- [x] Non proporre downgrade se la versione installata è più nuova.
- [x] Impostare timeout brevi nel modulo di rete.
- [x] Trattare assenza di rete, timeout e rate limit come condizioni non fatali.
- [x] Non effettuare controlli automatici in sviluppo o durante i test.
- [x] Rendere configurabile l'origine delle release in fase di build, evitando URL sparsi nel
      codice.

### 1.2 Frequenza e preferenze

- [x] Effettuare il primo controllo alcuni secondi dopo l'apertura della finestra, non prima.
- [x] Salvare la data dell'ultimo controllo riuscito nelle preferenze globali.
- [x] Non ripetere automaticamente il controllo più di una volta ogni 24 ore.
- [x] Aggiungere un comando manuale «Controlla aggiornamenti».
- [x] Distinguere il controllo manuale da quello automatico:
  - quello manuale mostra anche «Mockxy è aggiornato» o l'errore;
  - quello automatico rimane silenzioso se non ci sono novità o manca la rete.
- [x] Consentire di ignorare la notifica per la specifica versione disponibile.
- [x] Riproporre la notifica quando viene pubblicata una versione successiva.
- [ ] Valutare una preferenza per disabilitare i controlli automatici.

### 1.3 Integrazione Electron e IPC

- [x] Esporre tramite preload soltanto le operazioni e i dati necessari alla UI.
- [x] Validare i messaggi IPC e non permettere al renderer di richiedere URL arbitrari.
- [x] Usare `shell.openExternal` soltanto per URL HTTPS appartenenti agli host consentiti.
- [x] Registrare gli errori nel sistema di logging esistente senza mostrare stack trace
      all'utente.
- [x] Evitare controlli duplicati quando la seconda istanza inoltra argomenti alla prima.
- [x] Prevedere un identificatore del canale di distribuzione (`portable`, `appimage`,
      `store`, `nsis`, ecc.) utilizzabile nelle fasi successive.

### 1.4 Interfaccia utente

- [x] Mostrare una notifica non bloccante con versione disponibile.
- [x] Offrire «Vedi novità» e «Scarica» o un unico pulsante verso la pagina della release.
- [x] Offrire «Ignora questa versione».
- [x] Aggiungere il controllo manuale in una posizione stabile, per esempio nelle preferenze
      globali o in una futura finestra «Informazioni».
- [x] Mostrare chiaramente versione corrente e ultima versione trovata.
- [x] Non interrompere workspace attivi e server in esecuzione.
- [x] Aggiungere tutte le stringhe sia in italiano sia in inglese.
- [x] Verificare accessibilità da tastiera, focus e lettura dello stato.

### 1.5 Test

- [x] Testare versione più nuova, uguale, più vecchia e non valida.
- [x] Testare draft e prerelease ignorate.
- [x] Testare risposta vuota o malformata.
- [x] Testare timeout, DNS/rete assente, HTTP 403/404/429 e HTTP 5xx.
- [x] Testare la regola di scadenza delle 24 ore.
- [x] Testare «Ignora questa versione» e la comparsa di una versione ancora successiva.
- [x] Testare che il controllo automatico non parta in sviluppo o nei test.
- [x] Testare la validazione dell'URL aperto esternamente.
- [x] Aggiungere un test d'integrazione IPC senza dipendere dalla rete reale.
- [ ] Eseguire un collaudo manuale sulla portable Windows e sull'AppImage Linux.

### 1.6 Documentazione e rilascio

- [x] Documentare il controllo remoto nelle pagine desktop italiane e inglesi.
- [x] Documentare frequenza, dati richiesti e modalità per disattivarlo, se presente.
- [x] Specificare che la prima versione notifica soltanto e non installa.
- [ ] Inserire la funzionalità nelle note di rilascio.
- [ ] Pubblicare una release di prova più nuova e verificare il flusso end-to-end.

### Criteri di accettazione dell'obiettivo 1

- [ ] Una build precedente rileva una release stabile successiva e mostra la notifica.
- [ ] Il percorso funziona senza un server Mockxy dedicato.
- [ ] L'app parte normalmente con rete assente o servizio remoto non disponibile.
- [ ] La portable apre la pagina corretta per scaricare la nuova versione.
- [ ] L'utente può ignorare una versione senza ignorare tutte quelle future.
- [ ] Test e documentazione bilingue sono aggiornati.

---

## Obiettivo 2 — Build e pubblicazione Microsoft Store

Scopo: distribuire una build installabile, certificata e aggiornata dal Microsoft Store,
mantenendo disponibili gli altri formati.

### 2.1 Account e identità

- [ ] Scegliere consapevolmente account Partner Center `Individual` o `Company`.
- [ ] Avviare la registrazione dal nuovo flusso gratuito indicato da Microsoft.
- [ ] Completare verifica dell'identità o dell'organizzazione.
- [ ] Riservare il nome dell'app.
- [ ] Registrare nel piano l'identità assegnata:
  - package identity name;
  - publisher;
  - publisher display name;
  - product identity.
- [ ] Non salvare nel repository credenziali Partner Center.
- [ ] Definire contatto di supporto e URL pubblici richiesti dalla scheda.
- [ ] Verificare se serve un'informativa privacy e pubblicarla prima dell'invio.

### 2.2 Strategia del pacchetto

- [ ] Usare inizialmente il target AppX di `electron-builder 26`.
- [ ] Non rendere `electron-builder 27` alpha una dipendenza della release stabile.
- [ ] Mantenere AppX e portable come target separati, senza sovrascrivere artefatti.
- [ ] Definire nomi artefatto e numerazione a quattro componenti.
- [ ] Configurare l'identità esatta ricevuta da Partner Center.
- [ ] Preparare tutte le immagini richieste dal manifest e dalla scheda Store.
- [ ] Dichiarare soltanto le capability necessarie.
- [ ] Motivare `runFullTrust` nelle note di certificazione.
- [ ] Verificare il manifest generato invece di considerarlo corretto per costruzione.

### 2.3 Comportamento specifico della build Store

- [ ] Identificare a runtime la build Store in modo affidabile.
- [ ] Disattivare il controllo GitHub e qualsiasi futuro `electron-updater` nella build Store.
- [ ] Mostrare, se necessario, «Aggiornamenti gestiti da Microsoft Store».
- [ ] Scrivere preferenze e log esclusivamente in directory consentite e persistenti.
- [ ] Non tentare scritture nella directory di installazione protetta.
- [ ] Verificare l'accesso a workspace scelti fuori dal pacchetto.
- [ ] Verificare file watching, handler e middleware JavaScript.
- [ ] Verificare l'avvio dei server locali e l'accesso tramite loopback.
- [ ] Verificare il blocco della seconda istanza.
- [ ] Verificare ripristino multi-workspace e `--no-restore-workspaces`.
- [ ] Decidere e documentare il comportamento delle preferenze passando dalla portable allo
      Store.

### 2.4 Collaudo e certificazione

- [ ] Creare un certificato di sviluppo soltanto per il collaudo locale.
- [ ] Installare e disinstallare il pacchetto su una macchina Windows pulita.
- [ ] Eseguire Windows App Certification Kit.
- [ ] Correggere errori e analizzare tutti gli avvisi.
- [ ] Preparare descrizione, categorie, classificazione per età, icone e screenshot.
- [ ] Preparare istruzioni di test chiare per i certificatori.
- [ ] Dichiarare esplicitamente che Mockxy esegue codice JavaScript presente nei workspace.
- [ ] Effettuare prima un invio privato o con visibilità limitata.
- [ ] Verificare installazione dal vero Store, non soltanto sideload.
- [ ] Pubblicare una seconda versione di prova e verificare l'aggiornamento Store.
- [ ] Verificare persistenza di preferenze, workspace recenti e sessione dopo l'aggiornamento.
- [ ] Verificare il rollback operativo in caso di certificazione rifiutata.

### 2.5 Automazione e documentazione

- [ ] Aggiungere un job Windows dedicato alla build AppX.
- [ ] Separare produzione del pacchetto e invio a Partner Center.
- [ ] Iniziare con caricamento manuale; automatizzare l'invio solo dopo un ciclo riuscito.
- [ ] Proteggere eventuali credenziali di invio tramite secret e ambienti approvati.
- [ ] Documentare installazione e aggiornamenti Store in italiano e inglese.
- [ ] Collegare la pagina Store dal README e dalla documentazione desktop.

### Criteri di accettazione dell'obiettivo 2

- [ ] Il pacchetto supera Windows App Certification Kit.
- [ ] Il pacchetto viene accettato in Partner Center.
- [ ] Installazione, primo avvio, workspace e server locali funzionano dalla build Store.
- [ ] Un aggiornamento Store N → N+1 conserva i dati previsti.
- [ ] La build Store non esegue controlli o download dall'updater GitHub.
- [ ] La portable rimane disponibile e funzionante.

---

## Obiettivo 3 — Restanti build dirette Windows e Linux

Scopo: offrire libertà di scelta senza moltiplicare configurazioni e comportamenti incoerenti.

### 3.1 Configurazione comune

- [ ] Separare configurazione condivisa e configurazioni specifiche dei target.
- [ ] Produrre tutti gli artefatti dalla stessa sorgente e versione.
- [ ] Inserire in ogni build un identificatore non ambiguo del formato.
- [ ] Normalizzare nome prodotto, icone, copyright, licenza e metadati.
- [ ] Decidere inizialmente l'architettura supportata; proposta: x64.
- [ ] Pubblicare checksum SHA-256 per tutti gli artefatti diretti.
- [ ] Generare una distinta degli artefatti attesi e fallire la CI se ne manca uno.
- [ ] Pubblicare una tabella che spieghi installazione, firma e aggiornamenti di ogni formato.

### 3.2 Windows portable

- [ ] Conservare la portable come artefatto ufficiale.
- [ ] Verificare che preferenze e log restino accanto all'eseguibile quando possibile.
- [ ] Verificare il fallback in directory utente quando la posizione non è scrivibile.
- [ ] Integrare la notifica realizzata nell'obiettivo 1.
- [ ] Mantenere il download manuale come strategia iniziale di aggiornamento.
- [ ] Documentare chiaramente che la portable non si auto-sostituisce.
- [ ] Collaudare avvio da cartella locale, unità rimovibile e directory non scrivibile.

### 3.3 Windows NSIS

- [ ] Aggiungere un target NSIS per utente senza privilegi amministrativi.
- [ ] Decidere installer one-click oppure assistito.
- [ ] Definire collegamenti Start/Desktop e comportamento dell'uninstaller.
- [ ] Non cancellare dati utente per impostazione predefinita durante la disinstallazione.
- [ ] Verificare installazione pulita, reinstallazione, upgrade e disinstallazione.
- [ ] Verificare coesistenza con portable e Store.
- [ ] Integrare la notifica realizzata nell'obiettivo 1.
- [ ] Documentare l'assenza di firma per la distribuzione diretta.
- [ ] Decidere separatamente se consentire auto-update NSIS prima di disporre di una firma.

### 3.4 Linux AppImage

- [ ] Formalizzare AppImage come artefatto ufficiale della workflow Linux.
- [ ] Costruire su runner Ubuntu supportato.
- [ ] Verificare avvio sulle distribuzioni Linux dichiarate.
- [ ] Verificare eventuale dipendenza da FUSE e documentare l'alternativa disponibile.
- [ ] Integrare la notifica realizzata nell'obiettivo 1.
- [ ] Verificare directory dati, log, workspace e file watching.
- [ ] Verificare avvio da file scrivibile e da posizione in sola lettura.
- [ ] Documentare l'integrazione manuale nel menu applicazioni, se necessaria.

### 3.5 Linux deb

- [ ] Aggiungere il target deb.
- [ ] Compilare package name, maintainer, homepage, categoria e dipendenze.
- [ ] Verificare installazione e rimozione su Debian e Ubuntu supportati.
- [ ] Verificare voce nel menu applicazioni e icona.
- [ ] Verificare workspace, server locali, log e preferenze.
- [ ] Integrare la notifica realizzata nell'obiettivo 1.
- [ ] Spiegare che un `.deb` su GitHub Releases non costituisce un repository APT.
- [ ] Decidere se gli aggiornamenti deb saranno manuali, applicativi o tramite futuro
      repository APT.

### 3.6 Linux rpm

- [ ] Aggiungere il target rpm dopo la stabilizzazione del deb.
- [ ] Compilare metadati e dipendenze rpm.
- [ ] Verificare installazione e rimozione almeno su Fedora.
- [ ] Estendere il collaudo a RHEL/openSUSE solo se dichiarati supportati.
- [ ] Integrare la notifica realizzata nell'obiettivo 1.
- [ ] Decidere se gli aggiornamenti rpm saranno manuali, applicativi o tramite repository.

### 3.7 Workflow e matrice di test

- [ ] Usare runner Windows per portable, NSIS e AppX.
- [ ] Usare runner Ubuntu per AppImage, deb e rpm.
- [ ] Allegare tutti gli artefatti alla stessa draft release.
- [ ] Pubblicare la release solo quando entrambe le piattaforme hanno completato i job.
- [ ] Eseguire smoke test degli artefatti, non soltanto verificare che i file esistano.
- [ ] Conservare log di build e checksum come artefatti CI.
- [ ] Verificare manualmente almeno una macchina pulita per famiglia prima di una release
      stabile.

### Criteri di accettazione dell'obiettivo 3

- [ ] La stessa release contiene portable, NSIS, AppImage, deb e rpm.
- [ ] Ogni artefatto mostra la stessa versione.
- [ ] Installazione o avvio, apertura workspace e disinstallazione sono stati collaudati.
- [ ] La notifica aggiornamenti usa la release corretta in ogni formato non Store.
- [ ] Documentazione e pagina download spiegano chiaramente le differenze.

---

## Obiettivo 4 — Aggiornamenti automatici e formati aggiuntivi

Questa fase non deve ritardare la notifica dell'obiettivo 1 né la prima pubblicazione Store.

### 4.1 Aggiornamenti automatici

- [ ] Aggiungere `electron-updater` come dipendenza runtime dell'app desktop.
- [ ] Configurare GitHub Releases come provider degli artefatti diretti.
- [ ] Pubblicare manifest e blockmap richiesti insieme agli artefatti.
- [ ] Separare nel codice:
  - controllo della versione;
  - download;
  - verifica;
  - consenso dell'utente;
  - installazione e riavvio.
- [ ] Non interrompere automaticamente server o workspace senza consenso esplicito.
- [ ] Mostrare avanzamento download e possibilità di rimandare il riavvio.
- [ ] Verificare checksum e, quando disponibile, firma del pacchetto.
- [ ] Non eseguire `electron-updater` nelle build portable o Store.
- [ ] Testare NSIS N → N+1.
- [ ] Testare AppImage N → N+1 da posizione scrivibile.
- [ ] Testare e documentare l'elevazione richiesta da deb/rpm.
- [ ] Gestire download interrotto, disco pieno, pacchetto corrotto e riavvio fallito.
- [ ] Definire una procedura per ritirare una release senza forzare downgrade.
- [ ] Valutare rollout graduale solo dopo il funzionamento del canale stabile.

### 4.2 MSIX

- [ ] Monitorare la stabilizzazione di `electron-builder 27`.
- [ ] Leggere tutte le breaking change prima dell'aggiornamento.
- [ ] Provare il target MSIX in un branch dedicato.
- [ ] Confrontare manifest e comportamento con AppX.
- [ ] Migrare la build Store soltanto se MSIX porta un beneficio concreto.
- [ ] Verificare una migrazione AppX → MSIX tramite Store.

### 4.3 Snap e Flatpak

- [ ] Definire il modello di accesso a workspace arbitrari prima di scegliere la sandbox.
- [ ] Prototipare i file picker/portal necessari.
- [ ] Verificare server loopback, file watching ed esecuzione degli handler.
- [ ] Valutare i requisiti di revisione Snap `classic`.
- [ ] Valutare manifest, permission e Flathub review per Flatpak.
- [ ] Affidare gli aggiornamenti ai rispettivi store, non a `electron-updater`.
- [ ] Pubblicare questi formati soltanto quando l'esperienza workspace è equivalente o le
      limitazioni sono dichiarate chiaramente.

### 4.4 Formati e architetture ulteriori

- [ ] Valutare ARM64 Windows e Linux in base alla domanda.
- [ ] Valutare MSI/MSI-wrapped soltanto per esigenze enterprise concrete.
- [ ] Valutare archivi zip/tar soltanto se offrono un caso d'uso diverso dalla portable o
      dall'AppImage.
- [ ] Evitare Squirrel.Windows se non emerge un requisito che NSIS non soddisfa.

### Criteri di accettazione dell'obiettivo 4

- [ ] Ogni formato dichiara chiaramente chi gestisce gli aggiornamenti.
- [ ] Nessuna build usa contemporaneamente due sistemi di auto-update.
- [ ] Gli aggiornamenti automatici sono stati provati da una versione realmente pubblicata
      alla successiva.
- [ ] Un fallimento dell'aggiornamento non rende inutilizzabili workspace e preferenze.

---

## Checklist trasversale per ogni nuova distribuzione

- [ ] Versione e nome artefatto corretti.
- [ ] Avvio senza privilegi amministrativi quando previsto.
- [ ] Blocco della seconda istanza.
- [ ] Apertura di più workspace.
- [ ] Ripristino della sessione multi-workspace.
- [ ] Funzionamento di `--no-restore-workspaces`.
- [ ] Lettura, scrittura e file watching dei workspace.
- [ ] Avvio contemporaneo dei server dei workspace.
- [ ] Handler e middleware JavaScript.
- [ ] Preferenze e log in una posizione persistente e scrivibile.
- [ ] Comportamento con directory non scrivibili.
- [ ] Notifica aggiornamento corretta per il canale.
- [ ] Aggiornamento N → N+1, se supportato.
- [ ] Disinstallazione senza perdita inattesa dei dati utente.
- [ ] Coesistenza con gli altri formati.
- [ ] Documentazione italiana e inglese aggiornata.

## Registro decisioni

| Data | Decisione | Motivazione |
|---|---|---|
| 28 lug 2026 | Prima la notifica, poi Store, infine le altre build | Ottenere presto valore per gli utenti senza aprire subito tutta la matrice di packaging |
| 28 lug 2026 | GitHub Releases come infrastruttura minima proposta | Evita un server dedicato e può ospitare manifest e artefatti |
| 28 lug 2026 | AppX come primo pacchetto Store | È supportato dalla toolchain stabile attuale e accettato dal Microsoft Store |
| 28 lug 2026 | MSIX rinviato | Il target di electron-builder 27 è ancora beta in una major alpha |
| 28 lug 2026 | Auto-update distinto dalla semplice notifica | La portable e lo Store richiedono strategie diverse dagli installer diretti |
| 28 lug 2026 | `tosdan/mockxy` è il repository canonico delle release | Codice, release e manifest degli aggiornamenti rimangono nello stesso repository |
| 29 lug 2026 | Checker GitHub isolato da Electron e UI | Consente test locali, nessuna credenziale nel client e futura integrazione con updater diversi |
| 29 lug 2026 | Controllo automatico dopo 5 secondi, massimo ogni 24 ore | Non rallenta l'avvio e limita le richieste remote; il controllo manuale resta sempre esplicito |
| 29 lug 2026 | Build Store esclusa dal checker GitHub | Lo Store resta l'unica autorità per gli aggiornamenti del proprio pacchetto |

## Prossimo incremento consigliato

Il checker è ora collegato al ciclo di vita Electron, alle preferenze globali, a IPC/preload
e alla UI bilingue, senza download automatico. Restano il collaudo sugli artefatti reali e il
workflow di pubblicazione necessario per provare il percorso completo.

Sequenza proposta per il prossimo ciclo:

1. creare il workflow di release minimo avviato da un tag;
2. eseguire test e build prima di creare una draft release;
3. allegare artefatti e checksum alla draft;
4. provare il controllo aggiornamenti tra due versioni reali;
5. collaudare la notifica su portable Windows e AppImage Linux;
6. completare criteri di accettazione e note di rilascio dell'obiettivo 1.
