import { z } from 'zod';
import type { Connection, Workspace } from './workspace';

const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const DiagnosticStepKindSchema = z.enum([
  'power',
  'confirm-route',
  'monitor-link',
  'dock-link',
  'display-settings',
  'compatibility',
  'direct-test',
  'record-route',
]);
export type DiagnosticStepKind = z.infer<typeof DiagnosticStepKindSchema>;
export const DiagnosticAnswerSchema = z.enum([
  'fixed',
  'not-fixed',
  'skip',
  'confirmed',
  'not-confirmed',
  'not-supported',
]);
export type DiagnosticAnswer = z.infer<typeof DiagnosticAnswerSchema>;
const StopReasonSchema = z.enum([
  '',
  'resolved',
  'checks-exhausted',
  'route-unknown',
  'route-not-confirmed',
  'prerequisite-skipped',
  'compatibility-unknown',
  'compatibility-not-supported',
  'graph-changed',
]);
const PathConnectionSchema = z.strictObject({
  id: Id,
  from: Id,
  to: Id,
  connector: z.enum(['USB-C', 'HDMI', 'DisplayPort', 'Ethernet', 'USB-A', 'Bluetooth', 'Unknown']),
  source: z.enum(['demo', 'user-reported', 'photo-inferred', 'os-detected']),
});
const PathSchema = z.strictObject({
  deviceIds: z.array(Id).min(1).max(8),
  connections: z.array(PathConnectionSchema).max(7),
  ambiguous: z.boolean(),
});
export type DiagnosticPath = z.infer<typeof PathSchema>;
const PlanStepSchema = z.strictObject({
  kind: DiagnosticStepKindSchema,
  deviceIds: z.array(Id).min(1).max(8),
  connectionIds: z.array(Id).max(7),
});
export type DiagnosticPlanStep = z.infer<typeof PlanStepSchema>;
const SessionRecordSchema = z.strictObject({
  id: Id,
  deviceId: Id,
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  result: z.enum(['active', 'resolved', 'unresolved']),
  step: z.number().int().min(0).max(7),
  plan: z.array(PlanStepSchema).min(2).max(8),
  path: PathSchema,
  answers: z
    .array(
      z.strictObject({
        step: z.number().int().min(0).max(7),
        kind: DiagnosticStepKindSchema,
        answer: DiagnosticAnswerSchema,
        at: z.string().datetime(),
      }),
    )
    .max(8),
  stopReason: StopReasonSchema,
  // Once any contributing record came from macOS, this session stays local-only.
  localOnly: z.boolean(),
});
export type DiagnosticSession = z.infer<typeof SessionRecordSchema>;
/** Compatibility name for callers that used the previous in-memory state. */
export type DiagnosticState = DiagnosticSession;

function stepPlan(path: DiagnosticPath): DiagnosticPlanStep[] {
  const [monitor] = path.deviceIds;
  const make = (
    kind: DiagnosticStepKind,
    deviceIds = path.deviceIds,
    connectionIds = path.connections.map((connection) => connection.id),
  ): DiagnosticPlanStep => ({ kind, deviceIds: [...deviceIds], connectionIds });
  const power = make('power', [monitor], []);
  if (!path.connections.length) return [power, make('record-route', [monitor], [])];
  const monitorEdge = path.connections[0];
  const plan = [
    power,
    make('confirm-route'),
    make('monitor-link', [monitorEdge.from, monitorEdge.to], [monitorEdge.id]),
  ];
  if (path.deviceIds.length > 2) plan.push(make('dock-link'));
  plan.push(make('display-settings', [path.deviceIds.at(-1)!], []));
  plan.push(make('compatibility'));
  if (path.deviceIds.length > 2) plan.push(make('direct-test'));
  return plan;
}

