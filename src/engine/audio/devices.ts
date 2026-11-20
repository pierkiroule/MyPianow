export const isUsb = (d: { deviceId: string; label: string }) =>
  d.deviceId !== "default" &&
  !!d.deviceId &&
  /usb|yamaha|clavinova|digital\s*piano/i.test(d.label) &&
  !/midi/i.test(d.label);
export const constraints = (id: string): MediaStreamConstraints => ({
  video: false,
  audio: {
    deviceId: { exact: id },
    channelCount: { ideal: 2 },
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
});
export async function audioDevices() {
  if (!navigator.mediaDevices?.enumerateDevices)
    throw Error("Capture audio indisponible. Utilise Chrome en HTTPS.");
  return (await navigator.mediaDevices.enumerateDevices()).filter(
    (d) => d.kind === "audioinput" && isUsb(d),
  );
}
export async function openUsb(device: MediaDeviceInfo) {
  if (!isUsb(device)) throw Error("Sélectionne une entrée USB reconnue.");
  const stream = await navigator.mediaDevices.getUserMedia(
    constraints(device.deviceId),
  );
  const track = stream.getAudioTracks()[0];
  const settings = track?.getSettings();
  if (
    !track ||
    track.readyState !== "live" ||
    settings?.deviceId !== device.deviceId ||
    !isUsb({ deviceId: settings.deviceId || "", label: track.label })
  ) {
    stream.getTracks().forEach((t) => t.stop());
    throw Error(
      "Source USB non confirmée. Aucun micro de secours ne sera utilisé.",
    );
  }
  return { stream, track, settings };
}
export async function captureLock(): Promise<() => void> {
  if (!navigator.locks) return () => {};
  return new Promise((resolve, reject) => {
    void navigator.locks
      .request("mypianow-capture", { ifAvailable: true }, async (lock) => {
        if (!lock) {
          reject(
            Error(
              "Une autre capture ou un diagnostic utilise déjà l’entrée audio.",
            ),
          );
          return;
        }
        await new Promise<void>((release) => resolve(release));
      })
      .catch(reject);
  });
}
