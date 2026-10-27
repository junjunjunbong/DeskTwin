import { test, expect } from '@playwright/test';
const key = 'desktwin.workspace.v1';
let pageErrors: string[] = [];
test.beforeEach(async ({ page }) => { pageErrors = []; page.on('pageerror', e => pageErrors.push(e.message)); });
test.afterEach(() => { expect(pageErrors).toEqual([]); });
test('renders a real canvas without claiming detected hardware', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await expect(page.getByTestId('desk-canvas')).toBeVisible();
  await expect(page.getByText('예시 기반 3D 장면 · 실시간 감지 아님')).toBeVisible();
  await page.getByRole('button', { name: '기기 목록', exact: true }).click();
  await expect(page.getByRole('button', { name: /MacBook 노트북/ })).toBeVisible();
  await page.getByRole('button', { name: /USB-C Dock Dock/ }).click();
  await expect(page.getByRole('complementary', { name: '선택한 기기' })).toBeVisible();
  await expect(page.getByLabel('작동 상태 사용자 확인')).toHaveValue('unknown');
  expect(errors).toEqual([]);
});
test('adds a device and persists across reload', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '기기 추가', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '기기 추가' });
  await modal.getByLabel('기기 이름').fill('테스트 디스플레이');
  await modal.getByRole('button', { name: '내 책상에 추가' }).click();
  await page.reload(); await page.getByRole('button', { name: '기기 목록', exact: true }).click();
  await expect(page.getByRole('button', { name: /테스트 디스플레이 모니터/ })).toBeVisible();
  const stored = await page.evaluate(k => JSON.parse(localStorage.getItem(k)!), key);
  expect(stored.devices.find((d: {name: string}) => d.name === '테스트 디스플레이').source).toBe('user-reported');
  expect(stored.devices.find((d: {name: string}) => d.name === '테스트 디스플레이').status).toBe('unknown');
});
test('conversation proposals require confirmation and never verify operation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'DeskTwin에게 메시지' }).fill('오른쪽 모니터를 Dock에 HDMI로 연결했어');
  await page.getByRole('button', { name: '메시지 보내기' }).click();
  await expect(page.getByRole('button', { name: '확인하고 반영' })).toBeVisible();
  expect(await page.evaluate(k => localStorage.getItem(k), key)).toBeNull();
  await page.getByRole('button', { name: '확인하고 반영' }).click();
  const stored = await page.evaluate(k => JSON.parse(localStorage.getItem(k)!), key);
  expect(stored.connections.filter((c: {source: string}) => c.source === 'user-reported')).toHaveLength(1);
  expect(stored.devices.every((d: {status: string}) => d.status === 'unknown')).toBe(true);
  await expect(page.getByText('확인 후 반영됨')).toBeVisible();
});
test('supports manual connections and undo', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '연결 보기', exact: true }).click();
  await page.getByRole('button', { name: '연결 추가', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '연결 관계 알려주기' });
  await modal.getByLabel('첫 번째 기기').selectOption('laptop'); await modal.getByLabel('두 번째 기기').selectOption('monitor-right');
  await modal.getByLabel('연결 방식').selectOption('HDMI');
  await modal.getByRole('button', { name: '사용자 입력으로 저장' }).click();
  let stored = await page.evaluate(k => JSON.parse(localStorage.getItem(k)!), key); expect(stored.connections).toHaveLength(8);
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  stored = await page.evaluate(k => JSON.parse(localStorage.getItem(k)!), key); expect(stored.connections).toHaveLength(7);
});
test('rejects invalid import without replacing the workspace', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '설정 열기' }).click();
  await page.getByLabel('작업실 이름').fill('보존할 작업실'); await page.getByRole('dialog').getByLabel('조명').focus();
  const before = await page.evaluate(k => localStorage.getItem(k), key);
  await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":999}') });
  await expect(page.getByText('올바른 DeskTwin v1 JSON 파일이 아닙니다. 기존 구성은 유지했습니다.')).toBeVisible();
  expect(await page.evaluate(k => localStorage.getItem(k), key)).toBe(before);
});
test('mobile layout fits the viewport and opens a usable device dialog', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByTestId('desk-canvas')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: '기기 추가', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.screenshot({ path: 'docs/screenshots/hero-mobile.png' });
});