const physicalSteps = new Set<DiagnosticStepKind>([
  'power',
  'monitor-link',
  'dock-link',
  'display-settings',
  'direct-test',
]);
export function diagnosticAnswers(kind: DiagnosticStepKind): DiagnosticAnswer[] {
  if (physicalSteps.has(kind)) return ['fixed', 'not-fixed', 'skip'];
  if (kind === 'confirm-route') return ['confirmed', 'not-confirmed', 'skip'];
  if (kind === 'compatibility') return ['confirmed', 'not-supported', 'skip'];
  return ['not-confirmed', 'skip'];
}

type Transition = Pick<DiagnosticSession, 'step' | 'result' | 'stopReason'>;
function transition(
  session: Pick<DiagnosticSession, 'step' | 'plan' | 'answers'>,
  answer: DiagnosticAnswer,
): Transition {
  const kind = session.plan[session.step].kind;
  const end = (stopReason: DiagnosticSession['stopReason']): Transition => ({
    step: session.step,
    result: stopReason === 'resolved' ? 'resolved' : 'unresolved',
    stopReason,
  });
  const go = (step: number): Transition =>
    step < session.plan.length
      ? { step, result: 'active', stopReason: '' }
      : end('checks-exhausted');
  if (!diagnosticAnswers(kind).includes(answer))
    throw new Error('That answer does not apply to this check. Review the current step.');
  if (answer === 'fixed') return end('resolved');
  if (kind === 'record-route') return end('route-unknown');
  if (kind === 'confirm-route')
    return answer === 'confirmed'
      ? go(session.step + 1)
      : end(answer === 'skip' ? 'prerequisite-skipped' : 'route-not-confirmed');
  if (kind === 'compatibility') {
    if (answer === 'not-supported') return end('compatibility-not-supported');
    if (answer === 'skip') return end('compatibility-unknown');
    if (
      session.answers.some(
        (item) =>
          item.answer === 'skip' && ['power', 'monitor-link', 'dock-link'].includes(item.kind),
      )
    )
      return end('prerequisite-skipped');
    return go(session.step + 1);
  }
  if (answer === 'skip') {
    // A skipped power/input prerequisite never justifies unplugging equipment.
    if (kind === 'power' || kind === 'direct-test') return end('prerequisite-skipped');
    if (kind === 'monitor-link' || kind === 'dock-link') {
      // Offer a non-disruptive settings observation instead of dependent cable tests.
      const next = session.plan.findIndex((item) => item.kind === 'display-settings');
      return next > session.step ? go(next) : end('prerequisite-skipped');
    }
  }
  return go(session.step + 1);
}

export const DiagnosticSessionSchema = SessionRecordSchema.superRefine((session, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (session.path.deviceIds[0] !== session.deviceId)
    issue('The diagnostic path must start at its monitor.');
  if (new Set(session.path.deviceIds).size !== session.path.deviceIds.length)
    issue('The diagnostic path must not repeat devices.');
  if (session.path.connections.length !== session.path.deviceIds.length - 1)
    issue('The diagnostic path must be a continuous chain.');
  if (
    new Set(session.path.connections.map((edge) => edge.id)).size !==
    session.path.connections.length
  )
    issue('The diagnostic path must not repeat connections.');
  session.path.connections.forEach((edge, index) => {
    const endpoints = [session.path.deviceIds[index], session.path.deviceIds[index + 1]];
    if (edge.from === edge.to || !endpoints.includes(edge.from) || !endpoints.includes(edge.to))
      issue('A diagnostic connection must match its path endpoints.');
  });
  if (JSON.stringify(session.plan) !== JSON.stringify(stepPlan(session.path)))
    issue('The diagnostic plan must match its recorded path.');
  if (!session.localOnly && session.path.connections.some((edge) => edge.source === 'os-detected'))
    issue('OS-derived diagnostic paths must remain local-only.');
  if (session.step >= session.plan.length) {
    issue('The diagnostic step does not exist.');
    return;
  }
  let replay: Transition = { step: 0, result: 'active', stopReason: '' };
  let previousAt = Date.parse(session.startedAt);
  for (const [index, item] of session.answers.entries()) {
    if (
      replay.result !== 'active' ||
      replay.step !== item.step ||
      session.plan[item.step]?.kind !== item.kind ||
      !diagnosticAnswers(item.kind).includes(item.answer)
    ) {
      issue('Diagnostic answers must follow the recorded plan and its branches.');
      return;
    }
    if (Date.parse(item.at) < previousAt || Date.parse(item.at) > Date.parse(session.updatedAt))
      issue('Diagnostic answer times must follow the attempt timeline.');
    previousAt = Date.parse(item.at);
    replay = transition(
      { ...session, step: replay.step, answers: session.answers.slice(0, index) },
      item.answer,
    );
  }
  if (Date.parse(session.updatedAt) < previousAt)
    issue('The diagnostic update must follow its recorded answers.');
  if (session.stopReason === 'graph-changed') {
    if (
      session.result !== 'unresolved' ||
      session.step !== replay.step ||
      replay.result !== 'active'
    )
      issue('Only an active check may be ended after a graph change.');
  } else if (
    replay.step !== session.step ||
    replay.result !== session.result ||
    replay.stopReason !== session.stopReason
  )
    issue('The diagnostic result must follow the recorded user answers.');
});

