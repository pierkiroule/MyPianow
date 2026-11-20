import type { Preset } from "../lib/types";
export const SIGNATURES: Preset[] = [
  "naturel",
  "studio",
  "intime",
  "jazz",
  "concert",
  "cinematique",
];
export const SIGNATURE_LABELS: Record<Preset, [string, string]> = {
  naturel: ["Naturel", "Fidélité, équilibre"],
  studio: ["Studio", "Net, précis"],
  intime: ["Intime", "Doux, proche"],
  jazz: ["Jazz", "Chaleur, présence"],
  concert: ["Concert", "Ample, résonant"],
  cinematique: ["Cinématique", "Profond, enveloppant"],
  feutre: ["Feutré", "Preset historique"],
  ample: ["Ample", "Preset historique"],
};
