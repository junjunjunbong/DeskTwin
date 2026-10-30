import { execFile } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  HardwareAmbiguousIdentitySchema,
  MAX_AMBIGUOUS_HARDWARE_IDENTITIES,
  type HardwareAmbiguousIdentity,
  type HardwareDevice,
  type HardwareSnapshot,
} from '../src/domain/hardware';

const categories = ['display', 'usb', 'bluetooth'] as const;
const NativeCategorySchema = z.strictObject({
  state: z.enum(['ok', 'unavailable', 'permission-denied', 'error']),
  source: z.string().max(160),
  message: z.string().max(500),
});
export const NativeSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  categories: z.strictObject({
    display: NativeCategorySchema,
    usb: NativeCategorySchema,
    bluetooth: NativeCategorySchema,
  }),
  devices: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(100),
        category: z.enum(categories),
        name: z.string().min(1).max(160),
        model: z.string().max(160),
        // A native HMAC, never a serial number or an unkeyed serial hash.
        fingerprint: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable()
          .default(null),
        source: z.string().max(160),
        status: z.enum(['online', 'connected', 'paired']),
        parentId: z.string().max(100).nullable().default(null),
        attributes: z
          .array(z.strictObject({ label: z.string().max(80), value: z.string().max(240) }))
          .max(20),
      }),
    )
    .max(512),
});
export type NativeSnapshot = z.infer<typeof NativeSnapshotSchema>;

export class HardwareProbeError extends Error {
  constructor(
    readonly state: 'unavailable' | 'permission-denied' | 'error',
    message: string,
  ) {
    super(message);
  }
}

/** Monotonic trust evidence. It never stores raw fingerprints, serials or names. */
export interface HardwareIdentityQuarantine {
  remember(
    scope: string,
    additions: readonly HardwareAmbiguousIdentity[],
  ): Promise<HardwareAmbiguousIdentity[]>;
}

const IdentityScopeSchema = z.string().regex(/^[a-zA-Z0-9_-]{8,160}$/);
const QuarantinedIdentitySchema = HardwareAmbiguousIdentitySchema.extend({
  key: z.string().regex(/^hw_[a-f0-9]{64}$/),
});
const QuarantinedIdentitiesSchema = z
  .array(QuarantinedIdentitySchema)
  .max(MAX_AMBIGUOUS_HARDWARE_IDENTITIES);
const identityKey = (entry: HardwareAmbiguousIdentity) => `${entry.category}:${entry.key}`;
const publicIdentityKey = (category: string, fingerprint: string) =>
  `hw_${createHash('sha256').update(`${category}:${fingerprint}`).digest('hex')}`;

function quarantineFailure(): HardwareProbeError {
  return new HardwareProbeError(
    'unavailable',
    'The local hardware identity trust history could not be safely read or saved. Device presence is unknown. Check local-data permissions.',
  );
}

/** Safe default for dependency-injected probes: fixture scans never touch disk. */
export function createMemoryIdentityQuarantine(): HardwareIdentityQuarantine {
  const scopes = new Map<string, Map<string, HardwareAmbiguousIdentity>>();
  return {
    async remember(scope, additions) {
      IdentityScopeSchema.parse(scope);
      const known = new Map(scopes.get(scope));
      for (const entry of QuarantinedIdentitiesSchema.parse(additions))
        known.set(identityKey(entry), entry);
      if (known.size > MAX_AMBIGUOUS_HARDWARE_IDENTITIES) throw quarantineFailure();
      scopes.set(scope, known);
      return structuredClone([...known.values()]);
    },
  };
}

/**
 * One empty, exclusive marker per opaque identity: concurrent bridge instances
 * cannot overwrite each other's evidence, and a partial write cannot lose it.
 * The directory is fixed by trusted application code, never an HTTP input.
 */
