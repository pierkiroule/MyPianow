// Wire-format facts from the CSP/Smart Pianist protocol documented by ConPianist.
// This module contains an independent encoder/decoder, no Yamaha binary or firmware.
export const PROPERTIES = {
  model: [15, 1, 24, 1],
  firmware: [15, 1, 11, 1],
  effect: [12, 1, 0, 1],
  depth: [12, 0, 4, 1],
} as const;
export type Property = keyof typeof PROPERTIES;
const PREFIX = [67, 115, 1, 82, 37, 38];
export const pack = (value: number, size: number) => {
  if (!Number.isInteger(value) || value < 0 || value >= 128 ** size)
    throw Error("Valeur MIDI invalide.");
  return Array.from(
    { length: size },
    (_, i) => Math.floor(value / 128 ** (size - i - 1)) % 128,
  );
};
export const unpack = (bytes: number[]) =>
  bytes.reduce((n, b) => n * 128 + b, 0);
export function command(property: Property, bytes?: number[]) {
  if (bytes?.some((n) => !Number.isInteger(n) || n < 0 || n > 127))
    throw Error("Données SysEx invalides.");
  return [
    240,
    ...PREFIX,
    1,
    bytes ? 1 : 0,
    ...PROPERTIES[property],
    0,
    1,
    0,
    ...(bytes ? [...pack(bytes.length, 2), ...bytes] : []),
    247,
  ];
}
export function parse(data: Uint8Array) {
  const a = Array.from(data);
  if (
    a[0] !== 240 ||
    a.at(-1) !== 247 ||
    !PREFIX.every((n, i) => a[i + 1] === n) ||
    a.slice(1, -1).some((n) => n > 127) ||
    a[7] !== 0 ||
    ![0, 1].includes(a[8]) ||
    a[14] !== 1 ||
    a[15] !== 0 ||
    a[13] !== 0
  )
    return null;
  const offset = a[8] === 1 ? 18 : 16;
  if (a.length < offset + 3) return null;
  const count = a[offset] * 128 + a[offset + 1];
  if (count > 2048 || a.length !== offset + count + 3) return null;
  const key = (Object.keys(PROPERTIES) as Property[]).find((key) =>
    PROPERTIES[key].every((n, i) => a[i + 9] === n),
  );
  return key ? { key, bytes: a.slice(offset + 2, -1) } : null;
}
export function text(bytes: number[]) {
  let value = "";
  for (let i = 0; i < bytes.length; i += 8) {
    const count = Math.min(7, bytes.length - i - 1);
    for (let j = 0; j < count; j++)
      value += String.fromCharCode(
        bytes[i + j + 1] + ((bytes[i] >> (count - j - 1)) & 1) * 128,
      );
  }
  return value;
}
export function valid(property: Property, value: number[]) {
  return (
    Array.isArray(value) &&
    value.every((n) => Number.isInteger(n) && n >= 0 && n < 128) &&
    (property === "effect"
      ? value.length === 3
      : property === "depth"
        ? value.length === 1
        : true)
  );
}
export const REVERBS = [
  { value: 280, label: "Recital Hall" },
  { value: 260, label: "Concert Hall" },
  { value: 536, label: "Chambre" },
  { value: 792, label: "Club" },
  { value: 0, label: "Sans réverbération" },
];
