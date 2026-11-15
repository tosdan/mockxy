const { AsyncLocalStorage } = require("async_hooks");
const {
  currentScriptOrigin,
  invokeWithSyncBudget,
  isScriptBlockedError,
  runScript,
  runWithScriptOrigin,
} = require("../src/mocks/script-execution");
const { SharedStateStore } = require("../src/mocks/shared-state");

// Gli script del workspace girano nel processo del motore: il loro codice sincrono ha un tempo
// massimo, e tutto ciò che avviano ricorda da quale script discende.
describe("esecuzione degli script del workspace", () => {
  describe("tempo massimo sul codice sincrono", () => {
    test("un ciclo che non finisce viene interrotto, e il thread torna libero", () => {
      const startedAt = Date.now();
      let caught;
      try {
        invokeWithSyncBudget(() => {
          while (true) {} // eslint-disable-line no-empty
        }, 80);
      } catch (error) {
        caught = error;
      }

      expect(isScriptBlockedError(caught)).toBe(true);
      expect(caught.code).toBe("SCRIPT_BLOCKED");
      expect(caught.budgetMs).toBe(80);
      expect(Date.now() - startedAt).toBeLessThan(2000);
    });

    test("il risultato passa com'è: valori, promise, errori dello script", async () => {
      expect(invokeWithSyncBudget(() => 42, 1000)).toBe(42);

      const promise = invokeWithSyncBudget(async () => {
        await null;
        return "dopo l'await";
      }, 1000);
      expect(promise).toBeInstanceOf(Promise);
      await expect(promise).resolves.toBe("dopo l'await");

      const scriptError = new TypeError("errore dello script");
      expect(() => invokeWithSyncBudget(() => {
        throw scriptError;
      }, 1000)).toThrow(scriptError);
    });

    test("un errore dello script con lo stesso codice di Node non passa per un'interruzione... ma resta un errore", () => {
      const forged = Object.assign(new Error("finto"), { code: "ERR_SCRIPT_EXECUTION_TIMEOUT" });

      // Indistinguibile dall'interruzione vera: viene riportato come blocco. Lo script non ne
      // ricava nulla, e il motore non deve fidarsi di altro che del codice.
      expect(() => invokeWithSyncBudget(() => {
        throw forged;
      }, 1000)).toThrow(/synchronous code/);
    });

    test("senza un tempo massimo valido la funzione viene chiamata direttamente", () => {
      for (const budget of [0, -1, Infinity, NaN, undefined]) {
        expect(invokeWithSyncBudget(() => "diretto", budget)).toBe("diretto");
      }
    });

    test("le chiamate annidate non si pestano i piedi", () => {
      const result = invokeWithSyncBudget(
        () => `fuori(${invokeWithSyncBudget(() => "dentro", 1000)})`,
        1000
      );

      expect(result).toBe("fuori(dentro)");
      expect(invokeWithSyncBudget(() => "dopo", 1000)).toBe("dopo");
    });

    test("il tratto dopo un await non è coperto: resta al timer della richiesta", async () => {
      // Limite dichiarato: qui si verifica solo che il tempo massimo non scatti a sproposito
      // su una funzione che attende a lungo senza occupare il thread.
      const slow = invokeWithSyncBudget(
        () => new Promise((resolve) => setTimeout(() => resolve("tardi"), 120)),
        30
      );

      await expect(slow).resolves.toBe("tardi");
    });
  });

  describe("origine dello script", () => {
    const origin = { kind: "handler", method: "GET", path: "/utenti", filePath: "/ws/mocks/utenti/001.handler.js" };

    test("fuori dagli script non c'è origine", () => {
      expect(currentScriptOrigin()).toBeUndefined();
    });

    test("vale dentro la chiamata, dopo un await, in un timer e in una promise staccata", async () => {
      const seen = {};
      let timerDone;
      const timer = new Promise((resolve) => {
        timerDone = resolve;
      });

      await runScript(origin, async () => {
        seen.sync = currentScriptOrigin();
        setTimeout(() => {
          seen.timer = currentScriptOrigin();
          timerDone();
        }, 5);
        Promise.resolve().then(() => {
          seen.detached = currentScriptOrigin();
        });
        await null;
        seen.afterAwait = currentScriptOrigin();
      }, 1000);
      await timer;

      expect(seen).toEqual({ sync: origin, timer: origin, detached: origin, afterAwait: origin });
      expect(currentScriptOrigin()).toBeUndefined();
    });

    test("il caricamento di un modulo ha la sua origine, senza tempo massimo", () => {
      const loadOrigin = { kind: "script-load", filePath: "/ws/mocks/a/001.handler.js" };

      expect(runWithScriptOrigin(loadOrigin, () => currentScriptOrigin())).toBe(loadOrigin);
      expect(currentScriptOrigin()).toBeUndefined();
    });

    test("dopo un'interruzione l'origine torna quella di prima; un altro contesto in cui lo script era entrato no", () => {
      // L'interruzione salta i `finally`, compreso quello con cui un AsyncLocalStorage
      // ripristina il suo valore. L'origine la rimette a posto la chiamata esterna; di un
      // contesto altrui deve occuparsi chi lo possiede (vedi lo stato condiviso, sotto).
      const inner = new AsyncLocalStorage();

      expect(() => runScript(origin, () => inner.run("marcatore", () => {
        while (true) {} // eslint-disable-line no-empty
      }), 60)).toThrow(/synchronous code/);

      expect(currentScriptOrigin()).toBeUndefined();
      expect(inner.getStore()).toBe("marcatore");
      inner.enterWith(undefined);
    });
  });

  describe("stato condiviso dopo un'interruzione", () => {
    async function openCounter(store) {
      const request = store.createRequestFacade({ method: "GET", path: "/contatore", responseFile: "001.response.json" });
      const handle = await request.api.open("contatore", { seedKey: "v1", initialize: () => ({ n: 0 }) });
      return { handle, request };
    }

    test("un mutator interrotto lascia lo stato com'era e, ripristinato, lo store torna usabile", async () => {
      const store = new SharedStateStore();
      const { handle, request } = await openCounter(store);
      handle.mutate((draft) => {
        draft.n = 1;
      });

      expect(() => invokeWithSyncBudget(() => handle.mutate((draft) => {
        draft.n = 99;
        while (true) {} // eslint-disable-line no-empty
      }), 60)).toThrow(/synchronous code/);

      // Senza ripristino i marcatori del mutator restano accesi: ogni accesso è «rientrante».
      expect(() => handle.read()).toThrow(/mutator/);

      store.recoverFromInterruptedScript();

      expect(handle.read()).toEqual({ n: 1 });
      expect(handle.mutate((draft) => {
        draft.n += 1;
        return draft.n;
      })).toBe(2);
      request.close();
    });
  });
});
