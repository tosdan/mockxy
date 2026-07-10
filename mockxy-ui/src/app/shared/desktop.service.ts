import { Injectable } from '@angular/core';

/** Informazioni sul workspace aperto, fornite dall'app desktop. */
export interface WorkspaceInfo {
  root: string;
  name: string;
  /** Titolo personalizzato (condiviso), o null/assente se si usa il nome della cartella. */
  title?: string | null;
  port?: number;
  /** URL del backend reale per il proxy (locale); vuoto/null/assente = solo mock. */
  backendUrl?: string | null;
  // Impostazioni comportamentali: il processo principale risponde SEMPRE con il valore effettivo
  // (impostazione del workspace, o default del motore se assente) — vedi workspace:get in
  // electron/main.js. La UI non conosce i default: mostra e confronta ciò che riceve.
  /** Interfaccia di bind: '127.0.0.1' (solo loopback) o '0.0.0.0' (tutta la rete). */
  host: string;
  /** Filtri automatici sulle liste case-insensitive (locale). */
  caseInsensitiveFilters: boolean;
  /** Su richiesta non mockata: proxy al backend (true) vs 404 mock-only (false). */
  proxyFallbackEnabled: boolean;
  /** Gestione CORS del motore: preflight automatici + header sulle risposte generate localmente. */
  corsEnabled: boolean;
  /** Adatta i Set-Cookie proxati alla topologia con Mockxy in mezzo (rimuove Domain/Secure/SameSite=None). */
  adaptProxyCookies: boolean;
  /** Riscrive i Location dei redirect proxati che puntano al backend, così il browser resta su Mockxy. */
  rewriteProxyRedirects: boolean;
  /** Ritardo globale in ms applicato ai mock senza delayMs proprio; 0 = nessun ritardo. */
  globalDelayMs: number;
  /** Applica il ritardo globale anche alle richieste proxate. */
  delayAllRequests: boolean;
  /** Timeout in ms verso backend/handler. */
  requestTimeoutMs: number;
  /** Monitor: cadenza flush dump in ms. */
  monitorDumpIntervalMs: number;
  /** Monitor: soglia di batch (numero di voci) prima di un flush. */
  monitorDumpThreshold: number;
  /** Monitor: dimensione massima di ogni file di dump in byte. */
  monitorDumpMaxFileBytes: number;
  /** Monitor: tetto totale della cartella dump in byte; 0 = pruning off. */
  monitorDumpMaxTotalBytes: number;
}

/** Modifiche applicabili a un workspace dalla dialog delle impostazioni. */
export interface WorkspacePatch {
  /** Titolo personalizzato; stringa vuota per azzerarlo (torna al nome della cartella). */
  name?: string;
  /** Porta locale; il motore riparte se cambia. */
  port?: number;
  /** URL del backend reale (locale); stringa vuota = solo mock. Il motore riparte se cambia. */
  backendUrl?: string;
  /** Interfaccia di bind: '127.0.0.1' o '0.0.0.0'. Il motore riparte se cambia. */
  host?: string;
  /** Filtri automatici case-insensitive (locale). Il motore riparte se cambia. */
  caseInsensitiveFilters?: boolean;
  /** Proxy fallback su mock-miss (locale). Il motore riparte se cambia. */
  proxyFallbackEnabled?: boolean;
  /** Gestione CORS del motore (locale). Il motore riparte se cambia. */
  corsEnabled?: boolean;
  /** Adattamento dei Set-Cookie proxati (locale). Il motore riparte se cambia. */
  adaptProxyCookies?: boolean;
  /** Riscrittura dei Location dei redirect proxati (locale). Il motore riparte se cambia. */
  rewriteProxyRedirects?: boolean;
  /** Ritardo globale in ms (locale). Il motore riparte se cambia. */
  globalDelayMs?: number;
  /** Applica il ritardo anche alle richieste proxate (locale). Il motore riparte se cambia. */
  delayAllRequests?: boolean;
  /** Timeout in ms verso backend/handler (locale). Il motore riparte se cambia. */
  requestTimeoutMs?: number;
  /** Monitor: cadenza flush dump in ms (locale). Il motore riparte se cambia. */
  monitorDumpIntervalMs?: number;
  /** Monitor: soglia di batch (locale). Il motore riparte se cambia. */
  monitorDumpThreshold?: number;
  /** Monitor: dimensione massima per file di dump in byte (locale). Il motore riparte se cambia. */
  monitorDumpMaxFileBytes?: number;
  /** Monitor: tetto totale della cartella dump in byte (locale). Il motore riparte se cambia. */
  monitorDumpMaxTotalBytes?: number;
}

/** Esito dell'aggiornamento di un workspace. */
export interface WorkspaceUpdateResult {
  ok: boolean;
  /** Presente quando ok è false: 'port-in-use' = la porta scelta è occupata. */
  error?: 'port-in-use';
  port?: number | null;
  name?: string;
}

