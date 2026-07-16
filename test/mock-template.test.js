const {
  createTemplateContext,
  renderTemplateString,
  renderTemplateValue,
  renderTemplateHeaders,
  templateReferencesRequestBody,
} = require("../src/mocks/mock-template");

function context(overrides = {}) {
  return createTemplateContext({
    params: { id: "42", slug: "mario-rossi" },
    query: { ruolo: "admin", tags: ["a", "b"] },
    headers: { "x-tenant": "acme" },
    jsonBody: { utente: { email: "ada@example.com" }, extra: { nested: [1, 2] } },
    now: () => 1784000000000,
    uuid: () => "uuid-fisso",
    random: () => 0.5,
    ...overrides,
  });
}

describe("mock-template (placeholder nei mock statici)", () => {
  describe("sorgenti della richiesta", () => {
    test("params, query, headers e body con percorso a punti", () => {
      const ctx = context();
      expect(renderTemplateString("Utente {{params.id}}", ctx)).toBe("Utente 42");
      expect(renderTemplateString("{{query.ruolo}}", ctx)).toBe("admin");
      expect(renderTemplateString("{{headers.x-tenant}}", ctx)).toBe("acme");
      expect(renderTemplateString("{{body.utente.email}}", ctx)).toBe("ada@example.com");
    });

    test("header con nome in qualunque case (i nomi sono normalizzati in minuscolo)", () => {
      expect(renderTemplateString("{{headers.X-Tenant}}", context())).toBe("acme");
    });

    test("query ripetuta: vale il primo valore", () => {
      expect(renderTemplateString("{{query.tags}}", context())).toBe("a");
    });

    test("più placeholder nella stessa stringa", () => {
      expect(renderTemplateString("{{params.id}}-{{query.ruolo}}", context())).toBe("42-admin");
    });
  });

  describe("helper generati", () => {
    test("now, nowMs, uuid e randomInt (deterministici col contesto di test)", () => {
      const ctx = context();
      expect(renderTemplateString("{{now}}", ctx)).toBe(new Date(1784000000000).toISOString());
      expect(renderTemplateString("{{nowMs}}", ctx)).toBe("1784000000000");
      expect(renderTemplateString("{{uuid}}", ctx)).toBe("uuid-fisso");
      // random 0.5 su [1,10] → 1 + floor(0.5 * 10) = 6
      expect(renderTemplateString("{{randomInt 1 10}}", ctx)).toBe("6");
    });

    test("randomInt con argomenti invalidi non risolve", () => {
      const warnings = [];
      expect(renderTemplateString("{{randomInt 10 1}}", context(), (w) => warnings.push(w))).toBe("");
      expect(renderTemplateString("{{randomInt 1}}", context(), (w) => warnings.push(w))).toBe("");
      expect(warnings).toHaveLength(2);
    });
  });

  describe("filtro dei tipi (nodo intero)", () => {
    test("number: il nodo diventa numerico; non numerico → null", () => {
      expect(renderTemplateString("{{params.id | number}}", context())).toBe(42);
      expect(renderTemplateString("{{params.slug | number}}", context())).toBeNull();
    });

    test("boolean: true/1 e false/0; altro → null", () => {
      const ctx = context({ query: { attivo: "true", spento: "0", boh: "forse" } });
      expect(renderTemplateString("{{query.attivo | boolean}}", ctx)).toBe(true);
      expect(renderTemplateString("{{query.spento | boolean}}", ctx)).toBe(false);
      expect(renderTemplateString("{{query.boh | boolean}}", ctx)).toBeNull();
    });

    test("json: il sotto-albero del body così com'è", () => {
      expect(renderTemplateString("{{body.extra | json}}", context())).toEqual({ nested: [1, 2] });
    });

    test("il filtro immerso nel testo resta testuale", () => {
      expect(renderTemplateString("id={{params.id | number}}!", context())).toBe("id=42!");
    });

    test("filtro sconosciuto: non risolve, con warning", () => {
      const warnings = [];
      expect(renderTemplateString("{{params.id | upper}}", context(), (w) => warnings.push(w))).toBeNull();
      expect(warnings).toEqual(["params.id | upper"]);
    });
  });

  describe("mancanti, escape e casi limite", () => {
    test("placeholder non risolto: stringa vuota + warning; con filtro → null", () => {
      const warnings = [];
      expect(renderTemplateString("[{{query.assente}}]", context(), (w) => warnings.push(w))).toBe("[]");
      expect(renderTemplateString("{{query.assente | number}}", context(), (w) => warnings.push(w))).toBeNull();
      expect(warnings).toEqual(["query.assente", "query.assente | number"]);
    });

    test("sorgente sconosciuta ed espressione vuota non risolvono", () => {
      const warnings = [];
      expect(renderTemplateString("{{cookie.x}}", context(), (w) => warnings.push(w))).toBe("");
      expect(renderTemplateString("{{}}", context(), (w) => warnings.push(w))).toBe("");
      expect(warnings).toHaveLength(2);
    });

    test("escape: \\{{ produce {{ letterale, senza sostituzione", () => {
      expect(renderTemplateString("doc: \\{{params.id}}", context())).toBe("doc: {{params.id}}");
    });

    test("stringa senza placeholder passa intatta", () => {
      expect(renderTemplateString("nessun template", context())).toBe("nessun template");
    });

    test("un oggetto del body immerso nel testo viene serializzato", () => {
      expect(renderTemplateString("extra: {{body.extra}}", context())).toBe('extra: {"nested":[1,2]}');
    });
  });

  describe("renderTemplateValue (body JSON)", () => {
    test("attraversa oggetti e array sostituendo solo le stringhe", () => {
      const rendered = renderTemplateValue(
        {
          id: "{{params.id | number}}",
          nome: "Utente {{params.id}}",
          fisso: 7,
          nullo: null,
          lista: ["{{query.ruolo}}", { attivo: "{{query.attivo | boolean}}" }],
        },
        context({ query: { ruolo: "admin", attivo: "1" } }),
      );
      expect(rendered).toEqual({
        id: 42,
        nome: "Utente 42",
        fisso: 7,
        nullo: null,
        lista: ["admin", { attivo: true }],
      });
    });

    test("non muta l'originale", () => {
      const original = { nome: "{{params.id}}" };
      renderTemplateValue(original, context());
      expect(original).toEqual({ nome: "{{params.id}}" });
    });
  });

  describe("renderTemplateHeaders", () => {
    test("templa i valori stringa (sempre testuali) e lascia il resto", () => {
      const rendered = renderTemplateHeaders(
        { location: "/api/utenti/{{params.id}}", "x-fisso": 5, "x-multi": ["{{query.ruolo}}", "b"] },
        context(),
      );
      expect(rendered).toEqual({ location: "/api/utenti/42", "x-fisso": 5, "x-multi": ["admin", "b"] });
    });
  });

  describe("jsonBody pigro e scansione statica", () => {
    test("il body della richiesta viene letto solo se referenziato", () => {
      let reads = 0;
      const lazyContext = createTemplateContext({
        params: { id: "1" },
        jsonBody: () => {
          reads += 1;
          return { x: "y" };
        },
      });
      renderTemplateString("{{params.id}}", lazyContext);
      expect(reads).toBe(0);
      renderTemplateString("{{body.x}}", lazyContext);
      renderTemplateString("{{body.x}}", lazyContext);
      expect(reads).toBe(1); // memoizzato
    });

    test("templateReferencesRequestBody trova body. in profondità", () => {
      expect(templateReferencesRequestBody({ a: ["{{body.x}}"] })).toBe(true);
      expect(templateReferencesRequestBody({ a: "{{params.id}}", b: 3 })).toBe(false);
      expect(templateReferencesRequestBody("testo con {{ body.x }}")).toBe(true);
    });
  });
});
