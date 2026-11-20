import { test, expect } from "@playwright/test";
import { installUsbFixture } from "./usbFixture";
function sampleWav() {
  const rate = 44100,
    frames = rate / 2,
    buffer = Buffer.alloc(44 + frames * 2);
  buffer.write("RIFF");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++)
    buffer.writeInt16LE(
      Math.round(
        Math.sin((i * 2 * Math.PI * 880) / rate) *
          4000 *
          Math.exp((-i / rate) * 8),
      ),
      44 + i * 2,
    );
  return buffer;
}
test("desktop studio preserves independent samples, USB PCM, MIDI and portable projects", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installUsbFixture(page);
  await page.goto("/");
  const navigation = page.getByRole("navigation", {
    name: "Espaces du studio",
  });
  await page
    .getByRole("button", { name: "Chercher les entrées audio USB" })
    .click();
  await page
    .getByRole("button", { name: "Autoriser le MIDI", exact: true })
    .click();
  await navigation.getByRole("button", { name: /^CREATE/ }).click();
  await page.locator(".track-detail summary").first().click();
  await page
    .getByLabel("Importer sample 1", { exact: true })
    .setInputFiles({
      name: "qa-sample.wav",
      mimeType: "audio/wav",
      buffer: sampleWav(),
    });
  for (const step of [1, 5, 9, 13])
    await page
      .getByRole("button", { name: `qa-sample.wav, pas ${step}`, exact: true })
      .click();
  await page
    .getByRole("button", { name: "Lire l’accompagnement", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Arrêter les boucles", exact: true }),
  ).toBeEnabled();
  await navigation.getByRole("button", { name: /^PLAY/ }).click();
  await page
    .getByRole("button", { name: "Enregistrer mon piano", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Terminer la prise", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("meter", { name: "Niveau d’entrée", exact: true }),
  ).not.toHaveAttribute("aria-valuenow", "0");
  await page.evaluate(async () => {
    const send = (data: number[]) =>
      window.__qaMidi.dispatchEvent(
        new MessageEvent("midimessage", { data: new Uint8Array(data) }),
      );
    send([176, 64, 127]);
    send([144, 60, 80]);
    await new Promise((resolve) => setTimeout(resolve, 120));
    send([128, 60, 0]);
    send([176, 64, 0]);
  });
  await page
    .getByRole("button", { name: "Terminer la prise", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Exporter WAV", exact: true }),
  ).toBeEnabled({ timeout: 20000 });
  await expect(
    page.getByLabel("Inclure l’accompagnement au mix final", { exact: false }),
  ).not.toBeChecked();
  await page
    .getByLabel("Inclure l’accompagnement au mix final", { exact: false })
    .check();
  await expect(
    page.getByRole("button", { name: "Exporter WAV", exact: true }),
  ).toBeEnabled({ timeout: 20000 });
  await page
    .getByRole("button", { name: "Analyser et proposer", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Appliquer la proposition non destructive",
      exact: true,
    }),
  ).toBeEnabled({ timeout: 20000 });
  await page
    .getByRole("button", {
      name: "Appliquer la proposition non destructive",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Exporter WAV", exact: true }),
  ).toBeEnabled({ timeout: 20000 });
  const midiDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Exporter le MIDI synchronisé", exact: true })
    .click();
  expect((await midiDownload).suggestedFilename()).toMatch(/\.mid$/);
  const archiveDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Exporter le projet .mypianow", exact: true })
    .click();
  const archive = await archiveDownload;
  const path = testInfo.outputPath("qa-project.mypianow");
  await archive.saveAs(path);
  await expect(
    page.getByRole("button", { name: "Importer un projet", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Importer une archive MyPianow", { exact: true })
    .setInputFiles(path);
  await expect(
    navigation.getByRole("button", { name: /Mes créations/ }),
  ).toContainText("2", { timeout: 20000 });
  await page.reload();
  await expect(
    page
      .getByRole("navigation", { name: "Espaces du studio" })
      .getByRole("button", { name: /Mes créations/ }),
  ).toContainText("2");
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("desktop-studio.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
