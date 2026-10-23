import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
const configure = async (page, options = {}) =>
  (
    await page.request.get("/__test/state?" + new URLSearchParams(options))
  ).json();
const ready = async (page) => {
  await expect(page.locator("html")).toHaveAttribute("data-app-ready", "true");
};
async function capture(page, options) {
  for (const image of await page.locator("img").all()) {
    if (!(await image.isVisible())) continue;
    await image.scrollIntoViewIfNeeded();
    await image.evaluate((img) => img.decode().catch(() => {}));
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await accessible(page);
  await page.screenshot(options);
}
async function noOverflow(page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
}
async function accessible(page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
}

test("discovery is image-led, searchable, URL-restorable, and does not load creator code", async ({
  page,
}) => {
  const modules = [];
  page.on("request", (r) => {
    if (/chunks\/upload-/.test(r.url())) modules.push(r.url());
  });
  await page.goto("/");
  await expect(page.locator(".catalog-row")).toHaveCount(7);
  await expect(page.locator(".pack-art img").first()).toBeVisible();
  expect(modules).toEqual([]);
  await page.getByRole("textbox", { name: "关键词", exact: true }).fill("经典");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.locator(".catalog-row")).toHaveCount(1);
  await expect(page).toHaveURL(/q=/);
  await page.reload();
  await expect(page.locator(".catalog-row")).toHaveCount(1);
  await page.getByRole("button", { name: "清除筛选" }).click();
  await expect(page.locator(".catalog-row")).toHaveCount(7);
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await expect(page.locator("#catalog-filters")).toBeVisible();
  await accessible(page);
});

test("official directory has two complete classics and five original collections with usable media", async ({ page }) => {
  test.setTimeout(90000);
  const catalog = JSON.parse(await readFile(resolve("../../assets/official-packs/catalog.json"), "utf8"));
  await page.goto("/");
  await expect(page.getByText("所有表情包", {exact: true})).toBeVisible();
  await expect(page.locator(".catalog-row h3 a")).toHaveText(catalog.packs.map(p => p.name["zh-CN"]));
  await expect(page.getByText(/场景包/)).toHaveCount(0);
  for (const pack of catalog.packs) {
    await page.goto(`/packs/${pack.pack_id}/releases/${pack.release_id}`);
    await expect(page.locator(".expression-grid article")).toHaveCount(pack.expressions);
    await expect(page.getByRole("group", {name: "选择画风"})).toHaveCount(0);
    const images = page.locator(".image-preview-button img");
    for (const image of await images.all()) {
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    }
    await expect(page.getByRole("link", {name: "下载精确版本"})).toHaveAttribute("href", `/v1/packs/${pack.pack_id}/releases/${pack.release_id}/archive`);
    await noOverflow(page);
  }
});

test("the expression exhibit uses exact built-in meanings in both languages and works by keyboard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 920 });
  await page.goto("/");
  for (const locale of ["zh", "en"]) {
    if (locale === "en")
      await page.getByRole("button", { name: "Switch to English" }).click();
    const manifest = JSON.parse(
      await readFile(resolve("../../assets/official-packs/classic.manifest.json"), "utf8"),
    );
    const language = locale === "en" ? "en" : "zh-CN";
    for (const [slug, act] of [["thanks", "core:thanks"], ["celebrate", "core:celebrate"], ["progress", "core:checkin"]]) {
      const definition = manifest.expressions.find((e) => e.realizes === act);
      const button = page.getByRole("button", {
        name: (locale === "zh" ? "预览：" : "Preview: ") + definition.name[language],
        exact: true,
      });
      await button.focus();
      await button.press("Enter");
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(".meaning-quote")).toHaveText(
        definition.semantics[language].meaning,
      );
      await expect(page.locator(".exhibit-stage > img")).toHaveAttribute(
        "src",
        `/art/${slug}.webp`,
      );
      await noOverflow(page);
    }
    await accessible(page);
  }
});

