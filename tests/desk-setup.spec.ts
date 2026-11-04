import { expect, test, type Page } from '@playwright/test';
import { createDemoWorkspace, type Workspace } from '../src/domain/workspace';
import { stoppedHardwareSnapshot, type HardwareSnapshot } from '../src/domain/hardware';
import type { SceneProposal, SceneProposalItem } from '../src/domain/sceneProposal';

const storageKey = 'desktwin.workspace.v1';
test.setTimeout(75_000);

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  (page as Page & { setupErrors?: string[] }).setupErrors = errors;
  // Fixture-only coverage: no paid provider fallback or actual native detection.
  await page.route('**/api/chat', (route) => route.abort('blockedbyclient'));
  await page.route('**/api/photo', (route) => route.abort('blockedbyclient'));
  await page.route('**/api/hardware/**', (route) =>
    route.fulfill({ status: 503, json: { error: 'Native detection is disabled for this test.' } }),
  );
});
test.afterEach(async ({ page }) => {
  expect((page as Page & { setupErrors?: string[] }).setupErrors).toEqual([]);
});

async function seed(page: Page, workspace: Workspace) {
  await page.addInitScript(
    ({ key, value }) => {
      if (!sessionStorage.getItem('setup-seeded')) {
        localStorage.setItem(key, JSON.stringify(value));
        sessionStorage.setItem('setup-seeded', 'yes');
      }
    },
    { key: storageKey, value: workspace },
  );
  await page.goto('/');
  await expect(page.getByTestId('desk-canvas')).toBeVisible();
}
async function saved(page: Page): Promise<Workspace> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey);
}
async function openDeskPhoto(page: Page) {
  const overview = page.getByRole('complementary', { name: 'Workspace overview', exact: true });
  if (!(await overview.isVisible()))
    await page.getByRole('button', { name: 'My desk', exact: true }).click();
  const expand = page.getByRole('button', { name: /Expand details and controls/ });
  if (!(await overview.isVisible()) && (await expand.isVisible())) await expand.click();
  await overview.getByRole('button', { name: 'Build from a photo', exact: true }).click();
}
async function sendMessage(page: Page, message: string) {
  const input = page.getByRole('textbox', { name: 'Message DeskTwin' });
  if (!(await input.isVisible()))
    await page.getByRole('button', { name: 'AI chat', exact: true }).click();
  await input.fill(message);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
}
async function openSetup(page: Page) {
  await page.getByRole('button', { name: 'Hardware', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Hardware panel', exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

test('setup requires reviewing a replacement and preserves the original on cancel', async ({
  page,
}) => {
  const initial = createDemoWorkspace();
  await seed(page, initial);
  const panel = await openSetup(page);
  await panel.getByRole('button', { name: 'Connections', exact: true }).click();
  await expect(
    panel.getByRole('button', { name: 'Review connection', exact: true }),
  ).toBeDisabled();
  await panel.getByRole('button', { name: 'Edit connections', exact: true }).click();
  await panel.getByLabel('Setup first device', { exact: true }).selectOption('monitor-right');
  await panel.getByLabel('Setup connected device', { exact: true }).selectOption('dock');
  await panel.getByLabel('Setup connector', { exact: true }).selectOption('DisplayPort');
  await panel.getByLabel('Setup first port', { exact: true }).fill('DP input');
  await panel.getByRole('button', { name: 'Review connection', exact: true }).click();
  const confirmation = panel.getByRole('region', { name: 'Confirm setup connection', exact: true });
  await expect(confirmation).toContainText('Replace the existing connection?');
  await expect(confirmation).toContainText('HDMI');
  expect((await saved(page)).connections).toEqual(initial.connections);
  await confirmation.getByRole('button', { name: 'Cancel connection', exact: true }).click();
  expect((await saved(page)).connections).toEqual(initial.connections);
  await panel.getByRole('button', { name: 'Review connection', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Confirm replacement', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await saved(page)).connections.find(
          (edge) => edge.from === 'monitor-right' && edge.to === 'dock',
        )?.connector,
    )
    .toBe('DisplayPort');
  const result = await saved(page);
  expect(result.connections).toHaveLength(initial.connections.length);
  expect(result.devices).toEqual(initial.devices);
  expect(result.connections.find((edge) => edge.from === 'monitor-right')).toMatchObject({
    fromPort: 'DP input',
    source: 'user-reported',
  });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await saved(page)).connections).toEqual(initial.connections);
});

test('photo approval carries notes through reviewed connections, a saved monitor check, and conversation', async ({
  page,
}, testInfo) => {
  const item = (
    id: string,
    kind: SceneProposalItem['kind'],
    name: string,
    x: number,
    z: number,
    y = 2.51,
  ): SceneProposalItem => ({
    id,
    deviceId: null,
    kind,
    name,
    placement: { x, y, z, rotation: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: '#829575',
    parts: [],
    note: 'Synthetic photo fixture; approximate visual placement only.',
  });
  const fixture: SceneProposal = {
    message: 'Review this synthetic photo scene.',
    objects: [
      item('desk', 'desk', 'Photo desk', 0, 0, 0),
      item('laptop', 'laptop', 'Photo laptop', -1.8, 0),
      item('dock', 'dock', 'Photo dock', 0, 0.3),
      item('monitor', 'monitor', 'Photo monitor', 1.2, -0.6),
    ],
  };
  let photoCalls = 0;
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { mode: 'meta', model: 'setup-fixture-only' } }),
  );
  await page.route('**/api/photo', (route) => {
    photoCalls++;
    return route.fulfill({ json: { mode: 'meta', ...fixture } });
  });
  await seed(page, createDemoWorkspace());
  await openDeskPhoto(page);
  const photo = page.getByRole('complementary', { name: 'Desk photo panel', exact: true });
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    canvas.getContext('2d')!.fillRect(0, 0, 8, 8);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Desk photo file').setInputFiles({
    name: 'synthetic-setup.png',
    mimeType: 'image/png',
    buffer: Buffer.from(data, 'base64'),
  });
  const note = 'I connected Photo monitor to Photo dock with HDMI.';
  await photo.getByLabel('Device and connection notes', { exact: true }).fill(note);
  expect(photoCalls).toBe(0);
  await photo.getByRole('checkbox', { name: /I agree to send this photo/ }).check();
  await photo.getByRole('button', { name: 'Create scene preview with Meta', exact: true }).click();
  await page.getByRole('button', { name: /^Continue with \d+ objects?$/ }).click();
  const preview = page.getByRole('dialog', { name: 'Review your desk scene', exact: true });
  await expect(preview).toBeVisible();
  expect((await saved(page)).devices.some((device) => device.name === 'Photo monitor')).toBe(false);
  await preview.getByRole('button', { name: 'Confirm and apply scene', exact: true }).click();
  await expect(preview).toHaveCount(0);
  await photo
    .getByRole('button', { name: 'Next: check connections in Hardware', exact: true })
    .click();
  const panel = page.getByRole('complementary', { name: 'Hardware panel', exact: true });
  await expect(panel.getByRole('button', { name: 'Connections', exact: true })).toHaveAttribute(
    'aria-current',
    'step',
  );
  await expect(panel).toContainText(note);
  expect((await saved(page)).connections).toHaveLength(0);
  await panel
    .getByRole('button', {
      name: /^Review: Photo (?:dock|monitor) → Photo (?:dock|monitor) · HDMI$/,
    })
    .click();
  await expect(panel.getByLabel('Setup connector', { exact: true })).toHaveValue('HDMI');
  await panel.getByRole('button', { name: 'Edit connections', exact: true }).click();
  await panel.getByRole('button', { name: 'Review connection', exact: true }).click();
  expect((await saved(page)).connections).toHaveLength(0);
  await panel.getByRole('button', { name: 'Confirm connection', exact: true }).click();
  await expect.poll(async () => (await saved(page)).connections.length).toBe(1);
  const result = await saved(page);
  expect(result.connections[0]).toMatchObject({ connector: 'HDMI', source: 'user-reported' });
  expect(result.devices.every((device) => device.status === 'unknown')).toBe(true);
  expect(JSON.stringify(result)).not.toContain('data:image');
  expect(JSON.stringify(result)).not.toContain(note);
  expect(photoCalls).toBe(1);
  const monitorId = result.devices.find((device) => device.name === 'Photo monitor')!.id;
  const dockId = result.devices.find((device) => device.name === 'Photo dock')!.id;
  const laptopId = result.devices.find((device) => device.name === 'Photo laptop')!.id;
  await panel.getByLabel('Setup first device', { exact: true }).selectOption(dockId);
  await panel.getByLabel('Setup connected device', { exact: true }).selectOption(laptopId);
  await panel.getByLabel('Setup connector', { exact: true }).selectOption('USB-C');
  await panel.getByRole('button', { name: 'Review connection', exact: true }).click();
  expect((await saved(page)).connections).toHaveLength(1);
  await panel.getByRole('button', { name: 'Confirm connection', exact: true }).click();
  await expect.poll(async () => (await saved(page)).connections.length).toBe(2);
  await panel.getByRole('button', { name: 'Check a monitor', exact: true }).click();
  await panel.getByRole('button', { name: /^Photo monitor / }).click();
  const inspector = page.getByRole('complementary', { name: 'Selected device', exact: true });
  await expect(
    inspector.getByRole('heading', { name: 'Photo monitor', exact: true }),
  ).toBeVisible();
  await inspector
    .getByRole('button', { name: 'Troubleshoot monitor step by step', exact: true })
    .click();
  const check = inspector.getByRole('region', { name: 'Monitor troubleshooting', exact: true });
  await check.getByRole('button', { name: 'Still no display', exact: true }).click();
  await check
    .getByRole('button', { name: 'This matches my checked connections', exact: true })
    .click();
  await expect(
    check.getByRole('heading', { name: 'Check the current cable connection', exact: true }),
  ).toBeVisible();
  await check.getByRole('button', { name: 'The screen works', exact: true }).click();
  await expect.poll(async () => (await saved(page)).diagnoses[0].result).toBe('resolved');
  expect((await saved(page)).devices.find((device) => device.id === monitorId)!.status).toBe(
    'unknown',
  );
  await check.getByRole('button', { name: 'Save result as user-reported', exact: true }).click();
  await expect
    .poll(async () => (await saved(page)).devices.find((device) => device.id === monitorId)!.status)
    .toBe('reported-working');
  const completed = await saved(page);
  expect(completed.diagnoses[0].path.deviceIds).toEqual([monitorId, dockId, laptopId]);
  expect(completed.diagnoses[0].answers.map((answer) => answer.answer)).toEqual([
    'not-fixed',
    'confirmed',
    'fixed',
  ]);
  expect(completed.devices.find((device) => device.id === monitorId)!.statusNote).toContain(
    'Cause not determined',
  );
  await inspector.getByRole('button', { name: 'Ask about this device', exact: true }).click();
  const conversation = page.getByRole('complementary', {
    name: 'DeskTwin conversation',
    exact: true,
  });
  await expect(conversation.getByRole('combobox', { name: 'Conversation target' })).toHaveValue(
    monitorId,
  );
  await sendMessage(page, 'What should I check next?');
  await expect(conversation.locator('.chat-message.assistant')).toContainText('Saved user checks');
  await expect(conversation.locator('.chat-message.assistant')).toContainText(
    'Cause not determined',
  );
  expect(await saved(page)).toEqual(completed);
  expect(JSON.stringify(completed)).not.toContain('data:image');
  await page.screenshot({ path: testInfo.outputPath('photo-to-check-completed.png') });
});

