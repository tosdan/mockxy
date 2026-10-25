import { MIN_LIST_WIDTH, ResizableListWidth } from './resizable-list-width';

describe('ResizableListWidth', () => {
  const KEY = 'test-list-width';
  beforeEach(() => localStorage.removeItem(KEY));
  afterEach(() => localStorage.removeItem(KEY));

  it('parte dal default, o dalla larghezza salvata, sempre entro i limiti', () => {
    expect(new ResizableListWidth(KEY, 420).width()).toBe(420);
    localStorage.setItem(KEY, '510');
    expect(new ResizableListWidth(KEY, 420).width()).toBe(510);
    localStorage.setItem(KEY, '100');
    expect(new ResizableListWidth(KEY, 420).width()).toBe(MIN_LIST_WIDTH);
    localStorage.setItem(KEY, 'rotto');
    expect(new ResizableListWidth(KEY, 420).width()).toBe(420);
  });

  it('il trascinamento cambia la larghezza e la salva al rilascio', () => {
    const list = new ResizableListWidth(KEY, 420);
    list.startResize(new PointerEvent('pointerdown', { clientX: 400 }));
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 460 }));
    expect(list.width()).toBe(480);
    expect(localStorage.getItem(KEY)).toBeNull();
    document.dispatchEvent(new PointerEvent('pointerup'));
    expect(localStorage.getItem(KEY)).toBe('480');
    // A rilascio avvenuto il movimento non conta piu'.
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 600 }));
    expect(list.width()).toBe(480);
  });

  it('il doppio clic riporta al default e lo salva', () => {
    localStorage.setItem(KEY, '510');
    const list = new ResizableListWidth(KEY, 420);
    list.reset();
    expect(list.width()).toBe(420);
    expect(localStorage.getItem(KEY)).toBe('420');
  });
});
