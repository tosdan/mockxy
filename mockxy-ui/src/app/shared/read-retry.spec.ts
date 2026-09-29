import { Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { READ_RETRY_MAX_MS, READ_RETRY_MIN_MS, ReadRetry } from './read-retry';

@Injectable({ providedIn: 'root' })
class Reader {
  readonly read = vi.fn();
  readonly retry = new ReadRetry(() => this.read());
}

// Nuovi tentativi condivisi dagli store che si rileggono sulla sincronizzazione col runtime.
describe('ReadRetry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ripete la lettura con attese che raddoppiano fino al massimo, e riparte dalla minima dopo un successo', () => {
    const { read, retry } = TestBed.inject(Reader);
    const waits: number[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const before = read.mock.calls.length;
      retry.failed();
      let waited = 0;
      while (read.mock.calls.length === before) {
        vi.advanceTimersByTime(READ_RETRY_MIN_MS);
        waited += READ_RETRY_MIN_MS;
      }
      waits.push(waited);
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, READ_RETRY_MAX_MS, READ_RETRY_MAX_MS]);

    retry.succeeded();
    retry.failed();
    vi.advanceTimersByTime(READ_RETRY_MIN_MS);
    expect(read).toHaveBeenCalledTimes(8);
  });

  it('una lettura nuova, un successo o lo smontaggio annullano il tentativo in attesa', () => {
    const { read, retry } = TestBed.inject(Reader);
    retry.failed();
    retry.cancel();
    retry.failed();
    retry.succeeded();
    retry.failed();
    TestBed.resetTestingModule();
    vi.advanceTimersByTime(READ_RETRY_MAX_MS);
    expect(read).not.toHaveBeenCalled();
  });
});
