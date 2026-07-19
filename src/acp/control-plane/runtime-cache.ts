/** Small touch-aware cache for process-local ACP runtime handles. */
import type {
  AcpRuntime,
  AcpRuntimeHandle,
  AcpRuntimeSessionMode,
} from "@openclaw/acp-core/runtime/types";

/** Cached runtime handle plus the configuration signature that made it reusable. */
export type CachedRuntimeState = {
  runtime: AcpRuntime;
  handle: AcpRuntimeHandle;
  backend: string;
  agent: string;
  mode: AcpRuntimeSessionMode;
  cwd?: string;
  configSignature: string;
  appliedControlSignature?: string;
};

type RuntimeCacheEntry = {
  state: CachedRuntimeState;
  lastTouchedAt: number;
};

/** Snapshot entry used for idle eviction and cache diagnostics. */
type CachedRuntimeSnapshot = {
  actorKey: string;
  state: CachedRuntimeState;
  lastTouchedAt: number;
  idleMs: number;
};

/** Maximum number of cached runtime handles. Prevents unbounded growth under burst traffic. */
const DEFAULT_MAX_CACHE_SIZE = 64;

/** Map-backed cache that tracks last-touch time per actor key. */
export class RuntimeCache {
  private readonly cache = new Map<string, RuntimeCacheEntry>();
  private readonly maxCacheSize: number;

  constructor(params: { maxCacheSize?: number } = {}) {
    this.maxCacheSize = params.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE;
  }

  size(): number {
    return this.cache.size;
  }

  has(actorKey: string): boolean {
    return this.cache.has(actorKey);
  }

  get(
    actorKey: string,
    params: {
      touch?: boolean;
      now?: number;
    } = {},
  ): CachedRuntimeState | null {
    const entry = this.cache.get(actorKey);
    if (!entry) {
      return null;
    }
    if (params.touch !== false) {
      entry.lastTouchedAt = params.now ?? Date.now();
    }
    return entry.state;
  }

  peek(actorKey: string): CachedRuntimeState | null {
    return this.get(actorKey, { touch: false });
  }

  getLastTouchedAt(actorKey: string): number | null {
    return this.cache.get(actorKey)?.lastTouchedAt ?? null;
  }

  set(
    actorKey: string,
    state: CachedRuntimeState,
    params: {
      now?: number;
    } = {},
  ): void {
    if (!this.cache.has(actorKey) && this.cache.size >= this.maxCacheSize) {
      this.evictOldest();
    }
    this.cache.set(actorKey, {
      state,
      lastTouchedAt: params.now ?? Date.now(),
    });
  }

  clear(actorKey: string): void {
    this.cache.delete(actorKey);
  }

  snapshot(params: { now?: number } = {}): CachedRuntimeSnapshot[] {
    const now = params.now ?? Date.now();
    const entries: CachedRuntimeSnapshot[] = [];
    for (const [actorKey, entry] of this.cache.entries()) {
      entries.push({
        actorKey,
        state: entry.state,
        lastTouchedAt: entry.lastTouchedAt,
        idleMs: Math.max(0, now - entry.lastTouchedAt),
      });
    }
    return entries;
  }

  collectIdleCandidates(params: { maxIdleMs: number; now?: number }): CachedRuntimeSnapshot[] {
    if (!Number.isFinite(params.maxIdleMs) || params.maxIdleMs <= 0) {
      return [];
    }
    const now = params.now ?? Date.now();
    return this.snapshot({ now }).filter((entry) => entry.idleMs >= params.maxIdleMs);
  }

  /** Evict the least-recently-touched entry to make room for a new one. */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastTouchedAt < oldestTime) {
        oldestTime = entry.lastTouchedAt;
        oldestKey = key;
      }
    }
    if (oldestKey !== null) {
      this.cache.delete(oldestKey);
    }
  }
}