function compactConnection(connection: Connection): DiagnosticPath['connections'][number] {
  return {
    id: connection.id,
    from: connection.from,
    to: connection.to,
    connector: connection.connector,
    source: connection.source,
  };
}

/** A recorded path is a hypothesis to confirm, never proof of a working video route. */
export function diagnosticPath(workspace: Workspace, deviceId: string): DiagnosticPath {
  const target = workspace.devices.find((device) => device.id === deviceId);
  if (!target || target.kind !== 'monitor')
    throw new Error('Select a monitor that is still in this workspace.');
  const devices = new Map(workspace.devices.map((device) => [device.id, device]));
  const candidates: DiagnosticPath[] = [];
  const edges = [...workspace.connections].sort((a, b) => a.id.localeCompare(b.id));
  const queue: { ids: string[]; connections: Connection[] }[] = [
    { ids: [deviceId], connections: [] },
  ];
  let inspected = 0;
  // Breadth-first traversal finds the shortest recorded candidate first. Bound work
  // on imported graphs; a crowded/ambiguous graph still requires user confirmation.
  while (queue.length && candidates.length < 2 && inspected < 256) {
    const { ids, connections } = queue.shift()!;
    inspected++;
    const tail = devices.get(ids.at(-1)!)!;
    if (tail.kind === 'laptop' || tail.kind === 'desktop') {
      candidates.push({
        deviceIds: ids,
        connections: connections.map(compactConnection),
        ambiguous: false,
      });
      continue;
    }
    if (ids.length >= 8) continue;
    for (const edge of edges) {
      if (['Ethernet', 'Bluetooth', 'USB-A'].includes(edge.connector)) continue;
      const other = edge.from === tail.id ? edge.to : edge.to === tail.id ? edge.from : null;
      if (!other || ids.includes(other)) continue;
      const device = devices.get(other);
      if (!device || !['dock', 'laptop', 'desktop'].includes(device.kind)) continue;
      if (queue.length < 512)
        queue.push({ ids: [...ids, other], connections: [...connections, edge] });
    }
  }
  if (!candidates.length) return { deviceIds: [deviceId], connections: [], ambiguous: false };
  return { ...candidates[0], ambiguous: candidates.length > 1 || queue.length > 0 };
}

export function diagnosisDeviceIds(session: DiagnosticSession): string[] {
  return [
    ...new Set([
      session.deviceId,
      ...session.path.deviceIds,
      ...session.path.connections.flatMap((edge) => [edge.from, edge.to]),
      ...session.plan.flatMap((step) => step.deviceIds),
    ]),
  ];
}

