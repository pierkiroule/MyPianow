import { useEffect, useRef, useState, type ReactNode } from "react";
import { AudioRouterPanel } from "../../components/AudioRouterPanel";
import { channelMessage, midiTime } from "../../engine/midi/performance";
export function StudioDiagnostics({
  device,
  input,
  output,
  onOutput,
  disabled,
  onBusy,
  onPrepare,
  children,
}: {
  device?: MediaDeviceInfo;
  input?: MIDIInput;
  output: string;
  onOutput: (value: string) => void;
  disabled: boolean;
  onBusy: (v: boolean) => void;
  onPrepare: () => void;
  children: ReactNode;
}) {
  const events = useRef<{ timeMs: number; data: number[] }[]>([]),
    [count, setCount] = useState(0),
    [last, setLast] = useState("Aucun message MIDI reçu."),
    [error, setError] = useState("");
  useEffect(() => {
    events.current = [];
    setCount(0);
    setError("");
    if (!input) return;
    let alive = true;
    const receive = (event: MIDIMessageEvent) => {
      if (!event.data) return;
      const data = channelMessage(event.data);
      if (!data) return;
      events.current.push({ timeMs: midiTime(event.timeStamp), data });
      if (events.current.length > 10000) events.current.shift();
      setCount((c) => c + 1);
      setLast(data.map((v) => v.toString(16).padStart(2, "0")).join(" "));
    };
    void input
      .open()
      .then(() => {
        if (alive) input.addEventListener("midimessage", receive);
      })
      .catch((e) => setError(e.message));
    return () => {
      alive = false;
      input.removeEventListener("midimessage", receive);
    };
  }, [input]);
  return (
    <section className="card diagnostics-card">
      <div className="section-top">
        <span className="step">I/O</span>
        <h2>Diagnostic Studio</h2>
        <span className="chip">Mesures, pas simulation</span>
      </div>
      <p>
        Teste les chemins réels exposés par Windows avant une session. Le nom
        d’un périphérique ne prouve pas à lui seul qu’il est le piano.
      </p>
      {children}
      <div className="metric-grid">
        <div>
          <small>MIDI observé</small>
          <strong>{count} messages</strong>
        </div>
        <div>
          <small>Dernier message</small>
          <strong>{last}</strong>
        </div>
        <div>
          <small>Port sélectionné</small>
          <strong>{input?.name || "Aucun"}</strong>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      <button
        disabled={disabled}
        onClick={() => {
          events.current = [];
          setCount(0);
          setLast("Aucun message MIDI reçu.");
        }}
      >
        Remettre le compteur MIDI à zéro
      </button>
      <AudioRouterPanel
        outputId={output}
        onOutput={onOutput}
        device={device}
        disabled={disabled}
        onBusy={onBusy}
        onPrepare={onPrepare}
        midiEvidence={() => ({
          port: input?.name,
          events: events.current,
          clock: "performance.now · calage audio estimé",
        })}
      />
      <p className="small">
        Aucune validation Windows/CLP-825 n’est présumée. Les tests Chromium
        automatisés utilisent un matériel simulé explicitement nommé QA ; cette
        page n’injecte aucun signal d’entrée simulé.
      </p>
    </section>
  );
}
