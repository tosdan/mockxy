import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { DialogRef } from '@angular/cdk/dialog';
import { of } from 'rxjs';
import { OpenapiImportDialog } from './openapi-import-dialog';
import { translocoTesting } from '../../../testing/transloco-testing';
import { MockAdminApiService } from '../../../mock-admin-api.service';
import { MocksStore } from '../mocks-next.store';
import { ToastService } from '../../../ui/ui-toast/ui-toast';
import type { OpenapiImportItem, OpenapiImportPreview } from '../../../mock-admin-api.types';

const PREVIEW: OpenapiImportPreview = {
  items: [
    { method: 'GET', path: '/users', action: 'create', collection: 'Users' },
    { method: 'POST', path: '/users', action: 'create', collection: 'Users' },
    { method: 'GET', path: '/health', action: 'skip' },
  ],
  total: 3,
  create: 2,
  skip: 1,
  collections: 1,
};

describe('OpenapiImportDialog', () => {
  const api = {
    previewOpenapi: vi.fn(() => of(PREVIEW)),
    importOpenapi: vi.fn(() => of({ created: 2, skipped: 1, failed: 0, total: 3, collections: 1 })),
  };
  const store = { loadCatalog: vi.fn() };
  const toast = { show: vi.fn() };
  const dialogRef = { close: vi.fn() };

  beforeEach(async () => {
    api.previewOpenapi.mockClear();
    api.importOpenapi.mockClear();
    store.loadCatalog.mockClear();
    toast.show.mockClear();
    dialogRef.close.mockClear();

    await TestBed.configureTestingModule({
      imports: [OpenapiImportDialog, translocoTesting()],
      providers: [
        provideNoopAnimations(),
        { provide: MockAdminApiService, useValue: api },
        { provide: MocksStore, useValue: store },
        { provide: ToastService, useValue: toast },
        { provide: DialogRef, useValue: dialogRef },
      ],
    }).compileComponents();
  });

  function create() {
    const fixture = TestBed.createComponent(OpenapiImportDialog);
    fixture.detectChanges();
    return { fixture, c: fixture.componentInstance as any };
  }

  it('filtra le voci del piano per azione e conta i totali', () => {
    const { c } = create();
    c.preview.set(PREVIEW);

    expect(c.filteredItems().length).toBe(3);
    c.filter.set('create');
    expect(c.filteredItems().map((i: OpenapiImportItem) => i.method).sort()).toEqual(['GET', 'POST']);
    c.filter.set('skip');
    expect(c.filteredItems().map((i: OpenapiImportItem) => i.path)).toEqual(['/health']);

    expect(c.countFor('all')).toBe(3);
    expect(c.countFor('create')).toBe(2);
    expect(c.countFor('skip')).toBe(1);
  });

  it('import: chiama importOpenapi, ricarica il catalogo e chiude', () => {
    const { c } = create();
    c.docText = '{"openapi":"3.0.0","paths":{}}';
    c.preview.set(PREVIEW);

    c.runImport();

    expect(api.importOpenapi).toHaveBeenCalledTimes(1);
    expect(store.loadCatalog).toHaveBeenCalledTimes(1);
    expect(dialogRef.close).toHaveBeenCalledTimes(1);
    expect(toast.show).toHaveBeenCalled();
  });

  it('non importa senza documento', () => {
    const { c } = create();
    c.docText = '';
    c.runImport();
    expect(api.importOpenapi).not.toHaveBeenCalled();
  });

  it('onDragOver attiva lo stato dragging, onDragLeave lo disattiva', () => {
    const { c } = create();
    const event = { preventDefault: vi.fn() } as unknown as DragEvent;
    c.onDragOver(event);
    expect(c.dragging()).toBe(true);
    c.onDragLeave(event);
    expect(c.dragging()).toBe(false);
  });

  it('drop di un file supportato avvia la preview e azzera dragging', async () => {
    const { c } = create();
    c.dragging.set(true);
    const file = { name: 'spec.json', text: () => Promise.resolve('{"openapi":"3.0.0","paths":{}}') };
    const event = { preventDefault: vi.fn(), dataTransfer: { files: [file] } } as unknown as DragEvent;

    c.onDrop(event);
    expect(c.dragging()).toBe(false);

    await Promise.resolve();
    await Promise.resolve();
    expect(api.previewOpenapi).toHaveBeenCalledTimes(1);
    expect(c.preview()).toEqual(PREVIEW);
  });

  it('drop di un file non supportato mostra un errore e non chiama la preview', () => {
    const { c } = create();
    const file = { name: 'logo.png', text: () => Promise.resolve('') };
    const event = { preventDefault: vi.fn(), dataTransfer: { files: [file] } } as unknown as DragEvent;

    c.onDrop(event);

    expect(api.previewOpenapi).not.toHaveBeenCalled();
    expect(c.error()).toBeTruthy();
  });
});
