import { test, expect } from '@playwright/test';

for (const [kind, original, first, second, draft] of [
  ['number', 0.3, 1.8, 2.4, '2.6'],
  ['text', 'Original name', 'First name', 'Second name', 'Newer draft '],
] as const) {
  test(`${kind} input keeps accepted edits until parent publication without blur duplicates`, async ({
    page,
  }) => {
    await page.goto(`/tests/fixtures/commit-input.html?kind=${kind}`);
    const input = page.getByLabel('Edited value');
    const submissions = page.getByLabel('Submitted values');
    await input.fill(String(first));
    await input.press('Enter');
    await expect(submissions).toHaveText(JSON.stringify([first]));
    await page.getByRole('button', { name: 'Accept save', exact: true }).click();
    await expect(page.getByLabel('Last save result')).toHaveText('accept');
    // The command has resolved; its new value has deliberately not reached props.
    await expect(input).toHaveValue(String(first));
    await page.getByRole('button', { name: 'Focus elsewhere' }).click();
    await expect(submissions).toHaveText(JSON.stringify([first]));

    // Returning to the old prop is a new deliberate edit, even before publication.
    await input.fill(String(original));
    await input.press('Enter');
    await expect(submissions).toHaveText(JSON.stringify([first, original]));
    await page.getByRole('button', { name: 'Accept save', exact: true }).click();
    await page.getByRole('button', { name: 'Publish accepted value' }).click();
    await expect(input).toHaveValue(String(original));

    // A newer, uncommitted draft survives an earlier save and prop publication.
    await input.fill(String(second));
    await input.press('Enter');
    await input.fill(draft);
    await page.getByRole('button', { name: 'Accept save', exact: true }).click();
    await page.getByRole('button', { name: 'Publish accepted value' }).click();
    await expect(input).toHaveValue(draft);
    await expect(submissions).toHaveText(JSON.stringify([first, original, second]));
    await input.press('Escape');
    await expect(input).toHaveValue(String(second));

    // Both a rejected command and an exception restore the last accepted prop.
    await input.fill(String(first));
    await input.press('Enter');
    await page.getByRole('button', { name: 'Reject save' }).click();
    await expect(input).toHaveValue(String(second));
    await input.fill(String(original));
    await input.press('Enter');
    await page.getByRole('button', { name: 'Fail save' }).click();
    await expect(input).toHaveValue(String(second));
    await expect(page.getByRole('alert')).toHaveText('The change could not be saved.');
    await page.getByRole('button', { name: 'Focus elsewhere' }).click();
    await expect(submissions).toHaveText(
      JSON.stringify([first, original, second, first, original]),
    );
  });
}
