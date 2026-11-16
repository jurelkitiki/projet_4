# Guide de défense – Membre 3 : Validation, remise, retour et pénalités

**Ta partie :** Module 3 (validation des demandes) et Module 5 (remise et retour du matériel), avec l'espace **responsable** et le suivi des réservations côté client.

**Phrase d'ouverture pour la défense :**
> « Ma partie, c'est le travail du responsable du matériel : accepter ou refuser les demandes sans jamais dépasser le stock, remettre le matériel seulement quand c'est payé, enregistrer les retours et calculer les pénalités. »

---

## Tes fichiers

| Fichier | À quoi il sert |
|---|---|
| `src/routes/gestion.js` | Toute l'API du responsable : liste, valider, refuser, annulations, remise, retour, pénalités |
| `public/responsable.html` + `js/responsable.js` | L'espace responsable (onglets) |
| `public/js/detail.js` | Fenêtre « Détail » d'une réservation (lignes, paiements, pénalités, historique) |
| `public/mes-reservations.html` + `js/mes-reservations.js` | Le client suit ses réservations, paie, annule |
| (lecture) `src/services/location.js` | Fonctions `quantiteDisponible`, `journaliser`, `actualiserEtatMateriel` |

---

## 1. La protection de tout le fichier

```js
router.use(authentifier, autoriser('responsable', 'administrateur'));
```

Cette ligne, placée en haut de `gestion.js`, s'applique à **toutes** les routes du fichier : un client reçoit 403 partout.

## 2. Verrouiller une réservation avant de la modifier

```js
async function reservationVerrouillee(conn, id, statutsPermis) {
  const [[r]] = await conn.query('SELECT * FROM reservations WHERE id = ? FOR UPDATE', [id]);
  // [[r]] : le 1er tableau = les lignes, on prend la 1re ligne
  // FOR UPDATE : personne d'autre ne peut modifier cette réservation tant que la transaction n'est pas finie
  if (!r) throw new ErreurApp(404, 'Réservation introuvable.');
  if (statutsPermis && !statutsPermis.includes(r.statut)) {
    throw new ErreurApp(409, `Action impossible : la réservation est au statut « ${r.statut} ».`);
  }
  return r;
}
```

