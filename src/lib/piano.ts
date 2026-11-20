import {
  command,
  parse,
  pack,
  unpack,
  text,
  valid,
  REVERBS,
  type Property,
} from "./protocol";
type Values = Partial<Record<"effect" | "depth", number[]>>;
export type PianoState = {
  model: string;
  firmware: string;
  ready: boolean;
  busy: boolean;
  dirty: boolean;
  message: string;
  values: Values;
  inputs: MIDIInput[];
  outputs: MIDIOutput[];
};
export class Piano {
  state: PianoState = {
    model: "",
    firmware: "",
    ready: false,
    busy: false,
    dirty: false,
    message:
      "Connexion MIDI facultative. Le son USB peut être enregistré seul.",
    values: {},
    inputs: [],
    outputs: [],
  };
  onChange: ((state: PianoState) => void) | undefined;
  private access?: MIDIAccess;
  private input?: MIDIInput;
  private output?: MIDIOutput;
  private baseline: Values = {};
  private recoveryKey = "";
  private pending?: {
    key: Property;
    resolve: (bytes: number[]) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  private emit() {
    this.onChange?.({ ...this.state });
  }
  private message(message: string) {
    this.state.message = message;
    this.emit();
  }
  async authorize() {
    try {
      if (!navigator.requestMIDIAccess)
        throw Error("MIDI indisponible : utilise Chrome en HTTPS.");
      this.access = await navigator.requestMIDIAccess({ sysex: true });
      if (!this.access.sysexEnabled)
        throw Error("Autorise les messages MIDI SysEx.");
      this.access.onstatechange = () => {
        this.ports();
        if (
          this.input?.state === "disconnected" ||
          this.output?.state === "disconnected"
        ) {
          this.state.ready = false;
          this.fail("Connexion MIDI perdue.");
          this.message(
            "MIDI déconnecté. Les réglages du piano peuvent rester actifs ; reconnecte pour restaurer.",
          );
        }
      };
      this.ports();
      this.message("Choisis les ports du Clavinova puis identifie le piano.");
    } catch (e) {
      this.message(String((e as Error).message));
    }
  }
  private ports() {
    this.state.inputs = Array.from(this.access?.inputs.values() || []).filter(
      (p) => p.state === "connected",
    );
    this.state.outputs = Array.from(this.access?.outputs.values() || []).filter(
      (p) => p.state === "connected",
    );
    this.emit();
  }
  private fail(message: string) {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(Error(message));
      this.pending = undefined;
    }
  }
  private send(key: Property, value?: number[]) {
    if (
      !this.output ||
      this.output.state !== "connected" ||
      this.input?.state !== "connected"
    )
      throw Error("Piano déconnecté.");
    this.output.send(command(key, value));
  }
  private read(key: Property): Promise<number[]> {
    return new Promise((resolve, reject) => {
      if (this.pending) {
        reject(Error("Lecture MIDI déjà en cours."));
        return;
      }
      this.pending = {
        key,
        resolve,
        reject,
        timer: setTimeout(
          () => this.fail("Le piano ne répond pas pour " + key + "."),
          1800,
        ),
      };
      try {
        this.send(key);
      } catch (e) {
        this.fail((e as Error).message);
      }
    });
  }
  async connect(inputId: string, outputId: string) {
    if (this.state.busy) return;
    this.state.busy = true;
    this.state.ready = false;
    this.emit();
    try {
      this.fail("Reconnexion.");
      if (this.input) {
        this.input.onmidimessage = null;
        await this.input.close();
      }
      if (this.output) await this.output.close();
      this.input = this.access?.inputs.get(inputId);
      this.output = this.access?.outputs.get(outputId);
      if (!this.input || !this.output)
        throw Error("Sélectionne une entrée et une sortie MIDI.");
      await this.input.open();
      await this.output.open();
      this.input.onmidimessage = (e) => {
        if (!e.data) return;
        const parsed = parse(e.data);
        if (parsed && this.pending?.key === parsed.key) {
          const p = this.pending;
          this.pending = undefined;
          clearTimeout(p.timer);
          p.resolve(parsed.bytes);
        }
      };
      this.state.model = text(await this.read("model"));
      this.state.firmware = text(await this.read("firmware"));
      if (!/^CLP[-\s]?825$/i.test(this.state.model.trim()))
        throw Error(
          "Modèle identifié : " +
            this.state.model +
            ". Seul le CLP-825 est validé pour cette version.",
        );
      const values: Values = {};
      for (const key of ["effect", "depth"] as const) {
        try {
          const bytes = await this.read(key);
          if (valid(key, bytes)) values[key] = bytes;
        } catch {
          /* Unsupported properties stay unavailable. */
        }
      }
      if (!values.effect && !values.depth)
        throw Error(
          "Piano identifié, mais aucune commande de réverbération confirmée.",
        );
      this.state.values = values;
      this.recoveryKey =
        "mypianow-piano:" + this.state.model + ":" + inputId + ":" + outputId;
      this.baseline = structuredClone(values);
      this.state.dirty = false;
      try {
        const old = JSON.parse(
          localStorage.getItem(this.recoveryKey) || "null",
        );
        if (
          old?.dirty &&
          Object.keys(values).every((k) =>
            valid(k as Property, old.values?.[k] || []),
          )
        ) {
          this.baseline = old.values;
          this.state.dirty = true;
        }
      } catch {
        /* In-memory baseline remains available. */
      }
      this.state.ready = true;
      this.message(
        this.state.dirty
          ? "Sauvegarde précédente retrouvée. Tu peux restaurer le piano."
          : "CLP-825 connecté. Les réglages reçus sont confirmés.",
      );
    } catch (e) {
      this.message((e as Error).message);
    } finally {
      this.state.busy = false;
      this.emit();
    }
  }
  private backup() {
    try {
      localStorage.setItem(
        this.recoveryKey,
        JSON.stringify({ dirty: this.state.dirty, values: this.baseline }),
      );
    } catch {
      this.message(
        "Sauvegarde du piano en mémoire uniquement. Restaure avant de fermer.",
      );
    }
  }
  private async write(key: "effect" | "depth", value: number[]) {
    if (!this.state.ready || !this.baseline[key] || !valid(key, value))
      throw Error("Paramètre non confirmé.");
    this.send(key, value);
    await new Promise((r) => setTimeout(r, 160));
    const actual = await this.read(key);
    this.state.values[key] = actual;
    this.emit();
    if (
      !valid(key, actual) ||
      actual.length !== value.length ||
      actual.some((n, i) => n !== value[i])
    )
      throw Error(
        "Valeur non confirmée par le piano. Les changements précédents peuvent rester actifs.",
      );
  }
  async apply(effect: number | null, depth: number) {
    if (!this.state.ready || this.state.busy) return;
    this.state.busy = true;
    this.emit();
    try {
      if (effect === null && !this.state.values.depth)
        throw Error("Choisissez un type de réverbération accessible.");
      if (
        effect !== null &&
        (!REVERBS.some((r) => r.value === effect) ||
          !this.state.values.effect ||
          !REVERBS.some((r) => r.value === unpack(this.state.values.effect!)))
      )
        throw Error(
          "Type de réverbération non reconnu. Conserve le type actuel.",
        );
      this.state.dirty = true;
      this.backup();
      if (effect !== null) await this.write("effect", pack(effect, 3));
      if (this.state.values.depth)
        await this.write("depth", [
          Math.round(Math.max(0, Math.min(20, depth))),
        ]);
      this.message("Réverbération appliquée et relue sur le piano.");
    } catch (e) {
      this.message((e as Error).message);
    } finally {
      this.state.busy = false;
      this.emit();
    }
  }
  async restore() {
    if (!this.state.ready || this.state.busy) return;
    this.state.busy = true;
    this.emit();
    try {
      for (const key of ["effect", "depth"] as const)
        if (this.baseline[key]) await this.write(key, this.baseline[key]!);
      this.state.dirty = false;
      this.backup();
      this.message("Réglages initiaux restaurés et confirmés.");
    } catch (e) {
      this.message("Restauration incomplète : " + (e as Error).message);
    } finally {
      this.state.busy = false;
      this.emit();
    }
  }
  get metadata() {
    return this.state.ready
      ? {
          model: this.state.model,
          effect: this.state.values.effect
            ? unpack(this.state.values.effect)
            : undefined,
          depth: this.state.values.depth
            ? unpack(this.state.values.depth)
            : undefined,
        }
      : undefined;
  }
}
