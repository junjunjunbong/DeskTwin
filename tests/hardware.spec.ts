import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  HardwareSnapshotSchema,
  stoppedHardwareSnapshot,
  type HardwareDevice,
  type HardwareSnapshot,
} from '../src/domain/hardware';
import { createDemoWorkspace, type Workspace } from '../src/domain/workspace';

// These fixtures exercise browser integration only. They do not validate native
// macOS enumeration, physical devices, or the actual Mac permission model.
const storageKey = 'desktwin.workspace.v1';
const scope = 'installation_browser_fixture';
const sessionId = 'session_browser_fixture_001';
const checkedAt = '2026-10-29T03:00:00.000Z';
const token = 'a'.repeat(64);
test.setTimeout(75_000);

function display(key: string): HardwareDevice {
  return {
    id: key,
    category: 'display',
    name: 'Studio Display',
    model: 'Vendor 1552 · Model 41387',
    source: 'macOS CoreGraphics + AppKit NSScreen',
    identity: { key, stability: 'persistent', scope },
    status: 'online',
    parentId: null,
    attributes: [
      { label: 'Active for drawing', value: 'Yes' },
      { label: 'Pixel dimensions', value: '2560 × 1440' },
      { label: 'Built-in', value: 'No' },
    ],
  };
}

const firstDisplay = display('hw_browser_display_first');
const secondDisplay = display('hw_browser_display_second');
const hub: HardwareDevice = {
  id: 'hw_browser_usb_hub',
  category: 'usb',
  name: 'USB Hub',
  model: 'Vendor 2109 · Product 0817',
  source: 'macOS IOKit IOService USB registry',
  identity: { key: 'hw_browser_usb_hub', stability: 'persistent', scope },
  status: 'connected',
  parentId: null,
  attributes: [{ label: 'USB class', value: '09 (Hub)' }],
};
const storage: HardwareDevice = {
  id: 'hw_browser_usb_storage',
  category: 'usb',
  name: 'USB Storage',
  model: 'Vendor 174c · Product 55aa',
  source: 'macOS IOKit IOService USB registry',
  identity: { key: 'hw_browser_usb_storage', stability: 'session', scope: sessionId },
  status: 'connected',
  parentId: hub.id,
  attributes: [{ label: 'USB class', value: '00 (Per interface)' }],
};

function runningSnapshot(): HardwareSnapshot {
  return HardwareSnapshotSchema.parse({
    state: 'running',
    sessionId,
    identityScope: scope,
    lastCheckedAt: checkedAt,
    message: 'Read-only local detection is active. Recognition does not verify every feature.',
    categories: {
      display: {
        state: 'ok',
        source: firstDisplay.source,
        lastCheckedAt: checkedAt,
        message: 'Online displays returned by CoreGraphics.',
      },
      usb: {
        state: 'ok',
        source: hub.source,
        lastCheckedAt: checkedAt,
        message: 'USB registry entries returned by IOKit.',
      },
      bluetooth: {
        state: 'unavailable',
        source: 'Not collected',
        lastCheckedAt: null,
        message: 'Bluetooth detection is not implemented.',
      },
    },
    devices: [firstDisplay, secondDisplay, hub, storage],
  });
}

function approvedWorkspace(observation = firstDisplay, deviceId = 'monitor-right') {
  const workspace = createDemoWorkspace();
  const device = workspace.devices.find((item) => item.id === deviceId)!;
  device.hardwareBinding = {
    category: observation.category,
    identity: structuredClone(observation.identity),
    approvedAt: checkedAt,
  };
  if (deviceId === 'monitor-right') {
    device.status = 'reported-issue';
    device.statusNote = 'The screen remains dark even though macOS lists it.';
  }
  return workspace;
}

async function saved(page: Page): Promise<Workspace> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey);
}