test("auth modal keeps focus, recovers errors, returns focus and preserves the page", async ({
  page,
}) => {
  await page.goto("/");
  const login = page.getByRole("button", { name: "登录", exact: true });
  await login.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭" })).toBeFocused();
  await page.getByLabel("邮箱", { exact: true }).fill("fail@example.test");
  await page.getByLabel("密码", { exact: true }).fill("fixture-password");
  await dialog.getByRole("button", { name: "登录", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("邮箱或密码不正确");
  await accessible(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(login).toBeFocused();
  await expect(page.locator(".catalog-row")).toHaveCount(7);
});

test("language is remembered across detail navigation without changing fixed semantics", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Switch to English" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "A new language.",
  );
  await page.locator(".catalog-row h3 a").first().click();
  await expect(
    page.getByRole("link", { name: "Download exact release" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator('[lang="zh-CN"]').first()).toBeVisible();
  await accessible(page);
});

test("creator studio loads only on demand and saves a real local pack draft", async ({
  page,
}) => {
  await configure(page, { role: "creator" });
  await page.goto("/?view=studio");
  await page
    .locator("input[type=file]")
    .setInputFiles(resolve("../../assets/official-packs/classic.amoji"));
  const name = page.getByLabel("包名称 · zh-CN", { exact: true });
  await expect(name).toBeVisible();
  await expect(page.getByLabel("包名称 · en", { exact: true })).toHaveValue("Classic");
  await name.fill("我的协作表情");
  await expect(name).toHaveValue("我的协作表情");
  await page.reload();
  await expect(name).toHaveValue("我的协作表情");
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(
    page.getByText("可选择保留包内协作效果。", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(page.getByRole("heading", { name: "本地预览" })).toBeVisible();
  await expect(
    page.locator(".pack-preview .expression-grid img").first(),
  ).toBeVisible();
  await noOverflow(page);
  await accessible(page);
});

test("failed creator chunk leaves navigation, sign-out and recovery available", async ({
  page,
}) => {
  await configure(page, { role: "creator" });
  await page.route("**/chunks/upload-*.js", (r) => r.abort());
  await page.goto("/?view=studio");
  await expect(page.getByRole("alert")).toContainText(
    "创作者工作台暂时无法加载",
  );
  await expect(page.getByRole("button", { name: "刷新页面" })).toBeVisible();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "登录后继续" })).toBeVisible();
  await page.getByRole("link", { name: "发现表情", exact: true }).click();
  await expect(page.locator(".catalog-row")).toHaveCount(7);
});

test("reviewers can inspect exact content and submit a reasoned decision", async ({
  page,
}) => {
  await configure(page, { role: "reviewer" });
  await page.goto("/?view=review");
  await page.getByRole("button", { name: "查看精确内容", exact: true }).click();
  await expect(page.getByRole("button", { name: "批准公开" })).toBeDisabled();
  await page
    .getByLabel("审核理由", { exact: true })
    .fill("已检查图片、固定语义和内容许可。");
  await expect(page.getByRole("button", { name: "批准公开" })).toBeEnabled();
  await accessible(page);
  await page.getByRole("button", { name: "退回修改", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("决定已保存");
});

test("account management separates destructive controls and supports device approval", async ({
  page,
}) => {
  await configure(page, { role: "admin" });
  await page.goto("/?view=account");
  await expect(
    page.getByRole("button", { name: "删除我的账号" }),
  ).not.toBeVisible();
  await page.getByText("删除账号与数据", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "删除我的账号" }),
  ).toBeDisabled();
  await noOverflow(page);
  await accessible(page);
  await page.goto("/?authorization=fixture");
  await expect(page.getByText("AMOJI-42")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "确认授权此设备" }),
  ).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "确认授权此设备" }).click();
  await expect(page.getByRole("status")).toContainText("已确认");
});

for (const width of [320, 390, 768, 1024, 1440])
  test(`responsive gallery, detail, studio, account and review at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await expect(page.locator(".catalog-row")).toHaveCount(7);
    await noOverflow(page);
    await capture(page, {
      path: `.cache/design/gallery-${width}.png`,
      fullPage: true,
    });
    await page.locator(".catalog-row h3 a").first().click();
    await expect(
      page.getByRole("link", { name: "下载精确版本" }),
    ).toBeVisible();
    await noOverflow(page);
    await capture(page, {
      path: `.cache/design/detail-${width}.png`,
      fullPage: true,
    });
    await configure(page, { role: "creator" });
    await page.goto("/?view=studio");
    await expect(page.locator("input[type=file]")).toBeVisible();
    await noOverflow(page);
    await capture(page, {
      path: `.cache/design/studio-${width}.png`,
      fullPage: true,
    });
    await configure(page, { role: "admin" });
    await page.goto("/?view=account");
    await expect(page.locator(".account-layout")).toBeVisible();
    await noOverflow(page);
    await capture(page, {
      path: `.cache/design/account-${width}.png`,
      fullPage: true,
    });
    await page.goto("/?view=review");
    await expect(page.locator(".review-welcome")).toBeVisible();
    await noOverflow(page);
    await capture(page, {
      path: `.cache/design/review-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "查看精确内容", exact: true })
      .click();
    await expect(page.locator(".review-decision")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "批准公开", exact: true }),
    ).toBeDisabled();
    await noOverflow(page);
    await capture(page, {
      path: `.cache/design/review-content-${width}.png`,
      fullPage: true,
    });
  });
