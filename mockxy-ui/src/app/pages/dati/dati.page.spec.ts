import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { DatiPage } from './dati.page';
import { translocoTesting } from '../../testing/transloco-testing';
import { MockAdminApiService } from '../../mock-admin-api.service';
import { ToastService } from '../../ui/ui-toast/ui-toast';
import type { DataFileDetail, DataFileSummary, DataFileUsage } from '../../mock-admin-api.types';

function summary(name: string, over: Partial<DataFileSummary> = {}): DataFileSummary {
  return { name, fileName: `${name}.json`, sizeBytes: 100, updatedAt: '2026-07-07T10:00:00.000Z', usedBy: [], ...over };
}

function usage(path: string, method = 'GET', type: 'handler' | 'middleware' = 'handler'): DataFileUsage {
  return { id: `id-${path}`, method, path, type };
}

function detail(name: string, content: string): DataFileDetail {
  return { ...summary(name), content };
}

describe('DatiPage', () => {
  let api: ReturnType<typeof makeApiStub>;
  let toast: { show: ReturnType<typeof vi.fn>; dismiss: ReturnType<typeof vi.fn> };

  function makeApiStub() {
    return {
      listDataFiles: vi.fn(() => of({ items: [summary('utenti'), summary('aziende')] })),
      getDataFile: vi.fn((name: string) => of(detail(name, '[{"id":1}]'))),
      uploadDataFile: vi.fn((name: string) => of(summary(name.toLowerCase()))),
      renameDataFile: vi.fn((_name: string, next: string) =>
        of({ ...summary(next.toLowerCase()), referencesRewritten: 0, referencingEndpoints: [] as DataFileUsage[] }),
      ),
      deleteDataFile: vi.fn(() => of(undefined)),
    };
  }

  beforeEach(async () => {
    api = makeApiStub();
    toast = { show: vi.fn(), dismiss: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [DatiPage, translocoTesting()],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: MockAdminApiService, useValue: api },
        { provide: ToastService, useValue: toast },
      ],
    }).compileComponents();
  });

  function create() {
    const fixture = TestBed.createComponent(DatiPage);
    fixture.detectChanges(); // ngOnInit → reload
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { fixture, c: fixture.componentInstance as any };
  }

  function jsonFile(name: string): File {
    return new File(['[{"id":1}]'], name, { type: 'application/json' });
  }

  describe('caricamento iniziale', () => {
    it('elenca i file e mette a fuoco il primo, caricandone l’anteprima', () => {
      const { c } = create();
      expect(api.listDataFiles).toHaveBeenCalled();
      expect(c.files().map((f: DataFileSummary) => f.name)).toEqual(['utenti', 'aziende']);
      expect(c.selectedName()).toBe('utenti');
      expect(api.getDataFile).toHaveBeenCalledWith('utenti');
      expect(c.previewText()).toContain('"id": 1'); // ripformattato (pretty)
    });

    it('un errore di elenco mostra un toast col messaggio del server', () => {
      api.listDataFiles.mockReturnValueOnce(throwError(() => ({ error: { message: 'boom' } })));
      create();
      expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error', description: 'boom' }));
    });
  });

  describe('selezione e anteprima', () => {
    it('selezionare un altro file ne carica l’anteprima', () => {
      const { c } = create();
      c.select('aziende');
      expect(c.selectedName()).toBe('aziende');
      expect(api.getDataFile).toHaveBeenLastCalledWith('aziende');
    });

    it('lo snippet di riferimento nomina la variabile come il file selezionato', () => {
      const { c } = create();
      expect(c.referenceSnippet()).toBe("const utenti = await data('utenti');");
    });

    it('lo snippet converte i nomi non-identificatore in camelCase valido', () => {
      api.listDataFiles.mockReturnValueOnce(of({ items: [summary('utenti-demo'), summary('report.2026')] }));
      const { c } = create();
      expect(c.referenceSnippet()).toBe("const utentiDemo = await data('utenti-demo');");
      c.select('report.2026');
      expect(c.referenceSnippet()).toBe("const report2026 = await data('report.2026');");
    });
  });

  describe('usato da', () => {
    it('selectedUsedBy riflette gli endpoint che referenziano il file selezionato', () => {
      api.listDataFiles.mockReturnValueOnce(
        of({
          items: [
            summary('utenti', { usedBy: [usage('/api/a'), usage('/api/b', 'POST', 'middleware')] }),
            summary('orfano'),
          ],
        }),
      );
      const { c } = create();
      expect(c.selectedUsedBy()).toHaveLength(2);
      expect(c.selectedUsedBy()[0].path).toBe('/api/a');

      c.select('orfano');
      expect(c.selectedUsedBy()).toEqual([]);
    });
  });

  describe('upload', () => {
    it('carica solo i .json e ricarica l’elenco', () => {
      const { c } = create();
      c.uploadAll([jsonFile('nuovi.json')]);
      expect(api.uploadDataFile).toHaveBeenCalledWith('nuovi', expect.any(File));
      expect(api.listDataFiles).toHaveBeenCalledTimes(2); // iniziale + dopo upload
      expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'success' }));
    });

    it('scarta i file non-json con un toast d’errore, senza chiamare l’API', () => {
      const { c } = create();
      c.uploadAll([new File(['x'], 'note.txt', { type: 'text/plain' })]);
      expect(api.uploadDataFile).not.toHaveBeenCalled();
      expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
    });

    it('un JSON invalido respinto dal server mostra il messaggio del server', () => {
      const { c } = create();
      api.uploadDataFile.mockReturnValueOnce(throwError(() => ({ error: { message: 'not valid JSON' } })));
      c.uploadAll([jsonFile('rotto.json')]);
      expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error', description: 'not valid JSON' }));
    });

    it('avvisa quando il file supera la soglia di dimensione', () => {
      const { c } = create();
      api.uploadDataFile.mockReturnValueOnce(of(summary('grosso', { sizeBytes: 6 * 1024 * 1024 })));
      c.uploadAll([jsonFile('grosso.json')]);
      expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'warning' }));
    });
  });

  describe('rinomina', () => {
    it('conferma la rinomina, aggiorna la selezione e ricarica', () => {
      const { c } = create();
      // dopo la rinomina la lista ricaricata contiene il nuovo nome (fedeltà dello stub)
      api.listDataFiles.mockReturnValueOnce(of({ items: [summary('persone'), summary('aziende')] }));
      c.startRename();
      c.renameDraft.set('Persone');
      c.confirmRename();
      // 'utenti' non è usato (usedBy vuoto) → rewriteReferences false
      expect(api.renameDataFile).toHaveBeenCalledWith('utenti', 'Persone', false);
      expect(c.selectedName()).toBe('persone'); // normalizzato dal server, mantenuto dal reload
      expect(c.renaming()).toBe(false);
    });

    it('rinominando un file usato con opzione attiva, chiede la riscrittura e il toast riporta il conteggio', () => {
      api.listDataFiles.mockReturnValueOnce(of({ items: [summary('utenti', { usedBy: [usage('/api/a')] })] }));
      api.renameDataFile.mockReturnValueOnce(
        of({ ...summary('persone', { usedBy: [usage('/api/a')] }), referencesRewritten: 3, referencingEndpoints: [usage('/api/a')] }),
      );
      api.listDataFiles.mockReturnValueOnce(of({ items: [summary('persone', { usedBy: [usage('/api/a')] })] }));
      const { c } = create();

      c.startRename();
      expect(c.rewriteRefsOnRename()).toBe(true); // pre-selezionata
      c.renameDraft.set('persone');
      c.confirmRename();

      expect(api.renameDataFile).toHaveBeenCalledWith('utenti', 'persone', true);
      expect(toast.show).toHaveBeenCalledWith(
        expect.objectContaining({ tone: 'success', description: expect.stringContaining('3') }),
      );
    });

    it('rinominando un file usato con opzione disattivata, non chiede la riscrittura', () => {
      api.listDataFiles.mockReturnValueOnce(of({ items: [summary('utenti', { usedBy: [usage('/api/a')] })] }));
      const { c } = create();

      c.startRename();
      c.rewriteRefsOnRename.set(false);
      c.renameDraft.set('persone');
      c.confirmRename();

      expect(api.renameDataFile).toHaveBeenCalledWith('utenti', 'persone', false);
    });

    it('una collisione (409) mostra il messaggio del server', () => {
      const { c } = create();
      api.renameDataFile.mockReturnValueOnce(throwError(() => ({ error: { message: 'already exists' } })));
      c.startRename();
      c.renameDraft.set('aziende');
      c.confirmRename();
      expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error', description: 'already exists' }));
    });
  });

  describe('cancellazione', () => {
    it('conferma la cancellazione e ricarica senza mantenere la selezione', () => {
      const { c } = create();
      c.confirmingDelete.set(true);
      c.confirmDelete();
      expect(api.deleteDataFile).toHaveBeenCalledWith('utenti');
      expect(api.listDataFiles).toHaveBeenCalledTimes(2);
    });
  });

  describe('copia riferimento', () => {
    it('scrive lo snippet negli appunti', () => {
      const writeText = vi.fn(() => Promise.resolve());
      Object.assign(navigator, { clipboard: { writeText } });
      const { c } = create();
      c.copyReference();
      expect(writeText).toHaveBeenCalledWith("const utenti = await data('utenti');");
    });
  });
});
