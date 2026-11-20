# Desktop Studio — feuille de route

Promesse : Branchez votre piano. Jouez. Créez. Masterisez. Partagez.

## Disponible dans la version 0.2 (validation matériel requise)

- Architecture desktop PLAY / CREATE / MASTER, Diagnostic Studio et bibliothèque. Responsive et PWA conservés.
- Capture USB exacte, PCM/MIDI original, horloge commune estimée, capture 3 ou 10 min, récupération IndexedDB, commandes de réverbération CLP-825 conservées.
- Routage d’accompagnement distinct, choix de sortie si autorisé, absence de monitoring logiciel du piano.
- LoopPad 8 pistes / 16 pas, import/capture micro explicite, trim, tempo, swing, gain/pan/filtre/reverb, projets/variantes et séquence figée dans la prise.
- Mix de l’accompagnement optionnel après capture, samples séparés, aucun sample rejoué via MIDI sur le piano.
- Six signatures, EQ/comp/reverb/stéréo/chaleur, analyse audio/MIDI en worker, corrections graves locales bornées, trois variantes numériques, annuler/rétablir et A/B à RMS rapproché.
- Sauvegardes complètes, vérification et import atomique en copie, WAV24/MP3/MIDI standard.
- Diagnostic duplex, activité/stéréo/canaux dupliqués, MIDI observé, stabilité 30 s, rapports distinguant observations et mesures.

## Verrou prioritaire : Windows / CLP-825

Exécuter la recette sur Windows 10/11, Chrome et Edge réels, un câble USB et Audio Loopback désactivé. Vérifier le format réellement reçu, la sortie vers les enceintes, la capture simultanée MIDI/audio/boucles et leurs calages en début/fin de prise. Comparer les canaux et écouter les exports. Déterminer si un pilote Yamaha est nécessaire. Le navigateur n’accède pas directement à ASIO.

Les tests navigateur CI tournent sous Linux avec des sources USB/MIDI simulées et des API audio réelles. Ils ne prouvent jamais cette compatibilité matérielle. L’app n’a aucun mode de démonstration caché qui remplacerait une source indisponible.

## Prochaines étapes

- Arrangement multi-mesures et timeline, quantification d’événements live, montage de samples avancé.
- Mesure acoustique de calage, compensation de latence guidée et qualification de la dérive ; ne pas confondre les latences déclarées et la mesure physique.
- Mesures LUFS/LRA et true peak validées, EQ dynamique acoustique plus fine, automatisations éditables ; corpus d’écoute comparatif pour juger les propositions DSP.
- OPFS/streaming pour longues prises et exports volumineux, réduction des copies mémoire, quotas/gestion des assets orphelins, historique persistant et versions d’archives futures.
- Commandes Bluetooth MIDI seulement si exposées par le système. Pas de capture audio Bluetooth du CLP-825.

Pas de cloud, pas de modèle neuronal à télécharger, pas de promesse de qualité artistique automatique ou de performance audio universelle.