/** Un workspace attualmente aperto (con la sua porta e se è quello mostrato). */
export interface OpenWorkspace {
  root: string;
  name: string;
  port: number;
  active: boolean;
}

/** Un riferimento a un workspace (per i recenti). */
export interface WorkspaceRef {
  root: string;
  name: string;
}

/** Esito del cambio workspace: ok=false con 'not-found' quando la cartella non esiste più. */
export interface SwitchResult {
  ok: boolean;
  error?: 'not-found' | 'open-failed';
}

interface DesktopBridge {
  isDesktop?: boolean;
  getWorkspace?: () => Promise<WorkspaceInfo>;
  listWorkspaces?: () => Promise<OpenWorkspace[]>;
  listRecent?: () => Promise<WorkspaceRef[]>;
  openWorkspace?: () => unknown;
  switchWorkspace?: (root: string) => unknown;
  closeWorkspace?: (root: string) => Promise<unknown>;
  removeRecent?: (root: string) => Promise<{ removed?: boolean }>;
  updateWorkspace?: (root: string, patch: WorkspacePatch) => unknown;
}

function bridge(): DesktopBridge | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return (window as unknown as { desktop?: DesktopBridge }).desktop;
}

/**
 * Ponte verso l'app desktop (Electron). Il preload espone `window.desktop`; in un browser normale
 * non esiste, quindi `isDesktop` è false e le funzioni sono no-op (o restituiscono liste vuote). Così
 * la barra workspace e gli altri controlli desktop si nascondono fuori da Electron.
 */
@Injectable({ providedIn: 'root' })
export class DesktopService {
  readonly isDesktop = bridge()?.isDesktop === true;

  /** Workspace aperto e mostrato, o null fuori da Electron / in caso di errore. */
  async getWorkspace(): Promise<WorkspaceInfo | null> {
    const fn = bridge()?.getWorkspace;
    if (!fn) {
      return null;
    }
    try {
      return await fn();
    } catch {
      return null;
    }
  }

  /** Elenco dei workspace attualmente aperti (ognuno col suo motore). */
  async listWorkspaces(): Promise<OpenWorkspace[]> {
    const fn = bridge()?.listWorkspaces;
    if (!fn) {
      return [];
    }
    try {
      return await fn();
    } catch {
      return [];
    }
  }

  /** Elenco dei workspace aperti di recente. */
  async listRecent(): Promise<WorkspaceRef[]> {
    const fn = bridge()?.listRecent;
    if (!fn) {
      return [];
    }
    try {
      return await fn();
    } catch {
      return [];
    }
  }

  /** Apre la finestra nativa per scegliere/aggiungere un workspace (poi lo mostra). */
  openWorkspace(): void {
    const fn = bridge()?.openWorkspace;
    if (fn) {
      // Mostrare un altro workspace ricarica la finestra: un'eventuale rejection è attesa.
      void Promise.resolve(fn()).catch(() => undefined);
    }
  }

  /**
   * Passa al workspace indicato (lo apre se non è già avviato). Sul cambio riuscito la finestra
   * ricarica (la promise non si risolve qui dentro); se la cartella non esiste più restituisce
   * l'esito 'not-found' (il backend la toglie dai recenti), così il chiamante può rinfrescare l'elenco.
   */
  async switchWorkspace(root: string): Promise<SwitchResult | null> {
    const fn = bridge()?.switchWorkspace;
    if (!fn) {
      return null;
    }
    try {
      return (await fn(root)) as SwitchResult;
    } catch {
      // Sul cambio riuscito la finestra ricarica e la promise resta in sospeso: è atteso.
      return null;
    }
  }

  /** Rimuove un workspace dall'elenco dei recenti (con conferma nativa). True se è stato rimosso. */
  async removeRecent(root: string): Promise<boolean> {
    const fn = bridge()?.removeRecent;
    if (!fn) {
      return false;
    }
    try {
      const result = (await fn(root)) as { removed?: boolean };
      return result?.removed === true;
    } catch {
      return false;
    }
  }

  /** Chiude (ferma il motore di) un workspace. */
  async closeWorkspace(root: string): Promise<void> {
    const fn = bridge()?.closeWorkspace;
    if (!fn) {
      return;
    }
    try {
      await fn(root);
    } catch {
      /* la chiusura dell'attivo ricarica la finestra: ignora */
    }
  }

  /**
   * Applica titolo e/o porta del workspace. Se va a buon fine il motore riparte (quando cambia la
   * porta) e la finestra si ricarica. Se la porta scelta è occupata non cambia nulla e restituisce un
   * esito d'errore, così la dialog può avvisare l'utente.
   */
  async updateWorkspace(root: string, patch: WorkspacePatch): Promise<WorkspaceUpdateResult | null> {
    const fn = bridge()?.updateWorkspace;
    if (!fn) {
      return null;
    }
    try {
      return (await fn(root, patch)) as WorkspaceUpdateResult;
    } catch {
      // Sul cambio riuscito la finestra si ricarica e la promise resta in sospeso: è atteso.
      return null;
    }
  }
}
