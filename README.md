# MyPianow •°

Studio piano local en React, TypeScript et Vite. Pilotage de la réverbération native du Yamaha **CLP-825**, capture de son audio USB, bibliothèque de prises et finition après enregistrement.

## Démarrer

Node.js 24 recommandé.

```sh
npm ci
npm run dev
```

Les appareils MIDI et audio exigent HTTPS en dehors de `localhost`. Le téléphone doit accéder à une URL HTTPS, pas simplement à l’IP HTTP du serveur Vite.

```sh
npm test
npm run build
npm run preview
```

Le build produit `dist/`, servi par tout hébergeur statique. Configuration Vercel fournie. Pour un sous-répertoire : `VITE_BASE_PATH=/MyPianow/ npm run build`. Le premier build télécharge le source exact de l’encodeur MP3 pour respecter sa licence ; les builds suivants utilisent le cache local.

## Parcours

1. **Avant** : MIDI SysEx, identité CLP-825 et lecture des valeurs ; ambiance native, intensité, restauration des paramètres initiaux. Aucune sonorité CSP n’est envoyée.
2. **Prise** : entrée audio portant un nom USB, sélection par identifiant exact, sans source par défaut, sans monitoring. Trois minutes par prise. Les blocs PCM sont enregistrés progressivement dans IndexedDB.
3. **Après** : presets Naturel/Feutré/Ample modifiables, égaliseur paramétrique cinq bandes, largeur stéréo, gain, compression, réverbération additionnelle, niveau automatique RMS et plafond de crête. L’original PCM reste séparé.
4. **Exporter** : WAV 24 bits original/traité ; MP3 320 kb/s via worker ; partage de fichiers natif si le navigateur le permet, téléchargement sinon. Pour partager un MP3, l’exporter une première fois prépare son fichier.
5. **Bibliothèque** : prises et paramètres persistés localement, renommage, récupération des blocs validés après interruption, suppression explicite.

## Compatibilité et limites importantes

- La communication SysEx et le changement audible de réverbération ont été confirmés par l’utilisateur sur un **CLP-825, firmware 1.02**. Le flux monofichier USB/post-traitement a également été déclaré fonctionnel. Cette migration React nécessite une nouvelle validation sur le téléphone.
- Android/Chrome est la cible initiale. Ne pas promettre la compatibilité Safari/iOS : Web MIDI y est limité/absent. La PWA détecte les API réellement disponibles.
- **Bluetooth MIDI** : les ports exposés par Android/Chrome peuvent être sélectionnés dans la liste MIDI. Aucun pont BLE GATT propriétaire n’est implémenté ni validé. Si le port n’apparaît pas, utiliser l’USB.
- **Bluetooth audio** du CLP-825 ne transmet pas la prise vers le téléphone. Yamaha précise que l’enregistrement audio nécessite l’USB. Source : https://data.yamaha.com/files/download/other_assets/8/2293568/CLP-825_owners_manual_En_B0.pdf .
- La permission navigateur s’appelle « Microphone », y compris pour l’USB. Aucune capture générique n’est utilisée pour obtenir cette permission : si les noms sont masqués, l’utilisateur doit autoriser le site dans Chrome puis actualiser.
- IndexedDB est un stockage du navigateur, pas une sauvegarde externe. Le mode privé, le nettoyage des données ou une éviction peuvent supprimer les prises. Une demande de stockage persistant est disponible ; exporter les fichiers importants reste nécessaire.
- En arrière-plan ou après suspension/déconnexion, la prise est arrêtée. Les blocs confirmés sont récupérables ; le dernier bloc non livré peut être perdu. L’app ne promet pas un enregistrement écran verrouillé.
- L’espace ajouté peut créer une stéréo depuis une prise mono ; élargir une source mono sans espace ne crée pas de vraie stéréo. Le WAV 24 bits n’améliore pas la résolution de l’entrée.
- La finition utilise une cible **RMS**, pas une normalisation EBU R128/LUFS ; le plafond porte sur les échantillons, pas une mesure true peak suréchantillonnée. Pas de certification « mastering studio ».
- Le rendu Feutré est une coloration, sans échantillons de piano à feutre et sans imitation garantie d’un artiste.

## Architecture

- `src/lib/protocol.ts` : messages et validation SysEx.
- `src/lib/piano.ts` : transport Web MIDI, identité, lecture, écriture vérifiée, restauration.
- `src/lib/recorder.ts` et `public/capture.worklet.js` : capture USB silencieuse, verrou entre onglets, blocs progressifs.
- `src/lib/storage.ts` : IndexedDB, récupération, bibliothèque.
- `src/lib/effects.ts` : rendu hors ligne, EQ, stéréo, finition.
- `src/audio/mp3.worker.ts` : encodage MP3 séparé de l’interface.
- `scripts/build-sw.mjs` : cache PWA versionné, installation et mise à jour explicite.
- `docs/PROVENANCE.md` : sources du protocole et obligations des composants tiers. **Audit de licences à terminer avant distribution commerciale propriétaire.**

## Validation

`npm test` couvre le protocole, le refus des entrées non USB, l’intégrité WAV, l’encodage MP3 effectif, les crêtes/stéréo, les presets, la récupération IndexedDB et le collecteur AudioWorklet. `npm run build` vérifie TypeScript et produit la PWA. Les tests matériels et le partage natif doivent être complétés sur Android/Chrome et le piano.

L’application ne contient ni compte, ni paiement, ni analytics, ni backend. Elle n’est pas affiliée à Yamaha.
