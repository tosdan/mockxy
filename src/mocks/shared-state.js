const { AsyncLocalStorage } = require("node:async_hooks");
const { types } = require("node:util");

const DEFAULT_LIMITS = Object.freeze({
  maxEntries: 256,
  maxEntryBytes: 3 * 1024 * 1024,
  maxTotalBytes: 25 * 1024 * 1024,
  maxDepth: 100,
});

const SHARED_STATE_NAME_PATTERN = /^[a-z0-9._-]+$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

class SharedStateError extends Error {
  constructor(code, message, { meta = {}, cause } = {}) {
    super(message);
    this.name = "SharedStateError";
    this.code = code;
    this.meta = { ...meta };
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

function isSharedStateError(error) {
  return error instanceof SharedStateError;
}

function sharedStateError(code, message, meta, cause) {
  return new SharedStateError(code, message, { meta, cause });
}

function normalizeSharedStateName(name) {
  if (typeof name !== "string") {
    throw sharedStateError(
      "SHARED_STATE_INVALID_NAME",
      "Shared state name must be a string."
    );
  }

  const normalized = name.trim().toLowerCase();
  if (
    normalized.length < 1
    || normalized.length > 128
    || normalized === "."
    || normalized === ".."
    || !SHARED_STATE_NAME_PATTERN.test(normalized)
  ) {
    throw sharedStateError(
      "SHARED_STATE_INVALID_NAME",
      "Shared state name must contain 1-128 lowercase letters, digits, '.', '_' or '-'."
    );
  }

  return normalized;
}

function validateSeedKey(seedKey, name) {
  if (
    typeof seedKey !== "string"
    || seedKey.length < 1
    || seedKey.length > 256
    || seedKey.trim() !== seedKey
    || CONTROL_CHARACTER_PATTERN.test(seedKey)
  ) {
    throw sharedStateError(
      "SHARED_STATE_INVALID_SEED_KEY",
      "Shared state seedKey must be a non-empty string of at most 256 characters without surrounding whitespace or control characters.",
      { name }
    );
  }

  return seedKey;
}

function createSignal() {
  let resolve;
  const promise = new Promise((signalResolve) => {
    resolve = signalResolve;
  });
  return { promise, resolve };
}

function normalizeOrigin(origin) {
  const normalized = {};
  if (typeof origin?.method === "string" && origin.method !== "") {
    normalized.method = origin.method;
  }
  if (typeof origin?.path === "string" && origin.path !== "") {
    normalized.path = origin.path;
  }
  if (typeof origin?.responseFile === "string" && origin.responseFile !== "") {
    normalized.responseFile = origin.responseFile;
  }
  return normalized;
}

function invalidValue(message, meta = {}) {
  throw sharedStateError("SHARED_STATE_INVALID_VALUE", message, meta);
}

function isPlainObjectPrototype(prototype) {
  if (prototype === null || prototype === Object.prototype) {
    return true;
  }

  // Handler modules compiled through Node's native Module loader can belong to a different
  // realm than the Jest/application wrapper. Their Object.prototype has a different identity
  // but the same intrinsic shape: its own prototype is null and its own constructor is Object.
  // Inspect descriptors only, so this compatibility check cannot invoke user getters.
  if (types.isProxy(prototype) || Object.getPrototypeOf(prototype) !== null) {
    return false;
  }
  const constructorDescriptor = Object.getOwnPropertyDescriptor(prototype, "constructor");
  return (
    constructorDescriptor != null
    && "value" in constructorDescriptor
    && typeof constructorDescriptor.value === "function"
    && constructorDescriptor.value.name === "Object"
  );
}

// Validates without reading getters or invoking Proxy traps, and builds a detached representation
// whose prototypes cannot contribute inherited toJSON hooks during serialization.
function validateAndSerializeJson(value, { maxDepth = DEFAULT_LIMITS.maxDepth } = {}) {
  const holder = Object.create(null);
  const activeContainers = new WeakSet();
  const stack = [{ kind: "value", source: value, target: holder, key: "value", depth: 0 }];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame.kind === "exit") {
      activeContainers.delete(frame.source);
      continue;
    }

    const current = frame.source;
    if (current === null || typeof current === "boolean" || typeof current === "string") {
      frame.target[frame.key] = current;
      continue;
    }

    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        invalidValue("Shared state numbers must be finite.");
      }
      frame.target[frame.key] = Object.is(current, -0) ? 0 : current;
      continue;
    }

    if (typeof current !== "object") {
      invalidValue("Shared state values must be valid JSON data.");
    }

    if (types.isProxy(current)) {
      invalidValue("Shared state values cannot contain Proxy objects.");
    }

    const containerDepth = frame.depth + 1;
    if (containerDepth > maxDepth) {
      invalidValue("Shared state value exceeds the maximum JSON depth.", {
        actualDepth: containerDepth,
        limitDepth: maxDepth,
      });
    }
    if (activeContainers.has(current)) {
      invalidValue("Shared state values cannot contain circular references.");
    }
    activeContainers.add(current);
    stack.push({ kind: "exit", source: current });

    if (Array.isArray(current)) {
      const keys = Reflect.ownKeys(current);
      const indexes = [];
      for (const key of keys) {
        if (key === "length") {
          continue;
        }
        if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key)) {
          invalidValue("Shared state arrays must be dense and cannot have extra properties.");
        }
        const index = Number(key);
        if (!Number.isSafeInteger(index) || index >= current.length || String(index) !== key) {
          invalidValue("Shared state arrays must be dense and cannot have extra properties.");
        }
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (
          descriptor == null
          || descriptor.enumerable !== true
          || !("value" in descriptor)
          || descriptor.get != null
          || descriptor.set != null
        ) {
          invalidValue("Shared state arrays cannot contain accessors or hidden items.");
        }
        indexes.push({ index, value: descriptor.value });
      }
      if (indexes.length !== current.length) {
        invalidValue("Shared state arrays must be dense and cannot contain holes.");
      }

      const clone = [];
      Object.setPrototypeOf(clone, null);
      frame.target[frame.key] = clone;
      indexes.sort((left, right) => left.index - right.index);
      for (let index = indexes.length - 1; index >= 0; index -= 1) {
        const item = indexes[index];
        stack.push({
          kind: "value",
          source: item.value,
          target: clone,
          key: item.index,
          depth: containerDepth,
        });
      }
      continue;
    }

    const prototype = Object.getPrototypeOf(current);
    if (!isPlainObjectPrototype(prototype)) {
      invalidValue("Shared state objects must be plain objects.");
    }

    const clone = Object.create(null);
    frame.target[frame.key] = clone;
    const properties = [];
    for (const key of Reflect.ownKeys(current)) {
      if (typeof key !== "string") {
        invalidValue("Shared state objects cannot contain Symbol keys.");
      }
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (
        descriptor == null
        || descriptor.enumerable !== true
        || !("value" in descriptor)
        || descriptor.get != null
        || descriptor.set != null
      ) {
        invalidValue("Shared state objects can contain only enumerable data properties.");
      }
      properties.push({ key, value: descriptor.value });
    }
    for (let index = properties.length - 1; index >= 0; index -= 1) {
      const property = properties[index];
      stack.push({
        kind: "value",
        source: property.value,
        target: clone,
        key: property.key,
        depth: containerDepth,
      });
    }
  }

  const serializedValue = JSON.stringify(holder.value);
  return {
    serializedValue,
    sizeBytes: Buffer.byteLength(serializedValue, "utf8"),
  };
}

