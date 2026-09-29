import { Subject, of, throwError, type Observable } from 'rxjs';
import type { Mock } from 'vitest';
import { DraftGuard, type RemoteVersion } from './draft-guard';
import type { DraftTarget, RevisionConflict } from '../../../mock-admin-api.types';

const REV_A = `rev-v1:${'a'.repeat(64)}`;
const REV_B = `rev-v1:${'b'.repeat(64)}`;
const TARGET: DraftTarget = { endpointId: 'e1', responseFile: '001.response.json', baseRevision: REV_A };
const CONFLICT: RevisionConflict = {
  code: 'REVISION_CONFLICT',
  resource: { kind: 'response', endpointId: 'e1', responseFile: '001.response.json' },
  expectedRevision: REV_A,
  currentRevision: REV_B,
};

const noop = () => undefined;

function version(text: string, revision = REV_B): RemoteVersion<string> {
  return { revision, data: text, blocks: [{ label: '001.response.json', code: text, language: 'text' }] };
}

describe('DraftGuard', () => {
  let load: Mock<(target: DraftTarget) => Observable<RemoteVersion<string>>>;
  let apply: Mock<(data: string) => boolean>;
  let dirty: boolean;
  let guard: DraftGuard<string>;

  beforeEach(() => {
    load = vi.fn((_target: DraftTarget) => of(version('corrente')));
    apply = vi.fn((_data: string) => true);
    dirty = true;
    guard = new DraftGuard<string>({ load, apply, isDirty: () => dirty, errorMessage: () => 'lettura fallita' });
    guard.open(TARGET);
  });

  it('salva sul bersaglio fissato; la revisione di "Salva la mia versione" vale solo per quel salvataggio', () => {
    expect(guard.saveWith(noop)?.draft.target).toEqual(TARGET);
    expect(guard.saveWith(noop, REV_B)?.draft.target).toEqual({ ...TARGET, baseRevision: REV_B });
    // La base cambia solo con una ricarica o chiudendo la bozza dopo un salvataggio riuscito.
    expect(guard.target()?.baseRevision).toBe(REV_A);
  });

  it('un conflitto conserva la bozza e «Confronta» mostra la versione corrente senza applicarla', () => {
    guard.saveWith(noop)!.draft.onConflict!(CONFLICT);
    expect(guard.conflict()).toEqual(CONFLICT);

    guard.compare();

    expect(load).toHaveBeenCalledWith(TARGET);
    expect(guard.remote()?.revision).toBe(REV_B);
    expect(apply).not.toHaveBeenCalled();
    expect(guard.target()?.baseRevision).toBe(REV_A);
  });

  it('un nuovo conflitto invalida la versione mostrata: va riconfrontata prima di salvare la propria', () => {
    guard.saveWith(noop)!.draft.onConflict!(CONFLICT);
    guard.compare();
    guard.saveWith(noop, REV_B)!.draft.onConflict!({ ...CONFLICT, expectedRevision: REV_B, currentRevision: REV_A });

    expect(guard.remote()).toBeNull();
    expect(guard.conflict()?.currentRevision).toBe(REV_A);
  });

  it('«Ricarica» su una bozza modificata chiede conferma, poi sostituisce bozza e base', () => {
    guard.saveWith(noop)!.draft.onConflict!(CONFLICT);

    guard.reload();
    expect(guard.confirmingReload()).toBe(true);
    expect(load).not.toHaveBeenCalled();

    guard.confirmReload();
    expect(apply).toHaveBeenCalledWith('corrente');
    expect(guard.target()?.baseRevision).toBe(REV_B);
    expect(guard.conflict()).toBeNull();
    expect(guard.reloaded()).toBe(true);
  });

  it('«Ricarica» su una bozza non modificata non chiede conferma', () => {
    dirty = false;
    guard.saveWith(noop)!.draft.onConflict!(CONFLICT);

    guard.reload();

    expect(guard.confirmingReload()).toBe(false);
    expect(apply).toHaveBeenCalledWith('corrente');
  });

  it('una versione non rappresentabile nel form resta da confrontare e non sposta la base', () => {
    apply.mockReturnValue(false);
    guard.saveWith(noop)!.draft.onConflict!(CONFLICT);

    guard.confirmReload();

    expect(guard.reloadUnsupported()).toBe(true);
    expect(guard.remote()?.revision).toBe(REV_B);
    expect(guard.target()?.baseRevision).toBe(REV_A);
    expect(guard.conflict()).toEqual(CONFLICT);
  });

  it('un bersaglio sparito disabilita il salvataggio, anche se scoperto rileggendo', () => {
    guard.saveWith(noop)!.draft.onConflict!(CONFLICT);
    load.mockReturnValueOnce(throwError(() => ({ status: 404 })));

    guard.compare();

    expect(guard.missing()).toBe(true);
    expect(guard.canSave()).toBe(false);
    expect(guard.saveWith(noop)).toBeNull();
  });

  it('una lettura fallita per altri motivi resta un errore del pannello', () => {
    guard.saveWith(noop)!.draft.onConflict!(CONFLICT);
    load.mockReturnValueOnce(throwError(() => ({ status: 409, error: { details: { code: 'READ_INCONSISTENT' } } })));

    guard.compare();

    expect(guard.loadError()).toBe('lettura fallita');
    expect(guard.missing()).toBe(false);
    expect(guard.canSave()).toBe(true);
  });

  it('una risposta per una bozza chiusa o riaperta non tocca quella attuale', () => {
    const pending = new Subject<RemoteVersion<string>>();
    load.mockReturnValueOnce(pending);
    const onSaved = vi.fn();
    const staleSave = guard.saveWith(onSaved)!;
    staleSave.draft.onConflict!(CONFLICT);
    guard.compare();

    guard.open({ ...TARGET, responseFile: '002.response.json' });
    pending.next(version('vecchia'));
    staleSave.draft.onConflict!(CONFLICT);
    staleSave.draft.onMissing!();
    // Anche il successo tardivo: chiuderebbe la bozza riaperta, non salvata.
    staleSave.onSuccess();

    expect(guard.remote()).toBeNull();
    expect(guard.conflict()).toBeNull();
    expect(guard.missing()).toBe(false);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('il successo della bozza corrente arriva al form', () => {
    const onSaved = vi.fn();
    guard.saveWith(onSaved)!.onSuccess();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});
