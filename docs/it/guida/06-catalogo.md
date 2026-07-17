# 06 — Il catalogo dei mock

Il catalogo è la vista di lavoro sul workspace: l'elenco di tutti gli endpoint, organizzabile
e ricercabile, da cui si crea, si modifica e si accende ogni mock. La pagina è divisa in due:
a sinistra l'albero degli endpoint organizzati in collection, a destra la scheda
dell'endpoint selezionato (tema del [capitolo 8](08-scheda-endpoint.md)); il divisore tra i
due pannelli si trascina per ridimensionare, e un doppio click lo reimposta.

Vale anche qui la regola fondante: il catalogo e i file su disco sono **due viste equivalenti
sugli stessi dati**. Ogni azione della pagina scrive i file del workspace, e ogni modifica
fatta a mano ai file compare nel catalogo grazie alla ricarica a caldo.

> 📷 **SCREENSHOT** — `06-catalogo-panoramica.png`
> Cosa mostrare: il catalogo popolato con collection annidate (es. `utenti` con una
> sotto-collection, `ordini`, più qualche endpoint in Unsorted), un endpoint selezionato con
> la scheda visibile a destra, e il piè di pagina con i contatori. La vista "normale" di
> lavoro, senza filtri attivi.

## Le collection

Gli endpoint si organizzano in **collection**, anche annidate, per tenere ordinato un
workspace che cresce — tipicamente una collection per area funzionale dell'API (`utenti`,
`ordini`, `fatturazione`…). Si creano dal pulsante «Nuova collection» in testa all'albero (o
«Nuova sotto-collection» dal menu di una collection esistente), e si riordinano e spostano
con il **trascinamento**: sia le collection sia i singoli endpoint si trascinano da una
collection all'altra. In alternativa al drag & drop, il menu di ogni elemento offre «Sposta
su», «Sposta giù» e «Sposta in collection» con la scelta della destinazione (incluso il
livello principale).

Due proprietà da conoscere per usarle senza timori:

- l'organizzazione è **un metadato dell'interfaccia**: vive nel file `.collections.json`
  della cartella dei mock (condiviso in git come il resto) e non tocca né i percorsi serviti
  né la posizione delle cartelle su disco — riordinare non può rompere nulla;
- gli endpoint non assegnati ad alcuna collection vivono nella collection virtuale
  **Unsorted**, che è la destinazione di default dei nuovi mock.

### Le azioni di collection

Il menu di ogni collection raccoglie, oltre agli spostamenti, quattro azioni il cui effetto
va capito bene:

- **Abilita tutti / Disabilita tutti** — un'azione in massa: scrive lo stesso stato su
  *tutti* gli endpoint del sottoalbero, file per file. È il modo rapido per spegnere un'area
  intera («tutta l'anagrafica torna al backend vero»), ma è una scrittura uniforme:
  riabilitando la collection si riaccende tutto, anche ciò che era stato disabilitato
  singolarmente prima.
- **Dissolvi collection** — rimuove il raggruppamento senza eliminare i mock: la collection
  e le sue sotto-collection spariscono, e gli endpoint contenuti tornano in Unsorted.
- **Elimina collection** — elimina definitivamente l'intero sottoalbero: collection,
  sotto-collection e **tutti gli endpoint contenuti** con le loro varianti. La conferma
  dichiara il conteggio di ciò che sta per sparire.
- Su Unsorted, l'azione equivalente è **«Elimina tutti gli endpoint»**: rimuove tutti i
  non assegnati — **inclusi quelli momentaneamente nascosti dai filtri correnti**, dettaglio
  da tenere presente prima di confermare.

> 📷 **SCREENSHOT** — `06-menu-collection.png`
> Cosa mostrare: il menu contestuale di una collection aperto, con le voci di spostamento,
> «Abilita/Disabilita tutti», «Nuova sotto-collection», «Dissolvi» ed «Elimina» visibili.

## Ricerca e filtri

La casella «Filtra il catalogo…» restringe l'albero con la ricerca testuale libera; il
pulsante dei filtri apre il pannello con due criteri combinabili:

- **Tipo** — la natura della variante attiva di ciascun endpoint: Mock, Handler, Middleware,
  SSE, WebSocket (o Tutti);
- **Stato** — Attivi, Disattivi, o Tutti.

Ricerca e filtri si sommano; quando nessun endpoint corrisponde, il messaggio dedicato lo
segnala e «Reimposta filtri» riporta tutto alla vista completa. I pulsanti «Espandi tutte» e
«Collassa tutte» agiscono sulle cartelle dell'albero.

> 📷 **SCREENSHOT** — `06-filtri-attivi.png`
> Cosa mostrare: il pannello filtri aperto con un filtro attivo (es. Tipo = Handler) e
> l'albero ridotto ai soli endpoint corrispondenti.

## La riga dell'endpoint

Ogni endpoint compare nell'albero con il badge del metodo, il percorso e un **interruttore
di abilitazione** azionabile direttamente dalla lista: disattivare un endpoint non lo
cancella — le sue richieste tornano a seguire il fallback (proxy verso il backend, o 404 in
solo-mock). Un badge **SEQ** contrassegna gli endpoint con una sequenza di varianti attiva
([capitolo 12](12-sequenze.md)).

Il piè di pagina riepiloga i numeri del workspace: endpoint e collection totali, e il
rapporto attivi/totali.

## Ricaricare dal disco

Il pulsante «Ricarica dal disco» forza la rilettura del workspace. Con la ricarica a caldo
attiva serve di rado — le modifiche ai file vengono raccolte da sole — ma è la mossa giusta
dopo operazioni esterne massicce (un `git pull`, un cambio di branch, uno script che ha
riscritto i mock) o quando il watch è spento.

La vista, infine, **ricorda la posizione**: l'ultimo endpoint selezionato e le collection
compresse vengono salvati nel browser, e tornando al catalogo — anche dopo un riavvio — lo si
ritrova come lasciato.

Il catalogo si popola in tre modi: creando endpoint a mano («Nuovo»), importando una
specifica OpenAPI («Importa OpenAPI», [capitolo 23](23-import-openapi.md)), o catturando
traffico dal monitor ([capitolo 21](21-cattura-mock.md)). Si parte dal primo: la creazione
guidata e le regole dei percorsi sono il [capitolo 7](07-creare-endpoint.md).
