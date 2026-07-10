const { createServerPool } = require("../electron/server-pool");

// launch finto: registra le chiamate e restituisce un runtime con shutdown tracciabile.
function makeFakeLaunch() {
  const launched = [];
  const shutdownCalls = [];
  let port = 4000;
  const launch = async (root) => {
    launched.push(root);
    port += 1;
    return {
      runtime: { shutdown: async () => shutdownCalls.push(root) },
      port,
      url: `http://127.0.0.1:${port}/_admin/ui/`,
    };
  };
  return { launch, launched, shutdownCalls };
}

describe("server-pool (più motori insieme)", () => {
  test("open avvia un motore e lo traccia", async () => {
    const { launch, launched } = makeFakeLaunch();
    const pool = createServerPool({ launch });

    const entry = await pool.open("/ws/a");
    expect(launched).toEqual(["/ws/a"]);
    expect(entry.root).toBe("/ws/a");
    expect(typeof entry.port).toBe("number");
    expect(pool.has("/ws/a")).toBe(true);
    expect(pool.list().map((e) => e.root)).toEqual(["/ws/a"]);
  });

  test("aprire due volte lo stesso workspace non duplica il motore", async () => {
    const { launch, launched } = makeFakeLaunch();
    const pool = createServerPool({ launch });

    const first = await pool.open("/ws/a");
    const second = await pool.open("/ws/a");
    expect(launched).toEqual(["/ws/a"]);
    expect(second).toBe(first);
    expect(pool.list()).toHaveLength(1);
  });

  test("più workspace girano insieme su porte diverse", async () => {
    const { launch } = makeFakeLaunch();
    const pool = createServerPool({ launch });

    const a = await pool.open("/ws/a");
    const b = await pool.open("/ws/b");
    expect(pool.list().map((e) => e.root).sort()).toEqual(["/ws/a", "/ws/b"]);
    expect(a.port).not.toBe(b.port);
  });

  test("close spegne il motore e lo toglie dal pool", async () => {
    const { launch, shutdownCalls } = makeFakeLaunch();
    const pool = createServerPool({ launch });

    await pool.open("/ws/a");
    await pool.open("/ws/b");
    const closed = await pool.close("/ws/a");

    expect(closed).toBe(true);
    expect(shutdownCalls).toEqual(["/ws/a"]);
    expect(pool.has("/ws/a")).toBe(false);
    expect(pool.list().map((e) => e.root)).toEqual(["/ws/b"]);
  });

  test("close di un workspace non aperto è un no-op", async () => {
    const { launch } = makeFakeLaunch();
    const pool = createServerPool({ launch });
    expect(await pool.close("/ws/ignoto")).toBe(false);
  });

  test("closeAll spegne tutti i motori", async () => {
    const { launch, shutdownCalls } = makeFakeLaunch();
    const pool = createServerPool({ launch });

    await pool.open("/ws/a");
    await pool.open("/ws/b");
    await pool.closeAll();

    expect(shutdownCalls.sort()).toEqual(["/ws/a", "/ws/b"]);
    expect(pool.list()).toEqual([]);
  });
});