test('a photo record is matched to an OS observation only after local consent and explicit approval', async ({
  page,
}) => {
  const initial = createDemoWorkspace();
  const monitor = initial.devices.find((device) => device.id === 'monitor-right')!;
  monitor.source = 'photo-inferred';
  monitor.visual.source = 'photo-inferred';
  monitor.status = 'reported-issue';
  monitor.statusNote = 'I see a black screen.';
  const checkedAt = '2026-10-31T03:00:00.000Z';
  const snapshot: HardwareSnapshot = {
    ...stoppedHardwareSnapshot(),
    state: 'running',
    sessionId: 'setup_session_fixture',
    identityScope: 'setup_installation_fixture',
    lastCheckedAt: checkedAt,
    message: 'Synthetic local observation.',
    categories: {
      ...stoppedHardwareSnapshot().categories,
      display: {
        state: 'ok',
        source: 'Synthetic display fixture',
        lastCheckedAt: checkedAt,
        message: 'Fixture display enumeration.',
      },
    },
    devices: [
      {
        id: 'setup-display',
        category: 'display',
        name: 'Fixture display',
        model: 'Synthetic test display',
        source: 'Synthetic display fixture',
        identity: {
          key: 'setup_display_fixture',
          stability: 'persistent',
          scope: 'setup_installation_fixture',
        },
        status: 'online',
        parentId: null,
        attributes: [],
      },
    ],
  };
  let starts = 0;
  await page.route('**/api/hardware/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/session'))
      return route.fulfill({
        json: {
          token: 'setup-fixture-token-only',
          platform: 'darwin',
          available: true,
          message: 'Fixture-only availability.',
        },
      });
    if (path.endsWith('/start')) {
      starts++;
      return route.fulfill({ json: snapshot });
    }
    if (path.endsWith('/snapshot')) return route.fulfill({ json: snapshot });
    return route.fulfill({ json: stoppedHardwareSnapshot() });
  });
  await seed(page, initial);
  const panel = await openSetup(page);
  await panel.getByRole('button', { name: 'Devices', exact: true }).click();
  const record = panel.locator('.desk-setup-device').filter({
    has: page.getByRole('button', { name: 'Review device Right monitor', exact: true }),
  });
  await expect(record).toContainText('Photo-inferred');
  await record.getByRole('button', { name: 'Match local observation', exact: true }).click();
  expect(starts).toBe(0);
  await panel.locator('summary').filter({ hasText: 'Compare with this Mac' }).click();
  const start = panel.getByRole('button', { name: 'Start local detection', exact: true });
  await expect(start).toBeDisabled();
  await panel
    .getByRole('checkbox', {
      name: 'I agree to read this Mac’s hardware metadata locally.',
      exact: true,
    })
    .check();
  await start.click();
  await record
    .getByLabel('Local observation for Right monitor', { exact: true })
    .selectOption('setup-display');
  await record.getByRole('button', { name: 'Review this OS match', exact: true }).click();
  expect(
    (await saved(page)).devices.find((device) => device.id === monitor.id)?.hardwareBinding,
  ).toBeUndefined();
  await record.getByRole('button', { name: 'Confirm OS match', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await saved(page)).devices.find((device) => device.id === monitor.id)?.hardwareBinding
          ?.identity.key,
    )
    .toBe('setup_display_fixture');
  const result = await saved(page);
  expect(result.devices.find((device) => device.id === monitor.id)).toMatchObject({
    source: 'photo-inferred',
    visual: monitor.visual,
    status: monitor.status,
    statusNote: monitor.statusNote,
  });
  expect(result.connections).toEqual(initial.connections);
  expect(starts).toBe(1);
  await expect(record).toContainText('OS detected');
  await panel.getByRole('button', { name: 'Stop local detection', exact: true }).click();
  await expect(record).toContainText('Detection stopped');
});

