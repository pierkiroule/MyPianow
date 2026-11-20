# MyPianow •° — Desktop Studio

**Branchez votre piano. Jouez. Créez. Masterisez. Partagez.**

PWA React + Vite + TypeScript, prioritairement pour PC portable Windows 10/11 et Chrome/Edge récents. Audio, MIDI, projets et traitements restent sur l’appareil. Aucun serveur applicatif, compte, abonnement ou modèle neuronal. Le responsive mobile est conservé.

## Démarrer

Node.js 24 recommandé : `npm ci`, puis `npm run dev`. `npm test` et `npm run build` vérifient le code ; `npm run preview` sert `dist/`. HTTPS est nécessaire hors localhost. Le build produit un site statique, avec configuration Vercel et cache PWA versionné. `VITE_BASE_PATH=/MyPianow/ npm run build` permet un sous-répertoire.

Le premier build récupère le source exact de l’encodeur MP3 pour ses obligations LGPL ; les suivants utilisent le cache. Cette étape de construction ne concerne pas les enregistrements des utilisateurs et aucun média utilisateur n’est envoyé.

## Les espaces

| Espace                | Disponible dans cette version                                                                                                                                                                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PLAY**              | Choix entrée Yamaha/USB par identifiant exact, sortie système/autorisée, capture PCM originale et MIDI facultatif, niveau/crête, durées 3 ou 10 min, réverbération native CLP-825 relue et restaurable.                                                                                                                            |
| **CREATE**            | Huit pistes de samples importés ou capturés au micro PC, trim non destructif, pads, séquence répétée de 16 pas, tempo/swing, gain/pan/filtre/réverbération par piste, projets locaux et variantes.                                                                                                                                 |
| **MASTER**            | Six signatures personnalisables, EQ 5 bandes, compression, chaleur harmonique, réverbération, largeur, RMS/plafond, analyse audio/MIDI en worker, proposition prudente ou comparaison numérique de trois variantes, correction locale bornée des graves sous pédale, annuler/rétablir, écoute A/B à RMS rapproché, WAV24/MP3/MIDI. |
| **Diagnostic Studio** | Entrées/sorties, MIDI observé, capture piano 5 s, test duplex 6 s, stabilité 30 s, activité/corrélation/canaux dupliqués, retour des signaux, latences déclarées et mesures explicitement séparées, WAV et rapport JSON.                                                                                                           |
| **Mes créations**     | Prises originales, récupération après interruption, réglages persistants, archives complètes `.mypianow`, import en copie et vérification SHA-256 des données audio.                                                                                                                                                               |

## Piano et accompagnement

Le piano doit être reconnu par Windows puis exposé au navigateur. L’app accepte les noms USB, Yamaha, Clavinova et Digital Piano, exige l’identifiant exact et vérifie le périphérique réellement ouvert. Si les noms sont masqués, autoriser « Microphone » dans les paramètres du site puis actualiser ; aucune capture de micro par défaut n’est déclenchée pour forcer cette autorisation. Le micro PC de CREATE nécessite sa sélection explicite et ne remplace jamais l’entrée piano.

Le piano conserve son écoute directe. L’entrée USB va vers un collecteur silencieux, jamais vers ses enceintes. Les samples utilisent un bus de sortie distinct avec marge et compression de sécurité. Choisir la sortie Yamaha si elle est exposée ; sinon la sortie système reste indiquée comme telle, sans présumer sa destination physique. Un choix explicite qui échoue ne bascule pas silencieusement vers une autre sortie.

**Audio Loopback doit être désactivé** sur le CLP-825 : maintenir DEMO/SONG + PIANO/VOICE, puis Do6. Le diagnostic cherche une réinjection, mais son absence de détection ne garantit pas l’absence permanente de retour. Voir [le guide](docs/AUDIO-ROUTER.md).

Pour superposer piano et boucles : préparer et lancer CREATE, passer à PLAY, enregistrer. La capture partage l’AudioContext du séquenceur et conserve son origine temporelle et une copie de la séquence. Les fichiers des samples restent indépendants. Dans MASTER, **Inclure l’accompagnement** permet de l’ajouter ou de le retirer du rendu ; il est exclu par défaut. Ne pas l’ajouter s’il était déjà présent dans l’USB. Les réglages de la séquence sont figés pendant la lecture/prise.

## Ce qui est mesuré, et ce qui ne l’est pas