export function startDiagnosis(
  deviceId: string,
  workspace?: Workspace,
  at = new Date().toISOString(),
): DiagnosticSession {
  const path = workspace
    ? diagnosticPath(workspace, deviceId)
    : { deviceIds: [deviceId], connections: [], ambiguous: false };
  const ids = new Set(path.deviceIds);
  const localOnly =
    path.connections.some((edge) => edge.source === 'os-detected') ||
    Boolean(
      workspace?.devices.some(
        (device) =>
          ids.has(device.id) &&
          (device.hardwareOrigin === 'macos' ||
            device.source === 'os-detected' ||
            device.visual.source === 'os-detected'),
      ),
    );
  return DiagnosticSessionSchema.parse({
    id: crypto.randomUUID(),
    deviceId,
    startedAt: at,
    updatedAt: at,
    result: 'active',
    step: 0,
    plan: stepPlan(path),
    path,
    answers: [],
    stopReason: '',
    localOnly,
  });
}

export function answerDiagnosis(
  state: DiagnosticSession,
  answer: DiagnosticAnswer,
  at = new Date().toISOString(),
): DiagnosticSession {
  if (state.result !== 'active') return state;
  const current = DiagnosticSessionSchema.parse(state);
  const next = transition(current, answer);
  return DiagnosticSessionSchema.parse({
    ...current,
    ...next,
    updatedAt: at,
    answers: [
      ...current.answers,
      { step: current.step, kind: current.plan[current.step].kind, answer, at },
    ],
  });
}

export function endChangedDiagnosis(
  state: DiagnosticSession,
  at = new Date().toISOString(),
): DiagnosticSession {
  if (state.result !== 'active') return state;
  return DiagnosticSessionSchema.parse({
    ...state,
    updatedAt: at,
    result: 'unresolved',
    stopReason: 'graph-changed',
  });
}

export function diagnosticContextMatches(
  session: DiagnosticSession,
  workspace: Workspace,
): boolean {
  try {
    const current = diagnosticPath(workspace, session.deviceId);
    if (JSON.stringify(current) !== JSON.stringify(session.path)) return false;
    const involved = new Set(diagnosisDeviceIds(session));
    // Newly local-only provenance must not continue under the old shareable evidence boundary.
    return (
      session.localOnly ||
      !workspace.devices.some(
        (device) =>
          involved.has(device.id) &&
          (device.hardwareOrigin === 'macos' ||
            device.source === 'os-detected' ||
            device.visual.source === 'os-detected'),
      )
    );
  } catch {
    return false;
  }
}

