import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type MageConfig } from "../src/config";
import { resetSessionStore } from "../src/session/store";
import { SqliteSessionStore } from "../src/session/sqlite";

const sqliteConfig = (): MageConfig => {
  const dir = mkdtempSync(join(tmpdir(), "mage-sess-"));
  return {
    ...loadConfig(),
    sessionStore: "sqlite",
    sessionPath: join(dir, "sessions.sqlite"),
  };
};

describe("session store sqlite", () => {
  const stores: SqliteSessionStore[] = [];

  const open = (): SqliteSessionStore => {
    const store = new SqliteSessionStore(sqliteConfig());
    stores.push(store);
    return store;
  };

  beforeEach(() => {
    resetSessionStore();
  });

  afterEach(() => {
    for (const s of stores) {
      try {
        s.close();
      } catch {
        // ya cerrado
      }
    }
    stores.length = 0;
    resetSessionStore();
  });

  test("create y append turnos", () => {
    const store = open();
    const s = store.create();
    expect(s.turns).toHaveLength(0);
    const t = store.append(s.id, "user", "hola");
    expect(t?.content).toBe("hola");
    expect(store.get(s.id)?.turns).toHaveLength(1);
  });

  test("trim mantiene últimos N turnos", () => {
    const store = open();
    const s = store.create();
    for (let i = 0; i < 5; i++) store.append(s.id, "user", `msg${i}`);
    store.trim(s.id, 3);
    expect(store.get(s.id)?.turns).toHaveLength(3);
    expect(store.get(s.id)?.turns[0]?.content).toBe("msg2");
  });

  test("delete elimina sesión", () => {
    const store = open();
    const s = store.create();
    expect(store.delete(s.id)).toBe(true);
    expect(store.get(s.id)).toBeNull();
  });

  test("list y count", () => {
    const store = open();
    store.create();
    store.create();
    expect(store.count()).toBe(2);
    expect(store.list()).toHaveLength(2);
  });

  test("persiste_tras_reopen", () => {
    const cfg = sqliteConfig();
    const a = new SqliteSessionStore(cfg);
    const s = a.create();
    a.append(s.id, "user", "hola persistente");
    a.close();

    const b = new SqliteSessionStore(cfg);
    stores.push(b);
    const got = b.get(s.id);
    expect(got?.turns).toHaveLength(1);
    expect(got?.turns[0]?.content).toBe("hola persistente");
  });

  test("compact persiste summary y últimos K", () => {
    const store = open();
    const s = store.create({ tenantId: "acme" });
    for (let i = 0; i < 10; i++) {
      store.append(s.id, "user", `u${i}`);
      store.append(s.id, "assistant", `a${i}`, {
        status: "answered",
        factIds: i === 0 ? ["fact-old"] : [],
        evidenceIds: [`ev-${i}`],
      });
    }
    store.compact(s.id, 8, 6);
    const got = store.get(s.id, "acme");
    expect(got?.turns.length).toBe(6);
    expect(got?.summary?.factIds).toContain("fact-old");
    expect(got?.summary?.lastStatus).toBe("answered");
    expect(got?.summary?.lastEvidenceIds.length).toBeGreaterThan(0);
    expect(store.get(s.id, "otro")).toBeNull();
  });
});
