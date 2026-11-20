# Provenance et distribution

Le produit reste une version alpha. Aucune conclusion d’audit juridique n’est fournie par ce dépôt et aucune licence propriétaire commerciale globale n’est attribuée implicitement.

## Pilotage Clavinova

Les faits de protocole (préfixe, adresses, format Get/Set/Info/Response) ont été étudiés à partir de la documentation communautaire et du code **ConPianist** (GPL-3.0-or-later), notamment `Source/Piano/PianoMessage.cpp`, et de la documentation Yamaha. L’encodeur et le décodeur TypeScript de ce dépôt sont écrits séparément ; cette déclaration n’équivaut pas à une validation juridique de leur indépendance. Une revue de provenance est nécessaire avant une distribution propriétaire payante. Ne pas copier l’interface, les binaires, les échantillons ni les visuels de Smart Pianist.

Sources : https://github.com/hugbug/conpianist/issues/4 et https://github.com/hugbug/conpianist .

## MP3

- `@breezystack/lamejs` **1.2.7**, LGPL-3.0, Alex Zhukov et contributeurs, JavaScript port of LAME.
- Source correspondant : https://github.com/shijinyu/lamejs/tree/1fb0ef5fa177413107e2e107d054a9b994e3f79c
- Bibliothèque non modifiée, dans un worker distinct. Le wrapper `src/audio/mp3.worker.ts` est fourni sous LGPL-3.0-only.
- `npm run build` prépare les notices, les textes de licences et l’archive du source exact, servis sous `/licenses/`. Ce téléchargement requiert une connexion au premier build ; il est ensuite mis en cache dans `node_modules/.cache/`.
- Pour remplacer/recompiler l’encodeur : installer un fork compatible fournissant `Mp3Encoder`, mettre à jour `src/audio/mp3.worker.ts`, les notices et l’archive correspondante, puis relancer le build. Ne pas imposer de restriction au débogage de cette modification.

## Autres composants

React / React DOM et Vite : MIT. idb : ISC. Versions exactes et intégrité dans `package-lock.json` ; notices d’origine dans les paquets npm. Aucun backend, aucun SDK analytique, aucune banque de sons intégrée.