for (const mode of ["empty", "error", "removed"])
  test(`recoverable ${mode} state`, async ({ page }) => {
    const state = await configure(page, { mode });
    const p = state.packs[0];
    await page.goto(
      mode === "removed" ? `/packs/${p.pack_id}/releases/${p.release_id}` : "/",
    );
    await expect(
      mode === "error"
        ? page.locator(".notice.error p")
        : page.getByText(
            mode === "empty"
              ? "这里，等着第一份表达"
              : "这份表达暂时离开了市场",
            { exact: true },
          ),
    ).toBeVisible();
    await noOverflow(page);
    await accessible(page);
  });
test("creator cannot navigate into reviewer content", async ({ page }) => {
  await configure(page, { role: "creator" });
  await page.goto("/?view=review");
  await expect(
    page.getByRole("heading", { name: "此页面仅对审核者开放" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "内容审核", exact: true }),
  ).toHaveCount(0);
});

test("refreshing recovers a previously failed creator chunk", async ({
  page,
}) => {
  await configure(page, { role: "creator" });
  await page.route("**/chunks/upload-*.js", (r) => r.abort());
  await page.goto("/?view=studio");
  await expect(page.getByRole("alert")).toBeVisible();
  await page.unroute("**/chunks/upload-*.js");
  await page.getByRole("button", { name: "刷新页面" }).click();
  await expect(page.locator("input[type=file]")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("browser back restores search and a complete style collection keeps preview focus", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "关键词", exact: true }).fill("经典");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.locator(".catalog-row")).toHaveCount(1);
  await page.getByRole("button", { name: "清除筛选" }).click();
  await expect(page.locator(".catalog-row")).toHaveCount(7);
  await page.goBack();
  await expect(page.locator(".catalog-row")).toHaveCount(1);
  await expect(
    page.getByRole("textbox", { name: "关键词", exact: true }),
  ).toHaveValue("经典");
  await page.locator(".catalog-row h3 a").first().click();
  await expect(page.locator(".expression-grid article").first()).toBeVisible();
  await expect(page.locator(".expression-grid article")).toHaveCount(24);
  await expect(page.getByRole("group", { name: "选择画风" })).toHaveCount(0);
  const image = page.locator(".image-preview-button").first();
  await image.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await accessible(page);
  await page.keyboard.press("Escape");
  await expect(image).toBeFocused();
});

test("English narrow screens keep acquisition ahead of previews and registration in context", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Switch to English" }).click();
  await page.locator(".catalog-row h3 a").first().click();
  await expect(
    page.getByRole("link", { name: "Download exact release" }),
  ).toBeVisible();
  const acquire = await page.locator(".acquisition").boundingBox();
  const content = await page.locator(".detail-content").boundingBox();
  expect(acquire.y).toBeLessThan(content.y);
  await noOverflow(page);
  await capture(page, {
    path: ".cache/design/detail-en-320.png",
    fullPage: true,
  });
  const before = page.url();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "New here? Create account" }).click();
  await page.getByLabel("Display name", { exact: true }).fill("My workspace");
  await page.getByLabel("Email", { exact: true }).fill("creator@example.test");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await accessible(page);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(page.url()).toBe(before);
});

test("an invalid public link offers a way back without exposing private content", async ({
  page,
}) => {
  await page.goto("/packs/00000000-0000-4000-8000-000000000000");
  await expect(
    page.getByRole("heading", { name: "没有找到这份表情包" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "返回表情市场" }).click();
  await expect(page.locator(".catalog-row")).toHaveCount(7);
});

test("failed search can be retried without showing unrelated previous results", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".catalog-row")).toHaveCount(7);
  await page.route("**/v1/packs?*", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
  );
  await page.getByRole("textbox", { name: "关键词", exact: true }).fill("经典");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.locator(".notice.error")).toBeVisible();
  await expect(page.locator(".catalog-row")).toHaveCount(0);
  await page.unroute("**/v1/packs?*");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator(".catalog-row")).toHaveCount(1);
});

