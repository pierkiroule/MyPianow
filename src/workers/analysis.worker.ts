import { rmsOverWindow } from "../engine/analysis/level";
import { analyzeProbe } from "../engine/routing/routeProbe";
import { stereoEvidence } from "../engine/analysis/stereo";
/// <reference lib="webworker" />
import { analyze } from "../engine/analysis/analyze";
self.onmessage = async (event) => {
  try {
    self.postMessage({
      result:
        event.data.mode === "level"
          ? rmsOverWindow(event.data.pcm)
          : event.data.mode === "probe"
            ? await analyzeProbe(
                event.data.pcm,
                event.data.offset,
                event.data.gaps,
              )
            : event.data.mode === "stereo"
              ? stereoEvidence(event.data.pcm)
              : analyze(event.data.pcm, event.data.events, event.data.take),
    });
  } catch (error) {
    self.postMessage({ error: (error as Error).message });
  }
};
