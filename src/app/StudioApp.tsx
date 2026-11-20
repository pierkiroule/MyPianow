import { DeviceControls } from "../features/play/DeviceControls";
import { StudioDiagnostics } from "../features/diagnostics/StudioDiagnostics";
import { LoopPad } from "../features/create/LoopPad";
import { ProjectFiles } from "../features/create/ProjectFiles";
import { IntelligentMaster } from "../features/master/IntelligentMaster";
import { LoopEngine, mixAccompaniment } from "../engine/loopPad/LoopEngine";
import { newProject, type LoopProject } from "../engine/loopPad/types";
import { listProjects, saveProject, projectAssets } from "../storage/projects";
import { SIGNATURES, SIGNATURE_LABELS as labels } from "../presets/signatures";
import { exportMidi } from "../export/midi";
import { levelInWorker } from "../engine/analysis/levelWorker";
import { noteTimeline } from "../engine/midi/performance";
import { useEffect, useRef, useState, useMemo } from "react";
import { Piano, type PianoState } from "../engine/midi/Piano";
import { REVERBS, unpack } from "../engine/midi/protocol";
import { Recorder, audioDevices } from "../engine/recording/Recorder";
import {
  listTakes,
  readPcm,
  readMidi,
  recoverTakes,
  saveTake,
  deleteTake,
} from "../storage/database";
import {
  PRESETS,
  cloneFx,
  type Take,
  type Pcm,
  type Fx,
  type Preset,
  type MidiPacket,
} from "../lib/types";
import { renderPcm } from "../engine/dsp/effects";
import { encodeMp3 } from "../lib/mp3";
import { shareTrack } from "../lib/share";
import { encodeWav, download } from "../lib/wav";
import "../style.css";
const piano = new Piano();
const clock = (n: number) =>
  String(Math.floor(n / 60)).padStart(2, "0") +
  ":" +
  String(Math.floor(n % 60)).padStart(2, "0");
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
function useBlobUrl(blob: Blob | null) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!blob) {
      setUrl("");
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}
export default function App() {
  const [pianoState, setPianoState] = useState<PianoState>(piano.state),
    [tab, setTab] = useState<"studio" | "takes">("studio"),
    [takes, setTakes] = useState<Take[]>([]),
    [selected, setSelected] = useState<Take | null>(null),
    [raw, setRaw] = useState<Pcm | null>(null),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [deviceId, setDeviceId] = useState(""),
    [inputId, setInputId] = useState(""),
    [outputId, setOutputId] = useState(""),
    [preEffect, setPreEffect] = useState("keep"),
    [preDepth, setPreDepth] = useState(8),
    [phase, setPhase] = useState<"idle" | "opening" | "recording" | "saving">(
      "idle",
    ),
    [seconds, setSeconds] = useState(0),
    [peak, setPeak] = useState(0),
    [notice, setNotice] = useState("Votre studio reste sur cet appareil."),
    [working, setWorking] = useState(false),
    [original, setOriginal] = useState<Blob | null>(null),
    [master, setMaster] = useState<Blob | null>(null),
    [listen, setListen] = useState<"master" | "original">("master"),
    [deleteId, setDeleteId] = useState<string | null>(null),
    [install, setInstall] = useState<InstallPrompt | null>(null),
    [update, setUpdate] = useState<ServiceWorker | null>(null),
    [storageInfo, setStorageInfo] = useState("");
  const [workspace, setWorkspace] = useState<
    "play" | "create" | "master" | "diagnostics"
  >("play");
  const [project, setProject] = useState<LoopProject>(() => newProject());
  const [loopEngine] = useState(() => new LoopEngine());
  const [loopPlaying, setLoopPlaying] = useState(false),
    [createBusy, setCreateBusy] = useState(false),
    [archiveBusy, setArchiveBusy] = useState(false);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]),
    [audioOutput, setAudioOutput] = useState("");
  const [maxSeconds, setMaxSeconds] = useState(180);
  const [mixSource, setMixSource] = useState<Pcm | null>(null),
    [comparisonOriginal, setComparisonOriginal] = useState<Blob | null>(null);
  const [matched, setMatched] = useState(true),
    [levels, setLevels] = useState({ source: 1, master: 1 }),
    [outputError, setOutputError] = useState(false);
  const [pastFx, setPastFx] = useState<Fx[]>([]),
    [futureFx, setFutureFx] = useState<Fx[]>([]);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [routerBusy, setRouterBusy] = useState(false);
  const [captureMidi, setCaptureMidi] = useState(true);
  const [midiCount, setMidiCount] = useState(0);
  const [midiEvents, setMidiEvents] = useState<MidiPacket[]>([]);
  const [format, setFormat] = useState<"wav" | "mp3">("wav"),
    [mp3, setMp3] = useState<Blob | null>(null),
    [exportBusy, setExportBusy] = useState(false),
    [encodeProgress, setEncodeProgress] = useState(0);
  const [customPresets, setCustomPresets] = useState<
      { name: string; fx: Fx }[]
    >(() => {
      try {
        const values = JSON.parse(
          localStorage.getItem("mypianow-custom-presets") || "[]",
        );
        return Array.isArray(values)
          ? values
              .filter(
                (v) =>
                  typeof v.name === "string" &&
                  v.fx &&
                  typeof v.fx.gain === "number",
              )
              .slice(0, 30)
          : [];
      } catch {
        return [];
      }
    }),
    [customName, setCustomName] = useState("");
  const previewState = useRef({ time: 0, resume: false });
  const recorder = useRef<Recorder | null>(null),
    busyStop = useRef(false),
    player = useRef<HTMLAudioElement | null>(null),
    renderQueue = useRef(Promise.resolve()),
    loadId = useRef(0),
    phaseRef = useRef(phase);
  phaseRef.current = phase;
  const originalUrl = useBlobUrl(original),
    masterUrl = useBlobUrl(master),
    active = phase !== "idle";
  const studioLocked =
    active ||
    routerBusy ||
    createBusy ||
    archiveBusy ||
    exportBusy ||
    analysisBusy;
  const comparisonUrl = useBlobUrl(comparisonOriginal);
  async function refresh() {
    setTakes(await listTakes());
  }
  useEffect(() => {
    void listProjects()
      .then(async (items) => {
        if (items[0]) setProject(items[0]);
        else await saveProject(project);
      })
      .catch((e) => setNotice(e.message));
    loopEngine.onFault = (text) => {
      setLoopPlaying(false);
      setNotice(text);
      if (recorder.current) void stop(text);
    };
    return () => {
      void loopEngine.close();
    };
  }, []);
  async function updateProject(next: LoopProject) {
    setProject(next);
    try {
      await saveProject(next);
    } catch (e) {
      setNotice("Projet non sauvegardé : " + message(e));
    }
  }
  function navigate(next: typeof workspace) {
    if (studioLocked) return;
    if (next === "master" || next === "diagnostics") {
      loopEngine.stop();
      setLoopPlaying(false);
    }
    setTab("studio");
    setWorkspace(next);
    window.scrollTo(0, 0);
  }
  useEffect(() => {
    player.current?.pause();
    void loopEngine.close();
    setLoopPlaying(false);
  }, [audioOutput]);
  useEffect(() => {
    const audio = player.current;
    if (!audio) return;
    let stale = false;
    audio.pause();
    setOutputError(true);
    const element = audio as HTMLAudioElement & {
      setSinkId?: (id: string) => Promise<void>;
    };
    const route = element.setSinkId
      ? element.setSinkId(audioOutput)
      : audioOutput
        ? Promise.reject(
            Error("Choix de sortie indisponible pour la préécoute."),
          )
        : Promise.resolve();
    void route
      .then(() => {
        if (!stale) setOutputError(false);
      })
      .catch((e) => {
        if (!stale) {
          audio.pause();
          setNotice("Sortie non confirmée : " + e.message);
        }
      });
    return () => {
      stale = true;
    };
  }, [audioOutput, selected?.id, tab]);
  useEffect(() => {
    if (player.current) {
      const floor = Math.min(levels.source, levels.master);
      player.current.volume =
        matched && floor > 1e-6
          ? Math.min(
              1,
              floor / (listen === "original" ? levels.source : levels.master),
            )
          : 1;
    }
  }, [matched, levels, listen]);
  useEffect(() => {
    if (!raw || !selected) {
      setMixSource(null);
      return;
    }
    let stale = false;
    setMixSource(null);
    const accompaniment = selected.accompaniment;
    if (!accompaniment?.include) {
      setMixSource(raw);
      return;
    }
    setWorking(true);
    void projectAssets(accompaniment.project)
      .then((assets) =>
        mixAccompaniment(
          raw,
          accompaniment.project,
          assets,
          accompaniment.offsetSeconds,
        ),
      )
      .then((result) => {
        if (!stale) setMixSource(result);
      })
      .catch((e) => {
        if (!stale) setNotice(e.message);
      })
      .finally(() => {
        if (!stale) setWorking(false);
      });
    return () => {
      stale = true;
    };
  }, [raw, selected?.id, selected?.accompaniment]);
  useEffect(() => {
    if (!mixSource || mixSource === raw) {
      setComparisonOriginal(null);
      return;
    }
    const abort = new AbortController();
    void encodeWav(mixSource, abort.signal)
      .then((blob) => {
        if (!abort.signal.aborted) setComparisonOriginal(blob);
      })
      .catch(() => {});
    return () => abort.abort();
  }, [mixSource, raw]);
  useEffect(() => {
    piano.onChange = setPianoState;
    void scan();
    recoverTakes()
      .then(refresh)
      .catch((e) => setNotice("Stockage local indisponible : " + message(e)));
    const before = (e: BeforeUnloadEvent) => {
      if (phaseRef.current !== "idle" || piano.state.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const hidden = () => {
      if (document.hidden && recorder.current)
        void stop("Page masquée : prise interrompue.");
    };
    const prompt = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallPrompt);
    };
    const waiting = (e: Event) =>
      setUpdate((e as CustomEvent<ServiceWorker>).detail);
    window.addEventListener("beforeunload", before);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("beforeinstallprompt", prompt);
    window.addEventListener("mypianow-update", waiting);
    return () => {
      piano.onChange = undefined;
      window.removeEventListener("beforeunload", before);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("beforeinstallprompt", prompt);
      window.removeEventListener("mypianow-update", waiting);
    };
  }, []);
  useEffect(() => {
    if (!inputId && pianoState.inputs.length === 1)
      setInputId(pianoState.inputs[0].id);
    if (!outputId && pianoState.outputs.length === 1)
      setOutputId(pianoState.outputs[0].id);
  }, [pianoState, inputId, outputId]);
  useEffect(() => {
    const handle = () => {
      if (!recorder.current) void scan();
    };
    navigator.mediaDevices?.addEventListener("devicechange", handle);
    return () =>
      navigator.mediaDevices?.removeEventListener("devicechange", handle);
  }, []);
  async function scan() {
    try {
      const [all, exposed] = await Promise.all([
        audioDevices(),
        navigator.mediaDevices.enumerateDevices(),
      ]);
      setAudioOutputs(exposed.filter((d) => d.kind === "audiooutput"));
      setDevices(all);
      setDeviceId((id) =>
        all.some((d) => d.deviceId === id)
          ? id
          : all.length === 1
            ? all[0].deviceId
            : "",
      );
      setNotice(
        all.length
          ? "Entrée audio USB disponible."
          : "Aucune entrée USB visible. Branche le piano. Si Chrome masque les noms, autorise Microphone dans les paramètres du site puis actualise. Aucun micro par défaut ne sera ouvert.",
      );
    } catch (e) {
      setNotice(message(e));
    }
  }
  async function selectTake(take: Take) {
    window.scrollTo(0, 0);
    const id = ++loadId.current;
    previewState.current = { time: 0, resume: false };
    player.current?.pause();
    setSelected(take);
    setPastFx([]);
    setFutureFx([]);
    setRaw(null);
    setMidiEvents([]);
    setOriginal(null);
    setMaster(null);
    setWorking(true);
    try {
      const [pcm, events] = await Promise.all([
        readPcm(take),
        readMidi(take.id),
      ]);
      if (id !== loadId.current) return;
      setRaw(pcm);
      setMidiEvents(events);
      setTab("studio");
      setWorkspace("master");
      setNotice(
        take.status === "interrupted"
          ? "Prise récupérée : seuls les blocs sauvegardés sont présents."
          : "Prise chargée. L’original reste intact.",
      );
    } catch (e) {
      if (id === loadId.current) setNotice(message(e));
    } finally {
      if (id === loadId.current) setWorking(false);
    }
  }
  useEffect(() => {
    if (!raw) return;
    const abort = new AbortController();
    setOriginal(null);
    encodeWav(raw, abort.signal)
      .then((b) => {
        if (!abort.signal.aborted) setOriginal(b);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setNotice(message(e));
      });
    return () => abort.abort();
  }, [raw]);
  useEffect(() => {
    setMp3(null);
    if (!mixSource || !selected) {
      setMaster(null);
      return;
    }
    const abort = new AbortController();
    if (listen === "master" && player.current && !player.current.paused)
      previewState.current = { time: player.current.currentTime, resume: true };
    setMaster(null);
    setWorking(true);
    const timer = setTimeout(() => {
      renderQueue.current = renderQueue.current
        .catch(() => {})
        .then(async () => {
          if (abort.signal.aborted) return;
          try {
            const result = await renderPcm(
              mixSource,
              selected.fx,
              abort.signal,
            );
            const [sourceLevel, masterLevel] = await Promise.all([
              levelInWorker(mixSource, abort.signal),
              levelInWorker(result, abort.signal),
            ]);
            if (!abort.signal.aborted)
              setLevels({ source: sourceLevel, master: masterLevel });
            const blob = await encodeWav(result, abort.signal);
            if (!abort.signal.aborted) setMaster(blob);
          } catch (e) {
            if (!abort.signal.aborted) setNotice(message(e));
          } finally {
            if (!abort.signal.aborted) setWorking(false);
          }
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [mixSource, selected?.id, selected?.fx]);
  async function start() {
    if (studioLocked || working || !deviceId) return;
    player.current?.pause();
    setPhase("opening");
    const rec = new Recorder();
    recorder.current = rec;
    setMidiCount(0);
    rec.onMidi = setMidiCount;
    rec.onMeter = (p, s) => {
      setPeak(p);
      setSeconds(s);
    };
    rec.onInterrupted = (reason) => {
      void stop(reason);
    };
    try {
      const d = devices.find((d) => d.deviceId === deviceId);
      if (!d) throw Error("Choisissez une entrée USB.");
      await rec.start(
        d,
        piano.metadata,
        captureMidi ? piano.captureInput(inputId) : undefined,
        {
          context: loopPlaying ? loopEngine.context : undefined,
          project: loopPlaying ? project : undefined,
          loopOrigin: loopEngine.origin,
          maxSeconds,
        },
      );
      if (recorder.current !== rec) return;
      setSeconds(0);
      setPeak(0);
      setPhase("recording");
      setNotice("Enregistrement USB. Sauvegarde des blocs audio en cours.");
    } catch (e) {
      recorder.current = null;
      setPhase("idle");
      setNotice(message(e));
      await refresh();
    }
  }
  async function stop(reason?: string) {
    const rec = recorder.current;
    if (!rec || busyStop.current) return;
    busyStop.current = true;
    setPhase("saving");
    try {
      const take = await rec.stop(reason);
      setNotice(reason || "Prise sauvegardée sur cet appareil.");
      await refresh();
      if (take.frames) await selectTake(take);
    } catch (e) {
      setNotice("Sauvegarde à vérifier : " + message(e));
      await refresh();
    } finally {
      recorder.current = null;
      busyStop.current = false;
      setPhase("idle");
      loopEngine.stop();
      setLoopPlaying(false);
      setPeak(0);
    }
  }
  async function editTake(next: Take, history = true) {
    if (history && selected && next.fx !== selected.fx) {
      setPastFx((list) => [...list.slice(-19), cloneFx(selected.fx)]);
      setFutureFx([]);
    }
    setSelected(next);
    setTakes((list) => list.map((t) => (t.id === next.id ? next : t)));
    try {
      await saveTake(next);
    } catch (e) {
      setNotice("Réglages non sauvegardés : " + message(e));
    }
  }
  function switchListen(mode: "original" | "master") {
    if (player.current)
      previewState.current = {
        time: player.current.currentTime,
        resume: !player.current.paused,
      };
    setListen(mode);
  }
  function saveCustom() {
    if (!selected || !customName.trim()) return;
    const values = [
      ...customPresets.filter((p) => p.name !== customName.trim()),
      { name: customName.trim().slice(0, 60), fx: cloneFx(selected.fx) },
    ].slice(-30);
    try {
      localStorage.setItem("mypianow-custom-presets", JSON.stringify(values));
      setCustomPresets(values);
      setCustomName("");
      setNotice("Rendu personnel conservé sur cet appareil.");
    } catch {
      setNotice("Impossible de conserver ce preset dans ce navigateur.");
    }
  }
  const waveform = useMemo(() => {
    if (!raw) return [];
    const mono = raw.channels[0],
      width = Math.max(1, Math.floor(mono.length / 160));
    return Array.from({ length: 160 }, (_, i) => {
      let peak = 0;
      for (
        let j = i * width;
        j < Math.min(mono.length, (i + 1) * width);
        j += Math.max(1, Math.floor(width / 32))
      )
        peak = Math.max(peak, Math.abs(mono[j]));
      return Math.max(1, Math.min(60, peak * 90));
    });
  }, [raw]);
  async function choosePreset(preset: Preset) {
    if (selected)
      await editTake({ ...selected, preset, fx: cloneFx(PRESETS[preset]) });
  }
  async function exportTrack() {
    if (!selected || !mixSource || !master) return;
    try {
      if (format === "wav") {
        download(master, selected.title + ".wav");
        return;
      }
      if (mp3) {
        download(mp3, selected.title + ".mp3");
        return;
      }
      setExportBusy(true);
      setEncodeProgress(0);
      const processed = await renderPcm(
        mixSource,
        selected.fx,
        new AbortController().signal,
      );
      const blob = await encodeMp3(processed, setEncodeProgress);
      setMp3(blob);
      download(blob, selected.title + ".mp3");
      setNotice("MP3 prêt. Vous pouvez maintenant le partager.");
    } catch (e) {
      setNotice(message(e));
    } finally {
      setExportBusy(false);
    }
  }
  async function share() {
    if (!selected) return;
    const blob = format === "mp3" ? mp3 : master;
    if (!blob) return;
    try {
      if (!(await shareTrack(blob, selected.title, format))) {
        download(blob, selected.title + "." + format);
        setNotice(
          "Partage de fichiers non disponible : fichier téléchargé pour le partager depuis votre ordinateur.",
        );
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setNotice(message(e));
    }
  }
  async function remove(id: string) {
    try {
      await deleteTake(id);
      if (selected?.id === id) {
        loadId.current++;
        setSelected(null);
        setRaw(null);
        setOriginal(null);
        setMaster(null);
      }
      setDeleteId(null);
      await refresh();
    } catch (e) {
      setNotice(message(e));
    }
  }
  const knownEffect =
    pianoState.values.effect &&
    REVERBS.some((r) => r.value === unpack(pianoState.values.effect!));
  const sliders: [keyof Fx, string, number, number, number, string][] = [
    ["width", "Largeur stéréo", 0, 150, 1, "%"],
    ["gain", "Gain", -9, 9, 0.5, "dB"],
    ["compression", "Compression", 0, 100, 1, "%"],
    ["room", "Espace ajouté", 0, 30, 1, "%"],
    ["warmth", "Chaleur harmonique", 0, 40, 1, "%"],
  ];
  return (
    <div className="app-shell">
      <header className="header">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("play");
          }}
        >
          My<span>Pianow</span>
          <sup>•°</sup>
        </a>
        <div className="header-right">
          <span className="privacy">Sur votre appareil</span>
          {install && (
            <button
              className="quiet"
              onClick={async () => {
                await install.prompt();
                setInstall(null);
              }}
            >
              Installer
            </button>
          )}
        </div>
      </header>
      <main>
        <nav className="tabs workspace-tabs" aria-label="Espaces du studio">
          {(
            [
              ["play", "PLAY", "Jouer et enregistrer"],
              ["create", "CREATE", "Composer"],
              ["master", "MASTER", "Sublimer"],
              ["diagnostics", "Diagnostic", "Vérifier le studio"],
            ] as const
          ).map(([id, label, description]) => (
            <button
              key={id}
              disabled={studioLocked}
              className={tab === "studio" && workspace === id ? "active" : ""}
              aria-current={
                tab === "studio" && workspace === id ? "page" : undefined
              }
              onClick={() => navigate(id)}
            >
              <strong>{label}</strong>
              <small>{description}</small>
            </button>
          ))}
          <button
            className={tab === "takes" ? "active" : ""}
            disabled={studioLocked}
            onClick={() => {
              loopEngine.stop();
              setLoopPlaying(false);
              setTab("takes");
            }}
          >
            Mes créations <span>{takes.length}</span>
          </button>
        </nav>
        <div className="studio-status">
          <span>Windows · Chrome / Edge · traitement local</span>
          <span>
            {deviceId ? "Entrée sélectionnée" : "Entrée à connecter"} ·{" "}
            {loopPlaying ? "Accompagnement en lecture" : "Transport arrêté"}
            {active ? " · Prise en cours" : ""}
          </span>
        </div>

        {update && (
          <aside className="update">
            Une nouvelle version est prête.{" "}
            <button
              disabled={active || working || exportBusy || routerBusy}
              onClick={() => {
                update.postMessage({ type: "SKIP_WAITING" });
                navigator.serviceWorker.addEventListener(
                  "controllerchange",
                  () => location.reload(),
                  { once: true },
                );
              }}
            >
              Mettre à jour
            </button>
          </aside>
        )}
        <div className="notice" role="status" aria-live="polite">
          {notice}
        </div>
        {tab === "studio" ? (
          <>
            <div className="hero">
              <div>
                <p className="eyebrow">DESKTOP STUDIO · USB AUDIO + MIDI</p>
                <h1>
                  {workspace === "play" ? (
                    <>
                      Branchez. Jouez.
                      <br />
                      <em>Capturez l’instant.</em>
                    </>
                  ) : workspace === "create" ? (
                    <>
                      Vos sons.
                      <br />
                      <em>Votre accompagnement.</em>
                    </>
                  ) : workspace === "master" ? (
                    <>
                      Votre interprétation.
                      <br />
                      <em>Sa juste couleur.</em>
                    </>
                  ) : (
                    <>
                      Un câble.
                      <br />
                      <em>Des chemins vérifiés.</em>
                    </>
                  )}
                </h1>
                <p>Branchez votre piano. Jouez. Créez. Masterisez. Partagez.</p>
              </div>
              <div className="hero-art" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
            <div className="studio-grid" hidden={workspace !== "play"}>
              <section className="card recorder-card">
                <div className="section-top">
                  <span className="step">01</span>
                  <h2>Enregistrer</h2>
                  <span className="chip">USB audio</span>
                </div>
                <p className="sub">
                  Le son de votre piano, sans utiliser le micro du PC.
                </p>
                <DeviceControls
                  prefix="play"
                  inputs={devices}
                  outputs={audioOutputs}
                  input={deviceId}
                  output={audioOutput}
                  disabled={studioLocked || loopPlaying}
                  onInput={setDeviceId}
                  onOutput={setAudioOutput}
                  onScan={scan}
                />
                <p className="small">
                  Le piano fournit son écoute directe. Seuls les samples et
                  accompagnements du PC sont diffusés vers la sortie choisie ;
                  l’entrée piano n’est jamais réinjectée.
                </p>
                <label>
                  <input
                    type="checkbox"
                    checked={captureMidi}
                    disabled={active}
                    onChange={(e) => setCaptureMidi(e.target.checked)}
                  />
                  Enregistrer aussi les notes et pédales MIDI
                </label>
                {captureMidi && (
                  <div>
                    <button
                      disabled={studioLocked || pianoState.busy}
                      onClick={() => piano.authorize()}
                    >
                      Autoriser le MIDI
                    </button>
                    <select
                      aria-label="Entrée MIDI de la prise"
                      disabled={active}
                      value={inputId}
                      onChange={(e) => setInputId(e.target.value)}
                    >
                      <option value="">
                        Audio seul · aucun port MIDI sélectionné
                      </option>
                      {pianoState.inputs.map((port) => (
                        <option key={port.id} value={port.id}>
                          {port.name}
                        </option>
                      ))}
                    </select>
                    <p className="small">
                      {active
                        ? `${midiCount} événements MIDI reçus`
                        : "Le MIDI guide l’analyse future. Il ne génère aucun son. L’audio reste capturable seul."}
                    </p>
                  </div>
                )}
                <div
                  className={
                    "record-display " +
                    (phase === "recording" ? "is-recording" : "")
                  }
                >
                  <span>
                    {phase === "recording"
                      ? "PRISE EN COURS"
                      : phase === "saving"
                        ? "SAUVEGARDE"
                        : phase === "opening"
                          ? "CONNEXION USB"
                          : "PRÊT POUR VOTRE INSPIRATION"}
                  </span>
                  <div className="time">{clock(seconds)}</div>
                  <div
                    className="level"
                    role="meter"
                    aria-label="Niveau d’entrée"
                    aria-valuenow={Math.round(peak * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <i
                      style={{
                        width:
                          Math.min(
                            100,
                            Math.max(
                              0,
                              ((20 * Math.log10(peak + 1e-9) + 60) / 60) * 100,
                            ),
                          ) + "%",
                        background: peak > 0.98 ? "#cf6958" : undefined,
                      }}
                    />
                  </div>
                </div>
                <button
                  className={
                    "record-button " + (phase === "recording" ? "stop" : "")
                  }
                  disabled={
                    phase === "opening" ||
                    phase === "saving" ||
                    (!active &&
                      (!deviceId || working || exportBusy || routerBusy))
                  }
                  onClick={() =>
                    phase === "recording" ? void stop() : void start()
                  }
                >
                  <span className="record-symbol" />
                  {phase === "recording"
                    ? "Terminer la prise"
                    : phase === "saving"
                      ? "Sauvegarde…"
                      : "Enregistrer mon piano"}
                </button>
                <p className="small centered">
                  {maxSeconds / 60} min maximum · audio original sauvegardé au
                  fil du jeu
                </p>
                <button
                  disabled={studioLocked}
                  onClick={() => navigate("diagnostics")}
                >
                  Ouvrir le Diagnostic Studio
                </button>
                <label>
                  Durée maximale
                  <select
                    value={maxSeconds}
                    disabled={studioLocked}
                    onChange={(e) => setMaxSeconds(Number(e.target.value))}
                  >
                    <option value="180">
                      3 minutes · environ 69 Mo PCM stéréo à 48 kHz
                    </option>
                    <option value="600">
                      10 minutes · environ 230 Mo PCM stéréo à 48 kHz
                    </option>
                  </select>
                </label>
                {loopPlaying && (
                  <p className="route-result">
                    L’accompagnement sera conservé séparément avec cette prise.
                    Désactive Audio Loopback sur le Yamaha pour ne pas le
                    capturer aussi dans l’USB.
                  </p>
                )}
                <details className="help">
                  <summary>Connexion et conservation des prises</summary>
                  <p>
                    Chrome nomme l’autorisation audio « Microphone », même pour
                    l’USB. MyPianow exige une entrée nommée USB et ne demande
                    aucune source par défaut. Gardez la page visible ; un
                    passage en arrière-plan interrompt la prise. Laissez
                    résonner la dernière note avant de terminer.
                  </p>
                  <p>
                    Les prises restent dans le stockage de ce navigateur. Un
                    nettoyage des données ou une éviction peut les supprimer :
                    exportez celles qui comptent.
                  </p>
                  <button
                    disabled={studioLocked}
                    onClick={async () => {
                      try {
                        const persisted = await navigator.storage?.persist?.();
                        const estimate = await navigator.storage?.estimate?.();
                        setStorageInfo(
                          (persisted
                            ? "Stockage persistant accordé."
                            : "Stockage persistant non garanti.") +
                            " " +
                            (estimate?.usage
                              ? Math.round(estimate.usage / 1024 / 1024) +
                                " Mo utilisés."
                              : ""),
                        );
                      } catch (e) {
                        setStorageInfo(message(e));
                      }
                    }}
                  >
                    Renforcer la conservation locale
                  </button>
                  <p>{storageInfo}</p>
                </details>
              </section>
              <section className="card native-card">
                <div className="section-top">
                  <span className="step">02</span>
                  <h2>Avant la prise</h2>
                </div>
                <p className="sub">
                  Une ambiance jouée directement par le Clavinova.
                </p>
                <div className="piano-label">
                  {pianoState.ready
                    ? "Yamaha " + pianoState.model
                    : "Réverbération du CLP-825"}
                  <small>
                    {pianoState.ready
                      ? "Firmware " + pianoState.firmware
                      : "MIDI USB ou Bluetooth exposé au navigateur"}
                  </small>
                </div>
                <details className="connection" open={!pianoState.ready}>
                  <summary>
                    {pianoState.ready
                      ? "Connexion et état du piano"
                      : "Connecter les commandes du piano"}
                  </summary>
                  <button
                    className="secondary wide"
                    disabled={studioLocked || pianoState.busy}
                    onClick={() => piano.authorize()}
                  >
                    Autoriser le MIDI SysEx
                  </button>
                  {pianoState.inputs.length > 0 && (
                    <>
                      <label htmlFor="midi-in">Réponses du piano</label>
                      <select
                        id="midi-in"
                        disabled={studioLocked || pianoState.busy}
                        value={inputId}
                        onChange={(e) => setInputId(e.target.value)}
                      >
                        <option value="">Entrée MIDI</option>
                        {pianoState.inputs.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <label htmlFor="midi-out">Commandes vers le piano</label>
                      <select
                        id="midi-out"
                        disabled={studioLocked || pianoState.busy}
                        value={outputId}
                        onChange={(e) => setOutputId(e.target.value)}
                      >
                        <option value="">Sortie MIDI</option>
                        {pianoState.outputs.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <button
                        className="secondary wide"
                        disabled={
                          active || pianoState.busy || !inputId || !outputId
                        }
                        onClick={() => piano.connect(inputId, outputId)}
                      >
                        Identifier et lire les réglages
                      </button>
                    </>
                  )}
                  <p className="small" role="status">
                    {pianoState.message}
                  </p>
                  <p className="small">
                    Bluetooth : le CLP-825 peut être piloté en MIDI si son port
                    est exposé par le système et le navigateur. S’il n’apparaît
                    pas ici, utilisez le câble. L’enregistrement audio du piano
                    nécessite l’USB, même si le MIDI est sans fil.
                  </p>
                </details>
                <div className="native-presets">
                  {[
                    ["Sec", 0, 0],
                    ["Intime", 536, 8],
                    ["Scène", 260, 20],
                  ].map(([label, effect, depth]) => (
                    <button
                      key={String(label)}
                      className="quiet"
                      disabled={
                        studioLocked || pianoState.busy || !pianoState.ready
                      }
                      onClick={() => {
                        setPreEffect(String(effect));
                        setPreDepth(Number(depth));
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label htmlFor="ambience">Ambiance native</label>
                <select
                  id="ambience"
                  disabled={
                    studioLocked ||
                    pianoState.busy ||
                    !pianoState.ready ||
                    !knownEffect
                  }
                  value={preEffect}
                  onChange={(e) => setPreEffect(e.target.value)}
                >
                  <option value="keep">Conserver le type actuel</option>
                  {REVERBS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <label htmlFor="depth">
                  Intensité <output>{preDepth}</output>
                </label>
                <input
                  id="depth"
                  type="range"
                  min="0"
                  max="20"
                  value={preDepth}
                  disabled={
                    studioLocked ||
                    pianoState.busy ||
                    !pianoState.ready ||
                    !pianoState.values.depth
                  }
                  onChange={(e) => setPreDepth(+e.target.value)}
                />
                <div className="button-row">
                  <button
                    className="secondary"
                    disabled={
                      studioLocked || pianoState.busy || !pianoState.ready
                    }
                    onClick={() =>
                      piano.apply(
                        preEffect === "keep" ? null : +preEffect,
                        preDepth,
                      )
                    }
                  >
                    Appliquer au piano
                  </button>
                  <button
                    className="quiet"
                    disabled={
                      active ||
                      pianoState.busy ||
                      !pianoState.ready ||
                      !pianoState.dirty
                    }
                    onClick={() => piano.restore()}
                  >
                    Restaurer
                  </button>
                </div>
                <p className="small">
                  La sonorité actuelle est conservée. Restaurez les réglages
                  avant de quitter pour retrouver l’ambiance initiale.
                </p>
              </section>
            </div>
            <div hidden={workspace !== "create"}>
              <LoopPad
                project={project}
                onProject={updateProject}
                engine={loopEngine}
                output={audioOutput}
                disabled={studioLocked}
                playing={loopPlaying}
                onPlaying={setLoopPlaying}
                onBusy={setCreateBusy}
                onNotice={setNotice}
              />
            </div>
            <div hidden={workspace !== "diagnostics"}>
              <StudioDiagnostics
                device={devices.find((d) => d.deviceId === deviceId)}
                input={piano.captureInput(inputId)}
                output={audioOutput}
                onOutput={setAudioOutput}
                disabled={
                  active ||
                  createBusy ||
                  exportBusy ||
                  archiveBusy ||
                  loopPlaying
                }
                onBusy={setRouterBusy}
                onPrepare={() => {
                  previewState.current.resume = false;
                  player.current?.pause();
                }}
              >
                <DeviceControls
                  prefix="diagnostic"
                  inputs={devices}
                  outputs={audioOutputs}
                  input={deviceId}
                  output={audioOutput}
                  disabled={studioLocked}
                  onInput={setDeviceId}
                  onOutput={setAudioOutput}
                  onScan={scan}
                />
                <button
                  disabled={studioLocked}
                  onClick={() => piano.authorize()}
                >
                  Autoriser le MIDI du diagnostic
                </button>
                <label>
                  Entrée MIDI testée
                  <select
                    value={inputId}
                    disabled={studioLocked}
                    onChange={(e) => setInputId(e.target.value)}
                  >
                    <option value="">Aucun port MIDI sélectionné</option>
                    {pianoState.inputs.map((port) => (
                      <option key={port.id} value={port.id}>
                        {port.name}
                      </option>
                    ))}
                  </select>
                </label>
              </StudioDiagnostics>
            </div>
            <section
              className="card finish-card"
              hidden={workspace !== "master"}
            >
              <div className="section-top">
                <span className="step">03</span>
                <h2>Après la prise</h2>
                <span className="chip">Original préservé</span>
              </div>
              {selected ? (
                <>
                  <input
                    className="take-title"
                    aria-label="Titre de la prise"
                    disabled={studioLocked}
                    value={selected.title}
                    onChange={(e) => {
                      void editTake({ ...selected, title: e.target.value });
                    }}
                  />
                  <p className="sub">
                    {new Date(selected.created).toLocaleString("fr-FR")} ·{" "}
                    {clock(selected.frames / selected.rate)} ·{" "}
                    {selected.channels === 1
                      ? "Mono USB reçu"
                      : "Deux canaux USB reçus"}
                  </p>
                  {selected.accompaniment && (
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={selected.accompaniment.include}
                        disabled={studioLocked || working}
                        onChange={(e) =>
                          void editTake({
                            ...selected,
                            accompaniment: {
                              ...selected.accompaniment!,
                              include: e.target.checked,
                            },
                          })
                        }
                      />
                      Inclure l’accompagnement au mix final (désactiver si déjà
                      présent dans l’USB)
                    </label>
                  )}
                  {mixSource && (
                    <IntelligentMaster
                      onBusy={setAnalysisBusy}
                      pcm={mixSource}
                      take={selected}
                      events={midiEvents}
                      disabled={studioLocked || working}
                      onFx={(fx) => void editTake({ ...selected, fx })}
                    />
                  )}
                  <div className="button-row">
                    <button
                      disabled={studioLocked || !pastFx.length}
                      onClick={() => {
                        const fx = pastFx[pastFx.length - 1];
                        setPastFx(pastFx.slice(0, -1));
                        setFutureFx([...futureFx, cloneFx(selected.fx)]);
                        void editTake({ ...selected, fx }, false);
                      }}
                    >
                      Annuler le réglage
                    </button>
                    <button
                      disabled={studioLocked || !futureFx.length}
                      onClick={() => {
                        const fx = futureFx[futureFx.length - 1];
                        setFutureFx(futureFx.slice(0, -1));
                        setPastFx([...pastFx, cloneFx(selected.fx)]);
                        void editTake({ ...selected, fx }, false);
                      }}
                    >
                      Rétablir le réglage
                    </button>
                  </div>
                  <div className="preset-row">
                    {SIGNATURES.map((p) => (
                      <button
                        key={p}
                        disabled={studioLocked}
                        className={
                          "preset " + (selected.preset === p ? "selected" : "")
                        }
                        aria-pressed={selected.preset === p}
                        onClick={() => choosePreset(p)}
                      >
                        <span>{labels[p][0]}</span>
                        <small>{labels[p][1]}</small>
                      </button>
                    ))}
                  </div>
                  <details className="custom">
                    <summary>Mes rendus personnels</summary>
                    <div className="input-row">
                      <input
                        aria-label="Nom du rendu personnel"
                        placeholder="Nom de mon rendu"
                        maxLength={60}
                        value={customName}
                        disabled={studioLocked}
                        onChange={(e) => setCustomName(e.target.value)}
                      />
                      <button
                        className="secondary"
                        disabled={active || exportBusy || !customName.trim()}
                        onClick={saveCustom}
                      >
                        Conserver
                      </button>
                    </div>
                    <div className="custom-preset-list">
                      {customPresets.map((p) => (
                        <button
                          className="quiet"
                          key={p.name}
                          disabled={studioLocked}
                          onClick={() =>
                            editTake({ ...selected, fx: cloneFx(p.fx) })
                          }
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </details>
                  <details className="custom">
                    <summary>Égaliseur et finition</summary>
                    <div className="eq-bands">
                      {selected.fx.bands?.map((band, i) => (
                        <div className="eq-band" key={i}>
                          <strong>
                            {
                              [
                                "Graves",
                                "Bas médiums",
                                "Médiums",
                                "Présence",
                                "Aigus",
                              ][i]
                            }
                          </strong>
                          {(["frequency", "gain", "q"] as const).map((key) => (
                            <label key={key}>
                              {key === "frequency"
                                ? "Fréquence"
                                : key === "gain"
                                  ? "Gain"
                                  : "Largeur Q"}
                              <output>
                                {band[key]}{" "}
                                {key === "frequency"
                                  ? "Hz"
                                  : key === "gain"
                                    ? "dB"
                                    : ""}
                              </output>
                              <input
                                aria-label={"Bande " + (i + 1) + " " + key}
                                type="range"
                                min={
                                  key === "frequency"
                                    ? 20
                                    : key === "gain"
                                      ? -12
                                      : 0.1
                                }
                                max={
                                  key === "frequency"
                                    ? 18000
                                    : key === "gain"
                                      ? 12
                                      : 8
                                }
                                step={
                                  key === "frequency"
                                    ? 10
                                    : key === "gain"
                                      ? 0.5
                                      : 0.1
                                }
                                disabled={
                                  active ||
                                  exportBusy ||
                                  (key === "q" && band.type !== "peaking")
                                }
                                value={band[key]}
                                onChange={(e) =>
                                  editTake({
                                    ...selected,
                                    fx: {
                                      ...selected.fx,
                                      bands: selected.fx.bands!.map((b, j) =>
                                        j === i
                                          ? { ...b, [key]: +e.target.value }
                                          : b,
                                      ),
                                    },
                                  })
                                }
                              />
                            </label>
                          ))}
                        </div>
                      ))}
                    </div>
                    <div className="slider-grid">
                      {sliders.map(([key, label, min, max, step, unit]) => (
                        <label key={key} htmlFor={"fx-" + key}>
                          {label}
                          <output>
                            {Number(
                              selected.fx[key] ?? (key === "width" ? 100 : 0),
                            )}{" "}
                            {unit}
                          </output>
                          <input
                            id={"fx-" + key}
                            type="range"
                            min={min}
                            max={max}
                            step={step}
                            disabled={studioLocked}
                            value={Number(
                              selected.fx[key] ?? (key === "width" ? 100 : 0),
                            )}
                            onChange={(e) =>
                              editTake({
                                ...selected,
                                fx: { ...selected.fx, [key]: +e.target.value },
                              })
                            }
                          />
                        </label>
                      ))}
                    </div>
                    <label className="check">
                      <input
                        type="checkbox"
                        disabled={studioLocked}
                        checked={!!selected.fx.autoLevel}
                        onChange={(e) =>
                          editTake({
                            ...selected,
                            fx: { ...selected.fx, autoLevel: e.target.checked },
                          })
                        }
                      />{" "}
                      Niveau automatique
                    </label>
                    <div className="slider-grid">
                      <label>
                        Niveau moyen cible (RMS)
                        <output>{selected.fx.targetRms ?? -20} dBFS</output>
                        <input
                          type="range"
                          min="-24"
                          max="-12"
                          step="1"
                          disabled={studioLocked}
                          value={selected.fx.targetRms ?? -20}
                          onChange={(e) =>
                            editTake({
                              ...selected,
                              fx: {
                                ...selected.fx,
                                targetRms: +e.target.value,
                              },
                            })
                          }
                        />
                      </label>
                      <label>
                        Plafond de crête
                        <output>{selected.fx.ceiling ?? -1} dBFS</output>
                        <input
                          type="range"
                          min="-3"
                          max="-.3"
                          step=".1"
                          disabled={studioLocked}
                          value={selected.fx.ceiling ?? -1}
                          onChange={(e) =>
                            editTake({
                              ...selected,
                              fx: { ...selected.fx, ceiling: +e.target.value },
                            })
                          }
                        />
                      </label>
                    </div>
                    <p className="small">
                      La largeur agit sur une source stéréo ou l’espace ajouté.
                      Le niveau automatique conserve la dynamique dans la limite
                      du plafond ; ce réglage RMS n’est pas une mesure LUFS/true
                      peak.
                    </p>
                    <p className="small">
                      Le rendu Feutré filtre aussi les aigus. Il n’ajoute pas
                      d’échantillons de feutre. Une réverbération déjà
                      enregistrée dans le piano fait partie de l’original.
                    </p>
                  </details>
                  <div className="compare">
                    <button
                      className={listen === "original" ? "selected" : ""}
                      disabled={routerBusy}
                      onClick={() => switchListen("original")}
                    >
                      {selected.accompaniment?.include
                        ? "Mix sans mastering"
                        : "Original USB"}
                    </button>
                    <button
                      className={listen === "master" ? "selected" : ""}
                      disabled={routerBusy}
                      onClick={() => switchListen("master")}
                    >
                      Version traitée
                    </button>
                  </div>
                  <p className="small" aria-live="polite">
                    {working
                      ? "Préparation de votre rendu…"
                      : master
                        ? "Rendu prêt · niveau et plafond de crête appliqués."
                        : "Original disponible ; traitement en préparation."}
                  </p>
                  <svg
                    className="waveform"
                    viewBox="0 0 640 70"
                    role="img"
                    aria-label="Forme d’onde de la prise originale"
                  >
                    {waveform.map((h, i) => (
                      <rect
                        key={i}
                        x={i * 4}
                        y={(70 - h) / 2}
                        width="2"
                        height={h}
                        rx="1"
                      />
                    ))}
                  </svg>
                  {selected.midi && (
                    <details>
                      <summary>
                        Notes, pédales et synchronisation ·{" "}
                        {selected.midi.eventCount} événements
                      </summary>
                      <p className="small">
                        {selected.midi.name} ·{" "}
                        {selected.channels === 2
                          ? "Deux canaux audio reçus"
                          : "Audio mono reçu"}
                        . Horloge commune estimée ; latence physique non
                        mesurée. Les durées représentent les touches, pas la
                        résonance avec pédale.
                      </p>
                      {selected.capture?.audioStartMs === undefined && (
                        <p>
                          Origine audio indisponible : alignement non établi.
                        </p>
                      )}
                      <svg
                        viewBox="0 0 640 100"
                        role="img"
                        aria-label="Notes MIDI alignées sur la durée de l’audio"
                        style={{ width: "100%", background: "#edf4ee" }}
                      >
                        {noteTimeline(midiEvents, selected).map((note, i) => {
                          const duration = selected.frames / selected.rate || 1;
                          const start = Math.max(0, note.start),
                            end = Math.min(duration, note.end);
                          return (
                            end > start && (
                              <rect
                                key={i}
                                x={(start / duration) * 640}
                                y={((108 - note.pitch) / 88) * 94}
                                width={Math.max(
                                  1,
                                  ((end - start) / duration) * 640,
                                )}
                                height="3"
                                fill={note.truncated ? "#c87965" : "#44735b"}
                              />
                            )
                          );
                        })}
                      </svg>
                      <label>
                        Décalage MIDI : {selected.midi.offsetMs} ms (positif =
                        plus tard)
                        <input
                          type="range"
                          min="-300"
                          max="300"
                          step="1"
                          value={selected.midi.offsetMs}
                          disabled={studioLocked}
                          onChange={(e) =>
                            void editTake({
                              ...selected,
                              midi: {
                                ...selected.midi!,
                                offsetMs: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </label>
                      <p className="small">
                        {
                          midiEvents.filter(
                            (e) =>
                              (e.data[0] & 0xf0) === 0xb0 &&
                              [64, 66, 67].includes(e.data[1]),
                          ).length
                        }{" "}
                        événements de pédales. Les messages originaux restent
                        intacts ; ce décalage ne modifie que leur placement.
                      </p>
                      <button
                        onClick={() =>
                          download(
                            new Blob(
                              [
                                JSON.stringify(
                                  {
                                    version: 1,
                                    take: selected,
                                    events: midiEvents,
                                  },
                                  null,
                                  2,
                                ),
                              ],
                              { type: "application/json" },
                            ),
                            selected.title + "-midi.json",
                          )
                        }
                      >
                        Exporter le diagnostic audio/MIDI
                      </button>
                    </details>
                  )}
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={matched}
                      onChange={(e) => setMatched(e.target.checked)}
                    />
                    Comparer à niveau RMS rapproché (pas une mesure LUFS)
                  </label>
                  <audio
                    onLoadedMetadata={() => {
                      const a = player.current;
                      if (!a) return;
                      a.currentTime = Math.min(
                        previewState.current.time,
                        Number.isFinite(a.duration)
                          ? Math.max(0, a.duration - 0.05)
                          : 0,
                      );
                      if (previewState.current.resume)
                        void a.play().catch(() => {});
                      previewState.current.resume = false;
                    }}
                    key={selected.id}
                    ref={player}
                    controls={!routerBusy && !outputError && !active}
                    src={
                      listen === "original"
                        ? comparisonUrl || originalUrl
                        : masterUrl || undefined
                    }
                  />
                  {selected.midi && (
                    <button
                      disabled={studioLocked || !midiEvents.length}
                      onClick={() => {
                        try {
                          download(
                            exportMidi(midiEvents, selected),
                            selected.title + ".mid",
                          );
                        } catch (e) {
                          setNotice(message(e));
                        }
                      }}
                    >
                      Exporter le MIDI synchronisé
                    </button>
                  )}
                  <label htmlFor="format">Format du morceau</label>
                  <select
                    id="format"
                    disabled={exportBusy}
                    value={format}
                    onChange={(e) => setFormat(e.target.value as "wav" | "mp3")}
                  >
                    <option value="wav">
                      WAV · 24 bits · qualité originale
                    </option>
                    <option value="mp3">MP3 · 320 kb/s · partage</option>
                  </select>
                  <div className="button-row">
                    <button
                      className="primary"
                      disabled={working || exportBusy || !master}
                      onClick={exportTrack}
                    >
                      {exportBusy
                        ? "MP3 " + Math.round(encodeProgress * 100) + " %"
                        : "Exporter " + format.toUpperCase()}
                    </button>
                    <button
                      className="secondary"
                      disabled={
                        working ||
                        exportBusy ||
                        !(format === "mp3" ? mp3 : master)
                      }
                      onClick={share}
                    >
                      Partager
                    </button>
                    <button
                      className="secondary"
                      disabled={!original}
                      onClick={() =>
                        original &&
                        download(original, selected.title + "-original.wav")
                      }
                    >
                      Exporter l’original
                    </button>
                  </div>
                  {format === "mp3" && !mp3 && (
                    <p className="small">
                      Exportez une première fois le MP3 pour préparer son
                      partage.
                    </p>
                  )}
                  <p className="small">
                    WAV 24 bits · l’export n’augmente pas la résolution de la
                    source USB. L’espace ajouté peut créer une ambiance stéréo
                    depuis une prise mono.
                  </p>
                </>
              ) : (
                <div className="empty">
                  <span className="empty-glyph">♫</span>
                  <h3>Une création commence par une prise.</h3>
                  <p>
                    Vous retrouverez ici vos couleurs sonores,
                    <br />
                    l’égaliseur et l’écoute avant/après.
                  </p>
                </div>
              )}
            </section>
            <div hidden={workspace !== "create" && workspace !== "master"}>
              <ProjectFiles
                project={project}
                take={
                  workspace === "master" ? selected || undefined : undefined
                }
                disabled={studioLocked || loopPlaying}
                onBusy={setArchiveBusy}
                onImported={async (result) => {
                  if (result.project) setProject(result.project);
                  await refresh();
                  if (result.take) await selectTake(result.take);
                }}
              />
            </div>
          </>
        ) : (
          <>
            <div className="library-heading">
              <p className="eyebrow">VOTRE CARNET D’IMPROVISATIONS</p>
              <h1>Mes créations</h1>
              <p>Conservées dans ce navigateur. Exportables à tout moment.</p>
            </div>
            <ProjectFiles
              project={project}
              take={selected || undefined}
              disabled={studioLocked}
              onBusy={setArchiveBusy}
              onImported={async (result) => {
                if (result.project) setProject(result.project);
                await refresh();
                if (result.take) await selectTake(result.take);
              }}
            />
            {takes.length === 0 ? (
              <div className="card empty">
                <h2>Votre prochaine idée a sa place ici.</h2>
                <button className="primary" onClick={() => navigate("play")}>
                  Ouvrir le studio
                </button>
              </div>
            ) : (
              <div className="take-list">
                {takes.map((t) => (
                  <article className="take-card" key={t.id}>
                    <div className="take-icon" aria-hidden="true">
                      ♫
                    </div>
                    <div>
                      <h2>{t.title}</h2>
                      <p>
                        {new Date(t.created).toLocaleDateString("fr-FR")} ·{" "}
                        {clock(t.frames / t.rate)} ·{" "}
                        {t.channels === 1 ? "Mono" : "Stéréo"}
                        {t.status === "interrupted" ? " · prise récupérée" : ""}
                      </p>
                    </div>
                    <button
                      className="secondary"
                      disabled={t.status === "recording" || studioLocked}
                      onClick={() => selectTake(t)}
                    >
                      {t.status === "recording"
                        ? "En cours dans un autre onglet"
                        : "Ouvrir"}
                    </button>
                    {deleteId === t.id ? (
                      <div className="delete-confirm">
                        <span>Supprimer cette prise et ses blocs audio ?</span>
                        <button className="danger" onClick={() => remove(t.id)}>
                          Supprimer
                        </button>
                        <button
                          className="quiet"
                          onClick={() => setDeleteId(null)}
                        >
                          Annuler
                        </button>
                      </div>
                    ) : (
                      <button
                        className="quiet"
                        aria-label={"Supprimer " + t.title}
                        onClick={() => setDeleteId(t.id)}
                      >
                        Supprimer
                      </button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </>
        )}
        <footer>
          <span>MyPianow •°</span>
          <p>
            Studio local et indépendant. Réverbération native validée sur
            CLP-825.
            <br />
            Aucune affiliation avec Yamaha. Aucun son envoyé à un serveur.
          </p>
          <a
            className="quiet"
            href={import.meta.env.BASE_URL + "licenses/index.html"}
          >
            Licences des composants
          </a>
          <details>
            <summary>À propos de cette version</summary>
            <p>
              Version 0.2 · PWA Desktop Studio pour Windows 10/11, Chrome et
              Edge récents. Le matériel Windows/CLP-825 reste à valider ; le
              prototype mobile est conservé. L’installation et les permissions
              MIDI/audio varient selon le navigateur. Une actualisation du
              logiciel du piano peut affecter sa compatibilité. Les fichiers
              audio sont stockés sur cet appareil ; pensez à les exporter.
              L’entrée piano n’est pas renvoyée vers ses enceintes ; les boucles
              utilisent un bus de lecture séparé.
            </p>
          </details>
        </footer>
      </main>
    </div>
  );
}
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
}
