import type { ResponseVariantRead } from '../../../mock-admin-api.types';
import type { RemoteBlock, RemoteVersion } from './draft-guard';

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
