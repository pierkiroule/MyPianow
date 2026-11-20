# Essai sur CLP-825 / Android

Cette liste est un protocole de recette matériel, pas une déclaration de tests déjà exécutés.

- Installer depuis HTTPS ; vérifier l’ouverture hors ligne après un premier chargement.
- Autoriser MIDI, sélectionner les ports et confirmer CLP-825 / 1.02.
- Appliquer Chambre et Concert Hall ; entendre la différence puis restaurer.
- Brancher USB, sélectionner USB audio. En parlant sans jouer, vérifier que la voix n’est pas captée.
- Faire une prise de 30 secondes ; vérifier la réverbération native dans l’original USB.
- Fermer et rouvrir l’application ; retrouver la prise et ses paramètres.
- Interrompre une prise par masquage/déconnexion, puis retrouver les blocs sauvegardés.
- Ouvrir un second onglet pendant la prise : vérifier que le verrou empêche la seconde capture et que la récupération ne marque pas la première comme interrompue.
- Écouter Naturel/Feutré/Ample ; personnaliser cinq bandes, largeur, compression, niveau et plafond.
- Exporter WAV original/traité et MP3 ; écouter les trois fichiers dans une autre application.
- Préparer MP3 puis partager vers l’application de son choix. Si le navigateur ne partage pas les fichiers, vérifier le téléchargement de secours.
- Tester la demande de conservation persistante et expliquer que la suppression des données navigateur supprime la bibliothèque.
- Vérifier le titre, le renommage, la suppression explicite et la mise à jour PWA hors enregistrement.
- Bluetooth MIDI : vérifier uniquement si un port est exposé ; ne pas assimiler cela à une capture Bluetooth audio.

## Capture simultanée audio/MIDI (P1)

Non exécuté sur matériel pour cette version React.

- Autoriser le MIDI, sélectionner le port d’entrée et l’entrée USB audio. Ne pas identifier/piloter les effets si cela n’est pas souhaité.
- Enregistrer des notes détachées et des accords pendant trois minutes avec CC64, puis si disponibles CC66/67 ; vérifier que les événements augmentent et que l’audio seul reste possible MIDI décoché.
- Vérifier au casque l’original exporté et ses canaux : demander deux canaux n’assure pas une source stéréo indépendante.
- Jouer huit notes espacées. Comparer leurs débuts MIDI et audio ; corriger le décalage manuel si nécessaire. Vérifier début et fin de prise pour une éventuelle dérive. Le diagnostic conserve l’origine estimée et le décalage, pas une mesure de latence physique.
- Débrancher MIDI/USB pendant la prise ; relancer l’app après fermeture forcée. Vérifier récupération des seuls blocs/événements validés, compte MIDI recalculé et notes tronquées signalées.
- Exporter le JSON de diagnostic. Vérifier notes on/off, vélocités et valeurs continues des pédales. Il ne contient pas les échantillons audio et ne constitue pas un projet complet restaurable.
- Supprimer une prise, vérifier suppression de ses données audio et MIDI. Ouvrir une ancienne prise sans MIDI et vérifier qu’elle fonctionne toujours.
