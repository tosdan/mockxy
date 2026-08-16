const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  SharedStateStore,
  normalizeSharedStateName,
  validateAndSerializeJson,
} = require("../src/mocks/shared-state");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createFacade(store, origin = {}) {
  return store.createRequestFacade(origin);
}

async function openState(facade, name = "items", seedKey = "items@v1", initialize = () => []) {
  return facade.api.open(name, { seedKey, initialize });
}

function expectCode(action, code) {
  expect(action).toThrow(expect.objectContaining({ code }));
}

async function expectRejectedCode(promise, code) {
  await expect(promise).rejects.toMatchObject({ code });
}

describe("SharedStateStore", () => {
  test("normalizza i nomi e rifiuta nomi e seedKey non validi in modo sincrono", () => {
    expect(normalizeSharedStateName("  Orders.V2  ")).toBe("orders.v2");
    for (const name of ["", ".", "..", "a b", "../items", "é", "a".repeat(129), 1]) {
      expectCode(() => normalizeSharedStateName(name), "SHARED_STATE_INVALID_NAME");
    }

    const store = new SharedStateStore();
    const { api } = createFacade(store);
    expectCode(() => api.open("items"), "SHARED_STATE_INVALID_INITIALIZER");
    expectCode(
      () => api.open("items", { seedKey: "", initialize: () => [] }),
      "SHARED_STATE_INVALID_SEED_KEY"
    );
    expectCode(
      () => api.open("items", { seedKey: " items@v1", initialize: () => [] }),
      "SHARED_STATE_INVALID_SEED_KEY"
    );
    expectCode(
      () => api.open("items", { seedKey: "items@v1", initialize: true }),
      "SHARED_STATE_INVALID_INITIALIZER"
    );
  });

  test("open valida invoca la factory nello stesso stack ma restituisce sempre una Promise", async () => {
    const store = new SharedStateStore();
    const { api } = createFacade(store);
    let invoked = false;

    const promise = api.open("items", {
      seedKey: "items@v1",
      initialize: () => {
        invoked = true;
        return [];
      },
    });

    expect(invoked).toBe(true);
    expect(promise).toBeInstanceOf(Promise);
    await expect(promise).resolves.toEqual(expect.objectContaining({
      read: expect.any(Function),
      mutate: expect.any(Function),
      replace: expect.any(Function),
    }));
  });

  test("un throw sincrono della factory diventa INIT_FAILED asincrono ed è ritentabile", async () => {
    const cause = new Error("seed unavailable");
    const store = new SharedStateStore();
    const { api } = createFacade(store);

    let promise;
    expect(() => {
      promise = api.open("items", {
        seedKey: "items@v1",
        initialize: () => { throw cause; },
      });
    }).not.toThrow();
    await expect(promise).rejects.toMatchObject({
      code: "SHARED_STATE_INIT_FAILED",
      cause,
    });

    const handle = await api.open("items", {
      seedKey: "items@v1",
      initialize: () => ["retry"],
    });
    expect(handle.read()).toEqual(["retry"]);
  });

  test("deduplica l'inizializzazione concorrente e usa soltanto la prima factory", async () => {
    const store = new SharedStateStore();
    const first = createFacade(store, { method: "GET", path: "/one" });
    const second = createFacade(store, { method: "GET", path: "/two" });
    const seed = deferred();
    const firstFactory = jest.fn(() => seed.promise);
    const secondFactory = jest.fn(() => ["wrong"]);

    const one = first.api.open("Items", { seedKey: "items@v1", initialize: firstFactory });
    const two = second.api.open("items", { seedKey: "items@v1", initialize: secondFactory });
    expect(firstFactory).toHaveBeenCalledTimes(1);
    expect(secondFactory).not.toHaveBeenCalled();

    seed.resolve(["one"]);
    const [firstHandle, secondHandle] = await Promise.all([one, two]);
    expect(firstHandle.read()).toEqual(["one"]);
    expect(secondHandle.read()).toEqual(["one"]);
    expect(store.listMetadata().items[0].initializedBy).toEqual({ method: "GET", path: "/one" });
  });

  test("un seedKey incompatibile fallisce subito senza eseguire la factory", async () => {
    const store = new SharedStateStore();
    const facade = createFacade(store);
    await openState(facade);
    const initializer = jest.fn(() => []);

    expectCode(
      () => facade.api.open("items", { seedKey: "items@v2", initialize: initializer }),
      "SHARED_STATE_SEED_CONFLICT"
    );
    expect(initializer).not.toHaveBeenCalled();
  });

  test("accetta solo JSON rigoroso e canonicalizza -0 ovunque", async () => {
    const store = new SharedStateStore();
    const facade = createFacade(store);
    const handle = await openState(facade, "values", "values@v1", () => ({
      scalar: -0,
      list: [-0, null, true, "ok"],
      nested: Object.assign(Object.create(null), { value: -0 }),
    }));
    const snapshot = handle.read();
    expect(Object.is(snapshot.scalar, 0)).toBe(true);
    expect(Object.is(snapshot.list[0], 0)).toBe(true);
    expect(Object.is(snapshot.nested.value, 0)).toBe(true);

    const invalid = [
      undefined,
      NaN,
      Infinity,
      1n,
      Symbol("x"),
      () => {},
      new Date(),
      new Map(),
      new (class Value {})(),
      [, 1],
    ];
    for (const value of invalid) {
      expectCode(() => validateAndSerializeJson(value), "SHARED_STATE_INVALID_VALUE");
    }
  });

  test("rifiuta cicli, accessor, proprietà nascoste/extra e Proxy senza eseguire codice", () => {
    const cyclic = {};
    cyclic.self = cyclic;
    expectCode(() => validateAndSerializeJson(cyclic), "SHARED_STATE_INVALID_VALUE");

    let getterCalls = 0;
    const withGetter = {};
    Object.defineProperty(withGetter, "secret", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "secret";
      },
    });
    expectCode(() => validateAndSerializeJson(withGetter), "SHARED_STATE_INVALID_VALUE");
    expect(getterCalls).toBe(0);

    const hidden = {};
    Object.defineProperty(hidden, "hidden", { enumerable: false, value: true });
    expectCode(() => validateAndSerializeJson(hidden), "SHARED_STATE_INVALID_VALUE");

    const arrayWithExtra = [];
    arrayWithExtra.extra = true;
    expectCode(() => validateAndSerializeJson(arrayWithExtra), "SHARED_STATE_INVALID_VALUE");

    let trapCalls = 0;
    const proxy = new Proxy({}, {
      getPrototypeOf() {
        trapCalls += 1;
        return Object.prototype;
      },
      ownKeys() {
        trapCalls += 1;
        return [];
      },
    });
    expectCode(() => validateAndSerializeJson(proxy), "SHARED_STATE_INVALID_VALUE");
    expect(trapCalls).toBe(0);
  });

  test("applica il limite di profondità con boundary 100/101", () => {
    function nested(depth) {
      let value = 1;
      for (let index = 0; index < depth; index += 1) {
        value = [value];
      }
      return value;
    }

    expect(() => validateAndSerializeJson(nested(100))).not.toThrow();
    expectCode(() => validateAndSerializeJson(nested(101)), "SHARED_STATE_INVALID_VALUE");
  });

  test("read restituisce snapshot indipendenti; factory e replace non espongono riferimenti vivi", async () => {
    const original = { items: [{ id: 1 }] };
    const store = new SharedStateStore();
    const facade = createFacade(store);
    const handle = await openState(facade, "items", "items@v1", () => original);
    original.items[0].id = 99;
    const first = handle.read();
    first.items.push({ id: 2 });
    expect(handle.read()).toEqual({ items: [{ id: 1 }] });

    const replacement = { items: [{ id: 3 }] };
    handle.replace(replacement);
    replacement.items[0].id = 100;
    expect(handle.read()).toEqual({ items: [{ id: 3 }] });
  });

  test("mutate e replace sono atomici, incrementano versione e aggiornano accounting", async () => {
    let now = 100;
    const store = new SharedStateStore({ now: () => now });
    const facade = createFacade(store, { method: "POST", path: "/items" });
    const handle = await openState(facade, "items", "items@v1", () => [{ id: 1 }]);
    const before = store.listMetadata().items[0];

    now = 200;
    const returned = handle.mutate((draft) => {
      const item = { id: 2 };
      draft.push(item);
      return item;
    });
    returned.id = 99;
    expect(handle.read()).toEqual([{ id: 1 }, { id: 2 }]);

    now = 300;
    expect(handle.replace([])).toBeUndefined();
    const after = store.listMetadata().items[0];
    expect(after.version).toBe(3);
    expect(after.updatedAt).toBe(300);
    expect(after.sizeBytes).toBe(Buffer.byteLength("[]"));
    expect(store.listMetadata().totalBytes).toBe(after.sizeBytes);
    expect(before.version).toBe(1);
  });

  test("throw, risultato thenable e valore invalido nel mutator fanno rollback", async () => {
    const store = new SharedStateStore();
    const facade = createFacade(store);
    const handle = await openState(facade, "counter", "counter@v1", () => ({ count: 1 }));
    const before = store.listMetadata();

    expect(() => handle.mutate((draft) => {
      draft.count = 2;
      throw new Error("no commit");
    })).toThrow("no commit");
    expectCode(() => handle.mutate(async (draft) => {
      draft.count = 3;
    }), "SHARED_STATE_ASYNC_MUTATOR");
    expectCode(() => handle.mutate((draft) => {
      draft.count = undefined;
    }), "SHARED_STATE_INVALID_VALUE");

    expect(handle.read()).toEqual({ count: 1 });
    expect(store.listMetadata().items[0]).toMatchObject({
      version: before.items[0].version,
      sizeBytes: before.items[0].sizeBytes,
      updatedAt: before.items[0].updatedAt,
    });
  });

  test("mutator thenable via Proxy viene rifiutato e la rejection tardiva è osservata", async () => {
    const store = new SharedStateStore();
    const facade = createFacade(store);
    const handle = await openState(facade);
    const failure = new Error("later");
    const thenable = new Proxy({}, {
      get(_target, key) {
        if (key === "then") {
          return (_resolve, reject) => reject(failure);
        }
        return undefined;
      },
    });

    expectCode(() => handle.mutate(() => thenable), "SHARED_STATE_ASYNC_MUTATOR");
    await new Promise((resolve) => setImmediate(resolve));
    expect(handle.read()).toEqual([]);
  });

  test("l'adozione di un thenable custom del mutator resta nel contesto vietato", async () => {
    const store = new SharedStateStore();
    const facade = createFacade(store);
    const one = await openState(facade, "one", "one@v1", () => ({ count: 0 }));
    const two = await openState(facade, "two", "two@v1", () => ({ count: 0 }));
    const adopted = deferred();
    const thenable = {
      then(resolve) {
        try {
          two.mutate((draft) => { draft.count += 1; });
        } catch (error) {
          adopted.resolve(error);
        }
        resolve();
      },
    };

    expectCode(() => one.mutate((draft) => {
      draft.count += 1;
      return thenable;
    }), "SHARED_STATE_ASYNC_MUTATOR");
    await expect(adopted.promise).resolves.toMatchObject({
      code: "SHARED_STATE_REENTRANT_ACCESS",
    });
    expect(one.read()).toEqual({ count: 0 });
    expect(two.read()).toEqual({ count: 0 });
  });

  test("initializer non può usare lo store, neppure catturando la violazione o dopo await", async () => {
    const store = new SharedStateStore();
    const facade = createFacade(store);
    const other = await openState(facade, "other", "other@v1", () => ({ ok: true }));

    await expectRejectedCode(
      facade.api.open("sync", {
        seedKey: "sync@v1",
        initialize: () => {
          try {
            other.read();
          } catch (_error) {
            // Catching the immediate error must not make the impure initializer valid.
          }
          return {};
        },
      }),
      "SHARED_STATE_REENTRANT_INITIALIZATION"
    );

    await expectRejectedCode(
      facade.api.open("async", {
        seedKey: "async@v1",
        initialize: async () => {
          await Promise.resolve();
          other.read();
          return {};
        },
      }),
      "SHARED_STATE_REENTRANT_INITIALIZATION"
    );
  });

  test("anche l'adozione di un thenable custom resta nel contesto vietato dell'initializer", async () => {
    const store = new SharedStateStore();
    const facade = createFacade(store);
    const existing = await openState(facade, "existing", "existing@v1", () => ({ ok: true }));
    const thenable = {
      then(resolve) {
        try {
          existing.read();
        } catch (_error) {
          // Swallowing the immediate error cannot make thenable adoption a pure initializer.
        }
        resolve({ ok: true });
      },
    };

    await expectRejectedCode(
      facade.api.open("custom-thenable", {
        seedKey: "custom-thenable@v1",
        initialize: () => thenable,
      }),
      "SHARED_STATE_REENTRANT_INITIALIZATION"
    );
  });

  test("mutator non può usare nessuna entry e una violazione intercettata avvelena il commit", async () => {
    const store = new SharedStateStore();
    const facade = createFacade(store);
    const one = await openState(facade, "one", "one@v1", () => ({ count: 0 }));
    const two = await openState(facade, "two", "two@v1", () => ({ count: 0 }));

    expectCode(() => one.mutate((draft) => {
      draft.count = 1;
      try {
        two.read();
      } catch (_error) {
        // The store records the first violation even if user code catches it.
      }
    }), "SHARED_STATE_REENTRANT_ACCESS");
    expect(one.read()).toEqual({ count: 0 });

    expectCode(() => one.mutate(() => {
      facade.api.open("three", { seedKey: "three@v1", initialize: () => ({}) });
    }), "SHARED_STATE_REENTRANT_ACCESS");
  });

  test("la continuazione asincrona di un mutator resta marcata senza bloccare altre richieste", async () => {
    const store = new SharedStateStore();
    const first = createFacade(store);
    const second = createFacade(store);
    const one = await openState(first, "one", "one@v1", () => ({ count: 0 }));
    const two = await openState(second, "two", "two@v1", () => ({ count: 0 }));
    const continued = deferred();

    expectCode(() => one.mutate(async () => {
      await Promise.resolve();
      try {
        two.read();
      } catch (error) {
        continued.resolve(error);
      }
    }), "SHARED_STATE_ASYNC_MUTATOR");

    two.mutate((draft) => { draft.count += 1; });
    await expect(continued.promise).resolves.toMatchObject({ code: "SHARED_STATE_REENTRANT_ACCESS" });
    expect(two.read()).toEqual({ count: 1 });
  });

  test("reset durante init rigetta subito, non resuscita G e non migra implicitamente a G+1", async () => {
    const store = new SharedStateStore();
    const first = createFacade(store);
    const seed = deferred();
    const generationOne = first.api.open("items", {
      seedKey: "items@v1",
      initialize: () => seed.promise,
    });

    expect(store.reset("ITEMS")).toBe(true);
    await expectRejectedCode(generationOne, "SHARED_STATE_RESET_DURING_INITIALIZATION");

    const second = createFacade(store);
    const generationTwo = await openState(second, "items", "items@v2", () => ["G2"]);
    seed.resolve(["G1"]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(generationTwo.read()).toEqual(["G2"]);
    expect(store.listMetadata().items[0]).toMatchObject({ seedKey: "items@v2", version: 1 });
  });

  test("chiudere un waiter non cancella init per gli altri; l'ultimo libera subito il nome", async () => {
    const store = new SharedStateStore();
    const first = createFacade(store);
    const second = createFacade(store);
    const seed = deferred();
    const one = first.api.open("items", { seedKey: "items@v1", initialize: () => seed.promise });
    const two = second.api.open("items", { seedKey: "items@v1", initialize: () => [] });

    first.close();
    await expectRejectedCode(one, "SHARED_STATE_CONTEXT_CLOSED");
    expect(store.listMetadata().items).toHaveLength(1);
    seed.resolve([1]);
    expect((await two).read()).toEqual([1]);

    const pending = deferred();
    const third = createFacade(store);
    const ignored = third.api.open("pending", { seedKey: "pending@v1", initialize: () => pending.promise });
    third.close();
    await expectRejectedCode(ignored, "SHARED_STATE_CONTEXT_CLOSED");
    expect(store.listMetadata().items.map((item) => item.name)).not.toContain("pending");
  });

  test("reset rende stale gli handle e la nuova generazione riparte da versione 1", async () => {
    let now = 10;
    const store = new SharedStateStore({ now: () => now });
    const first = createFacade(store, { path: "/first" });
    const oldHandle = await openState(first);
    oldHandle.mutate((draft) => draft.push(1));
    expect(store.reset("items")).toBe(true);
    expect(store.reset("items")).toBe(false);
    expectCode(() => oldHandle.read(), "SHARED_STATE_STALE_HANDLE");

    now = 20;
    const second = createFacade(store, { path: "/second" });
    await openState(second, "items", "items@v2", () => [2]);
    expect(store.listMetadata().items[0]).toMatchObject({
      version: 1,
      initializedAt: 20,
      initializedBy: { path: "/second" },
    });
  });

  test("resetAll invalida ogni handle e restituisce il numero di entry", async () => {
    const store = new SharedStateStore();
    const facade = createFacade(store);
    const one = await openState(facade, "one", "one@v1", () => 1);
    const two = await openState(facade, "two", "two@v1", () => 2);
    expect(store.resetAll()).toBe(2);
    expect(store.resetAll()).toBe(0);
    expectCode(() => one.read(), "SHARED_STATE_STALE_HANDLE");
    expectCode(() => two.read(), "SHARED_STATE_STALE_HANDLE");
  });

  test("close del contesto e dello store sono permanenti e invalidano le operazioni", async () => {
    const store = new SharedStateStore();
    const facade = createFacade(store);
    const handle = await openState(facade);
    facade.close();
    facade.close();
    expectCode(() => handle.read(), "SHARED_STATE_CONTEXT_CLOSED");
    expectCode(
      () => facade.api.open("other", { seedKey: "other@v1", initialize: () => [] }),
      "SHARED_STATE_CONTEXT_CLOSED"
    );

    const active = createFacade(store);
    const activeHandle = await openState(active, "active", "active@v1", () => []);
    store.close();
    store.close();
    expectCode(() => activeHandle.read(), "SHARED_STATE_STORE_CLOSED");
    expectCode(
      () => active.api.open("next", { seedKey: "next@v1", initialize: () => [] }),
      "SHARED_STATE_STORE_CLOSED"
    );
  });

  test("limiti per entry, totale e numero entry preservano valore e accounting", async () => {
    const store = new SharedStateStore({
      maxEntries: 2,
      maxEntryBytes: 20,
      maxTotalBytes: 24,
    });
    const facade = createFacade(store);
    const one = await openState(facade, "one", "one@v1", () => "1234567890");
    await openState(facade, "two", "two@v1", () => "12345");

    expectCode(
      () => facade.api.open("three", { seedKey: "three@v1", initialize: () => null }),
      "SHARED_STATE_ENTRY_LIMIT"
    );
    expectCode(() => one.replace("x".repeat(19)), "SHARED_STATE_ENTRY_TOO_LARGE");
    expectCode(() => one.replace("1234567890123456"), "SHARED_STATE_TOTAL_TOO_LARGE");
    expect(one.read()).toBe("1234567890");
    expect(store.listMetadata().totalBytes).toBe(
      Buffer.byteLength(JSON.stringify("1234567890")) + Buffer.byteLength(JSON.stringify("12345"))
    );
  });

  test("boundary reali 3 MiB/+1, 25 MiB/+1 e 256/257", async () => {
    const mib = 1024 * 1024;
    const serializedStringOfSize = (bytes) => "x".repeat(bytes - 2);

    const entryStore = new SharedStateStore();
    const entryFacade = createFacade(entryStore);
    const boundary = await openState(
      entryFacade,
      "boundary",
      "boundary@v1",
      () => serializedStringOfSize(3 * mib)
    );
    expect(entryStore.listMetadata().items[0].sizeBytes).toBe(3 * mib);
    expectCode(
      () => boundary.replace(serializedStringOfSize(3 * mib + 1)),
      "SHARED_STATE_ENTRY_TOO_LARGE"
    );
    expect(Buffer.byteLength(JSON.stringify(boundary.read()))).toBe(3 * mib);

    const totalStore = new SharedStateStore();
    const totalFacade = createFacade(totalStore);
    for (let index = 0; index < 8; index += 1) {
      await openState(
        totalFacade,
        `chunk-${index}`,
        `chunk-${index}@v1`,
        () => serializedStringOfSize(3 * mib)
      );
    }
    await openState(
      totalFacade,
      "last-mebibyte",
      "last-mebibyte@v1",
      () => serializedStringOfSize(mib)
    );
    expect(totalStore.listMetadata().totalBytes).toBe(25 * mib);
    await expectRejectedCode(
      openState(totalFacade, "one-byte-over", "one-byte-over@v1", () => 0),
      "SHARED_STATE_TOTAL_TOO_LARGE"
    );
    expect(totalStore.listMetadata().totalBytes).toBe(25 * mib);

    const countStore = new SharedStateStore();
    const countFacade = createFacade(countStore);
    for (let index = 0; index < 256; index += 1) {
      await openState(countFacade, `entry-${index}`, `entry-${index}@v1`, () => null);
    }
    expect(countStore.listMetadata().items).toHaveLength(256);
    expectCode(
      () => countFacade.api.open("entry-256", {
        seedKey: "entry-256@v1",
        initialize: () => null,
      }),
      "SHARED_STATE_ENTRY_LIMIT"
    );
  }, 30000);

  test("metadata sono ordinati e non contengono i valori", async () => {
    const store = new SharedStateStore();
    const facade = createFacade(store);
    await openState(facade, "zeta", "zeta@v1", () => ({ secret: "never expose" }));
    await openState(facade, "alpha", "alpha@v1", () => []);

    const metadata = store.listMetadata();
    expect(metadata.items.map((item) => item.name)).toEqual(["alpha", "zeta"]);
    expect(JSON.stringify(metadata)).not.toContain("never expose");
    expect(metadata).toMatchObject({
      totalBytes: expect.any(Number),
      limits: {
        maxEntries: 256,
        maxEntryBytes: 3 * 1024 * 1024,
        maxTotalBytes: 25 * 1024 * 1024,
        maxDepth: 100,
      },
    });
  });

  test("un fallimento init produce un solo warn sicuro, anche con waiter multipli", async () => {
    const warnings = [];
    const logger = { warn: (...args) => warnings.push(args) };
    const store = new SharedStateStore({ logger });
    const first = createFacade(store, { method: "GET", path: "/items" });
    const second = createFacade(store, { method: "POST", path: "/items" });
    const failure = deferred();
    const one = first.api.open("items", { seedKey: "items@v1", initialize: () => failure.promise });
    const two = second.api.open("items", { seedKey: "items@v1", initialize: () => [] });
    failure.reject(new Error("database password=secret"));

    await expectRejectedCode(one, "SHARED_STATE_INIT_FAILED");
    await expectRejectedCode(two, "SHARED_STATE_INIT_FAILED");
    expect(warnings).toHaveLength(1);
    expect(warnings[0][0]).toBe("Shared state initialization failed.");
    expect(warnings[0][1]).toMatchObject({
      code: "SHARED_STATE_INIT_FAILED",
      name: "items",
      seedKey: "items@v1",
      origin: { method: "GET", path: "/items" },
    });
    expect(warnings[0][1]).not.toHaveProperty("value");
    expect(warnings[0][1]).not.toHaveProperty("body");
  });

  test("un logger difettoso non cambia cleanup, errore o retry", async () => {
    const store = new SharedStateStore({
      logger: { warn: () => { throw new Error("logger failed"); } },
    });
    const facade = createFacade(store);
    await expectRejectedCode(
      openState(facade, "items", "items@v1", () => { throw new Error("seed failed"); }),
      "SHARED_STATE_INIT_FAILED"
    );
    expect((await openState(facade, "items", "items@v1", () => [1])).read()).toEqual([1]);
  });

  test("le Promise originali restano rigettabili ma gli open ignorati non causano unhandled rejection", () => {
    const modulePath = path.resolve(__dirname, "../src/mocks/shared-state.js");
    const script = `
      const { SharedStateStore } = require(${JSON.stringify(modulePath)});
      const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
      const noopLogger = { warn() {} };
      const failedStore = new SharedStateStore({ logger: noopLogger });
      failedStore.createRequestFacade().api.open("failed", { seedKey: "failed@v1", initialize: () => Promise.reject(new Error("failed")) });
      const resetStore = new SharedStateStore({ logger: noopLogger });
      const resetSeed = deferred();
      resetStore.createRequestFacade().api.open("reset", { seedKey: "reset@v1", initialize: () => resetSeed.promise });
      resetStore.reset("reset");
      const contextStore = new SharedStateStore({ logger: noopLogger });
      const contextSeed = deferred();
      const context = contextStore.createRequestFacade();
      context.api.open("context", { seedKey: "context@v1", initialize: () => contextSeed.promise });
      context.close();
      const closedStore = new SharedStateStore({ logger: noopLogger });
      const closedSeed = deferred();
      closedStore.createRequestFacade().api.open("closed", { seedKey: "closed@v1", initialize: () => closedSeed.promise });
      closedStore.close();
      setTimeout(() => process.exit(0), 30);
    `;
    const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "-e", script], {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
      timeout: 2000,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });
});
