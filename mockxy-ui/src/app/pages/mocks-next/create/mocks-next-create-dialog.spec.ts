import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { of, Subject, throwError, type Observable } from 'rxjs';
import { MocksNextCreateDialog } from './mocks-next-create-dialog';
import { MocksStore } from '../mocks-next.store';
import { MockAdminApiService } from '../../../mock-admin-api.service';
import { ViewStateService } from '../../../shared/view-state.service';
import { translocoTesting } from '../../../testing/transloco-testing';
import { fakeRuntimeSync } from '../../../testing/runtime-sync-testing';
import type { MockDetail, MockDetailAfterMutation } from '../../../mock-admin-api.types';

const previous: MockDetail = {
  id: 'e1',
  type: 'mock',
  method: 'GET',
  path: '/precedente',
  status: 200,
  disabled: false,
  configFilePath: 'mocks/precedente/GET.endpoint.json',
  responseCount: 1,
  editable: true,
  selectedResponseFile: '002.response.json',
};

describe('MocksNextCreateDialog · creazione con file senza dettaglio', () => {
  const file = new File(['contenuto di B'], 'body.txt', { type: 'text/plain' });
  let api: {
    createMock: ReturnType<typeof vi.fn>;
    listMocks: ReturnType<typeof vi.fn>;
    uploadResponseFile: ReturnType<typeof vi.fn>;
  };
  let sync: ReturnType<typeof fakeRuntimeSync>;
  let dialogRef: { close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    sync = fakeRuntimeSync();
    dialogRef = { close: vi.fn() };
    api = {
      createMock: vi.fn(
        (): Observable<MockDetailAfterMutation> =>
          of({ id: 'nuovo', detailUnavailable: { message: 'dettaglio non disponibile' } }),
      ),
      listMocks: vi.fn(() => of({ items: [], collections: [], childOrder: {} })),
      uploadResponseFile: vi.fn(() =>
        of({ ...previous, id: 'nuovo', path: '/nuovo', selectedResponseFile: '001.response.json' }),
      ),
    };
    TestBed.configureTestingModule({
      imports: [translocoTesting()],
      providers: [
        MocksStore,
        sync.provider,
        { provide: MockAdminApiService, useValue: api },
        { provide: ViewStateService, useValue: { read: () => null, write: vi.fn() } },
        { provide: DialogRef, useValue: dialogRef },
        { provide: DIALOG_DATA, useValue: { type: 'mock' } },
      ],
    });
  });

  function create() {
    const store = TestBed.inject(MocksStore);
    const dialog = TestBed.runInInjectionContext(() => new MocksNextCreateDialog()) as unknown as {
      path: ReturnType<typeof signal<string>>;
      bodyFormat: ReturnType<typeof signal<'json' | 'text' | 'file'>>;
      fileDraft: ReturnType<typeof signal<File | null>>;
      create(): void;
    };
    dialog.path.set('/nuovo');
    dialog.bodyFormat.set('file');
    dialog.fileDraft.set(file);
    return { store, dialog };
  }

  it('carica il file su B e non sulla variante selezionata di A', () => {
    const { store, dialog } = create();
    store.selected.set(previous);

    dialog.create();

    expect(api.uploadResponseFile).toHaveBeenCalledWith(
      'nuovo',
      '001.response.json',
      file,
      undefined,
    );
    expect(store.selected()?.id).toBe('nuovo');
    expect(dialogRef.close).toHaveBeenCalledWith('created');
  });

  it('carica il file e chiude il dialog anche senza un dettaglio selezionato prima', () => {
    const { store, dialog } = create();

    dialog.create();

    expect(api.uploadResponseFile).toHaveBeenCalledWith(
      'nuovo',
      '001.response.json',
      file,
      undefined,
    );
    expect(store.selected()?.id).toBe('nuovo');
    expect(dialogRef.close).toHaveBeenCalledWith('created');
  });

  it('un upload fallito lascia il dialog aperto e il bersaglio da recuperare su B', () => {
    const { store, dialog } = create();
    store.selected.set(previous);
    api.uploadResponseFile.mockReturnValueOnce(throwError(() => new Error('upload fallito')));

    dialog.create();

    expect(api.uploadResponseFile).toHaveBeenCalledWith(
      'nuovo',
      '001.response.json',
      file,
      undefined,
    );
    expect(store.selectedId()).toBe('nuovo');
    expect(store.error()).toBe('upload fallito');
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('non avvia l’upload se la creazione termina dopo un cambio di workspace', () => {
    const { store, dialog } = create();
    store.selected.set(previous);
    const pending = new Subject<MockDetailAfterMutation>();
    api.createMock.mockReturnValueOnce(pending);
    dialog.create();

    sync.runtime(true);
    pending.next({ id: 'nuovo', detailUnavailable: { message: 'dettaglio non disponibile' } });
    pending.complete();

    expect(api.uploadResponseFile).not.toHaveBeenCalled();
    expect(dialogRef.close).not.toHaveBeenCalled();
  });
});