test("identity retry rebuilds the review workspace for the newly signed-in account", async ({
  page,
}) => {
  await configure(page, { role: "reviewer" });
  await page.goto("/?view=review");
  await page.getByRole("button", { name: "查看精确内容", exact: true }).click();
  await expect(page.locator(".release")).toBeVisible();
  await page.route("**/v1/auth/logout", (route) => route.abort());
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.route("**/v1/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        account: {
          id: "new-reviewer",
          name: "Reviewer B",
          email: "new@example.test",
          role: "reviewer",
        },
      }),
    }),
  );
  await page.route("**/v1/review/submissions", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ submissions: [], cursor: null }),
    }),
  );
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator(".release")).toHaveCount(0);
  await expect(
    page.getByText("当前没有待审投稿。", { exact: true }),
  ).toBeVisible();
});

test("a transient cover failure retries without leaving an empty image tile", async ({
  page,
}) => {
  let failed = false;
  await page.route("**/cover*", (route) => {
    if (!failed) {
      failed = true;
      return route.fulfill({ status: 429, body: "" });
    }
    return route.continue();
  });
  await page.goto("/");
  await expect(page.locator(".catalog-row")).toHaveCount(7);
  await page.locator(".pack-grid").scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      page
        .locator(".pack-art img")
        .evaluateAll((images) =>
          images.every(
            (img) => img.complete && img.naturalWidth > 0 && !img.hidden,
          ),
        ),
    )
    .toBe(true);
  expect(failed).toBe(true);
});

test("depth feedback keeps controls still, glass navigation stays accessible, and reduced motion disables tracking", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  const artwork = page.locator(".hero-artwork");
  const headline = page.locator(".hero-copy h1");
  await headline.evaluate((el) =>
    Promise.all(el.getAnimations().map((animation) => animation.finished)),
  );
  const textBefore = await headline.boundingBox();
  const bounds = await artwork.boundingBox();
  await page.mouse.move(
    bounds.x + bounds.width * 0.85,
    bounds.y + bounds.height * 0.65,
  );
  await expect(artwork).toHaveAttribute("data-tracking", "true");
  expect(await headline.boundingBox()).toEqual(textBefore);
  await expect
    .poll(() =>
      artwork.evaluate((el) =>
        parseFloat(el.style.getPropertyValue("--art-x")),
      ),
    )
    .toBeGreaterThan(0);
  // A changed OS preference must cancel an already-active pointer effect.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(artwork).not.toHaveAttribute("data-tracking", "true");
  await expect
    .poll(() =>
      page
        .locator(".hero-sculpture")
        .evaluate((el) => getComputedStyle(el).transform),
    )
    .toBe("none");
  await expect
    .poll(() => headline.evaluate((el) => getComputedStyle(el).animationName))
    .toBe("none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator("#collections").scrollIntoViewIfNeeded();
  await expect
    .poll(async () => (await page.locator(".topbar").boundingBox()).y)
    .toBe(0);
  const signIn = page.getByRole("button", { name: "登录", exact: true });
  await signIn.click();
  const dialog = page.getByRole("dialog");
  await dialog.evaluate((el) =>
    Promise.all(el.getAnimations().map((animation) => animation.finished)),
  );
  await accessible(page);
  await page.screenshot({ path: ".cache/design/glass-dialog-1440.png" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(signIn).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(signIn).toBeFocused();
});

test("touch interaction selects expressions without pointer depth or stuck hover effects", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  try {
    const page = await context.newPage();
    await page.goto("/");
    await ready(page);
    const bounds = await page.locator(".hero-artwork").boundingBox();
    await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + 80);
    await expect(page.locator(".hero-artwork")).not.toHaveAttribute(
      "data-tracking",
      "true",
    );
    const celebrate = page.getByRole("button", {
      name: "预览：一起庆祝",
      exact: true,
    });
    await celebrate.tap();
    await expect(celebrate).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".exhibit-stage > img")).toHaveAttribute(
      "src",
      "/art/celebrate.webp",
    );
    await noOverflow(page);
    await accessible(page);
  } finally {
    await context.close();
  }
});

