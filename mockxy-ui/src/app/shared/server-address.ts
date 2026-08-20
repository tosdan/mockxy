/**
 * Risolve l'indirizzo di Mockxy mostrato accanto al toggle del server.
 *
 * Quando la pagina è servita DAL motore, l'indirizzo vero è quello della pagina stessa: vale
 * nell'app desktop (la finestra è caricata sul motore del workspace attivo, e allo switch si
 * ricarica) e nel browser sulla UI compilata sotto /_admin/ui/ — dove `host` intero copre anche
 * l'accesso da LAN con hostname non-localhost. Il default cablato resta solo per lo sviluppo con
 * ng serve, dove la pagina gira su una porta propria e parla col motore attraverso il proxy dev.
 *
 * Nel desktop questo è solo il valore INIZIALE: appena arrivano le info del workspace vale
 * resolveDesktopBindAddress, perché la finestra carica sempre dal loopback e non può riflettere
 * un bind 0.0.0.0.
 */
export function resolveServerAddress(context: { isDesktop: boolean; baseUri: string; host: string }): string {
  const servedByEngine = context.baseUri.includes('/_admin/ui');
  if ((context.isDesktop || servedByEngine) && context.host) {
    return context.host;
  }
  return 'localhost:3000';
}

/**
 * Indirizzo di bind del workspace per l'app desktop: `host` dei settings (127.0.0.1 o 0.0.0.0)
 * più la porta effettiva. Mostrare 0.0.0.0 è una scelta: indica chiaramente QUALE opzione di
 * esposizione è attiva; l'IP concreto della macchina non è compito di questa etichetta.
 * La porta arriva dalle info del workspace, con l'URL della pagina come ripiego; senza host
 * (fuori dal desktop, o su errore del bridge) restituisce null e l'etichetta non cambia.
 */
export function resolveDesktopBindAddress(
  info: { host?: string | null; port?: number | null } | null,
  pageHost: string
): string | null {
  if (!info?.host) {
    return null;
  }
  const pagePort = pageHost.includes(':') ? Number(pageHost.split(':').pop()) : NaN;
  const port = info.port ?? (Number.isFinite(pagePort) ? pagePort : null);
  return port != null ? `${info.host}:${port}` : info.host;
}