async function setup(page: Page, workspace = createDemoWorkspace()) {
  const bridge = {
    snapshot: runningSnapshot(),
    disconnected: false,
    calls: { session: 0, start: 0, snapshot: 0, stop: 0 },
    externalCalls: 0,
  };
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { mode: 'demo', photoAvailable: false } }),
  );
  await page.route(/\/api\/(chat|photo)$/, (route) => {
    bridge.externalCalls++;
    return route.abort('blockedbyclient');
  });
  await page.route('**/api/hardware/*', async (route) => {
    const request = route.request();
    const operation = new URL(request.url()).pathname.split('/').at(-1)!;
    expect(request.headers()['x-desktwin-hardware']).toBe('1');
    if (operation === 'session') {
      bridge.calls.session++;
      expect(request.method()).toBe('GET');
      await route.fulfill({
        json: {
          token,
          platform: 'darwin',
          available: true,
          message: 'Local fixture helper available.',
        },
      });
      return;
    }
    expect(request.headers()['x-desktwin-hardware-token']).toBe(token);
    if (operation === 'start') {
      bridge.calls.start++;
      expect(request.method()).toBe('POST');
      expect(request.postDataJSON()).toEqual({ consent: true });
      await route.fulfill({ json: HardwareSnapshotSchema.parse(bridge.snapshot) });
    } else if (operation === 'snapshot') {
      bridge.calls.snapshot++;
      expect(request.method()).toBe('GET');
      if (bridge.disconnected) await route.abort('connectionrefused');
      else await route.fulfill({ json: HardwareSnapshotSchema.parse(bridge.snapshot) });
    } else if (operation === 'stop') {
      bridge.calls.stop++;
      expect(request.method()).toBe('POST');
      expect(request.postDataJSON()).toEqual({});
      const stopped = stoppedHardwareSnapshot();
      stopped.lastCheckedAt = bridge.snapshot.lastCheckedAt;
      for (const category of ['display', 'usb', 'bluetooth'] as const)
        stopped.categories[category].lastCheckedAt =
          bridge.snapshot.categories[category].lastCheckedAt;
      await route.fulfill({ json: stopped });
    } else {
      throw new Error(`Unexpected fixture endpoint: ${operation}`);
    }
  });
  await page.addInitScript(
    ({ key, value }) => {
      if (!sessionStorage.getItem('hardware-browser-fixture')) {
        localStorage.setItem(key, JSON.stringify(value));
        sessionStorage.setItem('hardware-browser-fixture', 'yes');
      }
    },
    { key: storageKey, value: workspace },
  );
  await page.goto('/');
  await expect(page.getByTestId('desk-canvas')).toBeVisible();
  await expect.poll(() => bridge.calls.session).toBeGreaterThan(0);
  return bridge;
}

function hardwarePanel(page: Page) {
  return page.getByRole('complementary', { name: 'Mac hardware panel', exact: true });
}
async function openHardware(page: Page) {
  await page.getByRole('button', { name: 'Mac hardware', exact: true }).click();
  const panel = hardwarePanel(page);
  await expect(panel).toBeVisible();
  return panel;
}
async function start(page: Page) {
  const panel = await openHardware(page);
  await panel.getByRole('checkbox', { name: /I agree to read this Mac/ }).check();
  await panel.getByRole('button', { name: 'Start detection', exact: true }).click();
  await expect(panel.locator('.hardware-state-title')).toHaveText('Detection active');
  return panel;
}
function rows(panel: Locator) {
  return panel.getByRole('region', { name: 'OS observations', exact: true }).getByRole('button');
}
async function approveExisting(panel: Locator, observationIndex: number, deviceId: string) {
  await rows(panel).nth(observationIndex).click();
  await panel.getByLabel('Desk device match', { exact: true }).selectOption(deviceId);
  await panel.getByRole('button', { name: 'Review match', exact: true }).click();
  await panel.getByRole('button', { name: 'Confirm and save match', exact: true }).click();
}
async function selectDevice(page: Page, id: string) {
  const names: Record<string, string> = { 'monitor-right': 'Right monitor', dock: 'USB-C Dock' };
  await page.getByRole('button', { name: 'Device list', exact: true }).click();
  await page
    .getByRole('complementary', { name: 'Device list panel', exact: true })
    .getByRole('button', { name: new RegExp(`^${names[id]} `) })
    .click();
  return page.getByRole('region', { name: 'OS recognition for selected device', exact: true });
}

