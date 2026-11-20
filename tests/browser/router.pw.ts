import { test } from "@playwright/test";
import assert from "node:assert/strict";
// Real AudioWorklet/Web Audio, simulated USB source and simulated hardware loopback.
// This never requests a real microphone and does not validate Yamaha/Android hardware.
test("isolated USB route, absent/present loopback, downloads and emergency stop", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__qaLoopback = false;
    const Native = window.AudioContext;
    class TestContext extends Native {
      constructor(...args) {
        super(...args);
        window.__qaContext = this;
        this.__qaCapture = this.createMediaStreamDestination();
        this.__qaPiano = Native.prototype.createGain.call(this);
        this.__qaPiano.gain.value = 0.06;
        const oscillator = this.createOscillator();
        oscillator.frequency.value = 440;
        oscillator.connect(this.__qaPiano);
        this.__qaPiano.connect(this.__qaCapture);
        oscillator.start();
        const track = this.__qaCapture.stream.getAudioTracks()[0];
        Object.defineProperty(track, "label", { value: "USB QA piano" });
        track.getSettings = () => ({
          deviceId: "qa-usb",
          channelCount: 2,
          sampleRate: this.sampleRate,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        });
      }
      createGain() {
        const gain = super.createGain(),
          connect = gain.connect.bind(gain);
        gain.connect = (target, ...args) => {
          const result = connect(target, ...args);
          if (target === this.destination && window.__qaLoopback)
            connect(this.__qaCapture);
          return result;
        };
        return gain;
      }
    }
    window.AudioContext = TestContext;
    navigator.mediaDevices.enumerateDevices = async () => [
      {
        kind: "audioinput",
        deviceId: "qa-usb",
        label: "USB QA piano",
        groupId: "qa",
      },
      {
        kind: "audiooutput",
        deviceId: "default",
        label: "System",
        groupId: "out",
      },
    ];
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints.audio.deviceId.exact !== "qa-usb")
        throw Error("Unexpected microphone request");
      return window.__qaContext.__qaCapture.stream;
    };
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Chercher les entrées audio USB" })
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
  assert(
    await page
      .getByRole("button", { name: "Enregistrer mon piano", exact: true })
      .isDisabled(),
  );
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
  assert(
    await page
      .getByRole("button", { name: "Enregistrer mon piano", exact: true })
      .isEnabled(),
  );
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
