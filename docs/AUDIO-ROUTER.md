# AudioRouter — diagnostic USB avant LoopPad

Ce module vérifie les chemins Web Audio sans ajouter de monitoring logiciel du piano. Il ne contient pas encore de LoopPad, ne pilote pas le réglage Audio Loopback et ne prouve pas le routage physique à lui seul.

## Utilisation

1. Brancher le CLP-825 en USB, choisir son entrée audio, ouvrir « Tester le routage USB · futur LoopPad » dans la carte Enregistrer.
2. Sur le piano : maintenir DEMO/SONG + PIANO/VOICE et appuyer sur Do6 pour désactiver Audio Loopback. Garder le volume bas. Voir le [manuel Yamaha, p. 28](https://data.yamaha.com/files/download/other_assets/0/2293570/clp825_OM_fr_B0_web.pdf).
3. Ouvrir le diagnostic. L’app demande uniquement le deviceId USB exact, vérifie le périphérique réellement ouvert, affiche le niveau et le nombre de canaux déclarés. Aucun repli sur le micro interne.
4. Capturer cinq secondes de piano. Le fichier WAV piano USB permet de vérifier à l’écoute la vraie source. Cette confirmation est une observation de l’utilisateur, pas une détection automatique du modèle.
5. Sans jouer, lancer le test émission/retour de six secondes. Deux chirps distincts de 180 ms sont programmés sur l’horloge audio, l’un à gauche et l’autre à droite, avec une amplitude maximale de 0,04 (-28 dBFS environ). Le volume physique dépend du piano. Confirmer où ils sont entendus.
6. Fermer le diagnostic avant d’écouter les fichiers. Télécharger les WAV et le JSON. Les clips sont temporaires et ne sont pas ajoutés à la bibliothèque de morceaux. Ils restent accessibles dans ce panneau après fermeture du flux, jusqu’à sa prochaine ouverture ou jusqu’à quitter l’écran.

La sortie système reste utilisée si `AudioContext.setSinkId` n’est pas disponible ou si aucune autre sortie autorisée n’est choisie. Une sélection explicite non prise en charge échoue ; elle n’est pas remplacée silencieusement. Le choix concerne uniquement le contexte du diagnostic et ne choisit pas la sortie de tous les lecteurs de l’application.

## Graphe et séparation des données

- Entrée USB → collecteur AudioWorklet → sortie remplie de zéros. Le collecteur ne peut jamais recopier l’audio reçu vers les enceintes.
- Buffer de référence des deux chirps → bus de lecture indépendant → sortie système/choisie.
- Le PCM reçu pendant le test est conservé séparément du buffer de référence émis. Si le matériel renvoie les chirps dans l’USB, ceux-ci figurent dans le PCM reçu et ne sont pas soustraits artificiellement.
- Les deux bus utilisent le même AudioContext. Le premier échantillon capturé et la programmation des chirps sont référencés à son horloge, sans utiliser le délai de réception du message comme début audio.

Le verrou de capture est partagé avec l’enregistreur musical, y compris entre onglets si Web Locks est disponible. L’interface interdit aussi une prise musicale simultanée et suspend la préécoute existante. L’arrêt, la perte du périphérique, le changement de sortie, le masquage de page ou une suspension audio coupent le test et libèrent les ressources.

## Mesures et limites

Le rapport conserve le périphérique sélectionné, ses réglages déclarés, la fréquence du contexte, les latences déclarées, les positions des captures et des références, ainsi que les observations de l’utilisateur. Il n’établit pas une latence USB physique calibrée.

La recherche compare les deux signaux à chaque canal reçu dans une fenêtre allant de -100 à +1000 ms autour de leur position nominale. Elle tolère une atténuation et une inversion de polarité. Un retour est signalé si les deux corrélations atteignent 0,6 avec des délais qui concordent à 40 ms près. Le délai correspondant est celui du retour observé dans ce test, pas une mesure générale de latence du piano.

Résultats :

- **Retour détecté** : risque de double comptage des boucles au futur mix. Vérifier Audio Loopback et refaire la mesure.
- **Aucun retour détecté** : aucun signal correspondant au seuil et dans la fenêtre du test ; ce résultat seul ne valide pas l’écoute sur le piano, l’absence de retour plus faible/plus long, ni les réglages futurs.
- **Indéterminé** : un seul signal ressemble au test, le fond est trop fort, la capture sature, est trop courte ou présente des discontinuités. Recommencer au calme.

Deux canaux déclarés ne démontrent pas une vraie stéréo indépendante. Un mix mono matériel, un retour acoustique si la source est mal exposée par le système, un routage Android modifié ou une réverbération matérielle peuvent modifier les résultats. L’app ne peut pas prouver le périphérique physique uniquement à partir de son nom déclaré.

## Validation

Les tests unitaires exécutent le vrai code des deux AudioWorklets en VM, contrôlent le graphe de connexion, l’exclusivité USB, l’arrêt, la séparation des données et la corrélation synthétique à 44,1/48 kHz. Le test Playwright `npm run test:browser` utilise un vrai Chromium/Web Audio/AudioWorklet, une source USB simulée et un retour matériel simulé. Il est exécuté séparément dans GitHub Actions. Aucun de ces tests ne remplace l’essai CLP-825 / Android.

Sources techniques : [AudioContext.setSinkId](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/setSinkId), [contraintes de capture](https://developer.mozilla.org/en-US/docs/Web/API/Media_Capture_and_Streams_API/Constraints), manuel Yamaha ci-dessus.
