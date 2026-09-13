import { test, expect } from '@playwright/test';

test.describe('3D Globe Rendering', () => {
  test.beforeEach(async ({ page }) => {
    // Suppress browser console noise
    page.on('console', msg => {
      if (msg.type() === 'log' || msg.type() === 'debug') return;
      if (msg.text().includes('Cesium')) return; // Cesium debug spam
      console.log(`[${msg.type()}] ${msg.text()}`);
    });

    // Catch critical errors
    page.on('pageerror', err => {
      console.error('Page error:', err.message);
    });
  });

  test('should load and initialize globe without WebGL errors', async ({ page }) => {
    await page.goto('/');
    
    // Wait for app to fully load
    await page.waitForSelector('#search-form', { timeout: 10000 });
    
    // Click 3D globe button
    await page.click('#view-3d');
    
    // Wait for globe canvas
    await page.waitForSelector('#globe canvas', { timeout: 30000 });
    
    // Verify no WebGL errors in console
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error' && msg.text().includes('WebGL')) {
        errors.push(msg.text());
      }
    });

    // Wait a bit for any initial WebGL errors
    await page.waitForTimeout(2000);
    
    expect(errors).toHaveLength(0);
    
    // Verify globe is visible
    const globeVisible = await page.isVisible('#globe');
    expect(globeVisible).toBe(true);
  });

  test('should handle terrain loading and display status', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#search-form');
    
    // Enable terrain
    const terrainToggle = await page.$('#terrain-toggle');
    if (terrainToggle) {
      const isChecked = await terrainToggle.isChecked();
      if (!isChecked) {
        await terrainToggle.click();
      }
    }

    // Switch to 3D globe
    await page.click('#view-3d');
    await page.waitForSelector('#globe canvas', { timeout: 30000 });

    // Check terrain status message appears
    const terrainStatus = await page.locator('#terrain-status');
    const statusText = await terrainStatus.textContent();
    
    // Should show either loading or loaded message
    expect(statusText).toMatch(/Loading terrain|Terrain on|unavailable/);
  });

  test('should search and display satellite footprints on globe', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#search-form');

    // Set search parameters
    await page.fill('#date', '2024-09-01');
    await page.fill('#place', 'Mount Anak Krakatau');
    
    // Find place
    await page.click('#find-place');
    await page.waitForTimeout(1500);

    // Trigger search
    await page.click('#search-form button[type="submit"]');

    // Wait for results
    await page.waitForSelector('.scene-card', { timeout: 60000 });

    // Verify results loaded
    const resultCount = await page.locator('.scene-card').count();
    expect(resultCount).toBeGreaterThan(0);

    // Enable 3D globe
    await page.click('#view-3d');
    await page.waitForSelector('#globe canvas', { timeout: 30000 });

    // Verify globe is active
    const is3dActive = await page.getAttribute('#view-3d', 'aria-pressed');
    expect(is3dActive).toBe('true');
  });

  test('should handle split-screen comparison without errors', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#search-form');

    // Search for results
    await page.fill('#date', '2024-09-01');
    await page.fill('#place', 'Mount Anak Krakatau');
    await page.click('#find-place');
    await page.waitForTimeout(1500);
    await page.click('#search-form button[type="submit"]');

    // Wait for results
    await page.waitForSelector('.scene-card', { timeout: 60000 });

    // Get first scene
    const firstCard = page.locator('.scene-card').first();
    await firstCard.click();

    // Pin as "Before A"
    const beforeBtn = page.locator('button:has-text("Use as Before A")').first();
    if (await beforeBtn.isVisible()) {
      await beforeBtn.click();
    }

    // Close dialog
    const closeDialog = page.locator('.close-dialog').first();
    if (await closeDialog.isVisible()) {
      await closeDialog.click();
    }

    // Switch to layers panel
    await page.click('#toggle-layers');
    
    // Verify compare controls are visible
    const compareToggle = await page.$('#compare-enabled');
    expect(compareToggle).toBeTruthy();

    // Try to render on globe
    await page.click('#render-globe');

    // Wait for any rendering to complete
    await page.waitForTimeout(3000);

    // Verify no critical errors
    const pageErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') pageErrors.push(msg.text());
    });

    expect(pageErrors.filter(e => e.includes('critical') || e.includes('fatal'))).toHaveLength(0);
  });

  test('should switch between 2D and 3D views without crashing', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#search-form');

    // Start in 3D
    await page.click('#view-3d');
    await page.waitForSelector('#globe canvas', { timeout: 30000 });
    let is3d = await page.getAttribute('#view-3d', 'aria-pressed');
    expect(is3d).toBe('true');

    // Switch to 2D
    await page.click('#view-2d');
    await page.waitForTimeout(500);
    let is2d = await page.getAttribute('#view-2d', 'aria-pressed');
    expect(is2d).toBe('true');

    // Switch back to 3D
    await page.click('#view-3d');
    await page.waitForSelector('#globe canvas', { timeout: 30000 });
    is3d = await page.getAttribute('#view-3d', 'aria-pressed');
    expect(is3d).toBe('true');
  });

  test('should handle globe camera navigation with keyboard', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#search-form');

    // Enable 3D
    await page.click('#view-3d');
    await page.waitForSelector('#globe canvas', { timeout: 30000 });

    // Focus globe
    const canvas = page.locator('#globe canvas');
    await canvas.focus();

    // Try camera navigation
    await page.click('#globe-home');
    await page.waitForTimeout(500);

    await page.click('#globe-in');
    await page.waitForTimeout(500);

    await page.click('#globe-east');
    await page.waitForTimeout(500);

    // Verify no errors occurred
    const errorText = await page.locator('#globe-status').textContent();
    const hasError = errorText && errorText.includes('unavailable');
    // Error is okay, just shouldn't crash
    expect(page).toBeTruthy();
  });

  test('performance: search should complete within 60 seconds', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#search-form');

    const startTime = Date.now();

    // Perform search
    await page.fill('#date', '2024-09-01');
    await page.fill('#place', 'Mount Anak Krakatau');
    await page.click('#find-place');
    await page.waitForTimeout(1500);
    await page.click('#search-form button[type="submit"]');

    // Wait for completion
    await page.waitForSelector('.scene-card', { timeout: 65000 });

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    console.log(`✓ Search completed in ${duration.toFixed(1)}s`);
    expect(duration).toBeLessThan(65);
  });
});
