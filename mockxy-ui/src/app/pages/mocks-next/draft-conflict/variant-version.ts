import type { MockDetail, ResponseVariantRead } from '../../../mock-admin-api.types';
import type { DraftGuard, RemoteBlock, RemoteVersion } from './draft-guard';

/**
 * Versione corrente di una variante, per il confronto con una bozza: il sorgente dello script
 * (evidenziato come JavaScript), la definizione persistita e il file dell'asset. Le etichette sono
 * i nomi dei file, gli stessi del workspace.
 */
export function variantVersion(read: ResponseVariantRead): RemoteVersion<ResponseVariantRead> {
  const blocks: RemoteBlock[] = [];
  if (read.source != null) {
    const sourceFile = read.response['sourceFile'];
    blocks.push({ label: typeof sourceFile === 'string' ? sourceFile : read.responseFile, code: read.source, language: 'javascript' });
  }
  blocks.push({ label: read.responseFile, code: JSON.stringify(read.response, null, 2), language: 'json' });
  if (read.fileInfo != null) {
    blocks.push({ label: read.fileInfo.name, code: `${read.fileInfo.size} B`, language: 'text' });
  }
  return { revision: read.revision, data: read, blocks };
}

/** La variante selezionata come la descrive il dettaglio: stessa acquisizione, stessa revisione. */
export function variantReadFromDetail(detail: MockDetail): ResponseVariantRead | null {
  if (!detail.selectedResponseFile || !detail.responseRevision || !detail.response) {
    return null;
  }
  return {
    id: detail.id,
    responseFile: detail.selectedResponseFile,
    selected: true,
    active: true,
    response: detail.response as ResponseVariantRead['response'],
    source: detail.source ?? null,
    fileInfo: detail.fileInfo ?? null,
    revision: detail.responseRevision,
  };
}

/** Stato del dettaglio visto dalla sincronizzazione, per le bozze aperte. */
export interface SyncedDetail {
  detail: MockDetail | undefined;
  /** L'endpoint aperto non esiste più. */
  gone: boolean;
  /** Il runtime serve un altro workspace. */
  staleWorkspace: boolean;
}

/**
 * Aggiorna ciò che una bozza di variante sa del server dal dettaglio riletto (piano agent/API,
 * §13 C4), senza toccarne testo, bersaglio o base: revisione della variante se è la selezionata,
 * bersaglio sparito, workspace cambiato. Una variante non selezionata si ricontrolla con
 * `recheckVariantDraft`.
 */
export function observeVariantDraft(guard: DraftGuard<ResponseVariantRead>, { detail, gone, staleWorkspace }: SyncedDetail): void {
  const target = guard.target();
  if (!target?.responseFile) {
    return;
  }
  if (staleWorkspace) {
    guard.block();
    return;
  }
  if (!detail || detail.id !== target.endpointId) {
    return;
  }
  if (gone) {
    guard.markMissing();
    return;
  }
  if (target.responseFile === detail.selectedResponseFile) {
    const read = variantReadFromDetail(detail);
    if (read) guard.observe(variantVersion(read));
  } else if (detail.responses && !detail.responses.some((response) => response.fileName === target.responseFile)) {
    guard.markMissing();
  }
}

/** Dopo una rilettura di sincronizzazione: la bozza di una variante non selezionata si rilegge per filename. */
export function recheckVariantDraft(guard: DraftGuard<ResponseVariantRead>, { detail, gone, staleWorkspace }: SyncedDetail): void {
  const target = guard.target();
  if (!target?.responseFile || !detail || staleWorkspace || gone || detail.id !== target.endpointId) {
    return;
  }
  if (target.responseFile !== detail.selectedResponseFile) {
    guard.recheck();
  }
}
