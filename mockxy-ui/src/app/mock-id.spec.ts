import { mockIdToWorkspacePath, shortenWorkspacePath } from './mock-id';

/** Come lo produce il backend (src/admin/mock-ids.js): base64url del percorso relativo posix. */
function encode(relativePath: string): string {
  const bytes = new TextEncoder().encode(relativePath);
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

describe('mockIdToWorkspacePath', () => {
  it('ricava dal solo id il percorso relativo alla cartella dei mock', () => {
    expect(mockIdToWorkspacePath(encode('api/users/GET.endpoint.json'))).toBe('api/users/GET.endpoint.json');
  });

  it('regge i segmenti con caratteri non ASCII e i parametri di rotta', () => {
    const relativePath = 'api/città/{id}/GET.endpoint.json';
    expect(mockIdToWorkspacePath(encode(relativePath))).toBe(relativePath);
  });

  it('rifiuta ciò che non è una definizione, per ripiegare sul percorso assoluto', () => {
    expect(mockIdToWorkspacePath(encode('api/users/001.response.json'))).toBeNull();
    expect(mockIdToWorkspacePath(encode('/assoluto/GET.endpoint.json'))).toBeNull();
    expect(mockIdToWorkspacePath(encode('C:\\win\\GET.endpoint.json'))).toBeNull();
  });

  it('non esplode su id assenti o illeggibili', () => {
    expect(mockIdToWorkspacePath(null)).toBeNull();
    expect(mockIdToWorkspacePath('')).toBeNull();
    expect(mockIdToWorkspacePath('non-base64-!!!')).toBeNull();
  });
});

describe('shortenWorkspacePath', () => {
  it('lascia intatto un percorso che ci sta', () => {
    expect(shortenWorkspacePath('api/users/GET.endpoint.json', 72)).toBe('api/users/GET.endpoint.json');
  });

  it('toglie segmenti dal centro, tenendo il file e le cartelle che lo contengono', () => {
    const long = 'api/v2/commerce/catalogo/products/{categoria}/{id}/GET.endpoint.json';
    const short = shortenWorkspacePath(long, 48);

    expect(short.startsWith('api/…/')).toBe(true);
    expect(short.endsWith('GET.endpoint.json')).toBe(true);
    expect(short.length).toBeLessThanOrEqual(48);
  });

  it('con due soli segmenti non ha centro da togliere: resta com è', () => {
    const flat = 'unaCartellaConUnNomeDavveroMoltoMoltoLungo/GET.endpoint.json';
    expect(shortenWorkspacePath(flat, 20)).toBe(flat);
  });
});
