import { z } from 'zod';

/** Read-only observations. These never replace a user's operating-status report. */
export const HardwareCategorySchema = z.enum(['display', 'usb', 'bluetooth']);
export type HardwareCategory = z.infer<typeof HardwareCategorySchema>;
export const HardwareIdentitySchema = z.strictObject({
  key: z.string().regex(/^[a-zA-Z0-9_-]{8,160}$/),
  stability: z.enum(['persistent', 'session']),
  scope: z.string().regex(/^[a-zA-Z0-9_-]{8,160}$/),
});
export type HardwareIdentity = z.infer<typeof HardwareIdentitySchema>;
export const HardwareBindingSchema = z.strictObject({
  category: HardwareCategorySchema,
  identity: HardwareIdentitySchema,
  approvedAt: z.string().datetime(),
});
export type HardwareBinding = z.infer<typeof HardwareBindingSchema>;
export const HardwareCategoryStateSchema = z.strictObject({
  state: z.enum(['ok', 'unavailable', 'permission-denied', 'error']),
  source: z.string().max(200),
  lastCheckedAt: z.string().datetime().nullable(),
  message: z.string().max(500),
});
export type HardwareCategoryState = z.infer<typeof HardwareCategoryStateSchema>;
export const HardwareDeviceSchema = z.strictObject({
  id: z.string().min(1).max(200),
  category: HardwareCategorySchema,
  name: z.string().min(1).max(200),
  model: z.string().max(200),
  source: z.string().max(200),
  identity: HardwareIdentitySchema,
  status: z.enum(['online', 'connected', 'paired']),
  parentId: z.string().min(1).max(200).nullable(),
  attributes: z
    .array(z.strictObject({ label: z.string().max(100), value: z.string().max(300) }))
    .max(30),
});
export type HardwareDevice = z.infer<typeof HardwareDeviceSchema>;
/** A previously stable, opaque identity whose uniqueness has been disproved. */
export const HardwareAmbiguousIdentitySchema = z.strictObject({
  category: HardwareCategorySchema,
  key: HardwareIdentitySchema.shape.key,
});
export type HardwareAmbiguousIdentity = z.infer<typeof HardwareAmbiguousIdentitySchema>;
export const MAX_AMBIGUOUS_HARDWARE_IDENTITIES = 4096;
export const HardwareSnapshotSchema = z
  .strictObject({
    state: z.enum(['running', 'stopped', 'unavailable']),
    sessionId: z.string().max(200),
    // Installation scope is present even for an empty successful scan. It lets
    // the UI distinguish actual absence from an old mapping on a different Mac.
    identityScope: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{8,160}$/)
      .nullable(),
    lastCheckedAt: z.string().datetime().nullable(),
    message: z.string().max(500),
    categories: z.strictObject({
      display: HardwareCategoryStateSchema,
      usb: HardwareCategoryStateSchema,
      bluetooth: HardwareCategoryStateSchema,
    }),
    devices: z.array(HardwareDeviceSchema).max(512),
    // Scoped by identityScope, not by a tab. Optional so older fixtures and
    // snapshots remain readable; this server always supplies the evidence.
    ambiguousIdentities: z
      .array(HardwareAmbiguousIdentitySchema)
      .max(MAX_AMBIGUOUS_HARDWARE_IDENTITIES)
      .optional(),
  })
  .superRefine((snapshot, context) => {
    const ids = new Set<string>();
    for (const device of snapshot.devices) {
      if (ids.has(device.id))
        context.addIssue({ code: 'custom', message: 'Duplicate observation ID.' });
      ids.add(device.id);
    }
  });
export type HardwareSnapshot = z.infer<typeof HardwareSnapshotSchema>;
export const HardwareSessionSchema = z.strictObject({
  token: z.string().min(16).max(200),
  platform: z.string().max(40),
  available: z.boolean(),
  message: z.string().max(500),
});
export type HardwareSession = z.infer<typeof HardwareSessionSchema>;

export const hardwareCategoryLabels: Record<HardwareCategory, string> = {
  display: 'Displays',
  usb: 'USB devices and hubs',
  bluetooth: 'Bluetooth',
};

export function stoppedHardwareSnapshot(): HardwareSnapshot {
  const category: HardwareCategoryState = {
    state: 'unavailable',
    source: 'Local macOS bridge',
    lastCheckedAt: null,
    message: 'Detection has not been started.',
  };
  return {
    state: 'stopped',
    sessionId: '',
    identityScope: null,
    lastCheckedAt: null,
    message: 'Detection stopped. No hardware information is being read.',
    categories: { display: { ...category }, usb: { ...category }, bluetooth: { ...category } },
    devices: [],
    ambiguousIdentities: [],
  };
}

export function sameHardwareIdentity(a: HardwareIdentity, b: HardwareIdentity): boolean {
  return a.key === b.key && a.scope === b.scope && a.stability === b.stability;
}

export function isAmbiguousHardwareIdentity(
  category: HardwareCategory,
  identity: HardwareIdentity,
  snapshot: HardwareSnapshot,
): boolean {
  return (
    identity.stability === 'persistent' &&
    identity.scope === snapshot.identityScope &&
    (snapshot.ambiguousIdentities?.some(
      (entry) => entry.category === category && entry.key === identity.key,
    ) ??
      false)
  );
}
