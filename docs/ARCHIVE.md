# Archive MyPianow v1

Fichier local `.mypianow`, MIME application/x-mypianow, 256 Mio maximum. Il n’est pas transmis à un serveur. Implémentation : src/export/projectArchive.ts.

- Octets 0–7 : ASCII `MYPW0001`.
- Octets 8–11 : taille du manifeste UTF-8, uint32 little-endian, 16 Mio maximum.
- Manifeste JSON : version 1, projet courant éventuel, prise sélectionnée éventuelle, événements MIDI horodatés, métadonnées des samples et des blocs PCM.
- Payload : canaux PCM Float32 little-endian dans l’ordre des entrées du manifeste. Chaque entrée indique clé, canal, fréquence, nombre de frames, longueur en octets et SHA-256 du canal.

Le PCM de la prise est l’original USB. Les FX, le décalage MIDI, la séquence figée et le calage de l’accompagnement sont des métadonnées réversibles. Les samples du projet courant et de la séquence de prise sont inclus par identifiant, sans duplication d’un même asset. Les projets de séquence sont actuellement limités à 8 pistes / 16 pas ; les imports sont validés en conséquence.

L’import lit et contrôle l’intégralité des données avant écriture, refuse les canaux manquants/dupliqués, les tailles incohérentes, les valeurs non finies et les empreintes audio différentes. Il remappe les IDs des prises/projets/samples. L’écriture s’effectue en une transaction IndexedDB sur les cinq stores ; un échec annule l’ensemble. Il ne fusionne ni ne remplace un projet existant.

SHA-256 détecte une corruption des données audio ; ce n’est pas une signature d’auteur, ni une garantie d’authenticité du manifeste. Le format est destiné aux navigateurs Windows/ARM courants little-endian. Un JSON de diagnostic n’est pas une archive et ne contient pas les échantillons.