test('hardware reads need explicit local consent and keep observations out of the saved desk', async ({
  page,
}) => {
  const initial = createDemoWorkspace();
  const bridge = await setup(page, initial);
  const summary = page.getByRole('region', { name: 'OS detection summary', exact: true });
  await expect(summary).toContainText('Detection stopped');
  expect(bridge.calls.start + bridge.calls.snapshot).toBe(0);
  const panel = await openHardware(page);
  const startButton = panel.getByRole('button', { name: 'Start detection', exact: true });
  await expect(startButton).toBeDisabled();
  await expect(panel).toContainText(
    'No screen capture, key recording, device control or settings changes.',
  );
  await expect(panel).toContainText('Nothing is sent to Meta.');
  await panel.getByRole('checkbox', { name: /I agree to read this Mac/ }).check();
  await expect(startButton).toBeEnabled();
  expect(bridge.calls.start + bridge.calls.snapshot).toBe(0);
  expect(await saved(page)).toEqual(initial);
  await startButton.click();
  await expect(rows(panel)).toHaveCount(4);
  expect(bridge.calls.start).toBe(1);
  await expect(panel.getByRole('region', { name: 'Detection sources' })).toContainText(
    'Bluetooth detection is not implemented.',
  );
  await expect(panel).toContainText('CoreGraphics');
  await expect(panel).toContainText('IOKit');
  await rows(panel).nth(3).click();
  const observation = panel.getByRole('region', { name: 'Selected OS observation', exact: true });
  await expect(observation).toContainText('USB Hub');
  await expect(observation).toContainText('IOKit registry hierarchy; not a measured cable route.');
  await panel.getByRole('button', { name: 'Close Mac hardware', exact: true }).click();
  await expect(summary).toContainText('4 OS observations · 0 matched desk devices');
  await expect(summary).toContainText('Last successful check:');
  expect(await saved(page)).toEqual(initial);
  expect(bridge.externalCalls).toBe(0);
});

test('matching is explicit, preserves existing evidence, prevents duplicates, and supports Undo and Redo', async ({
  page,
}) => {
  const initial = createDemoWorkspace();
  const monitor = initial.devices.find((device) => device.id === 'monitor-right')!;
  monitor.source = 'user-reported';
  monitor.model = 'My retained monitor model';
  monitor.status = 'reported-issue';
  monitor.statusNote = 'I checked the monitor and it still has no picture.';
  await setup(page, initial);
  let panel = await start(page);
  await expect(rows(panel).filter({ hasText: 'Studio Display' })).toHaveCount(2);
  await rows(panel).nth(0).click();
  await expect(panel.getByLabel('Desk device match', { exact: true })).toHaveValue('');
  await expect(panel.getByRole('button', { name: 'Review match', exact: true })).toBeDisabled();
  await panel.getByLabel('Desk device match', { exact: true }).selectOption('monitor-right');
  await panel.getByRole('button', { name: 'Review match', exact: true }).click();
  await expect(panel.getByRole('group', { name: 'Confirm hardware match' })).toContainText(
    'Keep the existing name, model, layout, connections and user-reported status.',
  );
  expect(await saved(page)).toEqual(initial);
  await panel.getByRole('button', { name: 'Cancel match', exact: true }).click();
  expect(await saved(page)).toEqual(initial);
  await panel.getByRole('button', { name: 'Review match', exact: true }).click();
  await panel.getByRole('button', { name: 'Confirm and save match', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await saved(page)).devices.find((device) => device.id === monitor.id)?.hardwareBinding
          ?.identity,
    )
    .toEqual(firstDisplay.identity);
  const approved = await saved(page);
  const { hardwareBinding, ...retained } = approved.devices.find(
    (device) => device.id === monitor.id,
  )!;
  expect(hardwareBinding?.category).toBe('display');
  expect(retained).toEqual(monitor);
  expect(approved.connections).toEqual(initial.connections);
  expect(approved.objects).toEqual(initial.objects);
  expect(approved.devices).toHaveLength(8);
  expect(approved.history).toHaveLength(initial.history.length + 1);
  const inspector = page.getByRole('complementary', { name: 'Selected device', exact: true });
  await expect(inspector.locator('.reported-status')).toHaveText('User reports an issue');
  await expect(inspector.locator('.hardware-badge')).toHaveText('OS detected');
  await expect(inspector).toContainText('My retained monitor model');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => saved(page)).toEqual(initial);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => saved(page)).toEqual(approved);
  await page.getByRole('button', { name: 'My desk', exact: true }).click();
  const summary = page.getByRole('region', { name: 'OS detection summary', exact: true });
  await summary.getByRole('button', { name: 'Right monitor OS detected', exact: true }).click();
  await expect(
    inspector.getByRole('heading', { name: 'Right monitor', exact: true }),
  ).toBeVisible();
  panel = await openHardware(page);
  await rows(panel).nth(0).click();
  await expect(panel).toContainText(
    'Already linked to Right monitor. A second record is not needed.',
  );
  await expect(panel.getByLabel('Desk device match', { exact: true })).toHaveCount(0);
  await rows(panel).nth(1).click();
  await expect(panel.getByLabel('Desk device match', { exact: true })).toHaveValue('');
  await panel.getByLabel('Desk device match', { exact: true }).selectOption('monitor-left');
  await panel.getByRole('button', { name: 'Review match', exact: true }).click();
  await panel.getByRole('button', { name: 'Confirm and save match', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await saved(page)).devices.find((device) => device.id === 'monitor-left')?.hardwareBinding
          ?.identity,
    )
    .toEqual(secondDisplay.identity);
  const final = await saved(page);
  expect(final.devices).toHaveLength(8);
  expect(
    final.devices.find((device) => device.id === monitor.id)?.hardwareBinding?.identity,
  ).toEqual(firstDisplay.identity);
});

