import { useEffect, useRef, useState } from "react";
import { LoopEngine } from "../../engine/loopPad/LoopEngine";
import {
  type LoopProject,
  type LoopTrack,
  type SampleAsset,
  newProject,
} from "../../engine/loopPad/types";
import { captureSample } from "../../engine/recording/SampleCapture";
import {
  listProjects,
  projectAssets,
  saveAsset,
  saveProject,
} from "../../storage/projects";
import { isUsb } from "../../engine/audio/devices";
type Props = {
  project: LoopProject;
  onProject: (p: LoopProject) => void;
  engine: LoopEngine;
  output: string;
  disabled: boolean;
  playing: boolean;
  onPlaying: (p: boolean) => void;
  onBusy: (p: boolean) => void;
  onNotice: (message: string) => void;
};
export function LoopPad({
  project,
  onProject,
  engine,
  output,
  disabled,
  playing,
  onPlaying,
  onBusy,
  onNotice,
}: Props) {
  const [assets, setAssets] = useState<SampleAsset[]>([]),
    [projects, setProjects] = useState<LoopProject[]>([]),
    [step, setStep] = useState(-1),
    [busy, setBusy] = useState(false),
    [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]),
    [mic, setMic] = useState(""),
    [micTrack, setMicTrack] = useState(project.tracks[0].id);
  useEffect(() => setMicTrack(project.tracks[0].id), [project.id]);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    void projectAssets(project)
      .then(setAssets)
      .catch((error) => onNotice(error.message));
    void listProjects().then(setProjects);
  }, [project]);
  useEffect(() => {
    engine.onStep = setStep;
    return () => {
      engine.onStep = undefined;
      abort.current?.abort();
    };
  }, [engine]);
  async function change(next: LoopProject) {
    onProject({ ...next, updated: Date.now() });
  }
  function edit(id: string, patch: Partial<LoopTrack>) {
    void change({
      ...project,
      tracks: project.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    });
  }
  async function prepare() {
    await engine.prepare(output);
    engine.configure(project, await projectAssets(project));
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    onBusy(true);
    try {
      await action();
    } catch (error) {
      onNotice((error as Error).message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  async function attach(track: string, asset: SampleAsset) {
    edit(track, {
      assetId: asset.id,
      name: asset.name,
      trimStart: 0,
      trimEnd: asset.frames / asset.rate,
    });
    setAssets((a) => [...a, asset]);
  }
  async function importSample(id: string, file?: File) {
    if (!file) return;
    await run(async () => {
      if (file.size > 25 * 1024 * 1024)
        throw Error("Fichier limité à 25 Mo ; sample à 12 secondes.");
      const ctx = new OfflineAudioContext(2, 1, 44100);
      const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
      if (buffer.duration > 12)
        throw Error("Choisis un sample de 12 secondes maximum.");
      const asset = await saveAsset(file.name, {
        rate: buffer.sampleRate,
        channels: Array.from(
          { length: Math.min(2, buffer.numberOfChannels) },
          (_, i) => buffer.getChannelData(i),
        ),
      });
      await attach(id, asset);
      onNotice("Sample conservé localement. Aucun fichier envoyé.");
    });
  }
  async function recordMic() {
    await run(async () => {
      await engine.close();
      onPlaying(false);
      abort.current = new AbortController();
      onNotice(
        "Capture micro PC · 8 secondes. Aucun retour du micro vers les enceintes.",
      );
      const pcm = await captureSample(mic, abort.current.signal);
      await attach(micTrack, await saveAsset("Sample micro", pcm));
    });
  }
  const locked = disabled || busy || playing;
  return (
    <section className="card loop-pad">
      <div className="section-top">
        <span className="step">CREATE</span>
        <h2>LoopPad · 8 pistes</h2>
        <span className="chip">Sources séparées</span>
      </div>
      <p className="sub">
        Importe tes sons ou capture le micro du PC. Programme une mesure, puis
        joue du piano par-dessus dans PLAY.
      </p>
      <div className="studio-controls">
        <label>
          Projet
          <input
            aria-label="Titre du projet"
            value={project.title}
            maxLength={120}
            disabled={locked}
            onChange={(e) => change({ ...project, title: e.target.value })}
          />
        </label>
        <label>
          Tempo
          <input
            aria-label="Tempo"
            type="number"
            min="40"
            max="220"
            value={project.tempo}
            disabled={locked}
            onChange={(e) => {
              const tempo = Number(e.target.value);
              if (tempo >= 40 && tempo <= 220)
                void change({ ...project, tempo });
            }}
          />
        </label>
        <label>
          Swing · {Math.round(project.swing * 100)} %
          <input
            type="range"
            min="0"
            max=".6"
            step=".01"
            value={project.swing}
            disabled={locked}
            onChange={(e) =>
              change({ ...project, swing: Number(e.target.value) })
            }
          />
        </label>
        <button
          className="primary"
          disabled={disabled || busy}
          onClick={() =>
            run(async () => {
              if (playing) {
                engine.stop();
                onPlaying(false);
              } else {
                await prepare();
                engine.start();
                onPlaying(true);
              }
            })
          }
        >
          {playing ? "Arrêter les boucles" : "Lire l’accompagnement"}
        </button>
      </div>
      <div className="studio-controls">
        <label>
          Projet local
          <select
            disabled={locked}
            value={project.id}
            onChange={(e) => {
              const p = projects.find((p) => p.id === e.target.value);
              if (p) onProject(p);
            }}
          >
            <option value={project.id}>{project.title}</option>
            {projects
              .filter((p) => p.id !== project.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
          </select>
        </label>
        <button
          disabled={locked}
          onClick={() =>
            run(async () => {
              const p = newProject();
              await saveProject(p);
              onProject(p);
            })
          }
        >
          Nouveau projet
        </button>
        <button
          disabled={locked}
          onClick={() =>
            run(async () => {
              const p = {
                ...structuredClone(project),
                id: crypto.randomUUID(),
                title: project.title + " · variante",
                updated: Date.now(),
              };
              await saveProject(p);
              onProject(p);
            })
          }
        >
          Dupliquer
        </button>
      </div>
      <div className="sequence-scroll">
        <div className="sequence-header">
          <span>Piste / pad</span>
          {Array.from({ length: 16 }, (_, i) => (
            <span key={i}>{i % 4 === 0 ? String(i / 4 + 1) : "·"}</span>
          ))}
        </div>
        {project.tracks.map((track, index) => {
          const asset = assets.find((a) => a.id === track.assetId);
          return (
            <div className="sequence-track" key={track.id}>
              <div className="sequence-row">
                <button
                  className="pad-trigger"
                  disabled={disabled || busy || !asset}
                  onClick={() =>
                    run(async () => {
                      if (
                        !engine.context ||
                        engine.revision !==
                          project.id + ":" + project.updated ||
                        engine.outputId !== output
                      )
                        await prepare();
                      engine.trigger(track.id);
                    })
                  }
                >
                  {index + 1} · {track.name}
                </button>
                {track.steps.map((on, i) => (
                  <button
                    key={i}
                    aria-label={`${track.name}, pas ${i + 1}`}
                    aria-pressed={on}
                    disabled={locked || !asset}
                    className={`sequence-step ${on ? "on" : ""} ${playing && step === i ? "current" : ""}`}
                    onClick={() =>
                      edit(track.id, {
                        steps: track.steps.map((value, j) =>
                          j === i ? !value : value,
                        ),
                      })
                    }
                  />
                ))}
              </div>
              <details className="track-detail">
                <summary>
                  {asset
                    ? `${(asset.frames / asset.rate).toFixed(1)} s · réglages et découpe`
                    : "Ajouter un sample"}
                </summary>
                <div className="studio-controls">
                  <label>
                    Importer
                    <input
                      aria-label={`Importer sample ${index + 1}`}
                      type="file"
                      accept="audio/*"
                      disabled={locked}
                      onChange={(e) => {
                        void importSample(track.id, e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <label>
                    Début (s)
                    <input
                      type="number"
                      min="0"
                      max={asset ? asset.frames / asset.rate : 0}
                      step=".01"
                      value={track.trimStart}
                      disabled={locked || !asset}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (
                          v >= 0 &&
                          v <
                            (track.trimEnd ||
                              (asset ? asset.frames / asset.rate : 0))
                        )
                          edit(track.id, { trimStart: v });
                      }}
                    />
                  </label>
                  <label>
                    Fin (s)
                    <input
                      type="number"
                      min="0"
                      max={asset ? asset.frames / asset.rate : 0}
                      step=".01"
                      value={track.trimEnd}
                      disabled={locked || !asset}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (
                          asset &&
                          v > track.trimStart &&
                          v <= asset.frames / asset.rate
                        )
                          edit(track.id, { trimEnd: v });
                      }}
                    />
                  </label>
                  <label>
                    Gain · {track.gainDb} dB
                    <input
                      type="range"
                      min="-48"
                      max="6"
                      step=".5"
                      value={track.gainDb}
                      disabled={locked}
                      onChange={(e) =>
                        edit(track.id, { gainDb: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    Panoramique
                    <input
                      type="range"
                      min="-1"
                      max="1"
                      step=".1"
                      value={track.pan}
                      disabled={locked}
                      onChange={(e) =>
                        edit(track.id, { pan: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    Filtre · {track.cutoff} Hz
                    <input
                      type="range"
                      min="80"
                      max="20000"
                      step="20"
                      value={track.cutoff}
                      disabled={locked}
                      onChange={(e) =>
                        edit(track.id, { cutoff: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    Réverbération
                    <input
                      type="range"
                      min="0"
                      max=".3"
                      step=".01"
                      value={track.room}
                      disabled={locked}
                      onChange={(e) =>
                        edit(track.id, { room: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={track.muted}
                      disabled={locked}
                      onChange={(e) =>
                        edit(track.id, { muted: e.target.checked })
                      }
                    />
                    Muet
                  </label>
                </div>
              </details>
            </div>
          );
        })}
      </div>
      <details className="help">
        <summary>Capturer un sample avec le micro du PC</summary>
        <p>
          Cette capture est volontaire et distincte de l’entrée piano USB. La
          lecture est arrêtée pendant ces huit secondes.
        </p>
        <button
          disabled={locked}
          onClick={() =>
            run(async () => {
              const devices = await navigator.mediaDevices.enumerateDevices();
              setMicrophones(
                devices.filter(
                  (d) =>
                    d.kind === "audioinput" &&
                    d.deviceId !== "default" &&
                    !isUsb(d),
                ),
              );
            })
          }
        >
          Lister les micros
        </button>
        <label>
          Micro exact
          <select
            aria-label="Micro du sample"
            disabled={locked}
            value={mic}
            onChange={(e) => setMic(e.target.value)}
          >
            <option value="">Choisir un micro PC</option>
            {microphones.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || "Entrée sans nom"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Piste cible
          <select
            value={micTrack}
            disabled={locked}
            onChange={(e) => setMicTrack(e.target.value)}
          >
            {project.tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <button disabled={locked || !mic} onClick={recordMic}>
          Capturer le micro · 8 s
        </button>
        <button disabled={!busy} onClick={() => abort.current?.abort()}>
          Annuler la capture micro
        </button>
      </details>
      <p className="small">
        Une mesure de 16 doubles croches, répétée ; une voix par piste. Bus
        d’accompagnement à -6 dB avec compression de sécurité (pas un limiteur
        true peak). Les réglages sont figés pendant la lecture et la prise. La
        version actuelle ne propose pas encore de timeline d’arrangement
        multi-mesures. Pour le piano + boucles, désactive Audio Loopback sur le
        Yamaha et vérifie le Diagnostic Studio.
      </p>
    </section>
  );
}
