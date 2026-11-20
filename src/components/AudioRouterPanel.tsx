import { useEffect, useRef, useState } from "react";
import {
  AudioRouter,
  type RouterInfo,
  type RouteRecording,
} from "../audio/AudioRouter";
import { encodeWav, download } from "../lib/wav";

type Props = {
  device?: MediaDeviceInfo;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onPrepare: () => void;
};
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export function AudioRouterPanel({
  device,
  disabled,
  onBusy,
  onPrepare,
}: Props) {
  const router = useRef<AudioRouter | null>(null);
  const generation = useRef(0);
  const busyCallback = useRef(onBusy);
  busyCallback.current = onBusy;
  const [phase, setPhase] = useState<
    "idle" | "opening" | "ready" | "recording" | "testing" | "closing"
  >("idle");
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [output, setOutput] = useState("");
  const [info, setInfo] = useState<RouterInfo | null>(null);
  const [notice, setNotice] = useState(
    "Vérifier l’entrée USB, la sortie du téléphone et l’éventuel retour des boucles.",
  );
  const [peak, setPeak] = useState(0);
  const [piano, setPiano] = useState<RouteRecording | null>(null);
  const [duplex, setDuplex] = useState<RouteRecording | null>(null);
  const [heard, setHeard] = useState(false);
  const [pianoHeard, setPianoHeard] = useState(false);
  const [saving, setSaving] = useState(false);
  const canSelect =
    typeof AudioContext !== "undefined" &&
    "setSinkId" in AudioContext.prototype;
  const open = phase !== "idle";
  const running = phase === "recording" || phase === "testing";
  useEffect(
    () => () => {
      generation.current++;
      void router.current?.close();
      router.current = null;
      busyCallback.current(false);
    },
    [],
  );
  async function scanOutputs() {
    try {
      setOutputs(
        (await navigator.mediaDevices.enumerateDevices()).filter(
          (d) => d.kind === "audiooutput" && d.deviceId !== "default",
        ),
      );
    } catch (error) {
      setNotice(errorText(error));
    }
  }
  async function close() {
    const token = ++generation.current;
    setPhase("closing");
    const current = router.current;
    router.current = null;
    await current?.close();
    if (token === generation.current) {
      setPhase("idle");
      setPeak(0);
      busyCallback.current(false);
    }
  }
  async function connect() {
    if (!device || disabled || router.current) return;
    const token = ++generation.current;
    onPrepare();
    busyCallback.current(true);
    setPhase("opening");
    setInfo(null);
    setPiano(null);
    setDuplex(null);
    setHeard(false);
    setPianoHeard(false);
    const current = new AudioRouter();
    router.current = current;
    current.onMeter = setPeak;
    current.onFault = (text) => {
      setNotice(text);
      void close();
    };
    try {
      const details = await current.open(device, output);
      if (token !== generation.current) return;
      setInfo(details);
      setPhase("ready");
      setNotice(
        "USB ouvert sans retour de l’entrée. Joue quelques notes puis enregistre le test piano.",
      );
      void scanOutputs();
    } catch (error) {
      if (token !== generation.current) return;
      router.current = null;
      setPhase("idle");
      busyCallback.current(false);
      setNotice(errorText(error));
    }
  }
  async function record(kind: RouteRecording["kind"]) {
    const current = router.current;
    if (!current || phase !== "ready") return;
    const token = generation.current;
    setPhase(kind === "piano" ? "recording" : "testing");
    if (kind === "duplex") {
      setHeard(false);
      setDuplex(null);
    } else {
      setPiano(null);
      setPianoHeard(false);
    }
    setNotice(
      kind === "piano"
        ? "Joue du piano pendant 5 secondes. Aucun signal n’est diffusé par l’app."
        : "Ne joue pas pendant 6 secondes. Deux signaux doux sont émis, puis leur retour est analysé.",
    );
    try {
      const clip = await current.record(kind);
      if (token !== generation.current) return;
      if (kind === "piano") setPiano(clip);
      else setDuplex(clip);
      setNotice(
        clip.analysis?.reason ||
          "Test piano reçu. Ferme le diagnostic puis écoute le WAV pour confirmer sa source.",
      );
    } catch (error) {
      if (token === generation.current) setNotice(errorText(error));
    } finally {
      if (token === generation.current) setPhase("ready");
    }
  }
  async function exportClip(clip: RouteRecording, reference = false) {
    setSaving(true);
    try {
      download(
        await encodeWav(reference ? clip.reference! : clip.pcm),
        `mypianow-test-${reference ? "reference-emise" : clip.kind === "piano" ? "piano-usb" : "retour-usb"}.wav`,
      );
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setSaving(false);
    }
  }
  function exportReport() {
    const summarize = (clip: RouteRecording | null) =>
      clip
        ? {
            kind: clip.kind,
            created: clip.created,
            rate: clip.pcm.rate,
            channels: clip.pcm.channels.length,
            frames: clip.pcm.channels[0].length,
            firstFrame: clip.firstFrame,
            gaps: clip.gaps,
            referenceOffsetSeconds: clip.referenceOffsetSeconds,
            analysis: clip.analysis,
          }
        : null;
    download(
      new Blob(
        [
          JSON.stringify(
            {
              version: 1,
              agent: navigator.userAgent,
              info,
              piano: summarize(piano),
              duplex: summarize(duplex),
              observations: {
                heardOnPiano: heard,
                pianoConfirmedInWav: pianoHeard,
              },
              limits:
                "Les observations sont déclarées. La corrélation ne garantit ni l’absence permanente de loopback ni une latence aller-retour calibrée. Les fichiers WAV sont séparés.",
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
      "mypianow-routage.json",
    );
  }
  const verdict = duplex?.analysis?.verdict;
  return (
    <details className="help audio-router">
      <summary>Tester le routage USB · futur LoopPad</summary>
      <p>
        Deux bus séparés : l’entrée piano est capturée en silence ; seuls les
        signaux de test sont envoyés à la sortie.
      </p>
      <p className="small">
        CLP-825 : désactive Audio Loopback avec DEMO/SONG + PIANO/VOICE + Do6.
        Garde le volume du piano bas.{" "}
        <a
          href="https://data.yamaha.com/files/download/other_assets/0/2293570/clp825_OM_fr_B0_web.pdf"
          target="_blank"
          rel="noreferrer"
        >
          Manuel Yamaha, p. 28
        </a>
        .
      </p>
      <label htmlFor="router-output">Sortie du test</label>
      <div className="input-row">
        <select
          id="router-output"
          value={output}
          disabled={open || disabled || !canSelect}
          onChange={(event) => setOutput(event.target.value)}
        >
          <option value="">Sortie système · choisie par Android</option>
          {outputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || "Sortie autorisée"}
            </option>
          ))}
        </select>
        <button disabled={open || disabled} onClick={scanOutputs}>
          Actualiser
        </button>
      </div>
      <p className="small">
        {canSelect
          ? "Choix de sortie disponible pour ce contexte de test. Aucun repli silencieux si la sortie choisie échoue."
          : "setSinkId indisponible : le navigateur ne choisit pas la sortie. L’écoute sur le piano doit être confirmée."}
      </p>
      <div className="button-row">
        <button
          disabled={disabled || !device || open || saving}
          onClick={connect}
        >
          Ouvrir le diagnostic USB
        </button>
        <button disabled={!open || phase === "closing"} onClick={close}>
          {running ? "Arrêter immédiatement" : "Fermer le diagnostic"}
        </button>
      </div>
      {open && (
        <div
          className="level"
          role="meter"
          aria-label="Entrée USB du diagnostic"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, Math.round(peak * 100))}
        >
          <i
            style={{
              width:
                Math.min(
                  100,
                  Math.max(0, ((20 * Math.log10(peak + 1e-9) + 60) / 60) * 100),
                ) + "%",
            }}
          />
        </div>
      )}
      {info && (
        <p className="small">
          {info.input} ·{" "}
          {info.channels === 2
            ? "2 canaux déclarés (stéréo à vérifier)"
            : "Mono reçu"}{" "}
          · {info.sampleRate} Hz. Latences déclarées : base{" "}
          {(info.baseLatency * 1000).toFixed(1)} ms
          {info.outputLatency !== undefined
            ? `, sortie ${(info.outputLatency * 1000).toFixed(1)} ms`
            : ""}{" "}
          ; aucune mesure physique à partir de ces valeurs.
        </p>
      )}
      <div className="button-row">
        <button
          disabled={phase !== "ready" || saving}
          onClick={() => record("piano")}
        >
          1. Capturer le piano · 5 s
        </button>
        <button
          disabled={phase !== "ready" || saving}
          onClick={() => record("duplex")}
        >
          2. Tester émission et retour · 6 s
        </button>
      </div>
      <p className="small" role="status">
        {notice}
      </p>
      {duplex && (
        <label className="check">
          <input
            type="checkbox"
            checked={heard}
            onChange={(event) => setHeard(event.target.checked)}
          />
          J’ai entendu les deux signaux dans les enceintes du piano pendant la
          capture.
        </label>
      )}
      {piano && (
        <label className="check">
          <input
            type="checkbox"
            checked={pianoHeard}
            onChange={(event) => setPianoHeard(event.target.checked)}
          />
          Après fermeture du diagnostic, j’ai écouté le WAV et confirmé que
          c’est le piano USB.
        </label>
      )}
      {duplex?.analysis && (
        <p className="route-result">
          {verdict === "returned"
            ? "Retour détecté · ne pas mélanger une seconde fois les boucles."
            : verdict === "inconclusive"
              ? "Résultat indéterminé · refaire le test."
              : heard && pianoHeard
                ? "Chemins observés compatibles avec un futur LoopPad séparé, dans cette configuration de test."
                : "Aucun retour détecté · confirmer encore l’écoute sur le piano et la source du WAV."}
        </p>
      )}
      <div className="button-row">
        {piano && (
          <button
            disabled={running || saving}
            onClick={() => exportClip(piano)}
          >
            WAV piano USB
          </button>
        )}
        {duplex && (
          <>
            <button
              disabled={running || saving}
              onClick={() => exportClip(duplex)}
            >
              WAV reçu pendant le test
            </button>
            <button
              disabled={running || saving}
              onClick={() => exportClip(duplex, true)}
            >
              WAV des signaux émis
            </button>
          </>
        )}
        {info && (
          <button disabled={running} onClick={exportReport}>
            Diagnostic JSON
          </button>
        )}
      </div>
      <p className="small">
        Tests temporaires, conservés dans cet écran uniquement. Télécharge les
        WAV et le JSON avant de quitter. Les signaux émis sont la référence
        numérique, pas la preuve de ce qui sort des enceintes. Ferme ce
        diagnostic avant une prise musicale.
      </p>
    </details>
  );
}
