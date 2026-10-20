import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
const fixture = path.resolve("tests/fixtures/classic.png");
const legacy = path.resolve("tests/fixtures/legacy.png");
async function mockSkins(page: Page) {
  const skin = await readFile(fixture);
  await page.route("https://playerdb.co/**", async (route) => {
    const name = route.request().url().split("/").pop()!;
    if (name === "Missing") {
      await route.fulfill({ status: 404, body: "Not found" });
      return;
    }
    const url = "https://textures.minecraft.net/texture/test";
    const value = Buffer.from(
      JSON.stringify({
        textures: {
          SKIN: { url, metadata: name === "Slim" ? { model: "slim" } : {} },
        },
      }),
    ).toString("base64");
    await route.fulfill({
      json: {
        data: {
          player: {
            id: "test-uuid",
            username: name,
            properties: [{ name: "textures", value }],
          },
        },
      },
    });
  });
  await page.route("https://textures.minecraft.net/**", (route) =>
    route.fulfill({ body: skin, contentType: "image/png" }),
  );
}
async function start(page: Page) {
  await mockSkins(page);
  await page.goto("/");
  await expect(page.locator("#editor")).toBeEnabled({ timeout: 30000 });
}
async function add(page: Page, names: string) {
  await page.locator("#names").fill(names);
  await page.locator("#add").click();
  await expect(page.locator("#generate")).toBeEnabled({ timeout: 60000 });
}
async function upload(page: Page, button: string, file: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.locator(button).click();
  await (await chooser).setFiles(file);
  await expect(page.locator("#generate")).toBeEnabled();
}
function gifInfo(bytes: Buffer) {
  const width = bytes.readUInt16LE(6),
    height = bytes.readUInt16LE(8);
  let p = 13;
  if (bytes[10] & 128) p += 3 * (1 << ((bytes[10] & 7) + 1));
  const delays: number[] = [];
  let images = 0,
    loop: number | undefined;
  const blocks = () => {
    while (bytes[p]) {
      const length = bytes[p++];
      p += length;
    }
    p++;
  };
  while (p < bytes.length) {
    const marker = bytes[p++];
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      const label = bytes[p++];
      if (label === 0xf9) {
        p++;
        p++;
        delays.push(bytes.readUInt16LE(p) * 10);
        p += 4;
      } else if (label === 0xff) {
        const n = bytes[p++],
          identifier = bytes.subarray(p, p + n).toString();
        p += n;
        if (identifier === "NETSCAPE2.0") loop = bytes.readUInt16LE(p + 2);
        blocks();
      } else blocks();
    } else if (marker === 0x2c) {
      images++;
      const packed = bytes[p + 8];
      p += 9;
      if (packed & 128) p += 3 * (1 << ((packed & 7) + 1));
      p++;
      blocks();
    } else throw new Error(`Unexpected GIF marker ${marker} at ${p - 1}`);
  }
  return { width, height, delays, images, loop };
}
test("1, 2, 3 and 12 actors; duplicates, model metadata, swaps, holes and cap", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await start(page);
  await page.screenshot({ path: "test-results/inventory-empty-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/inventory-empty-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await add(page, "Alpha");
  await expect(page.locator(".player")).toHaveCount(1);
  await add(page, "Slim");
  await expect(page.locator(".player")).toHaveCount(2);
  await expect(
    page.locator(".model").nth(1).locator("option[value=auto]"),
  ).toHaveText("Auto (Slim)");
  await add(page, "Alpha");
  await expect(page.locator(".player")).toHaveCount(3);
  await page.locator(".position").first().selectOption("right");
  await expect(page.locator(".position").nth(2)).toHaveValue("center");
  await add(page, "D E F G H I J K L");
  await expect(page.locator(".player")).toHaveCount(12);
  await expect(page.locator("#add")).toBeDisabled();
  await expect(page.locator("#count")).toHaveText("12/12");
  await page.screenshot({ path: "test-results/inventory-12-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.screenshot({ path: "test-results/inventory-12-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.locator(".remove").nth(3).click();
  await expect(page.locator(".player")).toHaveCount(11);
  await expect(page.locator(".position").first()).toHaveValue("right");
  await page.locator(".position").first().selectOption("inner-left");
  await expect(page.locator(".position").first()).toHaveValue("inner-left");
  await page.getByRole("button", { name: "Pause preview" }).click();
  await page.locator("#timeline").fill("84");
  await expect(page.locator("#time")).toHaveText("2.80 / 2.83");
  await page.locator("#timeline").fill("0");
  await expect(page.locator("#time")).toHaveText("0.00 / 2.83");
  await expect(page.locator("#notice")).toBeHidden();
  expect(errors).toEqual([]);
  await page.screenshot({
    path: "test-results/cast-desktop.png",
    fullPage: true,
  });
});
test("lookup failure, upload-only legacy skin, custom override and mobile layout", async ({
  page,
}) => {
  await start(page);
  await page.locator("#names").fill("Missing");
  await page.locator("#add").click();
  await expect(page.locator(".player-status")).toContainText(
    "Player not found",
  );
  await expect(page.locator("#generate")).toBeDisabled();
  await page.screenshot({ path: "test-results/inventory-error.png" });
  await upload(page, ".upload", legacy);
  await expect(page.locator(".upload")).toHaveAttribute(
    "title",
    /Legacy skin converted/,
  );
  await expect(page.locator(".model option[value=auto]")).toHaveText(
    "Auto (Classic)",
  );
  await page.locator(".name-form input").fill("Slim");
  await page.locator(".name-form button").click();
  await expect(page.locator(".clear")).toHaveText("Use account skin");
  await expect(page.locator(".upload")).toHaveAttribute("title", /legacy.png/);
  await page.locator(".clear").click();
  await expect(page.locator(".model option[value=auto]")).toHaveText(
    "Auto (Slim)",
  );
  await upload(page, "#add-upload", fixture);
  await expect(page.locator(".player")).toHaveCount(2);
  await page.locator(".model").nth(1).selectOption("slim");
  await expect(page.locator(".model").nth(1)).toHaveValue("slim");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.screenshot({
    path: "test-results/cast-mobile.png",
    fullPage: true,
  });
});
test("GIF export, exact frame delays, cancellation, repeated export and stale downloads", async ({
  page,
}) => {
  test.setTimeout(300000);
  await start(page);
  await add(page, "Alpha Slim Bravo");
  await page.locator("#generate").click();
  await expect(page.locator("#cancel")).toBeVisible();
  await page.locator("#cancel").click();
  await expect(page.locator("#export-status")).toContainText("cancelled");
  await expect(page.locator("#download")).toBeHidden();
  await page.locator("#generate").click();
  await expect(page.locator("#download")).toBeVisible({ timeout: 120000 });
  let downloadPromise = page.waitForEvent("download");
  await page.locator("#download").click();
  const download = await downloadPromise;
  await download.saveAs("test-results/cast-256.gif");
  const info = gifInfo(await readFile((await download.path())!));
  expect(info.width).toBe(256);
  expect(info.height).toBe(256);
  expect(info.images).toBe(85);
  expect(info.loop).toBe(0);
  const manifest = JSON.parse(
    await readFile("public/template/manifest.json", "utf8"),
  );
  expect(info.delays).toEqual(manifest.durations);
  expect(info.delays.reduce((a, b) => a + b, 0)).toBe(2830);
  await page.locator("#size").selectOption("498");
  await expect(page.locator("#download")).toBeHidden();
  await page.locator("#generate").click();
  await expect(page.locator("#download")).toBeVisible({ timeout: 120000 });
  downloadPromise = page.waitForEvent("download");
  await page.locator("#download").click();
  const large = await downloadPromise;
  await large.saveAs("test-results/cast-498.gif");
  expect(gifInfo(await readFile((await large.path())!)).width).toBe(498);
  await page.getByRole("button", { name: "Pause preview" }).click();
  await page.locator("#timeline").fill("44");
  await expect(page.locator("#time")).toHaveText("1.47 / 2.83");
  downloadPromise = page.waitForEvent("download");
  await page.locator("#png").click();
  const png = await downloadPromise;
  await png.saveAs("test-results/frame-44.png");
  expect((await readFile((await png.path())!)).subarray(1, 4).toString()).toBe(
    "PNG",
  );
  await page.locator(".model").first().selectOption("slim");
  await expect(page.locator("#download")).toBeHidden();
});
test("explains missing WebGL 2 without enabling broken exports", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      type: string,
      ...args: unknown[]
    ) {
      if (type === "webgl2") return null;
      return (original as Function).apply(this, [type, ...args]);
    } as typeof original;
  });
  await page.goto("/");
  await expect(page.locator("#notice")).toContainText("WebGL 2");
  await expect(page.locator("#generate")).toBeDisabled();
});
test("all exported poses match evaluated Blender meshes, including backwards scrubbing", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/tests/pose-probe.ts";
    const probe = await import(/* @vite-ignore */ path);
    return probe.comparePoses();
  });
  expect(result.checked).toBe(24 * 4 * 12);
  expect(result.failures).toEqual([]);
  expect(result.worst).toBeLessThan(0.0001);
});