test('adding an OS observation creates one unknown device and portable JSON omits local identities', async ({
  page,
}) => {
  const initial = createDemoWorkspace();
  const bridge = await setup(page, initial);
  const panel = await start(page);
  await rows(panel).nth(3).click();
  await panel.getByLabel('Desk device match', { exact: true }).selectOption('new');
  await panel.getByLabel('New hardware device name', { exact: true }).fill('Observed backup SSD');
  await panel.getByLabel('Hardware device template', { exact: true }).selectOption('ssd');
  await panel.getByRole('button', { name: 'Review match', exact: true }).click();
  expect(await saved(page)).toEqual(initial);
  await panel.getByRole('button', { name: 'Confirm and save match', exact: true }).click();
  await expect.poll(async () => (await saved(page)).devices.length).toBe(9);
  const current = await saved(page);
  const added = current.devices.find((device) => device.name === 'Observed backup SSD')!;
  expect(added).toMatchObject({
    kind: 'ssd',
    source: 'os-detected',
    status: 'unknown',
    statusNote: '',
    hardwareOrigin: 'macos',
    hardwareBinding: { category: 'usb', identity: storage.identity },
  });
  expect(current.connections).toEqual(initial.connections);
  expect(current.devices.filter((device) => device.id !== added.id)).toEqual(initial.devices);
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const download = await downloaded;
  const stream = await download.createReadStream();
  if (!stream) throw new Error('Workspace download stream missing.');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  const exported = JSON.parse(raw) as Workspace;
  expect(raw).not.toContain('hardwareBinding');
  expect(raw).not.toContain(storage.identity.key);
  expect(raw).not.toContain(scope);
  expect(raw).not.toContain(token);
  expect(exported.devices.find((device) => device.id === added.id)).toMatchObject({
    name: 'Observed backup SSD',
    source: 'os-detected',
    status: 'unknown',
  });
  expect(
    (await saved(page)).devices.find((device) => device.id === added.id)?.hardwareBinding,
  ).toEqual(added.hardwareBinding);
  expect(bridge.externalCalls).toBe(0);
});

test('absence requires a successful category scan; denied, disconnected, and stopped detection stay unknown', async ({
  page,
}) => {
  const initial = approvedWorkspace();
  const bridge = await setup(page, initial);
  await start(page);
  let recognition = await selectDevice(page, 'monitor-right');
  await expect(recognition.locator('.hardware-badge')).toHaveText('OS detected');
  bridge.snapshot = runningSnapshot();
  bridge.snapshot.devices = bridge.snapshot.devices.filter(
    (device) => device.id !== firstDisplay.id,
  );
  bridge.snapshot.lastCheckedAt = '2026-10-29T03:00:05.000Z';
  bridge.snapshot.categories.display.lastCheckedAt = bridge.snapshot.lastCheckedAt;
  await expect(recognition.locator('.hardware-badge')).toHaveText('Not detected', {
    timeout: 12_000,
  });
  await expect(recognition).toContainText('latest successful scan');
  bridge.snapshot = runningSnapshot();
  await expect(recognition.locator('.hardware-badge')).toHaveText('OS detected', {
    timeout: 12_000,
  });
  bridge.snapshot.categories.display.state = 'permission-denied';
  bridge.snapshot.categories.display.message = 'Display metadata permission was denied.';
  bridge.snapshot.devices = bridge.snapshot.devices.filter(
    (device) => device.category !== 'display',
  );
  await expect(recognition.locator('.hardware-badge')).toHaveText('Status unavailable', {
    timeout: 12_000,
  });
  await expect(recognition).toContainText('Display metadata permission was denied.');
  await expect(recognition.getByText('Not detected', { exact: true })).toHaveCount(0);
  bridge.disconnected = true;
  await expect(recognition).toContainText('Device presence is unknown.', { timeout: 12_000 });
  await expect(recognition.locator('.hardware-badge')).toHaveText('Status unavailable');
  const panel = await openHardware(page);
  await panel.getByRole('button', { name: 'Stop detection', exact: true }).click();
  await expect(panel.locator('.hardware-state-title')).toHaveText('Detection stopped');
  recognition = await selectDevice(page, 'monitor-right');
  await expect(recognition.locator('.hardware-badge')).toHaveText('Detection stopped');
  await expect(recognition).toContainText('presence is unknown');
  await expect(recognition.getByText('Not detected', { exact: true })).toHaveCount(0);
  expect(await saved(page)).toEqual(initial);
  expect(bridge.calls.stop).toBe(1);
});

