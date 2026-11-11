'use strict';

const { test, expect } = require('@playwright/test');

async function expectInsideViewport(locator, viewport, label) {
  const box = await locator.boundingBox();
  expect(box, `${label} should have a rendered box`).not.toBeNull();
  expect(box.x, `${label} should not clip left`).toBeGreaterThanOrEqual(-0.5);
  expect(box.y, `${label} should not clip above`).toBeGreaterThanOrEqual(-0.5);
  expect(box.x + box.width, `${label} should not clip right`).toBeLessThanOrEqual(viewport.width + 0.5);
  expect(box.y + box.height, `${label} should not clip below`).toBeLessThanOrEqual(viewport.height + 0.5);
  return box;
}

async function expectNoPageOverflow(page) {
  const overflow = await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth - window.innerWidth,
    vertical: document.documentElement.scrollHeight - window.innerHeight
  }));
  expect(overflow.horizontal, 'page should not overflow horizontally').toBeLessThanOrEqual(1);
  expect(overflow.vertical, 'page should not overflow vertically').toBeLessThanOrEqual(1);
}

test('3v3 schedule and team identities survive setup, reload and a side swap', async ({ page }) => {
  await page.goto('/');
  const group = page.getByRole('group', { name: 'Team format' });
  const points = page.getByRole('group', { name: 'Points per matchup' });
  await expect(group.getByRole('button')).toHaveCount(3);
  await expect(points).toHaveCount(0);
  await group.getByRole('button', { name: '3v3', exact: true }).click();
  await expect(points.getByRole('button', { name: '10 / 8 / 6' })).toHaveAttribute('aria-pressed', 'true');
  const presets = ['Wallabies 1', 'Koalas 1', 'Dragons 1', 'Gang-Gangs 1', 'Koalas 2', 'Dragons 2'];
  for (const side of ['Team A', 'Team B']) {
    const picker = page.getByRole('combobox', { name: `Choose a preset for ${side}` });
    await expect(picker).toBeVisible();
    await expect(picker.locator('option:enabled')).toHaveText(presets);
    await picker.selectOption(side === 'Team A' ? 'Wallabies 1' : 'Koalas 2');
  }
  await expect(page.getByLabel('Team A name')).toHaveValue('Wallabies 1');
  await expect(page.getByLabel('Team B name')).toHaveValue('Koalas 2');
  await page.getByLabel('Team B name').fill('Koalas 1');
  await page.getByRole('button', { name: 'Add player names' }).click();
  await page.getByLabel('Team B player 1').fill('Sam');
  await points.getByRole('button', { name: '10 every round' }).click();
  await page.reload();
  await expect(group.getByRole('button', { name: '3v3', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(points.getByRole('button', { name: '10 every round' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Start game' }).click();
  const servers = page.locator('.serve-pick button');
  await expect(servers).toHaveText(['Wallabies 1', 'Koalas 1']);
  await page.getByRole('button', { name: 'Swap sides' }).click();
  await expect(servers).toHaveText(['Koalas 1', 'Wallabies 1']);
  await page.getByRole('button', { name: 'Koalas 1', exact: true }).click();
  await page.getByRole('button', { name: 'Start rallies' }).click();
  await expect(page.locator('.zone .primary')).toHaveText(['Sam', 'Wallabies 1']);
  await expect(page.locator('.zone .secondary')).toHaveText(['Koalas 1', 'Player 1']);
  await expect(page.locator('.zone.b .serve-pill')).toBeVisible();
});

test('setup and scoring layouts fit the viewport', async ({ page }, testInfo) => {
  const viewport = testInfo.project.use.viewport;
  const landscape = viewport.width > viewport.height;
  await page.goto('/');

  const footer = page.locator('.setup-footer');
  const startGame = page.getByRole('button', { name: 'Start game' });
  const teamA = page.locator('#tname0');
  const teamB = page.locator('#tname1');
  const disclosure = page.getByRole('button', { name: 'Add player names' });

  await expect(startGame).toBeVisible();
  const footerBox = await expectInsideViewport(footer, viewport, 'setup footer');
  await expectInsideViewport(startGame, viewport, 'Start game button');
  const teamABox = await expectInsideViewport(teamA, viewport, 'Team A field');
  const teamBBox = await expectInsideViewport(teamB, viewport, 'Team B field');

  if (landscape) {
    expect(teamABox.y + teamABox.height, 'Team A should stay above the fixed footer').toBeLessThanOrEqual(footerBox.y + 0.5);
    expect(teamBBox.y + teamBBox.height, 'Team B should stay above the fixed footer').toBeLessThanOrEqual(footerBox.y + 0.5);
    const disclosureBox = await disclosure.boundingBox();
    expect(disclosureBox.y, 'landscape should place optional player names after team fields')
      .toBeGreaterThanOrEqual(Math.max(teamABox.y + teamABox.height, teamBBox.y + teamBBox.height) - 0.5);
    await disclosure.scrollIntoViewIfNeeded();
    const scrolledDisclosure = await expectInsideViewport(disclosure, viewport, 'player-name disclosure');
    const scrolledFooter = await footer.boundingBox();
    expect(scrolledDisclosure.y + scrolledDisclosure.height, 'disclosure should remain reachable above the footer')
      .toBeLessThanOrEqual(scrolledFooter.y + 0.5);
  } else {
    const disclosureBox = await expectInsideViewport(disclosure, viewport, 'player-name disclosure');
    expect(disclosureBox.y + disclosureBox.height, 'portrait should place player names before team fields')
      .toBeLessThanOrEqual(Math.min(teamABox.y, teamBBox.y) + 0.5);
    for (const [field, label] of [[teamA, 'Team A field'], [teamB, 'Team B field']]) {
      await field.scrollIntoViewIfNeeded();
      const fieldBox = await expectInsideViewport(field, viewport, label);
      const currentFooter = await footer.boundingBox();
      expect(fieldBox.y + fieldBox.height, `${label} should be reachable above the footer`)
        .toBeLessThanOrEqual(currentFooter.y + 0.5);
    }
  }

  await expectNoPageOverflow(page);
  await startGame.click();

  const startRallies = page.getByRole('button', { name: 'Start rallies' });
  await expect(startRallies).toBeVisible();
  await expectInsideViewport(page.locator('.overlay'), viewport, 'matchup overlay');
  await expectInsideViewport(startRallies, viewport, 'Start rallies button');
  await startRallies.click();

  await expect(page.locator('.zones')).toBeVisible();
  await expectInsideViewport(page.locator('.topbar'), viewport, 'game header');
  await expectInsideViewport(page.locator('.stage'), viewport, 'scoring stage');
  await expectInsideViewport(page.locator('.zone.a'), viewport, 'Team A scoring zone');
  await expectInsideViewport(page.locator('.zone.b'), viewport, 'Team B scoring zone');
  await expectNoPageOverflow(page);
});
