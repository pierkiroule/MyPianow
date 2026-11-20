import { useEffect, useState } from "react";
import type { Take } from "../../lib/types";
type Accompaniment = NonNullable<Take["accompaniment"]>;
export function AccompanimentMixer({
  value,
  disabled,
  onChange,
}: {
  value: Accompaniment;
  disabled: boolean;
  onChange: (next: Accompaniment) => void;
}) {
  const [shift, setShift] = useState(value.adjustmentMs || 0),
    [draft, setDraft] = useState<Record<string, number>>({});
  useEffect(() => {
    setShift(value.adjustmentMs || 0);
    setDraft({});
  }, [value]);
  function commitShift(next: number) {
    if (next !== (value.adjustmentMs || 0))
      onChange({ ...value, adjustmentMs: next });
  }
  function commitTrack(id: string, key: "gainDb" | "pan", next: number) {
    if (value.project.tracks.find((track) => track.id === id)?.[key] !== next)
      onChange({
        ...value,
        project: {
          ...value.project,
          tracks: value.project.tracks.map((track) =>
            track.id === id ? { ...track, [key]: next } : track,
          ),
        },
      });
  }
  return (
    <details className="custom">
      <summary>Mixage des boucles et calage</summary>
      <label>
        Décalage de l’accompagnement · {shift} ms (positif = plus tard)
        <input
          aria-label="Décalage de l’accompagnement"
          type="range"
          min="-500"
          max="500"
          step="5"
          value={shift}
          disabled={disabled}
          onChange={(e) => setShift(Number(e.target.value))}
          onPointerUp={(e) => commitShift(Number(e.currentTarget.value))}
          onKeyUp={(e) => commitShift(Number(e.currentTarget.value))}
          onBlur={(e) => commitShift(Number(e.currentTarget.value))}
        />
      </label>
      <div className="metric-grid">
        {value.project.tracks
          .filter((track) => track.assetId)
          .map((track) => (
            <div key={track.id}>
              <strong>{track.name}</strong>
              <label className="check">
                <input
                  type="checkbox"
                  checked={track.muted}
                  disabled={disabled}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      project: {
                        ...value.project,
                        tracks: value.project.tracks.map((t) =>
                          t.id === track.id
                            ? { ...t, muted: e.target.checked }
                            : t,
                        ),
                      },
                    })
                  }
                />
                Exclure cette piste
              </label>
              {(["gainDb", "pan"] as const).map((key) => (
                <label key={key}>
                  {key === "gainDb" ? "Gain (dB)" : "Panoramique"} ·{" "}
                  {draft[track.id + key] ?? track[key]}
                  <input
                    aria-label={`${track.name} ${key}`}
                    type="range"
                    min={key === "gainDb" ? -48 : -1}
                    max={key === "gainDb" ? 6 : 1}
                    step={key === "gainDb" ? 0.5 : 0.1}
                    value={draft[track.id + key] ?? track[key]}
                    disabled={disabled}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        [track.id + key]: Number(e.target.value),
                      })
                    }
                    onPointerUp={(e) =>
                      commitTrack(track.id, key, Number(e.currentTarget.value))
                    }
                    onKeyUp={(e) =>
                      commitTrack(track.id, key, Number(e.currentTarget.value))
                    }
                    onBlur={(e) =>
                      commitTrack(track.id, key, Number(e.currentTarget.value))
                    }
                  />
                </label>
              ))}
            </div>
          ))}
      </div>
      <p className="small">
        Calage estimé au départ. Ajuste sur des attaques isolées si nécessaire.
        Les samples et l’original USB restent intacts ; ces réglages ne
        modifient que leur mix après la prise.
      </p>
    </details>
  );
}
