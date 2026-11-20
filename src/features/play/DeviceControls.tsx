type Props = {
  prefix: string;
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
  input: string;
  output: string;
  disabled: boolean;
  onInput: (value: string) => void;
  onOutput: (value: string) => void;
  onScan: () => void;
};
export function DeviceControls({
  prefix,
  inputs,
  outputs,
  input,
  output,
  disabled,
  onInput,
  onOutput,
  onScan,
}: Props) {
  const canSelect =
    typeof AudioContext !== "undefined" &&
    "setSinkId" in AudioContext.prototype;
  return (
    <div className="connection-grid">
      <label htmlFor={prefix + "-input"}>
        Entrée piano USB
        <select
          id={prefix + "-input"}
          value={input}
          disabled={disabled}
          onChange={(e) => onInput(e.target.value)}
        >
          <option value="">Choisir le Yamaha</option>
          {inputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={prefix + "-output"}>
        Sortie accompagnement et préécoute
        <select
          id={prefix + "-output"}
          value={output}
          disabled={disabled || !canSelect}
          onChange={(e) => onOutput(e.target.value)}
        >
          <option value="">Sortie système Windows</option>
          {outputs
            .filter((d) => d.deviceId !== "default")
            .map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || "Sortie autorisée"}
              </option>
            ))}
        </select>
      </label>
      <button
        disabled={disabled}
        onClick={onScan}
        aria-label="Chercher les entrées audio USB"
      >
        Actualiser les périphériques
      </button>
      {!canSelect && (
        <p className="small">
          Choix de sortie indisponible : utilise la sortie système. Aucun
          routage vers le piano n’est présumé.
        </p>
      )}
    </div>
  );
}