test('a serial-less reconnect keeps the old match unknown until the user selects the new observation', async ({
  page,
}) => {
  const initial = approvedWorkspace(storage, 'dock');
  const bridge = await setup(page, initial);
  await start(page);
  const recognition = await selectDevice(page, 'dock');
  await expect(recognition.locator('.hardware-badge')).toHaveText('OS detected');
  bridge.snapshot.devices = bridge.snapshot.devices.filter((device) => device.id !== storage.id);
  await expect(recognition.locator('.hardware-badge')).toHaveText('Match again', {
    timeout: 12_000,
  });
  const reconnected = structuredClone(storage);
  reconnected.id = 'hw_browser_usb_reconnected';
  reconnected.identity.key = reconnected.id;
  bridge.snapshot.devices.push(reconnected);
  const panel = await openHardware(page);
  await expect(rows(panel).filter({ hasText: 'USB Storage' })).toHaveCount(1, { timeout: 12_000 });
  await rows(panel).filter({ hasText: 'USB Storage' }).click();
  await expect(panel.getByLabel('Desk device match', { exact: true })).toHaveValue('');
  expect(await saved(page)).toEqual(initial);
  await panel.getByLabel('Desk device match', { exact: true }).selectOption('dock');
  await panel.getByRole('button', { name: 'Review match', exact: true }).click();
  await expect(panel.getByRole('group', { name: 'Confirm hardware match' })).toContainText(
    'replaces the previously approved OS match',
  );
  await panel.getByRole('button', { name: 'Confirm and save match', exact: true }).click();
  await expect(recognition.locator('.hardware-badge')).toHaveText('OS detected');
  await expect
    .poll(
      async () =>
        (await saved(page)).devices.find((device) => device.id === 'dock')?.hardwareBinding
          ?.identity,
    )
    .toEqual(reconnected.identity);
  const current = await saved(page);
  expect(current.devices).toHaveLength(initial.devices.length);
  expect(current.connections).toEqual(initial.connections);
  const { hardwareBinding: oldBinding, ...originalDevice } = initial.devices.find(
    (device) => device.id === 'dock',
  )!;
  const { hardwareBinding: newBinding, ...currentDevice } = current.devices.find(
    (device) => device.id === 'dock',
  )!;
  expect(oldBinding?.identity).not.toEqual(newBinding?.identity);
  expect(currentDevice).toEqual(originalDevice);
});

