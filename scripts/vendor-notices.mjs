import { mkdir, copyFile, writeFile, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const root = "public/licenses",
  sha = "1fb0ef5fa177413107e2e107d054a9b994e3f79c",
  cache = "node_modules/.cache/lamejs-source";
await mkdir(root, { recursive: true });
await copyFile(
  "node_modules/@breezystack/lamejs/LICENSE",
  root + "/lamejs-NOTICE.txt",
);
for (const name of ["react", "react-dom", "vite", "idb"]) {
  for (const file of ["LICENSE", "LICENSE.md"])
    try {
      await copyFile(
        "node_modules/" + name + "/" + file,
        root + "/" + name + "-LICENSE.txt",
      );
      break;
    } catch {}
}
try {
  await access(cache + "/.git");
} catch {
  await mkdir(cache, { recursive: true });
  execFileSync("git", ["init", "--quiet", cache]);
  execFileSync(
    "git",
    [
      "-C",
      cache,
      "fetch",
      "--quiet",
      "--depth=1",
      "https://github.com/shijinyu/lamejs.git",
      sha,
    ],
    { stdio: "inherit" },
  );
}
execFileSync("git", [
  "-C",
  cache,
  "archive",
  "--format=tar.gz",
  "--output=" + resolve(root + "/lamejs-1.2.7-source.tar.gz"),
  sha,
]);
await copyFile(
  cache + "/../../@breezystack/lamejs/README.md",
  root + "/lamejs-README.md",
).catch(() =>
  copyFile(
    "node_modules/@breezystack/lamejs/README.md",
    root + "/lamejs-README.md",
  ),
);
for (const [name, url] of [
  ["LGPL-3.0.txt", "https://www.gnu.org/licenses/lgpl-3.0.txt"],
  ["GPL-3.0.txt", "https://www.gnu.org/licenses/gpl-3.0.txt"],
]) {
  try {
    await copyFile("licenses/" + name, root + "/" + name);
  } catch {
    const response = await fetch(url);
    if (!response.ok) throw Error("License download failed: " + url);
    await writeFile(root + "/" + name, await response.text());
  }
}
await writeFile(
  root + "/index.html",
  `<!doctype html><html lang="fr"><meta charset="utf-8"><title>MyPianow — Licences</title><main style="max-width:760px;margin:40px auto;font-family:system-ui;line-height:1.7"><h1>Composants tiers</h1><p>React et React DOM (MIT), Vite (MIT), idb (ISC). Le code d’interface est distinct de l’encodeur MP3.</p><ul><li><a href="react-LICENSE.txt">React</a></li><li><a href="react-dom-LICENSE.txt">React DOM</a></li><li><a href="vite-LICENSE.txt">Vite</a></li><li><a href="idb-LICENSE.txt">idb</a></li></ul><h2>Encodeur MP3</h2><p>@breezystack/lamejs 1.2.7, Alex Zhukov et contributeurs ; port JavaScript de LAME, LGPL-3.0. L’encodeur est distribué dans un worker séparé. Le wrapper de ce worker est lui aussi fourni sous LGPL-3.0. La bibliothèque n’est pas modifiée.</p><ul><li><a href="lamejs-NOTICE.txt">Notice de l’auteur</a></li><li><a href="LGPL-3.0.txt">LGPL version 3</a> et <a href="GPL-3.0.txt">GPL version 3</a></li><li><a href="lamejs-1.2.7-source.tar.gz">Source correspondant, commit ${sha}</a></li><li><a href="https://github.com/shijinyu/lamejs">Projet source</a> / <a href="https://lame.sourceforge.net/">LAME</a></li></ul><p>Le dépôt MyPianow fournit le wrapper et les instructions permettant de remplacer puis recompiler le worker. Aucun contrat de cette version ne restreint le débogage de ces modifications. L’audit de provenance du protocole Clavinova et le choix d’une licence commerciale pour l’application restent ouverts.</p><p><a href="../../">Retour au studio</a></p></main></html>`,
);