function findThenDescriptor(value) {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") {
    return undefined;
  }
  let current = value;
  while (current != null) {
    if (types.isProxy(current)) {
      // Inspecting either a Proxy or a Proxy in the prototype chain could execute arbitrary
      // traps. Conservatively classify it as thenable without touching it.
      return { get: true };
    }
    const descriptor = Object.getOwnPropertyDescriptor(current, "then");
    if (descriptor != null) {
      return descriptor;
    }
    current = Object.getPrototypeOf(current);
  }
  return undefined;
}

function isThenable(value) {
  if (
    ((typeof value === "object" && value !== null) || typeof value === "function")
    && types.isProxy(value)
  ) {
    // A Proxy could expose `then` through an arbitrary trap. Treat it conservatively as a
    // thenable and let Promise.resolve() observe any eventual rejection below.
    return true;
  }
  const descriptor = findThenDescriptor(value);
  if (descriptor == null) {
    return false;
  }
  return !("value" in descriptor) || typeof descriptor.value === "function";
}

function observePromise(promise) {
  promise.catch(() => {});
  return promise;
}

class SharedStateStore {
  constructor({
    now = () => Date.now(),
    logger,
    maxEntries = DEFAULT_LIMITS.maxEntries,
    maxEntryBytes = DEFAULT_LIMITS.maxEntryBytes,
    maxTotalBytes = DEFAULT_LIMITS.maxTotalBytes,
    maxDepth = DEFAULT_LIMITS.maxDepth,
  } = {}) {
    this.now = now;
    this.logger = logger;
    this.limits = Object.freeze({ maxEntries, maxEntryBytes, maxTotalBytes, maxDepth });
    this.entries = new Map();
    this.totalBytes = 0;
    this.closed = false;
    this.callbackContext = new AsyncLocalStorage();
    this.activeMutator = null;
  }

