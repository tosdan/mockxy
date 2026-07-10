const { sortAdminItems } = require("../src/admin/collections-state");

// Copre il fallback canonico di sortAdminItems: quando un item non ha un indice persistito
// nel childOrder (es. configFilePath non normalizzato), l'ordinamento deve restare
// deterministico: path, poi method, poi configFilePath.
describe("sortAdminItems", () => {
  function createEmptyCollectionState() {
    return { collections: [], memberships: {}, childOrder: {} };
  }

  test("senza indice persistito ricade sull'ordinamento canonico path → method → configFilePath", () => {
    // I path con prefisso "./" non coincidono con i ref normalizzati del childOrder,
    // quindi nessun item trova il proprio indice persistito.
    const items = [
      { method: "POST", path: "/beta", configFilePath: "./beta/POST.endpoint.json" },
      { method: "GET", path: "/beta", configFilePath: "./beta/GET.endpoint.json" },
      { method: "GET", path: "/alpha", configFilePath: "./alpha/GET.endpoint.json" },
      { method: "GET", path: "/same", configFilePath: "./same-second/GET.endpoint.json" },
      { method: "GET", path: "/same", configFilePath: "./same-first/GET.endpoint.json" },
    ];

    const sorted = sortAdminItems(items, createEmptyCollectionState());

    expect(sorted.map((item) => item.configFilePath)).toEqual([
      "./alpha/GET.endpoint.json",
      "./beta/GET.endpoint.json",
      "./beta/POST.endpoint.json",
      "./same-first/GET.endpoint.json",
      "./same-second/GET.endpoint.json",
    ]);
  });

  test("un item con indice persistito precede gli item senza indice", () => {
    // "zeta/..." è già normalizzato e trova il proprio indice nel childOrder risolto;
    // "./alpha/..." no, quindi finisce dopo nonostante preceda alfabeticamente.
    const items = [
      { method: "GET", path: "/alpha", configFilePath: "./alpha/GET.endpoint.json" },
      { method: "GET", path: "/zeta", configFilePath: "zeta/GET.endpoint.json" },
    ];

    const sorted = sortAdminItems(items, createEmptyCollectionState());

    expect(sorted.map((item) => item.configFilePath)).toEqual([
      "zeta/GET.endpoint.json",
      "./alpha/GET.endpoint.json",
    ]);
  });
});
