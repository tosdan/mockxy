import { listNavigationTarget, toggleListSelection } from './list-selection';

describe('toggleListSelection', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('spunta e toglie una voce, che diventa l’ancora', () => {
    const on = toggleListSelection(new Set(), ids, 'b', null, false);
    expect([...on.selected]).toEqual(['b']);
    expect(on.anchor).toBe('b');
    expect([...toggleListSelection(on.selected, ids, 'b', 'b', false).selected]).toEqual([]);
  });

  it('con l’intervallo spunta dall’ancora alla voce, in entrambe le direzioni', () => {
    expect([...toggleListSelection(new Set(['d']), ids, 'b', 'd', true).selected].sort()).toEqual(['b', 'c', 'd']);
    expect([...toggleListSelection(new Set(), ids, 'c', 'a', true).selected].sort()).toEqual(['a', 'b', 'c']);
  });

  // Sotto filtro l'ancora puo' essere sparita dalla lista: la spunta torna singola.
  it('senza ancora fra le voci, l’intervallo diventa una spunta singola', () => {
    expect([...toggleListSelection(new Set(), ids, 'c', 'zzz', true).selected]).toEqual(['c']);
    expect([...toggleListSelection(new Set(), ids, 'c', null, true).selected]).toEqual(['c']);
  });
});

describe('listNavigationTarget', () => {
  const ids = ['a', 'b', 'c'];

  it('frecce, Home ed End restano dentro la lista', () => {
    expect(listNavigationTarget('ArrowDown', ids, 'a')).toBe('b');
    expect(listNavigationTarget('ArrowDown', ids, 'c')).toBe('c');
    expect(listNavigationTarget('ArrowUp', ids, 'b')).toBe('a');
    expect(listNavigationTarget('ArrowUp', ids, 'a')).toBe('a');
    expect(listNavigationTarget('Home', ids, 'c')).toBe('a');
    expect(listNavigationTarget('End', ids, 'a')).toBe('c');
  });

  it('senza voce corrente parte dalla prima; altri tasti e liste vuote non portano da nessuna parte', () => {
    expect(listNavigationTarget('ArrowDown', ids, null)).toBe('a');
    expect(listNavigationTarget('Enter', ids, 'a')).toBeNull();
    expect(listNavigationTarget('ArrowDown', [], null)).toBeNull();
  });
});