  createRequestFacade(origin = {}) {
    const context = {
      closed: false,
      closedError: null,
      closeSignal: createSignal(),
      origin: normalizeOrigin(origin),
      waitingEntries: new Set(),
    };
    const api = Object.freeze({
      open: (name, options) => this.open(name, options, context),
    });
    return {
      api,
      close: () => this.closeRequestContext(context),
    };
  }

  _assertCallbackAccess() {
    const marker = this.callbackContext.getStore();
    if (marker?.store === this) {
      if (marker.violation == null) {
        const initializer = marker.phase === "initializer";
        marker.violation = sharedStateError(
          initializer
            ? "SHARED_STATE_REENTRANT_INITIALIZATION"
            : "SHARED_STATE_REENTRANT_ACCESS",
          initializer
            ? "Shared state cannot be accessed from an initializer."
            : "Shared state cannot be accessed from a mutator.",
          marker.meta
        );
      }
      throw marker.violation;
    }

    if (this.activeMutator != null) {
      if (this.activeMutator.violation == null) {
        this.activeMutator.violation = sharedStateError(
          "SHARED_STATE_REENTRANT_ACCESS",
          "Shared state cannot be accessed while a mutator is running.",
          this.activeMutator.meta
        );
      }
      throw this.activeMutator.violation;
    }
  }

  _assertStoreOpen() {
    if (this.closed) {
      throw sharedStateError(
        "SHARED_STATE_STORE_CLOSED",
        "Shared state store is closed."
      );
    }
  }

  _assertContextOpen(context) {
    if (context == null || context.closed) {
      throw context?.closedError || sharedStateError(
        "SHARED_STATE_CONTEXT_CLOSED",
        "Shared state request context is closed."
      );
    }
  }

  _validateOpen(name, options, context) {
    this._assertCallbackAccess();
    this._assertStoreOpen();
    this._assertContextOpen(context);

    const normalizedName = normalizeSharedStateName(name);
    if (options == null || typeof options !== "object" || Array.isArray(options)) {
      throw sharedStateError(
        "SHARED_STATE_INVALID_INITIALIZER",
        "Shared state open options must be an object with an initialize function.",
        { name: normalizedName }
      );
    }
    const seedKey = validateSeedKey(options.seedKey, normalizedName);
    if (typeof options.initialize !== "function") {
      throw sharedStateError(
        "SHARED_STATE_INVALID_INITIALIZER",
        "Shared state initialize must be a function.",
        { name: normalizedName, requestedSeedKey: seedKey }
      );
    }

    return { name: normalizedName, seedKey, initialize: options.initialize };
  }

