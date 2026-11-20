import { useEffect, useRef, useState, useMemo } from "react";
import { Piano, type PianoState } from "./lib/piano";
import { REVERBS, unpack } from "./lib/protocol";
import { Recorder, audioDevices } from "./lib/recorder";
import {
  listTakes,
  readPcm,
  recoverTakes,
  saveTake,
  deleteTake,
} from "./lib/storage";
import {
  PRESETS,
  cloneFx,
  type Take,
  type Pcm,
  type Fx,
  type Preset,
} from "./lib/types";
import { renderPcm } from "./lib/effects";
import { encodeMp3 } from "./lib/mp3";
import { shareTrack } from "./lib/share";
import { encodeWav, download } from "./lib/wav";
import "./style.css";
const piano = new Piano();
const labels: Record<Preset, [string, string]> = {
  naturel: ["Naturel", "Équilibré, fidèle"],
  feutre: ["Feutré", "Doux, intime"],
  ample: ["Ample", "Présent, spacieux"],
};
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
  async function refresh() {
    setTakes(await listTakes());
  }
  useEffect(() => {
    piano.onChange = setPianoState;
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
      const all = await audioDevices();
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
    const id = ++loadId.current;
    previewState.current = { time: 0, resume: false };
    player.current?.pause();
    setSelected(take);
    setRaw(null);
    setOriginal(null);
    setMaster(null);
    setWorking(true);
    try {
      const pcm = await readPcm(take);
      if (id !== loadId.current) return;
      setRaw(pcm);
      setTab("studio");
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
    if (!raw || !selected) return;
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
            const result = await renderPcm(raw, selected.fx, abort.signal);
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
  }, [raw, selected?.id, selected?.fx]);
  async function start() {
    if (active || working || exportBusy || !deviceId) return;
    player.current?.pause();
    setPhase("opening");
    const rec = new Recorder();
    recorder.current = rec;
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
      await rec.start(d, piano.metadata);
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
      setPeak(0);
    }
  }
  async function editTake(next: Take) {
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
    if (!selected || !raw || !master) return;
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
        raw,
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
          "Partage de fichiers non disponible : fichier téléchargé pour le partager depuis votre téléphone.",
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
  ];
  return (
    <div className="app-shell">
      <header className="header">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab("studio");
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
        <nav className="tabs" aria-label="Navigation principale">
          <button
            className={tab === "studio" ? "active" : ""}
            onClick={() => setTab("studio")}
          >
            Le studio
          </button>
          <button
            className={tab === "takes" ? "active" : ""}
            disabled={active || exportBusy}
            onClick={() => setTab("takes")}
          >
            Mes créations <span>{takes.length}</span>
          </button>
        </nav>
        {update && (
          <aside className="update">
            Une nouvelle version est prête.{" "}
            <button
              disabled={active || working || exportBusy}
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
                <p className="eyebrow">VOTRE PIANO. VOTRE INSTANT.</p>
                <h1>
                  Jouez.
                  <br />
                  <em>Gardez l’émotion.</em>
                </h1>
                <p>
                  Un son direct. Une prise préservée.
                  <br />
                  La liberté d’en choisir la couleur.
                </p>
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
            <div className="studio-grid">
              <section className="card recorder-card">
                <div className="section-top">
                  <span className="step">01</span>
                  <h2>Enregistrer</h2>
                  <span className="chip">USB audio</span>
                </div>
                <p className="sub">
                  Le son de votre piano, sans le micro du téléphone.
                </p>
                <label htmlFor="audio">Entrée audio</label>
                <div className="input-row">
                  <select
                    id="audio"
                    disabled={active || exportBusy}
                    value={deviceId}
                    onChange={(e) => setDeviceId(e.target.value)}
                  >
                    <option value="">Choisir une entrée USB</option>
                    {devices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="icon-button"
                    disabled={active || exportBusy}
                    onClick={scan}
                    aria-label="Chercher les entrées audio USB"
                  >
                    ↻
                  </button>
                </div>
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
                    (!active && (!deviceId || working || exportBusy))
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
                  3 min par prise · sauvegarde locale au fil du jeu
                </p>
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
                    disabled={active || exportBusy}
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
                    disabled={active || exportBusy || pianoState.busy}
                    onClick={() => piano.authorize()}
                  >
                    Autoriser le MIDI SysEx
                  </button>
                  {pianoState.inputs.length > 0 && (
                    <>
                      <label htmlFor="midi-in">Réponses du piano</label>
                      <select
                        id="midi-in"
                        disabled={active || exportBusy || pianoState.busy}
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
                        disabled={active || exportBusy || pianoState.busy}
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
                    est exposé par Android/Chrome. S’il n’apparaît pas ici,
                    utilisez le câble. L’enregistrement audio du piano nécessite
                    l’USB, même si le MIDI est sans fil.
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
                      disabled={active || pianoState.busy || !pianoState.ready}
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
                    active ||
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
                    active ||
                    pianoState.busy ||
                    !pianoState.ready ||
                    !pianoState.values.depth
                  }
                  onChange={(e) => setPreDepth(+e.target.value)}
                />
                <div className="button-row">
                  <button
                    className="secondary"
                    disabled={active || pianoState.busy || !pianoState.ready}
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
            <section className="card finish-card">
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
                    disabled={active || exportBusy}
                    value={selected.title}
                    onChange={(e) => {
                      void editTake({ ...selected, title: e.target.value });
                    }}
                  />
                  <p className="sub">
                    {new Date(selected.created).toLocaleString("fr-FR")} ·{" "}
                    {clock(selected.frames / selected.rate)} ·{" "}
                    {selected.channels === 1 ? "Mono USB" : "Stéréo USB"}
                  </p>
                  <div className="preset-row">
                    {(Object.keys(PRESETS) as Preset[]).map((p) => (
                      <button
                        key={p}
                        disabled={active || exportBusy}
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
                        disabled={active || exportBusy}
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
                          disabled={active || exportBusy}
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
                            {Number(selected.fx[key] ?? 100)} {unit}
                          </output>
                          <input
                            id={"fx-" + key}
                            type="range"
                            min={min}
                            max={max}
                            step={step}
                            disabled={active || exportBusy}
                            value={Number(selected.fx[key] ?? 100)}
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
                        disabled={active || exportBusy}
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
                          disabled={active || exportBusy}
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
                          disabled={active || exportBusy}
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
                      onClick={() => switchListen("original")}
                    >
                      Original USB
                    </button>
                    <button
                      className={listen === "master" ? "selected" : ""}
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
                    controls
                    src={
                      listen === "original"
                        ? originalUrl
                        : masterUrl || undefined
                    }
                  />
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
          </>
        ) : (
          <>
            <div className="library-heading">
              <p className="eyebrow">VOTRE CARNET D’IMPROVISATIONS</p>
              <h1>Mes créations</h1>
              <p>Conservées dans ce navigateur. Exportables à tout moment.</p>
            </div>
            {takes.length === 0 ? (
              <div className="card empty">
                <h2>Votre prochaine idée a sa place ici.</h2>
                <button className="primary" onClick={() => setTab("studio")}>
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
                      disabled={t.status === "recording" || exportBusy}
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
              Version 0.1 · Android/Chrome est la configuration testée par le
              prototype. L’installation et les permissions MIDI/audio varient
              selon le navigateur. Une actualisation du logiciel du piano peut
              affecter sa compatibilité. Les fichiers audio sont stockés sur cet
              appareil ; pensez à les exporter. L’application ne propose pas de
              retour d’effets en direct.
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