export function createFileIdentityQuarantine(directory: string): HardwareIdentityQuarantine {
  async function privateDirectory(path: string) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const stat = await lstat(path);
    if (
      !stat.isDirectory() ||
      (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw quarantineFailure();
  }
  return {
    async remember(scope, additions) {
      try {
        IdentityScopeSchema.parse(scope);
        const entries = QuarantinedIdentitiesSchema.parse(additions);
        await privateDirectory(directory);
        const scopedDirectory = resolve(directory, scope);
        await privateDirectory(scopedDirectory);
        const readMarkers = async () => {
          const files = await readdir(scopedDirectory, { withFileTypes: true });
          if (files.length > MAX_AMBIGUOUS_HARDWARE_IDENTITIES) throw quarantineFailure();
          const known: HardwareAmbiguousIdentity[] = [];
          for (const file of files) {
            const match = /^(display|usb|bluetooth)_(hw_[a-f0-9]{64})$/.exec(file.name);
            if (!match || !file.isFile()) throw quarantineFailure();
            const stat = await lstat(resolve(scopedDirectory, file.name));
            if (
              !stat.isFile() ||
              stat.size !== 0 ||
              (stat.mode & 0o077) !== 0 ||
              (process.getuid && stat.uid !== process.getuid())
            )
              throw quarantineFailure();
            known.push(QuarantinedIdentitySchema.parse({ category: match[1], key: match[2] }));
          }
          return known;
        };
        const known = new Map((await readMarkers()).map((entry) => [identityKey(entry), entry]));
        for (const entry of entries) known.set(identityKey(entry), entry);
        if (known.size > MAX_AMBIGUOUS_HARDWARE_IDENTITIES) throw quarantineFailure();
        for (const entry of entries) {
          try {
            await writeFile(resolve(scopedDirectory, `${entry.category}_${entry.key}`), '', {
              flag: 'wx',
              mode: 0o600,
            });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          }
        }
        // Re-read after appending, including identities written by another tab
        // or bridge instance. Never prune entries merely because a device left.
        return await readMarkers();
      } catch {
        throw quarantineFailure();
      }
    },
  };
}

export interface HardwareProbe {
  platform: string;
  quarantine?: HardwareIdentityQuarantine;
  availability(): Promise<{
    available: boolean;
    message: string;
    failureState?: 'unavailable' | 'permission-denied';
  }>;
  scope(): Promise<string>;
  read(signal: AbortSignal): Promise<unknown>;
}

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

/** Only the reviewed, locally built executable is runnable. No request selects code or argv. */
export function createNativeProbe(): HardwareProbe {
  const executable = resolve(repositoryRoot, 'build/desktwin-hardware-probe');
  const keyFile = resolve(repositoryRoot, 'local-data/hardware-identity.key');
  let keyPromise: Promise<Buffer> | undefined;
  async function identityKey(): Promise<Buffer> {
    if (!keyPromise) {
      keyPromise = (async () => {
        await mkdir(resolve(repositoryRoot, 'local-data'), { recursive: true, mode: 0o700 });
        try {
          await writeFile(keyFile, randomBytes(32), { flag: 'wx', mode: 0o600 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        const key = await readFile(keyFile);
        if (key.length !== 32) throw new Error('Invalid local key');
        return key;
      })().catch(() => {
        keyPromise = undefined;
        throw new HardwareProbeError(
          'unavailable',
          'The local hardware identity key could not be initialized. Check local-data permissions.',
        );
      });
    }
    return keyPromise;
  }
  return {
    platform: process.platform,
    quarantine: createFileIdentityQuarantine(
      resolve(repositoryRoot, 'local-data/hardware-identity-collisions'),
    ),
    async availability() {
      if (process.platform !== 'darwin')
        return {
          available: false,
          message: 'Hardware detection requires macOS. This server is not running on a Mac.',
        };
      try {
        await access(executable, constants.X_OK);
        return {
          available: true,
          message: 'Read-only macOS helper is available. Detection starts only after your consent.',
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EACCES')
          return {
            available: false,
            failureState: 'permission-denied',
            message:
              'Permission to run the native hardware helper was denied. Check the executable permissions.',
          };
        return {
          available: false,
          message: 'Build the local macOS helper with npm run hardware:build, then try again.',
        };
      }
    },
    async scope() {
      return `installation_${createHmac('sha256', await identityKey())
        .update('DeskTwin local identity scope v1')
        .digest('hex')}`;
    },
    async read(signal) {
      if (process.platform !== 'darwin')
        throw new HardwareProbeError('unavailable', 'Hardware detection requires macOS.');
      const key = await identityKey();
      if (signal.aborted) throw new HardwareProbeError('unavailable', 'Detection stopped.');
      return new Promise((resolveResult, reject) => {
        const child = execFile(
          executable,
          [],
          {
            encoding: 'utf8',
            timeout: 8000,
            maxBuffer: 1024 * 1024,
            signal,
            env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' },
          },
          (error, stdout) => {
            if (error) {
              const code = (error as NodeJS.ErrnoException).code;
              reject(
                new HardwareProbeError(
                  code === 'EACCES' ? 'permission-denied' : 'unavailable',
                  code === 'ENOENT'
                    ? 'The native helper is missing. Run npm run hardware:build on this Mac.'
                    : code === 'EACCES'
                      ? 'Permission to run the native hardware helper was denied.'
                      : 'The native hardware helper stopped, timed out, or could not be read. Device presence is unknown.',
                ),
              );
              return;
            }
            try {
              resolveResult(JSON.parse(stdout));
            } catch {
              reject(
                new HardwareProbeError(
                  'error',
                  'The native helper returned an invalid snapshot. Device presence is unknown.',
                ),
              );
            }
          },
        );
        // Prevent an early child exit from emitting an unhandled EPIPE.
        child.stdin?.on('error', () => undefined);
        child.stdin?.end(key.toString('base64') + '\n');
      });
    },
  };
}

interface Session {
  token: string;
  origin: string;
  sessionId: string;
  enabled: boolean;
  // Explicit Stop permanently revokes this capability's authority to start.
  // Read-only stopped snapshots remain available until the token is reclaimed.
  revoked: boolean;
  expiresAt: number;
  touchedAt: number;
  snapshot: HardwareSnapshot;
  transient: Map<string, string>;
  lastReadAt: number;
  controller?: AbortController;
  pending?: Promise<HardwareSnapshot>;
  generation: number;
}

export class HardwareRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function emptySnapshot(
  sessionId: string,
  message = 'Detection stopped. Device presence is unknown.',
): HardwareSnapshot {
  return {
    state: 'stopped',
    sessionId,
    identityScope: null,
    lastCheckedAt: null,
    message,
    categories: Object.fromEntries(
      categories.map((category) => [
        category,
        {
          state: 'unavailable',
          source:
            category === 'display'
              ? 'macOS CoreGraphics + AppKit NSScreen'
              : category === 'usb'
                ? 'macOS IOKit IOService USB registry'
                : 'Not collected',
          lastCheckedAt: null,
          message: category === 'bluetooth' ? 'Bluetooth detection is not implemented.' : message,
        },
      ]),
    ) as HardwareSnapshot['categories'],
    devices: [],
    ambiguousIdentities: [],
  };
}

/** Per-tab opt-in leases. Polling drives reads; no scan runs while all tabs are idle/stopped. */
export class HardwareService {
  private readonly sessions = new Map<string, Session>();
  private readonly now: () => number;
  private readonly leaseMs: number;
  private readonly minPollMs: number;
  private readonly quarantine: HardwareIdentityQuarantine;
  private readonly ambiguousIdentities = new Map<string, Map<string, HardwareAmbiguousIdentity>>();
  private reads = 0;
  constructor(
    readonly probe: HardwareProbe = createNativeProbe(),
    options: {
      now?: () => number;
      leaseMs?: number;
      minPollMs?: number;
      quarantine?: HardwareIdentityQuarantine;
    } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.leaseMs = options.leaseMs ?? 20000;
    this.minPollMs = options.minPollMs ?? 4000;
    this.quarantine = options.quarantine ?? probe.quarantine ?? createMemoryIdentityQuarantine();
  }
  private async rememberAmbiguity(scope: string, additions: HardwareAmbiguousIdentity[]) {
    const known =
      this.ambiguousIdentities.get(scope) ?? new Map<string, HardwareAmbiguousIdentity>();
    for (const entry of QuarantinedIdentitiesSchema.parse(additions))
      known.set(identityKey(entry), entry);
    this.ambiguousIdentities.set(scope, known);
    // Learning that trust is invalid does not depend on successfully saving it.
    // Retain this evidence and invalidate other caches even if persistence fails.
    this.invalidateAmbiguousCaches(scope, known);
    for (;;) {
      if (known.size > MAX_AMBIGUOUS_HARDWARE_IDENTITIES) throw quarantineFailure();
      const pending = [...known.values()];
      const persisted = QuarantinedIdentitiesSchema.parse(
        await this.quarantine.remember(scope, pending),
      );
      const persistedKeys = new Set(persisted.map(identityKey));
      if (pending.some((entry) => !persistedKeys.has(identityKey(entry))))
        throw quarantineFailure();
      for (const entry of persisted) known.set(identityKey(entry), entry);
      this.invalidateAmbiguousCaches(scope, known);
      // A concurrent scan can add evidence during the await. Retry the complete
      // union until it is persisted; recovery from a failed write must also save
      // the earlier collision even when only one indistinguishable device remains.
      if ([...known.keys()].every((key) => persistedKeys.has(key))) return;
    }
  }
  private invalidateAmbiguousCaches(scope: string, known: Map<string, HardwareAmbiguousIdentity>) {
    for (const session of this.sessions.values())
      if (
        session.snapshot.state === 'running' &&
        session.snapshot.identityScope === scope &&
        session.snapshot.devices.some(
          (device) =>
            device.identity.stability === 'persistent' &&
            known.has(identityKey({ category: device.category, key: device.identity.key })),
        )
      )
        // Do not let another tab's cache revive an identity whose uniqueness was
        // disproved. Its next authorized poll must obtain session observations.
        session.lastReadAt = -Infinity;
  }
  private expire() {
    for (const [token, session] of this.sessions) {
      if (session.enabled && session.expiresAt < this.now())
        this.stopSession(
          session,
          'Detection stopped because this tab stopped checking. Enable detection again.',
        );
      if (this.now() - session.touchedAt > 30 * 60000) {
        this.stopSession(session);
        this.sessions.delete(token);
      }
    }
  }
  async createSession(origin: string) {
    this.expire();
    // Reloaded/closed tabs leave only capability tokens. Reclaim an inactive
    // token before refusing a new tab; never evict someone else's active scan.
    if (this.sessions.size >= 16) {
      const inactive = [...this.sessions.values()]
        .filter((session) => !session.enabled)
        .sort((a, b) => a.touchedAt - b.touchedAt)[0];
      if (inactive) this.sessions.delete(inactive.token);
    }
    if (this.sessions.size >= 16)
      throw new HardwareRequestError(
        429,
        'Too many hardware sessions. Close unused tabs and try again later.',
      );
    const token = randomBytes(32).toString('hex');
    const sessionId = `session_${randomUUID()}`;
    this.sessions.set(token, {
      token,
      origin,
      sessionId,
      enabled: false,
      revoked: false,
      expiresAt: 0,
      touchedAt: this.now(),
      snapshot: emptySnapshot(sessionId),
      transient: new Map(),
      lastReadAt: -Infinity,
      generation: 0,
    });
    const availability = await this.probe.availability();
    return {
      token,
      platform: this.probe.platform,
      available: availability.available,
      message: availability.message,
    };
  }
  private get(token: string, origin: string) {
    this.expire();
    const session = this.sessions.get(token);
    if (!session || session.origin !== origin)
      throw new HardwareRequestError(
        403,
        'The local hardware session is invalid. Reopen the hardware panel.',
      );
    session.touchedAt = this.now();
    return session;
  }
  async start(token: string, origin: string) {
    const session = this.get(token, origin);
    if (session.revoked)
      throw new HardwareRequestError(
        403,
        'Detection was stopped. Request a new local hardware session before starting again.',
      );
    if (!session.enabled) {
      session.sessionId = `session_${randomUUID()}`;
      session.snapshot = emptySnapshot(session.sessionId);
      session.transient.clear();
      session.lastReadAt = -Infinity;
      session.generation++;
      session.enabled = true;
    }
    session.expiresAt = this.now() + this.leaseMs;
    return this.read(session);
  }
  stop(token: string, origin: string) {
    const session = this.get(token, origin);
    // Also reject a previously sent Start that arrives after this Stop. Client
    // abort/generation checks alone cannot enforce server request arrival order.
    session.revoked = true;
    this.stopSession(session);
    return session.snapshot;
  }
  private stopSession(session: Session, message?: string) {
    session.enabled = false;
    session.generation++;
    session.controller?.abort();
    session.pending = undefined;
    session.transient.clear();
    const last = session.snapshot;
    session.snapshot = emptySnapshot(session.sessionId, message);
    session.snapshot.lastCheckedAt = last.lastCheckedAt;
    for (const category of categories)
      session.snapshot.categories[category].lastCheckedAt = last.categories[category].lastCheckedAt;
  }
  async snapshot(token: string, origin: string) {
    const session = this.get(token, origin);
    if (!session.enabled) return session.snapshot;
    session.expiresAt = this.now() + this.leaseMs;
    return this.read(session);
  }
  private async read(session: Session): Promise<HardwareSnapshot> {
    if (session.pending) return session.pending;
    if (
      this.now() - session.lastReadAt < this.minPollMs &&
      (session.snapshot.state !== 'running' || !session.snapshot.identityScope)
    )
      return session.snapshot;
    const generation = session.generation;
    const previous = session.snapshot;
    const controller = new AbortController();
    session.controller = controller;
    session.pending = (async () => {
      let entered = false;
      try {
        if (this.now() - session.lastReadAt < this.minPollMs && previous.identityScope) {
          // Even a cached response reloads trust evidence. A second local bridge
          // instance may have discovered a collision since this snapshot.
          await this.rememberAmbiguity(previous.identityScope, []);
          if (!session.enabled || generation !== session.generation) return session.snapshot;
          if (this.now() - session.lastReadAt < this.minPollMs) {
            session.snapshot = {
              ...session.snapshot,
              ambiguousIdentities: [
                ...this.ambiguousIdentities.get(previous.identityScope)!.values(),
              ],
            };
            return session.snapshot;
          }
        }
        session.lastReadAt = this.now();
        const availability = await this.probe.availability();
        if (!session.enabled || generation !== session.generation) return session.snapshot;
        if (!availability.available)
          throw new HardwareProbeError(
            availability.failureState ?? 'unavailable',
            availability.message,
          );
        if (this.reads >= 2)
          throw new HardwareProbeError(
            'unavailable',
            'Other local hardware checks are in progress. Try again shortly.',
          );
        this.reads++;
        entered = true;
        const [raw, scope] = await Promise.all([
          this.probe.read(controller.signal),
          this.probe.scope(),
        ]);
        // A stopped/restarted request must not mutate the new generation's
        // transient identity cache, even if its native result arrives late.
        if (!session.enabled || generation !== session.generation) return session.snapshot;
        const parsed = NativeSnapshotSchema.parse(raw);
        IdentityScopeSchema.parse(scope);
        const nativeIds = parsed.devices.map((device) => `${device.category}:${device.id}`);
        if (new Set(nativeIds).size !== nativeIds.length)
          throw new Error('Duplicate native device IDs');
        const at = new Date(this.now()).toISOString();
        const next: HardwareSnapshot = {
          state: 'running',
          sessionId: session.sessionId,
          identityScope: scope,
          lastCheckedAt: categories.some((category) => parsed.categories[category].state === 'ok')
            ? at
            : previous.lastCheckedAt,
          message:
            'Read-only local detection is active. OS recognition does not verify that every feature works.',
          categories: Object.fromEntries(
            categories.map((category) => [
              category,
              {
                ...parsed.categories[category],
                lastCheckedAt:
                  parsed.categories[category].state === 'ok'
                    ? at
                    : previous.categories[category].lastCheckedAt,
              },
            ]),
          ) as HardwareSnapshot['categories'],
          devices: [],
          ambiguousIdentities: [],
        };
        const present = parsed.devices.filter(
          (device) => parsed.categories[device.category].state === 'ok',
        );
        const fingerprints = new Map<string, number>();
        for (const device of present)
          if (device.fingerprint) {
            const fingerprint = `${device.category}:${device.fingerprint}`;
            fingerprints.set(fingerprint, (fingerprints.get(fingerprint) ?? 0) + 1);
          }
        const collisions = present.flatMap((device) =>
          device.fingerprint &&
          (fingerprints.get(`${device.category}:${device.fingerprint}`) ?? 0) > 1
            ? [
                {
                  category: device.category,
                  key: publicIdentityKey(device.category, device.fingerprint),
                },
              ]
            : [],
        );
        await this.rememberAmbiguity(scope, collisions);
        if (!session.enabled || generation !== session.generation) return session.snapshot;
        // Another tab may have committed evidence between the awaited store
        // result and this continuation. Use the latest shared union, not a copy
        // captured by the earlier promise.
        next.ambiguousIdentities = [...this.ambiguousIdentities.get(scope)!.values()];
        const ambiguous = new Set(next.ambiguousIdentities.map(identityKey));
        // Session identities are discarded on a failed category too: a reconnect
        // during the unknown interval must be explicitly matched again.
        const retained = new Set(present.map((device) => `${device.category}:${device.id}`));
        for (const id of session.transient.keys())
          if (!retained.has(id)) session.transient.delete(id);
        const idMap = new Map<string, string>();
        next.devices = present.map((device) => {
          const stableKey = device.fingerprint
            ? publicIdentityKey(device.category, device.fingerprint)
            : null;
          const isAmbiguous =
            stableKey !== null &&
            ambiguous.has(identityKey({ category: device.category, key: stableKey }));
          const persistent = stableKey !== null && !isAmbiguous;
          const nativeId = `${device.category}:${device.id}`;
          let key: string;
          if (persistent) key = stableKey;
          else {
            key = session.transient.get(nativeId) ?? `hw_${randomBytes(32).toString('hex')}`;
            session.transient.set(nativeId, key);
          }
          idMap.set(nativeId, key);
          return {
            id: key,
            category: device.category,
            name: device.name,
            model: device.model,
            source: device.source,
            status: device.status,
            parentId: null,
            identity: {
              key,
              stability: persistent ? 'persistent' : 'session',
              scope: persistent ? scope : session.sessionId,
            },
            attributes: isAmbiguous
              ? [
                  ...device.attributes,
                  {
                    label: 'Identity confidence',
                    value:
                      'Ambiguous identifier. Explicit matching is required again in each detection session.',
                  },
                ]
              : device.attributes,
          } satisfies HardwareDevice;
        });
        for (let i = 0; i < present.length; i++) {
          const device = present[i];
          if (device.category === 'usb' && device.parentId && device.parentId !== device.id)
            next.devices[i].parentId = idMap.get(`usb:${device.parentId}`) ?? null;
        }
        if (session.enabled && generation === session.generation) {
          session.snapshot = next;
          session.lastReadAt = this.now();
        }
      } catch (error) {
        if (session.enabled && generation === session.generation) {
          const failure =
            error instanceof HardwareProbeError
              ? error
              : new HardwareProbeError(
                  'error',
                  'The native snapshot could not be validated. Device presence is unknown.',
                );
          const next = emptySnapshot(session.sessionId, failure.message);
          next.state = 'unavailable';
          next.lastCheckedAt = previous.lastCheckedAt;
          for (const category of categories) {
            next.categories[category].state =
              category === 'bluetooth' ? 'unavailable' : failure.state;
            next.categories[category].lastCheckedAt = previous.categories[category].lastCheckedAt;
          }
          session.snapshot = next;
          session.transient.clear();
        }
      } finally {
        if (entered) this.reads--;
        if (generation === session.generation) session.pending = undefined;
      }
      return session.snapshot;
    })();
    return session.pending;
  }
  close() {
    for (const session of this.sessions.values()) this.stopSession(session);
    this.sessions.clear();
  }
}