export const diagnosticStepTitles: Record<DiagnosticStepKind, string> = {
  power: 'Check power and input source',
  'confirm-route': 'Confirm the recorded display route',
  'monitor-link': 'Check the current cable connection',
  'dock-link': 'Check the dock’s computer connection',
  'display-settings': 'Check the computer’s display settings',
  compatibility: 'Check cable and port compatibility',
  'direct-test': 'Test a direct connection if possible',
  'record-route': 'Record the missing display connection',
};
export function diagnosticStep(session: DiagnosticSession, workspace: Workspace) {
  const planStep = session.plan[session.step];
  const name = (id: string) =>
    workspace.devices.find((device) => device.id === id)?.name || 'Removed device';
  const monitor = name(session.deviceId);
  const computer = name(session.path.deviceIds.at(-1)!);
  const edge = session.path.connections[0];
  const peer = edge
    ? name(edge.from === session.deviceId ? edge.to : edge.from)
    : 'the connected device';
  const connection =
    edge?.connector === 'Unknown'
      ? 'the cable whose type is not yet recorded'
      : `the recorded ${edge?.connector ?? 'display'} cable`;
  const skippedCable = session.answers.some(
    (answer) => answer.answer === 'skip' && ['monitor-link', 'dock-link'].includes(answer.kind),
  );
  const copy: Record<DiagnosticStepKind, { text: string; note: string }> = {
    power: {
      text: `Check that ${monitor} is powered on and that its selected input matches the cable you can see. Look at the screen yourself.`,
      note: 'A recorded cable type does not establish the selected input or the cause of the issue.',
    },
    'confirm-route': {
      text: `The saved route is ${session.path.deviceIds.map(name).join(' → ')}. Check whether this matches the physical connections you are troubleshooting.`,
      note: session.path.ambiguous
        ? 'More than one recorded route exists. This is one candidate; confirm it or correct the connections before continuing.'
        : session.path.connections.some(
              (item) => item.source === 'demo' || item.source === 'photo-inferred',
            )
          ? 'This route includes example or photo-inferred records. Confirm the actual cable path; the app has not verified it.'
          : 'These are recorded claims. This question does not mark any connection as working.',
    },
    'monitor-link': {
      text: `Check ${connection} between ${monitor} and ${peer}, including the selected monitor input. Only reseat a cable if you can do so safely.`,
      note: 'Before disconnecting a dock with storage attached, close files and safely eject that storage. If you cannot do this, skip the cable check.',
    },
    'dock-link': {
      text: `Check the recorded dock-to-computer part of ${session.path.deviceIds.map(name).join(' → ')}. Check power to the dock and its computer-side cable.`,
      note: 'Do not unplug a dock while storage is in use. USB-C alone does not prove support for video, power, or a particular link speed.',
    },
    'display-settings': {
      text: `On ${computer}, look at the display settings yourself. Check whether the intended display is listed and the arrangement matches the screen you are testing.`,
      note: skippedCable
        ? 'You skipped a cable check, so the next step is an observation without unplugging hardware. Dependent cable tests remain unavailable. DeskTwin does not change settings.'
        : 'DeskTwin does not open or change settings. A listed display does not by itself prove the screen is showing a picture.',
    },
    compatibility: {
      text: 'Use the device and cable documentation to check the intended video connection. If testing a direct connection, confirm that both ports and the cable support it.',
      note: 'Connector shape is not a capability check. If support is unknown, keep it unknown and stop here.',
    },
    'direct-test': {
      text: `If the compatibility check permits it, try ${computer} directly with ${monitor}, bypassing the dock. Safely eject any dock-attached storage first. Check the screen yourself.`,
      note: 'If it works, that reports only this test’s outcome. It does not prove that the dock or original cable is faulty, and the saved topology is unchanged.',
    },
    'record-route': {
      text: `There is no recorded candidate display path from ${monitor} to a laptop or desktop. Record the actual monitor-to-computer connections, including any dock, then start a new check.`,
      note: 'Unknown wiring is not a failed connection. Bluetooth, Ethernet, and USB-A records are not assumed to carry display output.',
    },
  };
  return { ...planStep, title: diagnosticStepTitles[planStep.kind], ...copy[planStep.kind] };
}

export function diagnosisNote(state: DiagnosticSession): string {
  if (state.result === 'resolved')
    return `User test: Display reported working after ${diagnosticStepTitles[state.plan[state.step].kind].toLowerCase()}. Cause not determined.`;
  const reasons: Record<DiagnosticSession['stopReason'], string> = {
    '': 'The user-guided check is in progress. No operating result has been confirmed.',
    resolved: '',
    'checks-exhausted':
      'The completed checks did not resolve the reported display issue. No cause has been established.',
    'route-unknown':
      'The display route is not recorded. Add the actual connections before further cable tests.',
    'route-not-confirmed':
      'The user did not confirm the recorded route. Correct the connections before further cable tests.',
    'prerequisite-skipped':
      'A required check was skipped. The outcome remains unknown; a skipped check is not a failure.',
    'compatibility-unknown':
      'Cable and port compatibility could not be checked. No direct-connection test was recommended.',
    'compatibility-not-supported':
      'The user reported that the intended cable or ports do not support the test. No direct-connection test was recommended.',
    'graph-changed':
      'The recorded connections changed during this attempt. Its answers were kept; a new check must use the current route.',
  };
  return reasons[state.stopReason];
}
