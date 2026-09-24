import { expect, test, type Page } from "@playwright/test";

const CLOUD_ORIGIN = "http://localhost:8787";

/** Answer cloud translation with a deterministic payload and cache layer. */
async function mockCloudTranslation(page: Page, cacheLayer = "redis"): Promise<void> {
  await page.route(`${CLOUD_ORIGIN}/v1/translate`, async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as {
      text?: string;
      from?: string;
      to?: string;
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        requestId: "e2e-request",
        sourceText: body.text ?? "",
        targetText: `[${body.from}->${body.to}] ${body.text ?? ""}`,
        cacheLayer,
        latencyMs: 7,
      }),
    });
  });
}

async function translatePage(page: Page): Promise<void> {
  await page.getByRole("button", { name: "翻译网页" }).click();
  await expect(page.locator(".meta-table tbody tr").first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".demo-app")).toBeVisible();
  await expect(page.locator("#demo-article p")).toHaveCount(5);
});

test("扫描正文并逐段渲染译文与云端元数据", async ({ page }) => {
  await mockCloudTranslation(page, "redis");
  await translatePage(page);

  const targets = page.locator('[data-imt="target"]');
  await expect(targets).toHaveCount(7);
  await expect(page.locator(".meta-table tbody tr")).toHaveCount(7);
  await expect(page.locator(".meta-table tbody tr").first().locator("td").nth(2)).toHaveText(
    "redis",
  );
  await expect(page.locator(".meta-table tbody tr").first().locator("td").nth(3)).toHaveText(
    "7ms",
  );
  await expect(page.locator(".meta-table tbody tr").first().locator("td").nth(4)).toHaveText(
    "cloud",
  );
  await expect(page.locator(".page-report")).toContainText("缓存层: redis");
});

test("快速、专业和研究模式正确切换展示与原文 DOM", async ({ page }) => {
  await mockCloudTranslation(page);
  await translatePage(page);

  const targets = page.locator('[data-imt="target"]');
  await expect(page.locator(".imt-target-replace")).toHaveCount(await targets.count());
  expect(await page.locator(".imt-source-hidden").count()).toBeGreaterThan(0);

  await page.locator(".mode-row").getByRole("button", { name: "专业" }).click();
  await expect(page.locator(".imt-target-replace")).toHaveCount(0);

  await page.locator(".mode-row").getByRole("button", { name: "研究" }).click();
  const hiddenBefore = await page.locator(".imt-research-hidden").count();
  expect(hiddenBefore).toBeGreaterThan(0);
  const toggle = page.locator('[data-imt="reading-toggle"]').first();
  await expect(toggle).toBeVisible();
  await toggle.click();
  expect(await page.locator(".imt-research-hidden").count()).toBeLessThan(
    hiddenBefore,
  );

  await page.getByRole("button", { name: "清除翻译" }).click();
  await expect(page.locator("[data-imt]")).toHaveCount(0);
  await expect(page.locator("#demo-article p")).toHaveCount(5);
});

test("云端不可达时逐段回退本地 Mock", async ({ page }) => {
  await page.route(`${CLOUD_ORIGIN}/**`, (route) => route.abort("connectionrefused"));
  await translatePage(page);

  const rows = page.locator(".meta-table tbody tr");
  await expect(rows).toHaveCount(7);
  const fallbackCells = await rows.locator("td:nth-child(6)").allTextContents();
  const serviceCells = await rows.locator("td:nth-child(5)").allTextContents();
  expect(fallbackCells).toEqual(Array(7).fill("是"));
  expect(serviceCells).toEqual(Array(7).fill("mock"));
});

test("动态新增段落会被观察器捕获并纳入翻译", async ({ page }) => {
  await mockCloudTranslation(page);
  await page.getByRole("button", { name: "新增动态段落" }).click();
  await expect(page.locator(".info-box").first()).toContainText("MutationObserver");
  await page.getByRole("button", { name: "翻译网页" }).click();
  await expect(page.locator('[data-imt="target"]')).toHaveCount(8);
  await expect(page.locator("#demo-article p")).toHaveCount(6);
});

test("移动端布局无横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCloudTranslation(page);
  await translatePage(page);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const scroller = page.locator(".table-scroll");
  await expect(scroller).toBeVisible();
});

test("?api= 参数决定云端地址并真正用于请求", async ({ page }) => {
  const customOrigin = "http://127.0.0.1:9999";
  let hits = 0;
  await page.route(`${customOrigin}/v1/translate`, async (route) => {
    hits += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        requestId: "e2e-custom-origin",
        sourceText: "",
        targetText: "自定义地址译文",
        cacheLayer: "rds",
        latencyMs: 11,
      }),
    });
  });

  await page.goto(`/?api=${encodeURIComponent(customOrigin)}`);
  await expect(page.locator(".config-row input[type='text']")).toHaveValue(customOrigin);
  await translatePage(page);

  expect(hits).toBeGreaterThan(0);
  await expect(page.locator(".meta-table tbody tr").first().locator("td").nth(2)).toHaveText(
    "rds",
  );
});
