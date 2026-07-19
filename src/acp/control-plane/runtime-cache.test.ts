/** Tests runtime cache touch semantics and idle-candidate collection. */
import type { AcpRuntime } from "@openclaw/acp-core/runtime/types";
import type { AcpRuntimeHandle } from "@openclaw/acp-core/runtime/types";
import { describe, expect, it } from "vitest";
import type { CachedRuntimeState } from "./runtime-cache.js";
import { RuntimeCache } from "./runtime-cache.js";

function mockState(sessionKey: string): CachedRuntimeState {
  const runtime = {
    async ensureSession() {
      return {
        sessionKey,
        backend: "acpx",
        runtimeSessionName: `runtime:${sessionKey}`,
      };
    },
    async *runTurn() {
      yield { type: "done" as const };
    },
    async cancel() { },
    async close() { },
  } satisfies AcpRuntime;
  return {
    runtime,
    handle: {
      sessionKey,
      backend: "acpx",
      runtimeSessionName: `runtime:${sessionKey}`,
    } as AcpRuntimeHandle,
    backend: "acpx",
    agent: "codex",
    mode: "persistent",
    configSignature: "config:test",
  };
}

describe("RuntimeCache", () => {
  it("tracks idle candidates with touch-aware lookups", () => {
    const cache = new RuntimeCache();
    const actor = "agent:codex:acp:s1";
    cache.set(actor, mockState(actor), { now: 1_000 });

    expect(cache.collectIdleCandidates({ maxIdleMs: 1_000, now: 1_999 })).toHaveLength(0);
    expect(cache.collectIdleCandidates({ maxIdleMs: 1_000, now: 2_000 })).toHaveLength(1);

    cache.get(actor, { now: 2_500 });
    expect(cache.collectIdleCandidates({ maxIdleMs: 1_000, now: 3_200 })).toHaveLength(0);
    expect(cache.collectIdleCandidates({ maxIdleMs: 1_000, now: 3_500 })).toHaveLength(1);
  });

  it("returns snapshot entries with idle durations", () => {
    const cache = new RuntimeCache();
    cache.set("a", mockState("a"), { now: 10 });
    cache.set("b", mockState("b"), { now: 100 });

    const snapshot = cache.snapshot({ now: 1_100 });
    const byActor = new Map(snapshot.map((entry) => [entry.actorKey, entry]));
    expect(byActor.get("a")?.idleMs).toBe(1_090);
    expect(byActor.get("b")?.idleMs).toBe(1_000);
  });

  it("evicts least-recently-touched entry when maxCacheSize is reached", () => {
    const cache = new RuntimeCache({ maxCacheSize: 3 });
    cache.set("a", mockState("a"), { now: 100 });
    cache.set("b", mockState("b"), { now: 200 });
    cache.set("c", mockState("c"), { now: 300 });

    expect(cache.size()).toBe(3);

    // Touch "a" so it is no longer the oldest
    cache.get("a", { now: 400 });

    // Adding "d" should evict "b" (least-recently-touched)
    cache.set("d", mockState("d"), { now: 500 });
    expect(cache.size()).toBe(3);
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
    expect(cache.has("d")).toBe(true);
  });

  it("does not evict when updating an existing key at maxCacheSize", () => {
    const cache = new RuntimeCache({ maxCacheSize: 2 });
    cache.set("a", mockState("a"), { now: 100 });
    cache.set("b", mockState("b"), { now: 200 });

    // Re-setting an existing key does not grow the cache
    cache.set("a", mockState("a-updated"), { now: 300 });
    expect(cache.size()).toBe(2);
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(true);
  });
});