  open(name, options, context) {
    const validated = this._validateOpen(name, options, context);
    let entry = this.entries.get(validated.name);
    if (entry != null && entry.seedKey !== validated.seedKey) {
      throw sharedStateError(
        "SHARED_STATE_SEED_CONFLICT",
        "Shared state seedKey conflicts with the active resource.",
        {
          name: validated.name,
          requestedSeedKey: validated.seedKey,
          currentSeedKey: entry.seedKey,
        }
      );
    }

    if (entry == null) {
      if (this.entries.size >= this.limits.maxEntries) {
        throw sharedStateError(
          "SHARED_STATE_ENTRY_LIMIT",
          "Shared state entry limit exceeded.",
          {
            name: validated.name,
            requestedSeedKey: validated.seedKey,
            actualEntries: this.entries.size + 1,
            limitEntries: this.limits.maxEntries,
          }
        );
      }
      entry = this._startInitialization(validated, context);
    } else if (entry.status === "initializing") {
      this._addWaiter(entry, context);
    }

    return entry.status === "ready"
      ? this._createReadyPromise(entry, context)
      : this._createInitializingPromise(entry, context);
  }

  _createEntry({ name, seedKey }, context) {
    return {
      name,
      seedKey,
      token: Symbol(name),
      status: "initializing",
      initializedBy: { ...context.origin },
      invalidationSignal: createSignal(),
      invalidationError: null,
      waiters: new Set(),
      initPromise: null,
      serializedValue: undefined,
      sizeBytes: 0,
      version: null,
      initializedAt: null,
      updatedAt: null,
      lastAccessAt: null,
      lastAccessedBy: null,
    };
  }

  _startInitialization(validated, context) {
    const entry = this._createEntry(validated, context);
    this.entries.set(entry.name, entry);
    this._addWaiter(entry, context);

    const marker = {
      store: this,
      phase: "initializer",
      violation: null,
      meta: { name: entry.name, requestedSeedKey: entry.seedKey },
    };

    let factoryResult;
    try {
      factoryResult = this.callbackContext.run(marker, () => validated.initialize());
    } catch (error) {
      factoryResult = Promise.reject(error);
    }

    // Promise/thenable adoption is part of the initializer contract too. Running it under the
    // same async marker prevents a custom `then` getter/callback from escaping the reentrancy
    // guard merely because the factory returned it instead of a native Promise.
    const factoryPromise = observePromise(
      this.callbackContext.run(marker, () => Promise.resolve(factoryResult))
    );
    entry.initPromise = observePromise(
      factoryPromise
        .then(
          (value) => {
            if (marker.violation != null) {
              throw marker.violation;
            }
            return this._commitInitialization(entry, value);
          },
          (error) => {
            throw marker.violation || error;
          }
        )
        .catch((error) => this._failInitialization(entry, error))
    );
    return entry;
  }

  _addWaiter(entry, context) {
    entry.waiters.add(context);
    context.waitingEntries.add(entry);
  }

  _clearWaiters(entry) {
    for (const context of entry.waiters) {
      context.waitingEntries.delete(entry);
    }
    entry.waiters.clear();
  }

  _commitInitialization(entry, value) {
    let serialized;
    try {
      serialized = validateAndSerializeJson(value, { maxDepth: this.limits.maxDepth });
      this._assertSizeLimits(entry, serialized.sizeBytes, 0);
    } catch (error) {
      throw this._addEntryMetadata(error, entry);
    }

    const current = this.entries.get(entry.name);
    if (
      this.closed
      || current !== entry
      || current.token !== entry.token
      || entry.waiters.size === 0
    ) {
      return entry;
    }

    const timestamp = this.now();
    entry.status = "ready";
    entry.serializedValue = serialized.serializedValue;
    entry.sizeBytes = serialized.sizeBytes;
    entry.version = 1;
    entry.initializedAt = timestamp;
    entry.updatedAt = timestamp;
    this.totalBytes += entry.sizeBytes;
    this._clearWaiters(entry);
    return entry;
  }