test('setup stays inside the contextual panel on a narrow screen', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, createDemoWorkspace());
  const panel = await openSetup(page);
  await panel.getByRole('button', { name: 'Connections', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Edit connections', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const scene = (await page.getByTestId('desk-canvas').boundingBox())!;
  expect(scene.height).toBeGreaterThan(100);
  await page.screenshot({ path: testInfo.outputPath('setup-mobile.png') });
});

test('photo notes open on connections, reveal the saved path, and scroll the monitor check into view', async ({
  page,
}) => {
  const item = (
    id: string,
    kind: SceneProposalItem['kind'],
    name: string,
    x: number,
    z: number,
    y = 2.51,
  ): SceneProposalItem => ({
    id,
    deviceId: null,
    kind,
    name,
    placement: { x, y, z, rotation: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: '#829575',
    parts: [],
    note: 'Synthetic photo fixture; approximate visual placement only.',
  });
  const fixture: SceneProposal = {
    message: 'Review this synthetic photo scene.',
    objects: [
      item('desk', 'desk', 'Photo desk', 0, 0, 0),
      item('left', 'monitor', 'Left computer monitor', -1.2, -0.9),
      item('right', 'monitor', 'Right computer monitor', 1.6, -0.9),
      item('dock', 'dock', 'Silver docking station', 0.2, 0.7),
      item('laptop', 'laptop', 'Silver laptop', -2.8, 0.8),
    ],
  };
  const note =
    'The right monitor is connected to the dock with HDMI. The dock is connected to the laptop USB-C port. The right monitor shows nothing.';
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { mode: 'meta', model: 'visibility-fixture-only' } }),
  );
  await page.route('**/api/photo', (route) =>
    route.fulfill({ json: { mode: 'meta', ...fixture } }),
  );
  await seed(page, createDemoWorkspace());
  await page.getByRole('button', { name: 'AI chat', exact: true }).click();
  await expect(
    page.getByText('Chat: local demo · Photo analysis: Meta, after your consent'),
  ).toBeVisible();
  await openDeskPhoto(page);
  const photo = page.getByRole('complementary', { name: 'Desk photo panel', exact: true });
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    canvas.getContext('2d')!.fillRect(0, 0, 8, 8);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Desk photo file').setInputFiles({
    name: 'synthetic-visibility.png',
    mimeType: 'image/png',
    buffer: Buffer.from(data, 'base64'),
  });
  await photo.getByLabel('Device and connection notes', { exact: true }).fill(note);
  await photo.getByRole('checkbox', { name: /I agree to send this photo/ }).check();
  await photo.getByRole('button', { name: 'Create scene preview with Meta', exact: true }).click();
  await page.getByRole('button', { name: /^Continue with \d+ objects?$/ }).click();
  const preview = page.getByRole('dialog', { name: 'Review your desk scene', exact: true });
  await preview.getByRole('button', { name: 'Confirm and apply scene', exact: true }).click();
  await expect(preview).toHaveCount(0);
  await photo
    .getByRole('button', { name: 'Next: check connections in Hardware', exact: true })
    .click();
  const panel = page.getByRole('complementary', { name: 'Hardware panel', exact: true });
  await expect(panel.getByRole('button', { name: 'Connections', exact: true })).toHaveAttribute(
    'aria-current',
    'step',
  );
  await expect(panel).toContainText('The photo did not verify these connections.');
  const hdmi = panel.getByRole('button', {
    name: 'Review: Right computer monitor → Silver docking station · HDMI',
    exact: true,
  });
  const usb = panel.getByRole('button', {
    name: 'Review: Silver docking station → Silver laptop · USB-C',
    exact: true,
  });
  await expect(hdmi).toBeVisible();
  await expect(usb).toBeVisible();
  await hdmi.click();
  await expect(panel.getByLabel('Setup connector', { exact: true })).toHaveValue('HDMI');
  await panel.getByRole('button', { name: 'Edit connections', exact: true }).click();
  await panel.getByRole('button', { name: 'Review connection', exact: true }).click();
  expect((await saved(page)).connections).toHaveLength(0);
  await panel.getByRole('button', { name: 'Confirm connection', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Show connections' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('region', { name: 'Focused connection path' })).toContainText(
    'Right computer monitor',
  );
  await expect(page.getByRole('region', { name: 'Focused connection path' })).toContainText(
    'Silver docking station',
  );
  await panel.getByRole('button', { name: 'Continue to a check', exact: true }).click();
  await panel.getByRole('button', { name: /^Right computer monitor/ }).click();
  await expect(
    page
      .getByRole('group', { name: 'Workspace mode' })
      .getByRole('button', { name: 'View', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  const inspector = page.getByRole('complementary', { name: 'Selected device', exact: true });
  await expect(
    inspector.getByRole('button', { name: 'Troubleshoot monitor step by step', exact: true }),
  ).toBeInViewport();
});

test('a local demo reply about the selected device focuses its recorded path', async ({ page }) => {
  await seed(page, createDemoWorkspace());
  await page
    .getByRole('complementary', { name: 'Workspace overview', exact: true })
    .getByRole('button', { name: /Right monitor Monitor/ })
    .click();
  await expect(page.getByRole('region', { name: 'Focused connection path' })).toHaveCount(0);
  await sendMessage(page, 'What should I check next for this monitor?');
  const conversation = page.getByRole('complementary', {
    name: 'DeskTwin conversation',
    exact: true,
  });
  await expect(conversation.locator('.chat-message.assistant')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Focused connection path' })).toBeVisible();
  await expect(
    conversation.getByRole('button', {
      name: 'Show current recorded path for Right monitor',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Show connections' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});
test('hardware opens on connections for several devices and keeps the Mac summary with devices', async ({
  page,
}) => {
  await seed(page, createDemoWorkspace());
  const panel = await openSetup(page);
  await expect(panel.getByRole('heading', { name: 'Hardware', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Connections', exact: true })).toHaveAttribute(
    'aria-current',
    'step',
  );
  await panel.getByRole('button', { name: 'Devices', exact: true }).click();
  await expect(
    panel.getByRole('region', { name: 'OS detection summary', exact: true }),
  ).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Mac recognition', exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'User reports', exact: true })).toBeVisible();
  await expect(
    panel.getByRole('button', { name: 'Open Mac hardware details', exact: true }),
  ).toBeVisible();
});
