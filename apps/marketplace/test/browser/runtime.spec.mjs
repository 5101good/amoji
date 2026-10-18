import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

test("real local Worker: creator uploads, submits, reviewer approves, public visitor downloads", async ({
  browser,
}) => {
  test.setTimeout(60000);
  const creator = await browser.newContext({
    baseURL: "http://localhost:4174",
  });
  const reviewer = await browser.newContext({
    baseURL: "http://localhost:4174",
  });
  const visitor = await browser.newContext({
    baseURL: "http://localhost:4174",
    javaScriptEnabled: false,
  });
  try {
    async function login(context, email, view) {
      const page = await context.newPage();
      await page.goto("/?view=" + view);
      await page
        .getByRole("banner")
        .getByRole("button", { name: "登录", exact: true })
        .click();
      await page.getByLabel("邮箱", { exact: true }).fill(email);
      await page
        .getByLabel("密码", { exact: true })
        .fill("synthetic-password-12345");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "登录", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      return page;
    }
    const page = await login(creator, "one@example.test", "studio");
    await page
      .locator("input[type=file]")
      .setInputFiles(
        resolve("../../assets/scenario-packs/make-it-clear.amoji"),
      );
    await page.getByLabel("包名称", { exact: true }).fill("浏览器真实投稿验收");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page
      .getByRole("button", { name: "上传并验证所选内容", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "已验证的精确版本" }),
    ).toBeVisible();
    await page
      .getByLabel("我已核对全部内容、许可和来源，确认拥有公开分发权。")
      .check();
    await page
      .getByRole("button", { name: "确认投稿，等待审核", exact: true })
      .click();
    await expect(page.locator(".submission-state")).toHaveText("待审");
    await page.screenshot({
      path: ".cache/design/studio-submitted.png",
      fullPage: true,
    });

    const review = await login(reviewer, "reviewer@example.test", "review");
    await review
      .getByRole("button", { name: "查看精确内容", exact: true })
      .click();
    await expect(
      review.getByRole("heading", { name: "浏览器真实投稿验收", exact: true }),
    ).toBeVisible();
    await review
      .getByLabel("审核理由", { exact: true })
      .fill("已在隔离环境核对固定语义、图片与分发许可。");
    await review.screenshot({
      path: ".cache/design/review-runtime.png",
      fullPage: true,
    });
    await review.getByRole("button", { name: "批准公开", exact: true }).click();
    await expect(review.getByRole("status")).toContainText("决定已保存");

    const publicPage = await visitor.newPage();
    const response = await publicPage.goto(
      "/?q=" + encodeURIComponent("浏览器真实投稿验收"),
    );
    expect(response.status()).toBe(200);
    await expect(publicPage.locator(".catalog-row")).toHaveCount(1);
    await expect(publicPage.locator(".catalog-row h3")).toContainText(
      "浏览器真实投稿验收",
    );
    expect(
      await publicPage
        .locator(".pack-art img")
        .evaluate((img) => img.complete && img.naturalWidth > 0),
    ).toBe(true);
    const link = await publicPage
      .locator(".catalog-row h3 a")
      .getAttribute("href");
    const detail = await (await publicPage.request.get("/v1" + link)).json();
    const archive = await publicPage.request.get("/v1" + link + "/archive");
    expect(archive.ok()).toBe(true);
    expect(archive.headers()["etag"]).toBe('"' + detail.archive_sha256 + '"');
    expect(Number(archive.headers()["content-length"])).toBe(
      (await archive.body()).length,
    );
  } finally {
    await Promise.all([creator.close(), reviewer.close(), visitor.close()]);
  }
});

test("the human narrative and its links are available without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL: "http://localhost:4174",
  });
  try {
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "有你的温度。",
    );
    await expect(
      page.getByRole("heading", { name: "表达，是一种需要。" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "看懂一张 Amoji" }).click();
    await expect(page).toHaveURL(/#expression-language$/);
    await expect(page.locator(".meaning-quote")).toHaveText(
      "谢谢你刚才提供的帮助，我真心领情。",
    );
    await page.getByRole("link", { name: "寻找此刻的表达" }).click();
    await expect(page).toHaveURL(/#collections$/);
    await expect(page.locator("#collections")).toBeVisible();
  } finally {
    await context.close();
  }
});