  _addEntryMetadata(error, entry) {
    if (!isSharedStateError(error)) {
      return sharedStateError(
        "SHARED_STATE_INIT_FAILED",
        "Shared state initializer failed.",
        {
          name: entry.name,
          requestedSeedKey: entry.seedKey,
          origin: { ...entry.initializedBy },
        },
        error
      );
    }

    error.meta = {
      name: entry.name,
      requestedSeedKey: entry.seedKey,
      origin: { ...entry.initializedBy },
      ...error.meta,
    };
    return error;
  }

  _failInitialization(entry, error) {
    const normalized = this._addEntryMetadata(error, entry);
    if (this.entries.get(entry.name) === entry) {
      this.entries.delete(entry.name);
    }
    this._clearWaiters(entry);
    this._reportInitializationFailure(normalized, entry);
    throw normalized;
  }

  _reportInitializationFailure(error, entry) {
    try {
      this.logger?.warn("Shared state initialization failed.", {
        code: error.code,
        name: entry.name,
        seedKey: entry.seedKey,
        origin: { ...entry.initializedBy },
        error: error.message,
        errorName: error.name,
        errorStack: error.stack,
        cause: error.cause?.message,
        causeName: error.cause?.name,
        causeStack: error.cause?.stack,
      });
    } catch (_loggerError) {
      // Diagnostics must never change store cleanup or the error observed by the handler.
    }
  }

  _createReadyPromise(entry, context) {
    const readyOutcome = Promise.resolve({ kind: "ready" });
    const promise = Promise.race([
      readyOutcome,
      context.closeSignal.promise.then((error) => ({ kind: "error", error })),
      entry.invalidationSignal.promise.then((error) => ({ kind: "error", error })),
    ]).then((outcome) => {
      if (outcome.kind === "error") {
        throw outcome.error;
      }
      return this._createHandle(entry, context);
    });
    return observePromise(promise);
  }

  _createInitializingPromise(entry, context) {
    const initializationOutcome = entry.initPromise.then(
      () => ({ kind: "ready" }),
      (error) => ({ kind: "error", error })
    );
    const promise = Promise.race([
      initializationOutcome,
      context.closeSignal.promise.then((error) => ({ kind: "error", error })),
      entry.invalidationSignal.promise.then((error) => ({ kind: "error", error })),
    ]).then((outcome) => {
      if (outcome.kind === "error") {
        throw outcome.error;
      }
      if (entry.invalidationError != null) {
        throw entry.invalidationError;
      }
      return this._createHandle(entry, context);
    });
    return observePromise(promise);
  }

  _createHandle(entry, context) {
    this._assertEntry(entry, context);
    this._recordAccess(entry, context.origin);
    const token = entry.token;
    return Object.freeze({
      read: () => this._read(entry.name, token, context),
      mutate: (mutator) => this._mutate(entry.name, token, context, mutator),
      replace: (value) => this._replace(entry.name, token, context, value),
    });
  }

  _assertEntry(entry, context) {
    this._assertCallbackAccess();
    this._assertStoreOpen();
    this._assertContextOpen(context);
    const current = this.entries.get(entry.name);
    if (current !== entry || current.token !== entry.token || current.status !== "ready") {
      throw sharedStateError(
        "SHARED_STATE_STALE_HANDLE",
        "Shared state handle belongs to a stale generation.",
        { name: entry.name, currentSeedKey: current?.seedKey }
      );
    }
  }

  _resolveHandleEntry(name, token, context) {
    this._assertCallbackAccess();
    this._assertStoreOpen();
    this._assertContextOpen(context);
    const entry = this.entries.get(name);
    if (entry == null || entry.token !== token || entry.status !== "ready") {
      throw sharedStateError(
        "SHARED_STATE_STALE_HANDLE",
        "Shared state handle belongs to a stale generation.",
        { name, currentSeedKey: entry?.seedKey }
      );
    }
    return entry;
  }

