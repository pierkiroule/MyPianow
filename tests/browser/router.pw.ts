import { installUsbFixture } from "./usbFixture";
import { test } from "@playwright/test";
import assert from "node:assert/strict";
// Real AudioWorklet/Web Audio, simulated USB source and simulated hardware loopback.
// This never requests a real microphone and does not validate Yamaha/Android hardware.
test("isolated USB route, absent/present loopback, downloads and emergency stop", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installUsbFixture(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Chercher les entrées audio USB" })
    .click();
  await page
    .getByRole("navigation", { name: "Espaces du studio" })
    .getByRole("button", { name: /^Diagnostic/ })
    .click();
  await page
    .getByText("Tester le routage USB · futur LoopPad", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Ouvrir le diagnostic USB", exact: true })
    .click();
  await page
    .getByRole("button", { name: "1. Capturer le piano · 5 s", exact: true })
    .waitFor();
  assert(await page.locator(".record-button").isDisabled());
  await page
    .getByRole("button", { name: "1. Capturer le piano · 5 s", exact: true })
    .click();
  await page
    .getByRole("button", { name: "WAV piano USB", exact: true })
    .waitFor({ timeout: 10000 });
  await page.evaluate(() => (window.__qaContext.__qaPiano.gain.value = 0));
  await page
    .getByRole("button", {
      name: "2. Tester émission et retour · 6 s",
      exact: true,
    })
    .click();
  await page
    .getByText(
      "Aucun retour détecté · confirmer encore l’écoute sur le piano et la source du WAV.",
      { exact: true },
    )
    .waitFor({ timeout: 12000 });
  const reportDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Diagnostic JSON", exact: true })
    .click();
  const report = await reportDownload;
  await report.saveAs(testInfo.outputPath("report-no-return.json"));
  await page
    .getByRole("button", { name: "Fermer le diagnostic", exact: true })
    .click();
  assert(await page.locator(".record-button").isEnabled());
  await page.evaluate(() => (window.__qaLoopback = true));
  await page
    .getByRole("button", { name: "Ouvrir le diagnostic USB", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "2. Tester émission et retour · 6 s",
      exact: true,
    })
    .waitFor();
  await page.evaluate(() => (window.__qaContext.__qaPiano.gain.value = 0));
  await page
    .getByRole("button", {
      name: "2. Tester émission et retour · 6 s",
      exact: true,
    })
    .click();
  await page
    .getByText(
      "Retour détecté · ne pas mélanger une seconde fois les boucles.",
      { exact: true },
    )
    .waitFor({ timeout: 12000 });
  await page.screenshot({
    path: testInfo.outputPath("route-mobile.png"),
    fullPage: true,
  });
  const returnedDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Diagnostic JSON", exact: true })
    .click();
  await (
    await returnedDownload
  ).saveAs(testInfo.outputPath("report-return.json"));
  await page
    .getByRole("button", {
      name: "2. Tester émission et retour · 6 s",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Arrêter immédiatement", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Ouvrir le diagnostic USB", exact: true })
    .waitFor();
  assert((await page.evaluate(() => window.__qaContext.state)) === "closed");
  assert.deepEqual(errors, []);
});