test('another tab cannot overwrite an approved hardware match and stopping one session does not stop the other', async ({
  context,
  page,
}) => {
  const initial = createDemoWorkspace();
  const first = await setup(page, initial);
  const second = await context.newPage();
  const other = await setup(second, initial);
  const firstPanel = await start(page);
  const secondPanel = await start(second);
  await rows(secondPanel).nth(0).click();
  await secondPanel.getByLabel('Desk device match', { exact: true }).selectOption('monitor-left');
  await secondPanel.getByRole('button', { name: 'Review match', exact: true }).click();
  await approveExisting(firstPanel, 0, 'monitor-right');
  await expect
    .poll(
      async () =>
        (await saved(page)).devices.find((device) => device.id === 'monitor-right')?.hardwareBinding
          ?.identity,
    )
    .toEqual(firstDisplay.identity);
  const winner = await saved(page);
  await expect(
    second.getByRole('button', { name: 'Load latest saved workspace', exact: true }),
  ).toBeVisible();
  await secondPanel.getByRole('button', { name: 'Confirm and save match', exact: true }).click();
  await expect(secondPanel.getByRole('alert')).toContainText('The match was not saved.');
  expect(await saved(second)).toEqual(winner);
  expect(
    winner.devices.find((device) => device.id === 'monitor-left')?.hardwareBinding,
  ).toBeUndefined();
  const activeFirstPanel = await openHardware(page);
  await activeFirstPanel.getByRole('button', { name: 'Stop detection', exact: true }).click();
  await expect(activeFirstPanel.locator('.hardware-state-title')).toHaveText('Detection stopped');
  await expect(secondPanel.locator('.hardware-state-title')).toHaveText('Detection active');
  expect(first.calls.stop).toBe(1);
  expect(other.calls.stop).toBe(0);
  expect(await saved(second)).toEqual(winner);
  await second.close();
});

test('a late capability response cannot replace an active token and repeated availability checks share one request', async ({
  page,
}) => {
  const bridge = await setup(page);
  const panel = await openHardware(page);
  await panel.getByRole('checkbox', { name: /I agree to read this Mac/ }).check();
  await expect(panel.getByRole('button', { name: 'Start detection', exact: true })).toBeEnabled();
  let releaseCapability!: () => void;
  let capabilityFinished!: () => void;
  const capabilityGate = new Promise<void>((resolve) => {
    releaseCapability = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    capabilityFinished = resolve;
  });
  let requests = 0;
  await page.route('**/api/hardware/session', async (route) => {
    requests++;
    await capabilityGate;
    await route.fulfill({
      json: {
        token: 'b'.repeat(64),
        platform: 'darwin',
        available: true,
        message: 'A later capability token.',
      },
    });
    capabilityFinished();
  });
  const check = panel.getByRole('button', { name: 'Check bridge availability', exact: true });
  await check.click();
  await expect.poll(() => requests).toBe(1);
  await check.click();
  expect(requests).toBe(1);
  await panel.getByRole('button', { name: 'Start detection', exact: true }).click();
  await expect(panel.locator('.hardware-state-title')).toHaveText('Detection active');
  const polls = bridge.calls.snapshot;
  releaseCapability();
  await finished;
  // The shared fixture rejects any private request that uses the late token.
  await expect.poll(() => bridge.calls.snapshot, { timeout: 12_000 }).toBeGreaterThan(polls);
  await expect(panel.locator('.hardware-state-title')).toHaveText('Detection active');
  await panel.getByRole('button', { name: 'Stop detection', exact: true }).click();
  await expect(panel.locator('.hardware-state-title')).toHaveText('Detection stopped');
  expect(bridge.calls.start).toBe(1);
  expect(bridge.calls.stop).toBe(1);
  expect(requests).toBe(1);
});