  _recordAccess(entry, origin) {
    entry.lastAccessAt = this.now();
    entry.lastAccessedBy = { ...origin };
  }

  _read(name, token, context) {
    const entry = this._resolveHandleEntry(name, token, context);
    const snapshot = JSON.parse(entry.serializedValue);
    this._recordAccess(entry, context.origin);
    return snapshot;
  }

  _mutate(name, token, context, mutator) {
    const entry = this._resolveHandleEntry(name, token, context);
    if (typeof mutator !== "function") {
      throw sharedStateError(
        "SHARED_STATE_INVALID_MUTATOR",
        "Shared state mutator must be a function.",
        { name }
      );
    }

    const draft = JSON.parse(entry.serializedValue);
    const marker = {
      store: this,
      phase: "mutator",
      violation: null,
      meta: { name, currentSeedKey: entry.seedKey },
    };
    let result;
    this.activeMutator = marker;
    try {
      result = this.callbackContext.run(marker, () => mutator(draft));
    } finally {
      this.activeMutator = null;
    }

    if (marker.violation != null) {
      throw marker.violation;
    }
    if (isThenable(result)) {
      // Promise adoption may execute a user-defined `then` asynchronously. Keep that work in
      // the mutator marker too: otherwise a custom thenable could re-enter this or another
      // resource after the synchronous store-wide guard has been released.
      observePromise(this.callbackContext.run(marker, () => Promise.resolve(result)));
      throw sharedStateError(
        "SHARED_STATE_ASYNC_MUTATOR",
        "Shared state mutators must be synchronous.",
        { name, currentSeedKey: entry.seedKey }
      );
    }

    let serialized;
    try {
      serialized = validateAndSerializeJson(draft, { maxDepth: this.limits.maxDepth });
      this._assertSizeLimits(entry, serialized.sizeBytes, entry.sizeBytes);
    } catch (error) {
      throw this._addOperationMetadata(error, entry);
    }
    this._assertEntry(entry, context);
    entry.serializedValue = serialized.serializedValue;
    this.totalBytes = this.totalBytes - entry.sizeBytes + serialized.sizeBytes;
    entry.sizeBytes = serialized.sizeBytes;
    entry.version += 1;
    entry.updatedAt = this.now();
    this._recordAccess(entry, context.origin);
    return result;
  }

  _replace(name, token, context, value) {
    const entry = this._resolveHandleEntry(name, token, context);
    let serialized;
    try {
      serialized = validateAndSerializeJson(value, { maxDepth: this.limits.maxDepth });
      this._assertSizeLimits(entry, serialized.sizeBytes, entry.sizeBytes);
    } catch (error) {
      throw this._addOperationMetadata(error, entry);
    }
    this._assertEntry(entry, context);
    entry.serializedValue = serialized.serializedValue;
    this.totalBytes = this.totalBytes - entry.sizeBytes + serialized.sizeBytes;
    entry.sizeBytes = serialized.sizeBytes;
    entry.version += 1;
    entry.updatedAt = this.now();
    this._recordAccess(entry, context.origin);
    return undefined;
  }

  _addOperationMetadata(error, entry) {
    if (!isSharedStateError(error)) {
      return error;
    }
    error.meta = {
      name: entry.name,
      currentSeedKey: entry.seedKey,
      ...error.meta,
    };
    return error;
  }

  _assertSizeLimits(entry, nextBytes, previousBytes) {
    if (nextBytes > this.limits.maxEntryBytes) {
      throw sharedStateError(
        "SHARED_STATE_ENTRY_TOO_LARGE",
        "Shared state entry exceeds its byte limit.",
        {
          name: entry.name,
          actualBytes: nextBytes,
          limitBytes: this.limits.maxEntryBytes,
        }
      );
    }
    const nextTotal = this.totalBytes - previousBytes + nextBytes;
    if (nextTotal > this.limits.maxTotalBytes) {
      throw sharedStateError(
        "SHARED_STATE_TOTAL_TOO_LARGE",
        "Shared state store exceeds its total byte limit.",
        {
          name: entry.name,
          actualBytes: nextTotal,
          limitBytes: this.limits.maxTotalBytes,
        }
      );
    }
  }