C'est une **machine à états** : chaque action n'est permise que depuis certains statuts (ex. on ne peut remettre qu'une réservation `confirmee`).

---

## 3. Module 3 – Valider une demande

```js
router.post('/reservations/:id/valider', [param('id').isInt()], valider, asyncHandler(async (req, res) => {
  const delai = Number(process.env.PAIEMENT_DELAI_MINUTES || 30);
  await transaction(async (conn) => {
    const r = await reservationVerrouillee(conn, req.params.id, ['en_attente']);   // 1) seulement « en attente »
    if (r.date_debut < loc.aujourdhui()) throw new ErreurApp(409, 'La date de début est dépassée : refusez cette demande.');
    for (const l of await lignesDe(conn, r.id)) {                                  // 2) pour chaque équipement
      const { disponible } = await loc.quantiteDisponible(conn, l.materiel_id, r.date_debut, r.date_fin,
        { exclureReservation: r.id, verrou: true });                               //    revérifier le stock, avec verrou
      if (l.quantite > disponible) throw new ErreurApp(409, `Quantité insuffisante pour « ${l.materiel} » …`);
    }
    await conn.query(
      `UPDATE reservations SET statut = 'validee', valide_par = ?, valide_le = NOW(),
              expiration_paiement = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?`,   // 3) blocage de 30 min
      [req.user.id, delai, r.id]);
    await loc.journaliser(conn, { reservationId: r.id, utilisateurId: req.user.id, action: 'DEMANDE_VALIDEE', … });
  });
  res.json({ message: `Demande validée. Le client dispose de ${delai} minutes pour payer.` });
}));
```

**À expliquer :**

- `exclureReservation: r.id` : on ne compte pas la demande elle-même dans les quantités déjà réservées.
- `verrou: true` → `SELECT … FOR UPDATE` sur le matériel : si deux responsables valident en même temps deux demandes pour le dernier projecteur, la deuxième **attend** la fin de la première, puis voit le stock à jour et est refusée. C'est la **prévention des conflits de réservation**.
- `expiration_paiement` : règle « une réservation validée est temporairement maintenue pendant le paiement ». Après 30 min, `server.js` (tâche toutes les minutes) la passe à `annulee` et le matériel redevient disponible.
- `valide_par` + historique : traçabilité (qui a validé, quand).

## 4. Refuser une demande

```js
body('motif').trim().notEmpty().withMessage('Indiquez le motif du refus.')
…
UPDATE reservations SET statut = 'refusee', motif = ?, … expiration_paiement = NULL WHERE id = ?
```

Le motif est obligatoire : le client le voit dans **Mes réservations** (« Informer l'utilisateur du résultat »).

## 5. Traiter une demande d'annulation (réservation déjà payée)

```js
const r = await reservationVerrouillee(conn, req.params.id, ['confirmee']);
if (!r.demande_annulation) throw new ErreurApp(409, 'Aucune demande d\'annulation pour cette réservation.');
if (req.body.decision === 'accepter') {
  UPDATE reservations SET statut = 'annulee', demande_annulation = 0 …   // matériel libéré
  journaliser(… 'ANNULATION_ACCEPTEE', `Remboursement simulé de ${montant} $`)
} else {
  UPDATE reservations SET demande_annulation = 0 …                       // la réservation reste confirmée
}
```

Dans les statistiques (Membre 4), une location annulée après paiement n'est pas comptée dans les revenus : elle apparaît en « remboursements simulés ».

---

## 6. Module 5 – Remise du matériel

```js
const r = await reservationVerrouillee(conn, req.params.id, ['confirmee']);            // 1) confirmée
if (r.demande_annulation) throw new ErreurApp(409, 'Une demande d\'annulation est en attente : traitez-la d\'abord.');
const [[paye]] = await conn.query(
  "SELECT id FROM paiements WHERE reservation_id = ? AND type = 'location' AND statut = 'accepte' LIMIT 1", [r.id]);
if (!paye) throw new ErreurApp(409, 'Le paiement initial n\'a pas été accepté : remise impossible.');  // 2) payée
for (const l of lignes) { /* refuse si un équipement est en maintenance / hors service */ }
INSERT INTO remises (reservation_id, responsable_id, observations) …
UPDATE reservations SET statut = 'en_cours' …
for (const l of lignes) await loc.actualiserEtatMateriel(conn, l.materiel_id);        // 3) état « loué » si tout est sorti
```

→ Règle : *« La remise du matériel ne peut être enregistrée que pour une réservation confirmée et payée. »* Le paiement est **revérifié dans la table `paiements`**, on ne se fie pas seulement au statut.

`actualiserEtatMateriel` (dans `services/location.js`) : si toutes les unités d'un équipement sont sorties, son état devient `loue` ; sinon `disponible`.

## 7. Module 5 – Retour et pénalités

```js
const joursRetard = Math.max(0, loc.nombreDeJours(r.date_fin, dateRetour) - 1);
// fin prévue le 12, retour le 15 : nombreDeJours(12, 15) = 4, moins 1 = 3 jours de retard
// retour le 12 ou avant : 0 (Math.max empêche un nombre négatif)

INSERT INTO retours (reservation_id, date_retour_effective, etat_materiel, jours_retard, observations, responsable_id) …

if (joursRetard > 0) {
  const tarifJour = lignes.reduce((s, l) => s + Number(l.tarif_applique) * l.quantite, 0);
  // somme de (tarif appliqué × quantité) de toutes les lignes = coût d'une journée de location
  const montant = Math.round(tarifJour * joursRetard * multiplicateur * 100) / 100;   // multiplicateur = 1,5 (.env)
  INSERT INTO penalites (reservation_id, type, montant, description, cree_par) VALUES (?, 'retard', ?, ?, ?)
}
if (etat === 'endommage' && montantDommage > 0) {
  INSERT INTO penalites (… 'dommage', montantDommage …)          // montant saisi par le responsable
}
UPDATE reservations SET statut = 'terminee' …
for (const id of enMaintenance) UPDATE materiels SET etat = 'maintenance' WHERE id = ?   // matériel endommagé
for (const l of lignes) await loc.actualiserEtatMateriel(conn, l.materiel_id);          // le reste redevient disponible
```

**Exemple chiffré à donner :** 2 portables à 15 $ rendus 3 jours en retard → (2 × 15) × 3 × 1,5 = **135 $** de pénalité.

**Règles couvertes :**
- *« Une pénalité constitue un montant supplémentaire distinct du paiement initial »* → table `penalites` séparée, et paiement de type `penalite`.
- *« Remettre le matériel en disponibilité lorsqu'il est en bon état »* → `actualiserEtatMateriel`, sauf ceux cochés « maintenance ».

## 8. Règlement d'une pénalité au comptoir

```js
INSERT INTO paiements (reservation_id, penalite_id, type, montant, mode, statut, reference)
VALUES (?, ?, 'penalite', ?, 'comptoir_simule', 'accepte', ?)
UPDATE penalites SET statut = 'reglee' WHERE id = ?
```

Le client peut aussi la payer en ligne (Membre 4, `paiements.js`).

---

## 9. Front-end : `public/js/responsable.js`

```js
const vues = {
  async attente()    { … api('/gestion/reservations?statut=en_attente') … boutons Valider / Refuser },
  async remise()     { … statut=confirmee … bouton « Enregistrer la remise » seulement si paiement accepté },
  async cours()      { … statut=en_cours … boutons Retour / Pénalité, pastille « En retard » },
  async annulations(){ … annulation=1 … },
  async penalites()  { … },
  async materiel()   { … liste déroulante pour changer l'état },
  async toutes()     { … filtres statut + recherche },
};
```

- Un **objet de fonctions** : chaque onglet appelle la fonction du même nom (`vues[ongletActif]()`).
- **Délégation d'événements** : un seul écouteur `zone.addEventListener('click', …)` lit `data-action` et `data-id` du bouton cliqué, au lieu d'un écouteur par bouton.
- `formulaireRetour(id)` ouvre une fenêtre avec la date de retour, l'état (bon / endommagé), le montant du dommage et les équipements à mettre en maintenance.

## 10. `public/js/mes-reservations.js` (côté client)

- Affiche les réservations avec le statut et le statut du paiement.
- Bouton **Payer** seulement si `validee`, **Annuler** si `en_attente`, `validee` ou `confirmee` (sans demande en cours).
- Affiche « Payer avant HH:MM » (expiration) et les pénalités dues.

---

## Démo à faire pendant la défense

1. Responsable → **Demandes en attente** → **Valider** → montrer « 30 minutes pour payer ».
2. Ouvrir **Détail** → montrer l'historique (qui a fait quoi, quand).
3. Après le paiement (Membre 4) : **À remettre** → **Enregistrer la remise**.
4. **En cours / retours** → **Enregistrer le retour** avec « Endommagé », 45 $ et le projecteur en maintenance → l'onglet **État du matériel** montre « Maintenance ».

## Questions probables et réponses

| Question | Réponse courte |
|---|---|
| Comment empêchez-vous de dépasser le stock ? | La validation revérifie la disponibilité dans une transaction avec `SELECT … FOR UPDATE` sur le matériel. |
| Pourquoi bloquer seulement 30 minutes ? | Pour que le matériel ne reste pas bloqué si le client ne paie jamais ; ensuite il redevient disponible automatiquement. |
| Peut-on remettre du matériel non payé ? | Non : le serveur vérifie qu'il existe un paiement `accepte` dans la table `paiements`. |
| Comment est calculée la pénalité de retard ? | Coût d'une journée (tarifs appliqués × quantités) × jours de retard × 1,5. |
| Et si le matériel est abîmé ? | Pénalité « dommage » saisie par le responsable + équipement mis en maintenance, donc plus réservable. |
| Où voit-on l'historique ? | Table `historique`, affichée dans le détail d'une réservation et dans Administration → Historique. |

## Pour t'entraîner

1. Change `PENALITE_MULTIPLICATEUR_RETARD` à 2 dans `.env`, redémarre, et refais un retour en retard.
2. Change `PAIEMENT_DELAI_MINUTES` à 1, valide une demande, attends 2 minutes : elle passe à « Annulée ».
3. Dans phpMyAdmin, regarde la table `historique` après chaque action.
