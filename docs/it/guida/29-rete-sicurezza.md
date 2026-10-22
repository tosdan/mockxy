# 29 — Esporre Mockxy in rete, in sicurezza

Di default Mockxy ascolta **solo su loopback** (`127.0.0.1`): raggiungibile dalla macchina su
cui gira, invisibile alla rete. Questo capitolo spiega perché il default è questo, quando ha
senso cambiarlo, e con quali cautele.

## Loopback e bind, in due parole

Un server in ascolto si lega (*bind*) a un'interfaccia di rete. **`127.0.0.1`** (loopback) è
l'interfaccia interna della macchina: solo i processi locali possono raggiungerla —
`localhost` risolve lì. **`0.0.0.0`** significa *tutte le interfacce*: il server diventa
raggiungibile anche dall'indirizzo di LAN della macchina (es. `192.168.1.10`), quindi da
qualunque dispositivo sulla stessa rete.

## Perché il default è loopback

Non è prudenza generica — è la conseguenza diretta di cosa può fare l'**admin API**: crea
handler, cioè **scrive file ed esegue JavaScript**, e **non ha autenticazione**. Su un bind
di rete, chiunque raggiunga la porta può creare un handler e con esso eseguire codice
arbitrario sulla macchina. L'esposizione deve quindi essere una scelta esplicita e
consapevole, mai un default.

I casi legittimi esistono: il **device mobile fisico** che deve raggiungere i mock durante lo
sviluppo dell'app, il **collega in LAN** che prova il frontend contro il tuo workspace, il
server interno che eroga mock per il team.

## Come si espone

- **App desktop**: interruttore «Accessibile da tutta la rete» nelle impostazioni del
  workspace — la scelta è binaria (loopback / tutte le interfacce) e l'avvertenza sul
  rischio è parte dell'interruttore;
- **Headless**: `HOST=0.0.0.0`;
- **Docker**: le immagini impostano `HOST=0.0.0.0` da sole — il loopback *del container* non
  sarebbe raggiungibile dal port mapping — e l'esposizione reale si decide sul mapping delle
  porte dell'host (`-p 127.0.0.1:3000:3000` resta locale, `-p 3000:3000` espone).

Quando l'admin API è attiva su un bind non-loopback, all'avvio il log mostra un avviso
esplicito. Non è un blocco — su una rete fidata può essere una scelta legittima — ma la
combinazione va fatta a occhi aperti.

> 📷 **SCREENSHOT** — `29-esposizione-avvertenza.png`
> Cosa mostrare: la dialog impostazioni workspace con «Accessibile da tutta la rete» attivo
> e l'avvertenza di sicurezza ben visibile.

## Le protezioni esistenti

Tre difese sono attive per costruzione:

- **guardia anti DNS rebinding.** Un attacco insidioso colpisce anche i server solo-loopback:
  una pagina web ostile fa ri-risolvere il proprio dominio verso `127.0.0.1`, e il browser
  della vittima — per cui quelle richieste sono same-origin — può raggiungere il server
  locale. La difesa usa l'unico segnale non falsificabile: l'header `Host` conserva il
  dominio ostile, e l'admin API accetta solo richieste con `Host` di loopback (più gli
  eventuali nomi extra dichiarati in `ADMIN_ALLOWED_HOSTS` — un alias in `/etc/hosts`, il
  nome di un server intranet). Tutto il resto riceve `403`. Il controllo vale solo per
  l'admin: i *mock* accettano qualunque `Host`, perché devono poter essere consumati da
  client di ogni tipo;
- **mutazioni solo JSON.** Le scritture dell'admin API accettano solo `content-type`
  espliciti: una richiesta cross-origin con `application/json` scatena il preflight del
  browser e muore lì — è la difesa anti-CSRF;
- **admin spenta in produzione.** Con `NODE_ENV=production` l'admin API è disattivata di
  default.

## La configurazione giusta per ogni scenario

| Scenario | Configurazione |
|---|---|
| Sviluppo personale | il default: loopback, admin attiva |
| Device mobile / collega in LAN, occasionale | bind di rete su rete fidata, spegnere quando non serve |
| Erogazione continuativa al team | admin spenta (`ADMIN_API_ENABLED=false`), o meglio l'immagine **standalone** — che spegne admin, proxy e watch per costruzione ([capitolo 31](31-headless-docker.md)) |

Con i frontend dei colleghi che chiamano il server dal browser, da altre origin, serve anche
il CORS automatico ([capitolo 27](27-topologia-proxy.md)); cookie e redirect adattati sono
già attivi di default.

Due promemoria finali che escono dal perimetro del bind: **handler e middleware sono
codice** — chi apre un workspace ne esegue gli script, quindi per i workspace altrui vale la
fiducia che si accorda a un repository che si clona ed esegue; e gli **archivi del monitor**
possono contenere dati personali — restano fuori da git e non vanno montati su server
condivisi.

L'admin API, qui vista come superficie da proteggere, è anche lo strumento di automazione più
potente di Mockxy: il [prossimo capitolo](30-admin-api.md) la usa.