test("spatial scenes follow scrolling, preserve readable meaning, and stop when reduced motion is requested", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  const hero = page.locator(".hero-scene");
  const scene = page.locator("#expression-language");
  const progress = (locator) =>
    locator.evaluate((el) =>
      parseFloat(el.style.getPropertyValue("--scene-progress")),
    );
  await expect.poll(() => progress(hero)).toBe(0);
  await page.evaluate(() => window.scrollTo({ top: 350, behavior: "instant" }));
  await expect.poll(() => progress(hero)).toBeGreaterThan(0.2);
  // The semantic exhibit is a real anchor, usable without pointer interaction.
  const link = page.getByRole("link", { name: "看懂一张 Amoji" });
  await link.focus();
  await link.press("Enter");
  await expect(page).toHaveURL(/#expression-language$/);
  await expect.poll(() => progress(scene)).toBeGreaterThan(0.7);
  await expect(page.locator(".meaning-quote")).toHaveText(
    "谢谢你刚才提供的帮助，我真心领情。",
  );
  await page.locator(".exhibit-stage > img").evaluate((img) => img.decode());
  await page.screenshot({ path: ".cache/design/human-space-meaning.png" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const locator of [hero, scene])
    await expect
      .poll(() =>
        locator.evaluate((el) => el.style.getPropertyValue("--scene-progress")),
      )
      .toBe("");
  for (const selector of [
    ".hero-sculpture",
    ".exhibit-stage",
    ".exhibit-meaning",
  ])
    expect(
      await page
        .locator(selector)
        .evaluate((el) => getComputedStyle(el).transform),
    ).toBe("none");
  await page
    .getByRole("button", { name: "预览：进度如何", exact: true })
    .click();
  await expect(page.locator(".meaning-quote")).toContainText(
    "我想了解当前任务做到哪一步了",
  );
  await noOverflow(page);
  await accessible(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect.poll(() => progress(hero)).toBe(0);
  await page.screenshot({ path: ".cache/design/human-space-first-screen.png" });
});

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`expanded filters and the open-source invitation stay readable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await ready(page);
    for (const locale of ["zh", "en"]) {
      if (locale === "en")
        await page.getByRole("button", { name: "Switch to English" }).click();
      const toggle = page.locator(".filter-toggle");
      const search = page.locator(".search-bar");
      const panel = page.locator("#catalog-filters");
      await search.scrollIntoViewIfNeeded();
      const closed = await search.boundingBox();
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      const open = await search.boundingBox();
      const filters = await panel.boundingBox();
      expect(open.height).toBeCloseTo(closed.height, 0);
      expect(filters.y).toBeGreaterThanOrEqual(open.y + open.height);
      await noOverflow(page);
      await accessible(page);
      await page
        .locator(".catalog-search")
        .screenshot({ path: `.cache/design/filters-${locale}-${width}.png` });
      // Enter in a filter field still submits the same search form.
      await page
        .getByRole("textbox", {
          name: locale === "zh" ? "关键词" : "Keywords",
          exact: true,
        })
        .fill("经典");
      // The locale field offers a datalist, so it is a combobox.
      const language = panel.getByRole("combobox", { name: locale === "zh" ? "语言" : "Language", exact: true });
      await language.fill("en");
      if (locale === "zh")
        await language.press("Enter");
      else
        await panel
          .getByRole("button", { name: "Apply filters", exact: true })
          .click();
      await expect(page).toHaveURL(/locale=en/);
      await expect(page.locator(".catalog-row")).toHaveCount(1);
      await page
        .getByRole("button", {
          name: locale === "zh" ? "清除筛选" : "Clear filters",
          exact: true,
        })
        .click();
      await expect(page.locator(".catalog-row")).toHaveCount(7);
      await toggle.click();
      await expect(panel).toBeHidden();
      const invitation = page.locator(".about-expression");
      await invitation.scrollIntoViewIfNeeded();
      await noOverflow(page);
      const textFits = await invitation
        .locator("h2, p, a")
        .evaluateAll((items) =>
          items.every(
            (el) =>
              el.scrollWidth <= el.clientWidth + 1 &&
              el.getBoundingClientRect().right <= innerWidth,
          ),
        );
      expect(textFits).toBe(true);
      await expect(
        invitation.getByRole("link", {
          name: locale === "zh" ? "分享你的表情" : "Share your expressions",
        }),
      ).toHaveAttribute("href", "/?view=studio");
      await expect(
        invitation.getByRole("link", { name: "GitHub 开源项目" }),
      ).toHaveCount(locale === "zh" ? 1 : 0);
      await invitation.screenshot({
        path: `.cache/design/invitation-${locale}-${width}.png`,
      });
    }
  });
}
