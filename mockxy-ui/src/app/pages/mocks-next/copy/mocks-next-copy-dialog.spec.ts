import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { of } from 'rxjs';
import { MocksNextCopyDialog } from './mocks-next-copy-dialog';
import { MocksStore } from '../mocks-next.store';
import { MockAdminApiService } from '../../../mock-admin-api.service';
import { translocoTesting } from '../../../testing/transloco-testing';
import type { EndpointCopyPreview } from '../../../mock-admin-api.types';

const preview: EndpointCopyPreview = {
  dryRun: true,
  target: { method: 'POST', path: '/api/items-copy' },
  copyResponses: false,
  responseFiles: ['001.response.json'],
  assetFiles: ['001.handler.js'],
  sharedStateRefs: ['items'],
  warnings: [{ code: 'SHARED_STATE_REFERENCES_PRESERVED', names: ['items'] }],
};

describe('MocksNextCopyDialog', () => {
  const store = {
    creating: signal(false),
    error: signal<string | null>(null),
    copyEndpoint: vi.fn(),
  };
  const api = {
    previewEndpointCopy: vi.fn(() => of(preview)),
  };
  const dialogRef = { close: vi.fn() };

  beforeEach(async () => {
    vi.useFakeTimers();
    store.creating.set(false);
    store.error.set(null);
    store.copyEndpoint.mockReset();
    api.previewEndpointCopy.mockClear();
    dialogRef.close.mockReset();
    await TestBed.configureTestingModule({
      imports: [MocksNextCopyDialog, translocoTesting()],
      providers: [
        provideNoopAnimations(),
        { provide: MocksStore, useValue: store },
        { provide: MockAdminApiService, useValue: api },
        { provide: DialogRef, useValue: dialogRef },
        {
          provide: DIALOG_DATA,
          useValue: { id: 'abc', method: 'POST', path: '/api/items-copy', responseCount: 1 },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => vi.useRealTimers());

  function create() {
    const fixture = TestBed.createComponent(MocksNextCopyDialog);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      path: ReturnType<typeof signal<string>>;
      preview: ReturnType<typeof signal<EndpointCopyPreview | null>>;
      canCopy(): boolean;
      copy(): void;
    };
    return { fixture, component };
  }

  it('disabilita il commit finché il dry run corrente non è riuscito e mostra il warning', () => {
    const { fixture, component } = create();
    expect(component.canCopy()).toBe(false);
    vi.advanceTimersByTime(150);
    fixture.detectChanges();

    expect(api.previewEndpointCopy).toHaveBeenCalledWith('abc', {
      method: 'POST', path: '/api/items-copy', copyResponses: false,
    });
    expect(component.canCopy()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('items');
  });

  it('invalida l’anteprima quando cambia un input e usa il piano nuovo prima del commit', () => {
    const { fixture, component } = create();
    vi.advanceTimersByTime(150);
    fixture.detectChanges();
    component.path.set('/api/changed');
    fixture.detectChanges();
    expect(component.canCopy()).toBe(false);

    vi.advanceTimersByTime(150);
    fixture.detectChanges();
    expect(component.canCopy()).toBe(true);
    component.copy();
    expect(store.copyEndpoint).toHaveBeenCalledWith(
      'abc',
      { method: 'POST', path: '/api/changed', copyResponses: false },
      expect.any(Function),
    );
  });
});
