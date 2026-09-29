import type { RuntimeConfigState, RuntimeConfigValues } from '../mock-admin-api.types';

export const STARTUP_CONFIG: RuntimeConfigValues = {
  backendUrl: 'http://localhost:8080',
  proxyFallbackEnabled: true,
  corsEnabled: false,
  delayAllRequests: false,
  caseInsensitiveFilters: true,
  adaptProxyCookies: true,
  rewriteProxyRedirects: true,
  globalDelayMs: 0,
  requestTimeoutMs: 15000,
};

/** Risposta di GET /config con gli override indicati applicati ai valori di avvio. */
export function runtimeConfigState(overrides: Partial<RuntimeConfigValues> = {}): RuntimeConfigState {
  return {
    runtimeId: 'runtime-1',
    startup: { ...STARTUP_CONFIG },
    effective: { ...STARTUP_CONFIG, ...overrides },
    overrides: { ...overrides },
    persisted: false,
  };
}
