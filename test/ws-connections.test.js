const { WsConnectionStore, wsWirePayload } = require("../src/mocks/ws-connections");

// Lo store delle connessioni ws mockate: transcript col suo tetto, push a zero connessioni,
// payload sul filo. I comportamenti "vivi" (socket veri) stanno in ws-serving.test.js.
describe("ws connection store", () => {
  test("wsWirePayload: il JSON viene serializzato, la stringa passa com'è", () => {
    expect(wsWirePayload("ciao")).toBe("ciao");
    expect(wsWirePayload({ tipo: "promo" })).toBe('{"tipo":"promo"}');
    expect(wsWirePayload(42)).toBe("42");
  });

  test("il push a zero connessioni registra comunque il transcript (la regia è avvenuta)", () => {
    const store = new WsConnectionStore();

    const delivered = store.push("GET /api/canale", { tipo: "promo" });

    expect(delivered).toBe(0);
    const transcript = store.listTranscript("GET /api/canale");
    expect(transcript).toHaveLength(1);
    expect(transcript[0]).toMatchObject({ direction: "out", origin: "manual", data: { tipo: "promo" } });
  });

  test("una send che lancia non blocca il broadcast alle altre connessioni", () => {
    const store = new WsConnectionStore();
    const received = [];
    store.register("GET /api/canale", {
      send: () => {
        throw new Error("connessione morente");
      },
      close: () => {},
    });
    const healthy = store.register("GET /api/canale", { send: (text) => received.push(text), close: () => {} });

    const delivered = store.push("GET /api/canale", "avviso");

    expect(delivered).toBe(1);
    expect(received).toEqual(["avviso"]);
    // Il contatore cresce solo dove la consegna è riuscita.
    expect(healthy.messagesSent).toBe(1);
  });

  test("il transcript è uno storico breve: oltre il tetto le voci più vecchie scivolano via", () => {
    const store = new WsConnectionStore();

    for (let i = 1; i <= 130; i += 1) {
      store.record("GET /api/canale", { direction: "in", origin: "received", connectionId: 1, data: `msg-${i}` });
    }

    const transcript = store.listTranscript("GET /api/canale");
    expect(transcript).toHaveLength(100);
    expect(transcript[0].data).toBe("msg-31");
    expect(transcript[99].data).toBe("msg-130");
  });

  test("unregister toglie la connessione dall'elenco senza toccare il transcript", () => {
    const store = new WsConnectionStore();
    const connection = store.register("GET /api/canale", { send: () => {}, close: () => {} });
    store.record("GET /api/canale", { direction: "in", origin: "received", connectionId: connection.id, data: "ciao" });

    store.unregister("GET /api/canale", connection.id);

    expect(store.listConnections("GET /api/canale")).toEqual([]);
    expect(store.listTranscript("GET /api/canale")).toHaveLength(1);
  });
});