test('Stop remains usable during a pending start and a late start response cannot restart detection', async ({
  page,
}) => {
  const initial = createDemoWorkspace();
  const bridge = await setup(page, initial);
  let releaseStart!: () => void;
  let responseFinished!: () => void;
  const startGate = new Promise<void>((resolve) => {
    releaseStart = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    responseFinished = resolve;
  });
  let starts = 0;
  await page.route('**/api/hardware/start', async (route) => {
    starts++;
    if (starts > 1) {
      await route.fallback();
      return;
    }
    expect(route.request().headers()['x-desktwin-hardware-token']).toBe(token);
    expect(route.request().postDataJSON()).toEqual({ consent: true });
    await startGate;
    try {
      // The browser may already have aborted this request after Stop.
      await route.fulfill({ json: bridge.snapshot });
    } finally {
      responseFinished();
    }
  });
  const panel = await openHardware(page);
  await panel.getByRole('checkbox', { name: /I agree to read this Mac/ }).check();
  await panel.getByRole('button', { name: 'Start detection', exact: true }).click();
  await expect.poll(() => starts).toBe(1);
  const capabilitiesBeforeStop = bridge.calls.session;
  await expect(panel.getByRole('button', { name: 'Stop detection', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: 'Stop detection', exact: true }).click();
  await expect(panel.locator('.hardware-state-title')).toHaveText('Detection stopped');
  releaseStart();
  await finished;
  await expect(panel.getByRole('button', { name: 'Start detection', exact: true })).toBeEnabled();
  await expect(rows(panel)).toHaveCount(0);
  expect(bridge.calls.snapshot).toBe(0);
  expect(await saved(page)).toEqual(initial);
  await panel.getByRole('button', { name: 'Start detection', exact: true }).click();
  await expect(panel.locator('.hardware-state-title')).toHaveText('Detection active');
  expect(starts).toBe(2);
  expect(bridge.calls.stop).toBe(1);
  expect(bridge.calls.session).toBeGreaterThan(capabilitiesBeforeStop);
  expect(await saved(page)).toEqual(initial);
});

test('provider payloads exclude OS-derived records and local-demo history while preserving manual context', async ({
  page,
  context,
}) => {
  const initial = createDemoWorkspace();
  const privateDevice = initial.devices.find((device) => device.id === 'monitor-right')!;
  privateDevice.name = 'Fixture private display 731';
  privateDevice.model = 'Fixture private model 948';
  privateDevice.source = 'os-detected';
  privateDevice.hardwareOrigin = 'macos';
  privateDevice.hardwareBinding = {
    category: 'display',
    identity: structuredClone(firstDisplay.identity),
    approvedAt: checkedAt,
  };
  const manual = initial.devices.find((device) => device.id === 'dock')!;
  manual.source = 'user-reported';
  manual.model = 'My manually entered dock model';
  manual.hardwareBinding = {
    category: 'usb',
    identity: structuredClone(hub.identity),
    approvedAt: checkedAt,
  };
  initial.history.push({
    id: 'private-local-history',
    at: checkedAt,
    source: 'user-reported',
    summary: `Updated ${privateDevice.name}`,
  });
  const bridge = await setup(page, initial);
  const message = page.getByRole('textbox', { name: 'Message DeskTwin', exact: true });
  const send = page.getByRole('button', { name: 'Send message', exact: true });
  // The user's alias contains no private label; the offline reply reads the
  // actual saved name. Forwarding that reply later would leak OS-derived data.
  await message.fill('The right monitor is not displaying');
  await send.click();
  const conversation = page.getByRole('complementary', {
    name: 'DeskTwin conversation',
    exact: true,
  });
  await expect(conversation.locator('.chat-message.assistant > p')).toContainText(
    privateDevice.name,
  );
  expect(bridge.externalCalls).toBe(0);
  expect(await saved(page)).toEqual(initial);

  type ChatRequest = {
    message: string;
    consent: boolean;
    workspace: Workspace;
    history: { role: string; content: string }[];
  };
  type PhotoRequest = { consent: boolean; workspace: Workspace; image: string; context: string };
  const chats: ChatRequest[] = [];
  const photos: PhotoRequest[] = [];
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { mode: 'meta', model: 'browser-fixture-only', photoAvailable: true } }),
  );
  await page.route('**/api/chat', async (route) => {
    chats.push(route.request().postDataJSON() as ChatRequest);
    await route.fulfill({
      json: { mode: 'meta', message: 'Fixture Meta reply for safe context.', proposals: [] },
    });
  });
  await page.route('**/api/photo', async (route) => {
    photos.push(route.request().postDataJSON() as PhotoRequest);
    await route.fulfill({
      status: 502,
      json: { error: 'Fixture-only photo transfer boundary checked.' },
    });
  });
  await page.getByRole('button', { name: 'Connect Meta API', exact: true }).click();
  const connection = page.getByRole('dialog', { name: 'Meta AI connection', exact: true });
  await connection
    .getByRole('button', { name: 'Check server settings again', exact: true })
    .click();
  await expect(connection).toContainText('Server configured: browser-fixture-only');
  await expect(connection).toContainText(
    'Local-demo history, OS observations, local matching identifiers and records created from Mac detection are excluded.',
  );
  await connection
    .getByRole('button', { name: 'I understand what will be sent · Enable Meta', exact: true })
    .click();
  await message.fill('Describe my manually entered connections.');
  await send.click();
  await expect.poll(() => chats.length).toBe(1);
  await expect(conversation.locator('.chat-message.assistant').last()).toContainText(
    'Fixture Meta reply for safe context.',
  );
  expect(chats[0].consent).toBe(true);
  expect(chats[0].history).toEqual([]);
  const { hardwareBinding: manualBinding, ...safeManual } = manual;
  expect(manualBinding).toBeDefined();
  function assertSafeContext(workspace: Workspace) {
    const encoded = JSON.stringify(workspace);
    expect(encoded).not.toContain(privateDevice.name);
    expect(encoded).not.toContain(privateDevice.model);
    expect(encoded).not.toContain('hardwareBinding');
    expect(encoded).not.toContain(firstDisplay.identity.key);
    expect(encoded).not.toContain(hub.identity.key);
    expect(workspace.devices.some((device) => device.id === privateDevice.id)).toBe(false);
    expect(workspace.devices.find((device) => device.id === manual.id)).toEqual(safeManual);
    expect(workspace.connections).toEqual(
      initial.connections.filter(
        (link) => link.from !== privateDevice.id && link.to !== privateDevice.id,
      ),
    );
    expect(workspace.history).toEqual([]);
  }
  assertSafeContext(chats[0].workspace);
  await message.fill('Which manual devices are recorded?');
  await send.click();
  await expect.poll(() => chats.length).toBe(2);
  expect(chats[1].history).toEqual([
    { role: 'user', content: 'Describe my manually entered connections.' },
    { role: 'assistant', content: 'Fixture Meta reply for safe context.' },
  ]);
  expect(JSON.stringify(chats)).not.toContain(privateDevice.name);
  expect(JSON.stringify(chats)).not.toContain(privateDevice.model);
  assertSafeContext(chats[1].workspace);

  await page.getByRole('button', { name: 'Desk photo', exact: true }).click();
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Desk photo file').setInputFiles({
    name: 'synthetic-privacy-fixture.png',
    mimeType: 'image/png',
    buffer: Buffer.from(image, 'base64'),
  });
  expect(photos).toHaveLength(0);
  await expect(
    page.getByRole('button', { name: 'Create scene preview with Meta', exact: true }),
  ).toBeDisabled();
  await page.getByRole('checkbox', { name: /I agree to send this photo/ }).check();
  await page.getByRole('button', { name: 'Create scene preview with Meta', exact: true }).click();
  await expect.poll(() => photos.length).toBe(1);
  await expect(
    page.getByText('Fixture-only photo transfer boundary checked.', { exact: true }),
  ).toBeVisible();
  expect(photos[0].consent).toBe(true);
  expect(photos[0].image).toMatch(/^data:image\/jpeg;base64,/);
  assertSafeContext(photos[0].workspace);
  expect(await saved(page)).toEqual(initial);
  expect(bridge.externalCalls).toBe(0);

  // Review evidence only: the filename explicitly identifies mocked hardware.
  const panel = await start(page);
  await panel.getByRole('button', { name: 'Close Mac hardware', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'OS detection summary', exact: true }),
  ).toContainText('4 OS observations · 2 matched desk devices');
  if (process.env.DESKTWIN_CAPTURE_REVIEW === '1') {
    await page.getByRole('button', { name: 'Meta connection settings', exact: true }).click();
    await page
      .getByRole('button', { name: 'Turn off Meta and use the local demo', exact: true })
      .click();
    const notice = page.getByRole('button', { name: 'Dismiss notification', exact: true });
    if (await notice.isVisible()) await notice.click();
    await page.screenshot({ path: 'docs/screenshots/hardware-overview-fixture.png' });
  }

  // This second page has no hardware routes. It checks this Linux server's real
  // unsupported-platform response, without invoking any native hardware scan.
  if (process.platform !== 'darwin') {
    const unsupported = await context.newPage();
    await unsupported.goto('/');
    await expect(unsupported.getByTestId('desk-canvas')).toBeVisible();
    const unsupportedPanel = await openHardware(unsupported);
    await expect(unsupportedPanel).toContainText(
      'Hardware detection requires macOS. This server is not running on a Mac.',
    );
    await unsupportedPanel.getByRole('checkbox', { name: /I agree to read this Mac/ }).check();
    await expect(
      unsupportedPanel.getByRole('button', { name: 'Start detection', exact: true }),
    ).toBeDisabled();
    await expect(rows(unsupportedPanel)).toHaveCount(0);
    if (process.env.DESKTWIN_CAPTURE_REVIEW === '1')
      await unsupported.screenshot({
        path: `docs/screenshots/hardware-unavailable-${process.platform}.png`,
      });
    await unsupported.close();
  }
});
