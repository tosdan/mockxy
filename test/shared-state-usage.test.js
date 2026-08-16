const { findLiteralSharedStateReferences } = require("../src/mocks/shared-state-usage");

describe("findLiteralSharedStateReferences", () => {
  test("trova, canonicalizza e ordina chiamate dirette con literal statici", () => {
    const source = `
      sharedState.open("Items", {});
      sharedState . open ( 'orders.v2', {} );
      sharedState.open(\`catalog-items\`, {});
      sharedState.open("Items", {});
    `;
    expect(findLiteralSharedStateReferences(source)).toEqual([
      "catalog-items",
      "items",
      "orders.v2",
    ]);
  });

  test("ignora nomi dinamici, alias e literal non validi senza eseguire il sorgente", () => {
    const source = `
      sharedState.open(resourceName, {});
      const open = sharedState.open; open("hidden", {});
      sharedState.open(\`items-\${version}\`, {});
      sharedState.open("../invalid", {});
      throw new Error("must never run");
    `;
    expect(findLiteralSharedStateReferences(source)).toEqual([]);
  });
});
