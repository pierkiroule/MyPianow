import { useEffect, useRef, useState } from "react";
import { analyzeInWorker } from "../../engine/analysis/worker";
import type { AudioAnalysis } from "../../engine/analysis/analyze";
import { proposeMastering, candidateScore } from "../../engine/mastering/plan";
import { renderPcm } from "../../engine/dsp/effects";
import type { Pcm, Take, MidiPacket, Fx } from "../../lib/types";
export function IntelligentMaster({
  pcm,
  take,
  events,
  disabled,
  onFx,
  onBusy,
}: {
  pcm: Pcm;
  take: Take;
  events: MidiPacket[];
  disabled: boolean;
  onFx: (fx: Fx) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [report, setReport] = useState<AudioAnalysis | null>(null),
    [proposal, setProposal] = useState<Fx | null>(null),
    [status, setStatus] = useState("Analyse locale, sans modèle neuronal."),
    [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null),
    revision = useRef(0);
  useEffect(() => {
    revision.current++;
    controller.current?.abort();
    setBusy(false);
    onBusy(false);
    setReport(null);
    setProposal(null);
  }, [pcm, take.id, take.midi?.offsetMs, take.fx, events]);
  useEffect(
    () => () => {
      controller.current?.abort();
      onBusy(false);
    },
    [],
  );
  async function run(iterative: boolean) {
    if (busy || disabled) return;
    const token = revision.current;
    controller.current = new AbortController();
    const signal = controller.current.signal;
    setBusy(true);
    onBusy(true);
    setProposal(null);
    try {
      setStatus("Analyse spectrale, dynamique, stéréo et MIDI…");
      const source = await analyzeInWorker(pcm, events, take, signal);
      if (token !== revision.current) return;
      setReport(source);
      if (source.peakDb <= -100) {
        setStatus("Prise silencieuse : aucun traitement automatique proposé.");
        return;
      }
      let best = proposeMastering(source, take.fx),
        score = Infinity;
      if (iterative) {
        for (const [index, strength] of [0.25, 0.5, 0.75].entries()) {
          setStatus(
            `Comparaison numérique ${index + 1}/3 · respect de la dynamique et des crêtes…`,
          );
          const candidate = proposeMastering(source, take.fx, strength),
            rendered = await renderPcm(pcm, candidate, signal),
            analysis = await analyzeInWorker(rendered, [], undefined, signal),
            next = candidateScore(source, analysis, candidate.targetRms ?? -20);
          if (next < score) {
            score = next;
            best = candidate;
          }
        }
      }
      if (token !== revision.current || signal.aborted) return;
      setProposal(best);
      setStatus(
        "Proposition prête. Compare à l’écoute après application ; l’optimisation numérique ne juge pas la qualité artistique.",
      );
    } catch (error) {
      if (!signal.aborted && token === revision.current)
        setStatus((error as Error).message);
    } finally {
      if (token === revision.current) {
        setBusy(false);
        onBusy(false);
      }
    }
  }
  return (
    <div className="intelligent-master">
      <div className="section-top">
        <h3>Assistant de mastering DSP</h3>
        <span className="chip">Audio + MIDI · local</span>
      </div>
      <div className="button-row">
        <button disabled={disabled || busy} onClick={() => run(false)}>
          Analyser et proposer
        </button>
        <button disabled={disabled || busy} onClick={() => run(true)}>
          Optimiser · 3 variantes
        </button>
        {busy && (
          <button onClick={() => controller.current?.abort()}>
            Annuler l’analyse
          </button>
        )}
      </div>
      <p className="small" role="status">
        {status}
      </p>
      {report && (
        <>
          <div className="metric-grid">
            {[
              ["Niveau RMS", `${report.rmsDb.toFixed(1)} dBFS`],
              ["Crête échantillonnée", `${report.peakDb.toFixed(1)} dBFS`],
              ["Contraste local", `${report.dynamicRangeDb.toFixed(1)} dB`],
              [
                "Corrélation stéréo",
                report.correlation === null
                  ? "Non mesurable"
                  : report.correlation.toFixed(2),
              ],
              ["Notes MIDI", String(report.midi.notes)],
              ["Pédale forte", `${report.midi.pedalEvents} événements`],
            ].map(([label, value]) => (
              <div key={label}>
                <small>{label}</small>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <svg
            className="analysis-timeline"
            viewBox="0 0 640 70"
            role="img"
            aria-label="Analyse par fenêtres d’une demi-seconde"
          >
            {report.windows.map((w, i) => (
              <rect
                key={i}
                x={(i / report.windows.length) * 640}
                y={70 - Math.max(1, w.rmsDb + 70)}
                width={Math.max(0.5, 640 / report.windows.length)}
                height={Math.max(1, w.rmsDb + 70)}
                fill={w.pedal >= 64 ? "#c08c62" : "#7d9c8e"}
              >
                <title>
                  {w.time.toFixed(1)} s · {w.rmsDb.toFixed(1)} dBFS · {w.notes}{" "}
                  attaques · vélocité {w.velocity.toFixed(0)} · pédale {w.pedal}
                </title>
              </rect>
            ))}
          </svg>
          <p className="small">
            Analyse spectrale indicative par bandes, dynamique sur fenêtres 0,5
            s ; ce ne sont pas des mesures LUFS/LRA ou true peak. Le MIDI guide
            des corrections graves limitées à 1,5 dB sur les accords graves sous
            pédale. Calage MIDI{" "}
            {report.midi.alignment === "estimated"
              ? "estimé : vérifier le décalage"
              : "non établi : guidage local désactivé"}
            .
          </p>
        </>
      )}
      {proposal && (
        <button
          className="primary"
          disabled={disabled || busy}
          onClick={() => onFx(proposal)}
        >
          Appliquer la proposition non destructive
        </button>
      )}
    </div>
  );
}
