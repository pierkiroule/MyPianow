# MyPianow •° — Jouez. Masterisez. Partagez.

Objectif : studio de piano local, React/Vite/TypeScript, sans serveur, abonnement ni modèle neuronal. La qualité finale doit être évaluée à l’écoute ; aucun rendu « studio » n’est garanti.

## P1 — Acquisition et données fiables

Implémenté : capture USB avec identifiant exact, sans repli micro ; PCM original sauvegardé par blocs ; MIDI facultatif en parallèle (messages de canal, dont notes, vélocités et CC64/66/67), sauvegardé par lots IndexedDB ; récupération des blocs et événements validés après interruption ; suppression commune audio/MIDI ; notes visualisées et export de diagnostic JSON. Le dialogue SysEx natif et l’écoute MIDI passive coexistent sans réémettre de notes.

La version 2 d’IndexedDB conserve les prises de la version 1. Un verrou entre onglets protège la capture quand Web Locks est disponible. Une perte de MIDI interrompt la prise, sans supprimer les données déjà écrites. Une prise audio seule reste possible.

Synchronisation : le premier bloc AudioWorklet fournit sa position en échantillons ; une correspondance AudioContext/performance permet de placer les timestamps Web MIDI sur cette horloge. **Ce placement est estimé : il ne mesure ni la latence d’entrée USB, ni celle du piano, ni la dérive entre matériels.** Le décalage manuel en millisecondes est conservé séparément, sans modifier les messages originaux. Les notes sans note-off sont signalées comme tronquées. Leur durée correspond à l’appui de touche, pas à la résonance sous pédale.

À valider sur CLP-825 / Android : réception simultanée, stabilité trois minutes, véritable stéréo indépendante et décalage sur attaques isolées. Deux canaux déclarés ne prouvent pas une image stéréo ; la capture mono reste clairement indiquée. L’export audio ne transpose pas le MIDI en son.

## P2 — Mastering algorithmique guidé par l’interprétation

À développer : mesures spectrales, dynamique, loudness intégré et court terme, crêtes interéchantillons, corrélation stéréo ; analyse des attaques MIDI, registres, vélocités et pédales ; détection de passages ; corrections locales graduelles et explicables ; comparaison de configurations sous contraintes de dynamique et de crête. Le MIDI doit rester un guide facultatif et ne pas être interprété comme une mesure acoustique exacte.

Le moteur actuel est une chaîne DSP personnalisable avec normalisation RMS et plafond de crêtes échantillonnées. Ce n’est pas encore un mastering adaptatif audio/MIDI, une mesure LUFS ou un limiteur true peak. Construire un corpus de prises de référence et des comparaisons à volume perceptuel comparable avant de revendiquer une amélioration automatique.

## P3 — Couleurs et effets

Disponibles : EQ cinq bandes, compression, largeur stéréo, réverbération logicielle, couleur douce et presets personnalisés. Réverbération native CLP-825 pilotée et relue séparément.

À développer : signatures Studio naturel / Jazz intime / Grande salle / Cinématique, séparation claire des chaînes PRE et POST logicielles, EQ dynamique, saturation harmonique contrôlée, automatisations et historique. Les effets logiciels restent réversibles. La réverbération native du piano est déjà imprimée dans l’original USB et ne peut pas en être retirée.

## P4 — Expérience quotidienne

Disponibles : bibliothèque locale, écoute original/traité, WAV 24 bits, MP3, partage système quand pris en charge, PWA hors ligne après chargement initial.

À développer : mode Simple et mode Studio, sélection temporelle synchronisée audio/MIDI, comparaison à niveau perceptuel égal, annulation, export/import de projet complet incluant PCM et MIDI, export MIDI standard, gestion de quota et sauvegardes externes. IndexedDB reste un stockage navigateur susceptible d’effacement ; exporter un fichier reste nécessaire pour une sauvegarde indépendante.

## Bluetooth

Ne pas promettre l’enregistrement audio du CLP-825 par Bluetooth : l’audio du piano vers le téléphone doit passer par USB. MIDI Bluetooth utilisable seulement si le système expose un port au navigateur ; pas de pont BLE/GATT implémenté dans cette PWA. Ne pas remettre en place de monitoring USB logiciel sans validation du routage et des boucles.


## Brique préalable au futur LoopPad

Un diagnostic `AudioRouter` indépendant teste désormais la capture USB seule et l’émission de deux signaux pendant la capture, sur des bus distincts. Il propose des WAV séparés, une détection indicative du retour et un rapport JSON. Ce n’est pas encore un séquenceur ou un mixeur multipiste. Valider les chemins matériels avec ce diagnostic avant de développer le LoopPad ; voir [AUDIO-ROUTER.md](AUDIO-ROUTER.md).
