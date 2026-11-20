import type { Page } from "@playwright/test";
// QA-only USB and MIDI fixtures. Production code never imports this file.
export async function installUsbFixture(page: Page) {
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
    const midi = Object.assign(new EventTarget(), {
      id: "qa-midi",
      name: "QA simulated MIDI",
      state: "connected",
      connection: "open",
      type: "input",
    });
    midi.open = async () => midi;
    midi.close = async () => midi;
    window.__qaMidi = midi;
    navigator.requestMIDIAccess = async () => ({
      sysexEnabled: true,
      inputs: new Map([[midi.id, midi]]),
      outputs: new Map(),
      onstatechange: null,
    });
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints.audio.deviceId.exact !== "qa-usb")
        throw Error("Unexpected microphone request");
      return window.__qaContext.__qaCapture.stream;
    };
  });
}
