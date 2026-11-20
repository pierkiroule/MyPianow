// SPDX-License-Identifier: LGPL-3.0-only
// This wrapper is licensed under LGPL-3.0; see public/licenses in the production build.
/// <reference lib="webworker" />
import { Mp3Encoder } from "@breezystack/lamejs";
self.onmessage = (
  event: MessageEvent<{ channels: Float32Array[]; rate: number }>,
) => {
  try {
    const { channels, rate } = event.data,
      count = channels.length,
      encoder = new Mp3Encoder(count, rate, 320),
      chunks: Uint8Array<ArrayBuffer>[] = [],
      block = 1152;
    for (let i = 0; i < channels[0].length; i += block) {
      const left = new Int16Array(Math.min(block, channels[0].length - i)),
        right = count === 2 ? new Int16Array(left.length) : undefined;
      for (let k = 0; k < left.length; k++) {
        left[k] = Math.round(
          Math.max(-1, Math.min(1, channels[0][i + k])) * 32767,
        );
        if (right)
          right[k] = Math.round(
            Math.max(-1, Math.min(1, channels[1][i + k])) * 32767,
          );
      }
      const out = encoder.encodeBuffer(left, right);
      if (out.length) chunks.push(new Uint8Array(out));
      if (i % (block * 50) === 0)
        self.postMessage({ progress: i / channels[0].length });
    }
    const tail = encoder.flush();
    if (tail.length) chunks.push(new Uint8Array(tail));
    self.postMessage({ blob: new Blob(chunks, { type: "audio/mpeg" }) });
  } catch (e) {
    self.postMessage({ error: (e as Error).message });
  }
};
