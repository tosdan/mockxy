# Esposizione in rete e sicurezza del bind

Di default Mockxy ascolta **solo su loopback** (`127.0.0.1`): raggiungibile dalla macchina su
cui gira, invisibile alla rete. Non è una timidezza — è la conseguenza diretta di cosa può fare
l'**admin API**: crea handler, cioè scrive file ed **esegue JavaScript**. Su un bind di rete,
chiunque raggiunga la porta può eseguire codice sulla macchina. L'esposizione deve quindi
essere una scelta esplicita e consapevole.

## Esporre sulla rete

- **Headless**: `HOST=0.0.0.0` (tutte le interfacce).
- **App desktop**: interruttore «Accessibile da tutta la rete» nelle impostazioni del
  workspace, che accetta solo la scelta binaria loopback/rete e mostra l'avvertenza sul rischio.
- **Docker**: le immagini impostano `HOST=0.0.0.0` da sole, perché il loopback *del container*
  non è raggiungibile dal port mapping; l'esposizione reale si decide sul mapping delle porte
  dell'host.

Quando l'admin API è attiva su un bind non-loopback, all'avvio compare nel log un **avviso
pensato per essere impossibile da mancare**. Non è un blocco — su una rete fidata può essere
una scelta legittima — ma la combinazione va fatta a occhi aperti. Le alternative sicure:

- **spegnere l'admin** con `ADMIN_API_ENABLED=false`: i mock restano serviti, sparisce la
  superficie che esegue codice. È ciò che fa da sé l'immagine standalone per gli ambienti
  condivisi (vedi il README, sezione Docker);
- per i frontend browser che chiamano il server esposto da altre origin, attivare il
  [CORS automatico](CORS.md) — che riguarda i *mock*, non l'admin.

## La difesa anti DNS rebinding

C'è un attacco che colpisce anche i server che ascoltano *solo* su loopback: il **DNS
rebinding**. Una pagina web ostile fa ri-risolvere il proprio dominio verso `127.0.0.1`: per il
browser della vittima le richieste al dominio ostile sono same-origin (il CORS non interviene),
ma arrivano al server locale — e potrebbero pilotare l'admin API, leggendone pure le risposte.

La difesa sfrutta l'unico segnale che l'attaccante non può falsificare: l'header **`Host`**
conserva il dominio ostile. L'admin API accetta quindi solo richieste con `Host` di loopback
(`localhost`, `127.0.0.1`, `::1`), più gli eventuali nomi extra dichiarati in
**`ADMIN_ALLOWED_HOSTS`** (per esempio un alias in `/etc/hosts`, o il nome del server in un
deployment intranet indurito — dichiararli attiva il controllo anche su bind non-loopback).
Tutto il resto riceve `403`.

Due confini deliberati del controllo:

- vale **solo per l'admin API**: i *mock* accettano qualunque `Host`, perché devono poter
  essere consumati da client di ogni tipo senza configurazione;
- sul bind di rete *senza* allowlist il controllo non si applica: gli host legittimi non
  sarebbero prevedibili, e su quel bind vale già l'avviso di esposizione.

## Promemoria per il caso LAN

Esporre il server per i colleghi tipicamente significa: bind di rete, **admin spenta** (o rete
davvero fidata), [CORS attivo](CORS.md) se i loro frontend girano nel browser su altre origin —
mentre [cookie](COOKIE.md) e [redirect](REDIRECT.md) adattati sono già attivi di default. La
sezione «Sicurezza e limiti» del README raccoglie il quadro completo delle avvertenze.
