import { useRef, useState } from "react";
import { exportProject, importProject } from "../../export/projectArchive";
import { download } from "../../lib/wav";
import type { Take } from "../../lib/types";
import type { LoopProject } from "../../engine/loopPad/types";
export function ProjectFiles({
  project,
  take,
  disabled,
  onImported,
  onBusy,
}: {
  project: LoopProject;
  take?: Take;
  disabled: boolean;
  onImported: (result: { project?: LoopProject; take?: Take }) => Promise<void>;
  onBusy: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  async function run(action: () => Promise<void>) {
    if (disabled || busy) return;
    setBusy(true);
    onBusy(true);
    try {
      await action();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <section className="card project-files">
      <h2>Sauvegarde de projet</h2>
      <p>
        Archive locale avec audio PCM original, MIDI, samples, séquence, calage
        et réglages. L’import crée une copie ; les projets existants restent
        intacts.
      </p>
      <div className="button-row">
        <button
          disabled={disabled || busy}
          onClick={() =>
            run(async () => {
              download(
                await exportProject(project, take),
                `${take?.title || project.title}.mypianow`,
              );
              setNotice(
                "Archive complète préparée. Conserve ce fichier hors du navigateur.",
              );
            })
          }
        >
          {busy ? "Préparation…" : "Exporter le projet .mypianow"}
        </button>
        <button
          disabled={disabled || busy}
          onClick={() => input.current?.click()}
        >
          Importer un projet
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept=".mypianow,application/x-mypianow"
        aria-label="Importer une archive MyPianow"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file)
            void run(async () => {
              await onImported(await importProject(file));
              setNotice("Projet importé et vérifié ; audio et MIDI conservés.");
            });
        }}
      />
      <p className="small" role="status">
        {notice ||
          "Empreintes SHA-256 vérifiées avant import · transaction locale atomique · 256 Mo maximum par archive. Les archives contiennent les données, contrairement au diagnostic JSON."}
      </p>
    </section>
  );
}
