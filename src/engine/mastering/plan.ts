import type { AudioAnalysis } from "../analysis/analyze";
import { cloneFx, type Fx } from "../../lib/types";
export function proposeMastering(
  report: AudioAnalysis,
  current: Fx,
  strength = 0.5,
): Fx {
  const fx = cloneFx(current),
    preserve = report.midi.velocitySpread > 35 || report.dynamicRangeDb > 12;
  if (fx.bands?.[0]?.type === "lowshelf")
    fx.bands[0].gain = Math.max(
      -12,
      Math.min(
        12,
        fx.bands[0].gain - (report.bands[0] > 0.65 ? 2 * strength : 0),
      ),
    );
  fx.compression = Math.min(
    preserve ? 18 : 35,
    Math.max(fx.compression, report.crestDb > 20 ? 10 + 20 * strength : 8),
  );
  if (report.correlation !== null && report.correlation < 0.1)
    fx.width = Math.min(100, fx.width ?? 100);
  fx.autoLevel = true;
  fx.ceiling = Math.min(-1, fx.ceiling ?? -1);
  const points: { time: number; gain: number }[] = [];
  if (report.midi.notes) {
    for (const window of report.windows) {
      const gain =
        window.pedal >= 64 &&
        window.chord >= 3 &&
        window.register < 60 &&
        window.bassFraction > 0.6
          ? -Math.min(1.5, 2 * strength)
          : 0;
      points.push({ time: window.time, gain });
    }
    fx.localEq = points;
  }
  return fx;
}
export function candidateScore(
  source: AudioAnalysis,
  result: AudioAnalysis,
  targetRms: number,
) {
  const dynamicLoss = Math.max(
    0,
    source.dynamicRangeDb - result.dynamicRangeDb - 1.5,
  );
  return (
    Math.abs(result.rmsDb - targetRms) * 0.35 +
    dynamicLoss * 3 +
    Math.max(0, result.peakDb + 1) * 20 +
    Math.max(0, source.crestDb - result.crestDb - 3) * 2
  );
}