  _invalidateEntry(entry, error) {
    if (entry.invalidationError == null) {
      entry.invalidationError = error;
      entry.invalidationSignal.resolve(error);
    }
    this._clearWaiters(entry);
  }

  closeRequestContext(context) {
    if (context == null || context.closed) {
      return;
    }
    context.closed = true;
    context.closedError = sharedStateError(
      "SHARED_STATE_CONTEXT_CLOSED",
      "Shared state request context is closed."
    );
    context.closeSignal.resolve(context.closedError);

    for (const entry of [...context.waitingEntries]) {
      entry.waiters.delete(context);
      context.waitingEntries.delete(entry);
      if (
        entry.status === "initializing"
        && entry.waiters.size === 0
        && this.entries.get(entry.name) === entry
      ) {
        this.entries.delete(entry.name);
        this._invalidateEntry(entry, context.closedError);
      }
    }
  }

  reset(name) {
    this._assertCallbackAccess();
    this._assertStoreOpen();
    const normalizedName = normalizeSharedStateName(name);
    const entry = this.entries.get(normalizedName);
    if (entry == null) {
      return false;
    }

    this.entries.delete(normalizedName);
    if (entry.status === "ready") {
      this.totalBytes -= entry.sizeBytes;
    } else {
      this._invalidateEntry(entry, sharedStateError(
        "SHARED_STATE_RESET_DURING_INITIALIZATION",
        "Shared state was reset during initialization.",
        { name: entry.name, currentSeedKey: entry.seedKey }
      ));
    }
    return true;
  }

  resetAll() {
    this._assertCallbackAccess();
    this._assertStoreOpen();
    const resetCount = this.entries.size;
    for (const entry of this.entries.values()) {
      if (entry.status === "initializing") {
        this._invalidateEntry(entry, sharedStateError(
          "SHARED_STATE_RESET_DURING_INITIALIZATION",
          "Shared state was reset during initialization.",
          { name: entry.name, currentSeedKey: entry.seedKey }
        ));
      } else {
        this._clearWaiters(entry);
      }
    }
    this.entries.clear();
    this.totalBytes = 0;
    return resetCount;
  }

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const entry of this.entries.values()) {
      if (entry.status === "initializing") {
        this._invalidateEntry(entry, sharedStateError(
          "SHARED_STATE_STORE_CLOSED",
          "Shared state store is closed.",
          { name: entry.name, currentSeedKey: entry.seedKey }
        ));
      } else {
        this._clearWaiters(entry);
      }
    }
    this.entries.clear();
    this.totalBytes = 0;
    this.callbackContext.disable();
  }

  listMetadata() {
    const items = [...this.entries.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => ({
        name: entry.name,
        seedKey: entry.seedKey,
        status: entry.status,
        version: entry.status === "ready" ? entry.version : null,
        sizeBytes: entry.status === "ready" ? entry.sizeBytes : null,
        initializedAt: entry.status === "ready" ? entry.initializedAt : null,
        updatedAt: entry.status === "ready" ? entry.updatedAt : null,
        lastAccessAt: entry.status === "ready" ? entry.lastAccessAt : null,
        initializedBy: { ...entry.initializedBy },
        lastAccessedBy: entry.lastAccessedBy == null ? null : { ...entry.lastAccessedBy },
      }));
    return {
      items,
      totalBytes: this.totalBytes,
      limits: { ...this.limits },
    };
  }
}

module.exports = {
  DEFAULT_SHARED_STATE_LIMITS: DEFAULT_LIMITS,
  SharedStateError,
  SharedStateStore,
  isSharedStateError,
  normalizeSharedStateName,
  validateAndSerializeJson,
};
