# Ricerca: Microsoft Store con AppX ed electron-builder

Stato della ricerca: **29 luglio 2026**. Le conclusioni usano soltanto fonti primarie:
documentazione Microsoft Learn e documentazione/codice ufficiale di `electron-builder`.

## Esito

Mockxy può essere distribuito nel Microsoft Store come applicazione desktop Electron
**full trust** mediante l'AppX prodotto dalla toolchain già presente nel repository. Partner
Center accetta ancora i file `.appx`, anche se per Windows 10 e 11 raccomanda i contenitori
`.appxupload` o `.msixupload`; il normale `.appx` generato da `electron-builder 26` è quindi
un primo pacchetto Store valido, non un formato da distribuire direttamente dal nostro sito
([formati accettati da Partner Center](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/upload-app-packages)).

Microsoft include esplicitamente Electron tra i framework Win32 distribuibili nello Store.
Il percorso AppX/MSIX offre hosting, firma e aggiornamenti dello Store; è distinto dalla
pubblicazione di un installer EXE/MSI, che dovrebbe essere già firmato e resterebbe ospitato e
aggiornato dal produttore
([distribuzione delle applicazioni Win32](https://learn.microsoft.com/en-us/windows/apps/distribute-through-store/how-to-distribute-your-win32-app-through-microsoft-store),
[opzioni di firma](https://learn.microsoft.com/en-us/windows/msix/package/signing-package-overview)).

Non serve aggiornare Electron per questo incremento. Il repository usa:

- Mockxy `1.2.0`;
- Electron `42.4.1`;
- `electron-builder 26.15.3`;
- Node.js 24 nella pipeline di release.

Le versioni dichiarate e risolte sono in
[`electron/package.json`](../../electron/package.json) e
[`electron/package-lock.json`](../../electron/package-lock.json); la pipeline corrente è in
[`release.yml`](../../.github/workflows/release.yml). Il target AppX è responsabilità di
`electron-builder`, non del runtime Electron. La baseline `v1.2.0` ispezionata all'avvio di
questo incremento produce soltanto la portable Windows e non contiene ancora né una sezione
`appx` né gli asset `electron/build/appx/`; sono precisamente elementi da introdurre nel
prototipo Store.

## Blocco esterno: prima va creato il prodotto in Partner Center

Non è corretto inventare l'identità definitiva nel repository. Occorre prima creare in Partner
Center un prodotto di tipo **MSIX or PWA app**, riservare il nome pubblico desiderato e aprire
**Product management → Product identity**
([riserva del nome](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/reserve-your-apps-name),
[identità del prodotto](https://learn.microsoft.com/en-us/windows/apps/publish/view-app-identity-details)).

Da quella pagina devono essere copiati senza modifiche questi tre valori:

| Partner Center / manifest | Opzione `electron-builder` | Provenienza |
|---|---|---|
| `Package/Identity/Name` | `appx.identityName` | assegnato al prodotto da Partner Center |
| `Package/Identity/Publisher` | `appx.publisher` | assegnato all'account/prodotto da Partner Center |
| `Package/Properties/PublisherDisplayName` | `appx.publisherDisplayName` | assegnato da Partner Center |

Questi campi stabiliscono la famiglia del pacchetto. PFN e Package SID, anch'essi mostrati da
Partner Center, sono valori derivati e **non** vanno copiati nel manifest
([campi dell'identità Store](https://learn.microsoft.com/en-us/windows/apps/publish/view-app-identity-details)).
L'identità di un pacchetto comprende nome, versione, architettura, resource ID e publisher;
`Name` è lungo 3–50 caratteri e il `Publisher` è il subject X.509 dell'editore
([package identity](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/package-identity-overview)).

Gli altri nomi hanno ruoli diversi:

- `appx.displayName` è il nome visibile del pacchetto e deve corrispondere a un nome riservato,
  inizialmente presumibilmente `Mockxy`;
- `appx.applicationId` è il package-relative application identifier (PRAID), unico soltanto
  all'interno del pacchetto: non è l'Identity Name assegnato da Partner Center. Conviene
  fissarlo a `Mockxy` e non cambiarlo dopo la prima pubblicazione, perché modificarlo può
  interrompere la posizione del riquadro nel menu Start
  ([schema `Application.Id`](https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-f-application));
- `build.appId: "com.mockxy.desktop"` è l'identificatore generale già usato da Electron e non
  sostituisce `appx.identityName`.

## Configurazione AppX proposta

Una volta ottenuti i valori reali da Partner Center, la prima configurazione dovrebbe avere
questa forma. I testi fra parentesi angolari sono segnaposto descrittivi, non valori da
committare:

```json
{
  "build": {
    "appId": "com.mockxy.desktop",
    "productName": "Mockxy",
    "win": {
      "target": "portable",
      "icon": "build/icon.ico"
    },
    "appx": {
      "applicationId": "Mockxy",
      "identityName": "<Package/Identity/Name da Partner Center>",
      "publisher": "<Package/Identity/Publisher da Partner Center>",
      "publisherDisplayName": "<Package/Properties/PublisherDisplayName da Partner Center>",
      "displayName": "Mockxy",
      "languages": ["en-US", "it-IT"],
      "capabilities": ["runFullTrust", "privateNetworkClientServer"],
      "setBuildNumber": false,
      "minVersion": "10.0.22000.0",
      "artifactName": "Mockxy-${version}-${arch}-store.${ext}"
    }
  }
}
```

`electron-builder` documenta il comando `electron-builder --win appx`, le opzioni di identità,
lingua, capability e visualizzazione e aggiunge comunque `runFullTrust` alle app Electron
([documentazione AppX di electron-builder](https://github.com/electron-userland/electron-builder/blob/master/website/docs/appx.md)).
Il repository espone due comandi distinti:

```powershell
# Prototipo non firmato con identità locale, mai destinato a Partner Center
npm run dist:electron:appx:test

# Candidato Store con i valori reali di Product identity
Copy-Item electron/store-identity.example.json electron/store-identity.json
# Modificare electron/store-identity.json, poi:
npm run dist:electron:appx:store
```

`electron/store-identity.json` è ignorato da Git ed escluso esplicitamente dai file inclusi
nell'app. La build Store si interrompe prima del packaging se il file manca o contiene ancora
segnaposto. In CI lo stesso file può essere fornito fuori dal repository indicando il percorso
con `MOCKXY_STORE_IDENTITY_FILE`. I valori di identità non sono password, ma questa separazione
impedisce di produrre accidentalmente un candidato con l'identità locale di test.

`languages` deve elencare soltanto lingue per le quali applicazione e scheda Store sono davvero
localizzate: le policy impongono di localizzare descrizione e limitazioni per ogni lingua
dichiarata
([Microsoft Store Policies 7.19, §10.7](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies)).

Con `setBuildNumber: false`, la versione SemVer `1.2.0` diventa `1.2.0.0`. È il comportamento
corretto per lo Store: il manifest usa una versione numerica a quattro componenti, ciascuna
entro 0–65535, il primo componente non può essere zero e il quarto è riservato allo Store e
deve essere zero nel pacchetto inviato
([numerazione dei pacchetti](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/package-version-numbering?pivots=store-installer-msix)).
Ogni aggiornamento dovrà incrementare almeno uno dei primi tre componenti.

### Versione minima e massima di Windows

Per il prototipo e il primo invio Store è consigliato dichiarare:

- `TargetDeviceFamily Name="Windows.Desktop"`;
- `MinVersion="10.0.22000.0"`, cioè la prima famiglia Windows 11;
- `MaxVersionTested` pari inizialmente al minimo (comportamento di `electron-builder` quando
  l'opzione non è impostata), da portare a `10.0.26200.0`, cioè Windows 11 25H2,
  **soltanto dopo** avere eseguito smoke test e WACK su 25H2. Se il collaudo avviene su una
  versione precedente, questo valore deve riportare la famiglia realmente provata.

`MinVersion` decide se il pacchetto è installabile; `MaxVersionTested` dichiara fino a quale
versione sono stati collaudati i comportamenti del sistema e non impedisce l'esecuzione su
versioni successive
([schema `TargetDeviceFamily`](https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-targetdevicefamily)).
Alla data della ricerca Windows 11 25H2 appartiene alla famiglia build 26200, mentre 24H2
appartiene alla 26100
([Windows 11 release information](https://learn.microsoft.com/en-us/windows/release-health/windows11-release-information)).

La scelta Windows 11-only riduce la prima matrice di certificazione ed evita di dichiarare
supporto generale a Windows 10 dopo la fine del supporto ordinario del 14 ottobre 2025
([lifecycle di Windows 10](https://learn.microsoft.com/en-us/lifecycle/announcements/windows-10-22h2-end-of-support-update)).
`electron-builder 26` userebbe altrimenti per x64 un minimo storico molto più basso
(`10.0.14316.0`), configurabile tramite `appx.minVersion`; non va accettato implicitamente
senza un collaudo su quei sistemi
([opzioni AppX di electron-builder](https://github.com/electron-userland/electron-builder/blob/master/website/docs/appx.md)).

Se si decide esplicitamente di servire Windows 10 LTSC/ESU tramite Store, l'abbassamento del
minimo deve essere un incremento separato, accompagnato da test installazione/WACK sulle
edizioni realmente dichiarate. Non basta che Electron si avvii su una singola macchina.

## Manifest risultante e asset

Il template AppX ufficiale di `electron-builder 26` genera già la struttura necessaria:

- `Identity` con nome, publisher, versione e architettura;
- `Properties` con display name, publisher display name, descrizione e logo;
- `Resources` con le lingue;
- `TargetDeviceFamily Name="Windows.Desktop"`;
- `Application` con l'eseguibile Electron e
  `EntryPoint="Windows.FullTrustApplication"`;
- `VisualElements`;
- `Capabilities`.

Ogni pacchetto deve contenere un manifest che descriva identità, dipendenze, capability,
elementi visuali ed estensioni
([schema del package manifest](https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/appx-package-manifest)).
Il target deve restare `Windows.Desktop`, coerentemente con l'applicazione Electron Win32, e non
va sostituito con una famiglia UWP generica.

L'assenza di `electron/build/appx/` farebbe usare a `electron-builder` immagini predefinite.
Prima di una submission reale servono invece asset Mockxy dedicati, almeno:

| File | Dimensione nominale |
|---|---:|
| `StoreLogo.png` | 50×50 |
| `Square150x150Logo.png` | 150×150 |
| `Square44x44Logo.png` | 44×44 |
| `Wide310x150Logo.png` | 310×150 |

Vanno collocati in `electron/build/appx/`; sono supportate anche varianti scalate e asset
facoltativi per badge, tile grande/piccolo e splash screen
([asset AppX di electron-builder](https://github.com/electron-userland/electron-builder/blob/master/website/docs/appx.md)).
Non bisogna inviare allo Store i placeholder del builder.

## Firma: submission Store e installazione locale sono due casi diversi

Per la submission Store non occorre acquistare un certificato: dopo la certificazione Microsoft
firma automaticamente il pacchetto AppX/MSIX. Questa firma gratuita vale per il pacchetto
distribuito dallo Store, non per la portable o per futuri installer scaricati da GitHub
([firma dei pacchetti](https://learn.microsoft.com/en-us/windows/msix/package/signing-package-overview),
[certificazione Store](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-certification-process)).
Con `CSC_IDENTITY_AUTO_DISCOVERY=false` e nessun certificato, `electron-builder` può quindi
produrre l'AppX non firmato destinato all'upload, purché il manifest contenga esattamente
l'identità Partner Center
([firma AppX in electron-builder](https://github.com/electron-userland/electron-builder/blob/master/website/docs/appx.md)).

Per installare e collaudare localmente lo stesso pacchetto serve invece una delle seguenti
modalità:

1. firmarlo con un certificato di sviluppo il cui `Subject` coincida **esattamente** con
   `Package/Identity/Publisher`, e rendere attendibile quel certificato sulla macchina di test;
2. su Windows 11, usare l'installazione esplicitamente non firmata con
   `Add-AppxPackage -AllowUnsigned`, riservata allo sviluppo e non alla distribuzione.

La firma locale può usare un certificato self-signed gratuito; Windows richiede normalmente
che il certificato sia attendibile sul dispositivo e che il suo subject coincida con il
publisher del manifest
([firma con SignTool](https://learn.microsoft.com/en-us/windows/msix/package/sign-app-package-using-signtool),
[pacchetti non firmati per test](https://learn.microsoft.com/en-us/windows/msix/package/unsigned-package)).
Il collaudo con certificato è più rappresentativo della distribuzione finale.

## Architetture

Il primo incremento può essere soltanto **x64**, in continuità con la portable già pubblicata.
Partner Center accetta più pacchetti della stessa app e consegna a ogni dispositivo quello
applicabile
([upload e selezione dei pacchetti](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/upload-app-packages)).

Una build x64 può funzionare in emulazione sui dispositivi Windows 11 ARM64, mentre una build
ARM64 nativa offre prestazioni e autonomia migliori; per una copertura nativa si potrà quindi
aggiungere in un incremento successivo un secondo AppX `--arm64`
([considerazioni x64/ARM64](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/deploy-overview)).
Non conviene dichiarare ARM64 prima che esistano un artefatto Electron ARM64 e una macchina
ARM64 su cui eseguire il collaudo completo.

## Vincoli specifici di Mockxy

### Full trust e loopback

Un'app desktop pacchettizzata con `Windows.FullTrustApplication` gira a livello di integrità
medio e non dentro un AppContainer. Può quindi usare le normali API Win32 con i permessi
dell'utente, ma il pacchetto deve dichiarare la capability ristretta `runFullTrust`
([capability delle app desktop](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/app-capability-declarations)).
`electron-builder` la aggiunge automaticamente; va comunque motivata nelle note di
certificazione perché Partner Center richiede una spiegazione per le capability ristrette
([submission options e restricted capabilities](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/manage-submission-options)).

Il caso di Mockxy richiede un'attenzione aggiuntiva: il processo principale avvia un server
HTTP/WebSocket e la UI Electron lo raggiunge su `127.0.0.1`. La documentazione Microsoft
aggiornata il 14 luglio 2026 afferma che le applicazioni pacchettizzate partecipanti a una
connessione loopback devono dichiarare `privateNetworkClientServer`; regole
`LoopbackAccessRules` reciproche servono invece quando comunicano **due applicazioni
pacchettizzate distinte**
([IPC via loopback](https://learn.microsoft.com/en-us/windows/apps/develop/communication/interprocess-communication)).
Per i processi della stessa applicazione Mockxy la configurazione iniziale deve quindi
dichiarare `privateNetworkClientServer` e il comportamento va verificato su un AppX installato.
Non va usato `CheckNetIsolation` come soluzione: Microsoft lo limita a sideload/debug con
accesso amministrativo locale.

Nel codice corrente il bind predefinito è loopback, mentre il workspace può scegliere
esplicitamente `0.0.0.0`
([`desktop-server.js`](../../electron/desktop-server.js)). Il collaudo Store deve coprire:

- caricamento della UI da `http://127.0.0.1:<porta>`;
- chiamata a un endpoint mock HTTP;
- WebSocket/SSE;
- più workspace, ciascuno con una porta;
- riavvio e ripristino della sessione;
- bind `0.0.0.0` su una rete privata e comportamento del firewall.

Il default loopback è anche la configurazione da presentare ai certificatori. L'esposizione in
LAN deve rimanere una scelta esplicita dell'utente.

### Directory di installazione e workspace esterni

I file dentro `C:\Program Files\WindowsApps\<package>` sono in sola lettura e protetti; una
desktop app full trust può invece scrivere fuori dal pacchetto dove l'utente possiede i
permessi. Le scritture sotto AppData possono essere reindirizzate in uno spazio per utente e
per pacchetto
([comportamento delle desktop app pacchettizzate](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes)).

La baseline Mockxy è già vicina al comportamento richiesto:

- preferenze globali e sessione usano `app.getPath("userData")` nelle build non-portable;
- i log tentano la posizione dell'eseguibile, ma ripiegano su `userData` se non è scrivibile;
- UI e sorgenti inclusi vengono letti da `process.resourcesPath`;
- i workspace sono directory esterne scelte dall'utente.

Queste scelte sono visibili in
[`app-main.js`](../../electron/app-main.js). Nell'incremento Store è preferibile dirigere
subito i log verso `userData`, senza tentare una scrittura sicuramente vietata nella directory
del pacchetto. Il test deve confermare lettura, scrittura, file watching, handler e middleware
in almeno un workspace esterno. Un `.env` o una configurazione collocati accanto
all'eseguibile non sarebbero scrivibili e non devono diventare il meccanismo della build Store.

### Codice JavaScript dei workspace

Mockxy esegue handler e middleware JavaScript forniti dall'utente nel workspace. Le policy
vietano di usare inclusione dinamica di codice per cambiare sostanzialmente la funzionalità
dichiarata o introdurre funzioni vietate; non vietano in assoluto un developer tool la cui
funzione descritta è eseguire codice locale
([Microsoft Store Policies 7.19, §10.2.2](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies)).

Per ridurre il rischio di una bocciatura, scheda e note di certificazione devono dichiarare
esplicitamente che Mockxy:

- è uno strumento di sviluppo per server mock locali;
- esegue script scelti e controllati dall'utente come parte della funzione principale;
- non scarica automaticamente script remoti;
- può leggere e modificare soltanto i workspace che l'utente apre;
- usa `127.0.0.1` per impostazione predefinita e avverte quando il server viene esposto in LAN.

Questa descrizione deve restare coerente con il comportamento reale: le policy richiedono che
funzioni, limiti e dipendenze siano rappresentati accuratamente
([Microsoft Store Policies 7.19, §10.1](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies)).

### Aggiornamenti

Lo Store deve essere l'unico gestore degli aggiornamenti per questa distribuzione. Il codice
corrente rileva già `process.windowsStore`, assegna il canale `store` e disattiva il controllo
GitHub
([`app-main.js`](../../electron/app-main.js),
[`update-service.js`](../../electron/update-service.js)). Electron definisce
`process.windowsStore` come vero per applicazioni eseguite come pacchetto MSIX/AppX
([API `process`](https://www.electronjs.org/docs/latest/api/process#processwindowsstore-readonly)).
Il collaudo dell'AppX deve comunque confermare che nell'interfaccia non compaiano né il
controllo né la notifica GitHub.

## Privacy, supporto e scheda Store

Per Mockxy l'informativa privacy non è facoltativa. Le policy correnti stabiliscono che i
prodotti Desktop Bridge e Win32 devono **sempre** avere una privacy policy, perché per natura
possono accedere a dati personali; l'URL pubblico va inserito in Partner Center e il documento
va mantenuto aggiornato
([Microsoft Store Policies 7.19, §10.5.1](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies)).
Nel repository non esiste ancora una privacy policy: è un blocco reale prima della submission.

Prima dell'invio occorrono:

- un URL HTTPS pubblico e stabile per l'informativa privacy;
- un contatto di supporto, come URL o indirizzo email;
- l'URL del progetto/sito;
- descrizioni, screenshot e asset della scheda per `en-US` e `it-IT`, se entrambe sono
  dichiarate.

Partner Center accetta per il supporto un URL o un indirizzo email
([support info per app MSIX](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/support-info)).
Il repository può fungere da sito del progetto e
`https://github.com/tosdan/mockxy/issues` è un possibile URL iniziale di supporto, ma il
publisher deve decidere anche un contatto che gli utenti possano usare senza ambiguità. La
privacy policy dovrà almeno descrivere dati nei workspace e nei log, connessioni verso backend
configurati dall'utente, assenza/presenza di telemetria e controlli disponibili all'utente;
questi contenuti richiedono una verifica funzionale e legale separata.

## WACK, Partner Center e collaudo

Prima dell'upload va eseguita la versione più recente del **Windows App Certification Kit**
inclusa nel Windows SDK. Il kit apre il pacchetto ed esegue il workflow appropriato; Microsoft
raccomanda di usare sempre la versione più recente prima della submission
([Windows App Certification Kit](https://learn.microsoft.com/en-us/windows/uwp/debug-test-perf/windows-app-certification-kit)).
Il controllo va eseguito su un Windows pulito, con il pacchetto firmato per test, conservando
il report come artefatto.

Partner Center ripete la validazione del pacchetto e la certificazione comprende controlli
tecnici WACK, sicurezza/malware e revisione delle policy. Dopo il superamento, lo Store firma il
pacchetto; è possibile impostare un publishing hold per evitare la pubblicazione immediata
([processo di certificazione](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-certification-process),
[publishing hold](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/manage-submission-options)).

Le note di certificazione devono fornire istruzioni riproducibili:

1. avviare Mockxy senza account né servizi esterni;
2. creare o aprire un workspace di prova;
3. mostrare la porta assegnata e aprire la UI locale;
4. invocare un endpoint mock;
5. spiegare handler JavaScript, accesso al filesystem e opzione LAN;
6. spiegare perché servono `runFullTrust` e `privateNetworkClientServer`;
7. indicare dove vengono salvati preferenze e log;
8. confermare che gli aggiornamenti sono affidati allo Store.

Il prodotto deve essere testabile, avviarsi e chiudersi correttamente e mantenere funzionante
ogni server necessario alla certificazione
([Microsoft Store Policies 7.19, §§10.3–10.4](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies)).
Per il primo invio conviene selezionare la pubblicazione manuale dopo la certificazione.

## Sequenza di implementazione consigliata

1. Creare/verificare l'account Partner Center e riservare il prodotto `Mockxy` come
   **MSIX or PWA app**.
2. Copiare i tre valori Product identity e scegliere il contatto di supporto.
3. Pubblicare una privacy policy raggiungibile via HTTPS.
4. Aggiungere una configurazione AppX x64 con identità reale, `applicationId` stabile,
   `runFullTrust` e `privateNetworkClientServer`.
5. Creare gli asset brand in `electron/build/appx/`.
6. Produrre l'AppX non firmato destinato allo Store e una copia firmata self-signed per il
   collaudo locale.
7. Installare la copia di test su Windows pulito e collaudare loopback, workspace esterno,
   handler, log/preferences, più workspace, seconda istanza, opzione
   `--no-restore-workspaces`, disinstallazione e reinstallazione.
8. Eseguire WACK e correggere ogni errore o warning spiegabile.
9. Aggiungere un job Windows dedicato che costruisca e conservi AppX e manifest, senza allegare
   il pacchetto Store alla GitHub Release pubblica.
10. Compilare listing e note di certificazione, caricare l'AppX in Partner Center e mantenere
    la pubblicazione sospesa fino all'esito del collaudo Store.

Il prototipo locale, gli asset e la configurazione parametrizzata sono ora preparati. Il primo
passo esterno resta la riserva del prodotto in Partner Center: il pacchetto candidato definitivo
dipende dai valori ufficiali del prodotto.