- L’interface CLP-825 est annoncée 44,1 kHz/24 bits/stéréo par Yamaha ; le navigateur peut exposer un format différent. Les réglages reçus font foi, sans inventer de stéréo ou de résolution. Deux canaux identiques sont signalés dans le diagnostic.
- L’horloge AudioWorklet sert de référence au MIDI et aux boucles. Les latences d’entrée/sortie physiques, la dérive et le routage Windows doivent être vérifiés sur matériel. Le décalage MIDI est réglable ; l’export MIDI utilise un tempo de référence 120 BPM et conserve les temps absolus (précision de quantification environ 0,52 ms), sans détecter le tempo joué.
- Le moteur est **algorithmique DSP**, sans IA neuronale. Mesures spectrales indicatives, RMS et crêtes échantillonnées : aucune revendication de mesure LUFS/LRA ou true peak certifiée. Les trois variantes sont comparées selon des contraintes numériques, pas selon un jugement artistique.
- Le guidage MIDI peut réduire modérément les graves sur certains accords graves sous pédale ; il ne normalise pas toutes les vélocités. Il dépend du calage estimé, à contrôler. L’original reste inchangé.
- Les effets logiciels sont réversibles. La réverbération native du piano est déjà imprimée dans l’original USB. Aucune voix CSP ou banque de feutres n’est envoyée au CLP-825.
- CREATE est une première version : une mesure répétée, une voix par piste, samples de 12 s maximum et capture micro de 8 s. Timeline d’arrangement multi-mesures, montage avancé et dessin d’automatisations restent à développer.
- Le navigateur utilise les périphériques exposés par Windows, sans accès ASIO exclusif. Yamaha documente un pilote USB audio Windows ; aucune garantie universelle « sans pilote ». Le MIDI Bluetooth n’est utilisable que si le système expose un port ; l’audio du piano est capturé par USB.

## Sauvegarde

IndexedDB v3 ajoute projets et samples sans supprimer les bibliothèques v1/v2. Les blocs audio/MIDI validés sont récupérables après interruption. Mise en veille, masquage, déconnexion ou stockage trop lent interrompent la prise ; le dernier bloc non livré peut être perdu.

Exporter `.mypianow` conserve le PCM original, les événements MIDI, les samples référencés, le projet, son calage et les réglages/automatisations DSP. Importer vérifie les longueurs, formats et empreintes audio avant une transaction atomique, avec de nouveaux identifiants. Format documenté dans [ARCHIVE.md](docs/ARCHIVE.md). Limite actuelle : 256 Mo par archive et 16 Mo de métadonnées. Une prise longue stéréo peut approcher cette limite ; les traitements hors ligne nécessitent plusieurs copies audio en mémoire.

Le stockage navigateur n’est pas une sauvegarde indépendante. Suppression des données, mode privé ou éviction peuvent supprimer les projets. La demande de conservation persistante existe ; garder aussi des archives hors navigateur. Le projet conserve ses samples même si une prise est supprimée ; le nettoyage d’assets orphelins reste à développer.

## Architecture et preuves

- `src/app/StudioApp.tsx` : orchestration et espaces ; `features/` : interface PLAY/CREATE/MASTER/diagnostics.
- `src/engine/audio`, `routing`, `recording`, `midi`, `dsp`, `loopPad`, `analysis`, `mastering` : moteurs indépendants de React.
- `src/storage/` : IndexedDB et projets ; `src/export/` : archive et MIDI ; `src/workers/` : analyse ; encodeur MP3 existant dans `src/audio/`.
- `src/presets/` : signatures ; `public/*.worklet.js` : collecteurs sur thread audio ; `scripts/build-sw.mjs` : cache PWA.
- Quelques fichiers `src/lib/` et `src/audio/` restent des façades de compatibilité pour les anciennes importations/tests.

[Audit de départ](docs/AUDIT-DESKTOP.md) · [Recette matériel](docs/ACCEPTANCE.md) · [Feuille de route](docs/ROADMAP.md) · [Provenance/licences](docs/PROVENANCE.md).

Tests locaux : `npm test` et build. Tests navigateur : `npx playwright install chromium chrome msedge`, puis `npm run test:browser` ; les tests audio utilisent de vraies API Web Audio et un **USB/MIDI simulé explicitement dans les seules fixtures QA**. Chrome et Edge sont exécutés sous Linux en CI ; cela ne constitue pas un essai Windows/Yamaha. Aucune simulation n’est injectée dans l’application.

Le changement audible de réverbération sur CLP-825/firmware 1.02 et l’ancien prototype monofichier ont été confirmés par l’utilisateur. Cette version Desktop Studio doit être validée sur le PC et le piano. Pas d’affiliation avec Yamaha. Audit de provenance/licences à terminer avant une distribution commerciale propriétaire.
