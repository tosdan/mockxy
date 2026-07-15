import { ViewStateService } from './view-state.service';

describe('ViewStateService', () => {
  let service: ViewStateService;

  beforeEach(() => {
    localStorage.clear();
    service = new ViewStateService();
  });

  it('round-trip di un valore JSON (stringhe, array, oggetti)', () => {
    service.write('k', 'endpoint-1');
    expect(service.read<string>('k')).toBe('endpoint-1');

    service.write('k', ['a', 'b']);
    expect(service.read<string[]>('k')).toEqual(['a', 'b']);
  });

  it('chiave assente → null', () => {
    expect(service.read('mai-scritta')).toBeNull();
  });

  it('null/undefined rimuovono la chiave', () => {
    service.write('k', 'valore');
    service.write('k', null);
    expect(service.read('k')).toBeNull();
  });

  it('un valore illeggibile (JSON corrotto) degrada a null, senza lanciare', () => {
    localStorage.setItem('mx-view:k', '{corrotto');
    expect(service.read('k')).toBeNull();
  });

  it('le chiavi sono prefissate: niente collisioni con altre voci di localStorage', () => {
    localStorage.setItem('k', '"nuda"');
    expect(service.read('k')).toBeNull();
    service.write('k', 'prefissata');
    expect(localStorage.getItem('mx-view:k')).toBe('"prefissata"');
    expect(localStorage.getItem('k')).toBe('"nuda"');
  });
});
