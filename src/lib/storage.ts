import { openDB, type DBSchema } from "idb";
import type { Chunk, Pcm, Take } from "./types";
interface Schema extends DBSchema {
  takes: { key: string; value: Take };
  chunks: {
    key: [string, number];
    value: Chunk;
    indexes: { "by-take": string };
  };
}
let connection: ReturnType<typeof openDB<Schema>> | undefined;
function database() {
  return (connection ??= openDB<Schema>("mypianow", 1, {
    upgrade(db) {
      db.createObjectStore("takes", { keyPath: "id" });
      const chunks = db.createObjectStore("chunks", {
        keyPath: ["takeId", "index"],
      });
      chunks.createIndex("by-take", "takeId");
    },
  }));
}
export async function listTakes() {
  return (await (await database()).getAll("takes")).sort(
    (a, b) => b.created - a.created,
  );
}
export async function saveTake(take: Take) {
  await (await database()).put("takes", take);
}
export async function saveChunk(chunk: Chunk) {
  await (await database()).put("chunks", chunk);
}
export async function readPcm(take: Take): Promise<Pcm> {
  const chunks = await (
    await database()
  ).getAllFromIndex("chunks", "by-take", take.id);
  chunks.sort((a, b) => a.index - b.index);
  const size = chunks.reduce((n, c) => n + c.frames, 0);
  if (!size)
    throw Error("Cette prise ne contient aucun bloc audio sauvegardé.");
  const channels = Array.from(
    { length: take.channels },
    () => new Float32Array(size),
  );
  let at = 0;
  for (const chunk of chunks) {
    for (let c = 0; c < take.channels; c++)
      channels[c].set(new Float32Array(chunk.channels[c]), at);
    at += chunk.frames;
  }
  return { channels, rate: take.rate };
}
export async function deleteTake(id: string) {
  const tx = (await database()).transaction(["takes", "chunks"], "readwrite");
  let cursor = await tx.objectStore("chunks").index("by-take").openCursor(id);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.objectStore("takes").delete(id);
  await tx.done;
}
async function recoverUnlocked() {
  const connection = await database();
  for (const take of await connection.getAll("takes"))
    if (take.status === "recording") {
      const chunks = await connection.getAllFromIndex(
        "chunks",
        "by-take",
        take.id,
      );
      const frames = chunks.reduce((n, c) => n + c.frames, 0);
      await connection.put("takes", { ...take, frames, status: "interrupted" });
    }
}

export async function recoverTakes() {
  if (navigator.locks)
    await navigator.locks.request(
      "mypianow-capture",
      { ifAvailable: true },
      async (lock) => {
        if (lock) await recoverUnlocked();
      },
    );
  else await recoverUnlocked();
}
