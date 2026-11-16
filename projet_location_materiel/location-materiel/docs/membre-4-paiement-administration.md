# Guide de défense – Membre 4 : Paiement, administration et statistiques

**Ta partie :** Module 4 (paiement simulé et facturation), Module 6 (historique et statistiques), l'espace **administrateur** (utilisateurs, transactions, demandes de conseil) et les **tests automatiques**.

**Ton rôle Scrum :** responsable des tests (tu vérifies que chaque user story « Terminée » fonctionne vraiment).

**Phrase d'ouverture pour la défense :**
> « Ma partie, c'est l'argent et le pilotage : le paiement simulé sans aucune donnée bancaire, les reçus, l'administration des comptes et les statistiques de revenus et de disponibilité. J'ai aussi écrit les tests qui vérifient tout le parcours. »

---

## Tes fichiers

| Fichier | À quoi il sert |
|---|---|
| `src/routes/paiements.js` | Paiement d'une location, paiement d'une pénalité, historique, reçu |
| `src/routes/admin.js` | Utilisateurs et rôles, transactions, historique, demandes de conseil, statistiques |
| `public/paiement.html` + `js/paiement.js` | Formulaire de carte (simulation) |
| `public/recu.html` + `js/recu.js` | Reçu imprimable |
| `public/mes-paiements.html` + `js/mes-paiements.js` | Historique des paiements + pénalités à payer |
| `public/admin.html` + `js/admin.js` | Espace administrateur (onglets) |
| `tests/parcours.js` | 37 vérifications automatiques (`npm test`) |

---

## 1. `src/routes/paiements.js` – Module 4

### Le principe de la simulation

```js
// IMPORTANT : aucune donnée de carte n'est enregistrée ni journalisée.
function simulerTransaction(numero) {
  if (numero === '4000000000000002') return { statut: 'refuse', message: 'Paiement refusé par la banque (simulation : fonds insuffisants).' };
  return { statut: 'accepte', message: 'Paiement accepté.' };
}
```

Les numéros de test ressemblent à ceux des vrais services de paiement en mode test : `4242 4242 4242 4242` est accepté, `4000 0000 0000 0002` est refusé.

### Validation de la carte (sans la garder)

```js
body('numero_carte').customSanitizer((v) => String(v || '').replace(/[\s-]/g, ''))  // enlève espaces et tirets
  .matches(/^\d{16}$/).withMessage('Le numéro de carte doit contenir 16 chiffres.')
  .custom(luhnValide).withMessage('Numéro de carte invalide.'),
body('expiration').matches(/^(0[1-9]|1[0-2])\/\d{2}$/)                              // MM/AA, mois 01 à 12
  .custom((v) => { const [mm, aa] = v.split('/').map(Number); return new Date(2000 + aa, mm, 1) > new Date(); })
  .withMessage('La carte est expirée.'),
body('cvv').matches(/^\d{3,4}$/),
```

**L'algorithme de Luhn** (contrôle mathématique des numéros de carte) :

```js
function luhnValide(numero) {
  let somme = 0; let double = false;
  for (let i = numero.length - 1; i >= 0; i--) {   // on part du dernier chiffre
    let n = Number(numero[i]);
    if (double) { n *= 2; if (n > 9) n -= 9; }       // un chiffre sur deux est doublé (si > 9, on retire 9)
    somme += n;
    double = !double;
  }
  return somme % 10 === 0;                          // valide si la somme est un multiple de 10
}
```

`1234 5678 9012 3456` échoue à Luhn → 400 (le test automatique le vérifie).

### Payer une location

```js
router.post('/reservations/:id', authentifier, autoriser('client'), [param('id').isInt(), ...reglesCarte], valider,
  asyncHandler(async (req, res) => {
    const simulation = simulerTransaction(req.body.numero_carte);
    const resultat = await transaction(async (conn) => {
      const [[r]] = await conn.query(
        'SELECT *, (expiration_paiement > NOW()) AS dans_les_temps FROM reservations WHERE id = ? FOR UPDATE', [req.params.id]);
      if (!r || r.utilisateur_id !== req.user.id) throw new ErreurApp(404, …);     // seulement SA réservation
      if (r.statut === 'confirmee') throw new ErreurApp(409, 'Cette réservation est déjà payée.');  // pas de double paiement
      if (r.statut !== 'validee') throw new ErreurApp(409, '… après validation de la demande par le responsable.');
      if (!r.dans_les_temps) {                                                       // délai de 30 min dépassé
        UPDATE reservations SET statut = 'annulee' … ; return { expire: true };
      }
      const reference = loc.referenceTransaction('PAY');                             // ex. PAY-20261109-4F7A9C
      INSERT INTO paiements (reservation_id, type, montant, mode, statut, reference)
             VALUES (?, 'location', ?, 'carte_simulee', ?, ?)   -- montant = r.montant_total (venant de la BASE)
      if (simulation.statut === 'accepte') UPDATE reservations SET statut = 'confirmee' …
      journaliser(… 'PAIEMENT_ACCEPTE' ou 'PAIEMENT_REFUSE' …)
    });
    if (resultat.expire) throw new ErreurApp(410, 'Le délai de paiement est expiré …');
    res.status(simulation.statut === 'accepte' ? 201 : 402).json({ … });
  }));
```

**Points à expliquer :**

- **Seuls le montant, le statut, le mode et une référence sont enregistrés.** Le numéro, l'expiration et le CVV ne sont écrits **nulle part** (ni base, ni console, ni historique) → spécification « aucune conservation de données bancaires ».
- Le **montant vient de la base** (`r.montant_total`), jamais du navigateur.
- Un paiement **refusé** est quand même enregistré (statut `refuse`) : traçabilité. Le client peut réessayer tant que le délai court.
- **402** = Payment Required (paiement refusé) ; **410** = Gone (délai expiré).
- La règle « une demande doit être validée avant le paiement » est appliquée ici (`statut !== 'validee'`).

### Payer une pénalité en ligne

Même principe, avec `type = 'penalite'` et `penalite_id`. La pénalité passe à `reglee`.

### Le reçu (`GET /api/paiements/:id/recu`)

```js
if (req.user.role === 'client' && reservation.utilisateur_id !== req.user.id) throw new ErreurApp(403, 'Accès refusé.');
```

Un client ne peut voir que **ses** reçus ; le responsable et l'admin les voient tous (le test le vérifie avec `client2`).

---

## 2. `src/routes/admin.js` – administration et Module 6

```js
router.use(authentifier, autoriser('administrateur'));   // tout le fichier est réservé à l'admin
```

### Utilisateurs et rôles

```js
if (Number(req.params.id) === req.user.id) throw new ErreurApp(409, 'Vous ne pouvez pas modifier votre propre rôle ou statut.');
// empêche l'admin de se retirer lui-même ses droits par erreur
const sets = []; const params = [];
if (req.body.role) { sets.push('role_id = (SELECT id FROM roles WHERE nom = ?)'); params.push(req.body.role); }
if (req.body.actif !== undefined) { sets.push('actif = ?'); params.push(req.body.actif ? 1 : 0); }
await pool.query(`UPDATE utilisateurs SET ${sets.join(', ')} WHERE id = ?`, [...params, req.params.id]);
```

On construit seulement les morceaux nécessaires (rôle et/ou actif) ; les valeurs passent toujours par des `?`.

### Statistiques (Module 6)

**Revenus** :

```sql
SELECT COALESCE(SUM(CASE WHEN p.type = 'location' THEN p.montant END), 0) AS locations,
       COALESCE(SUM(CASE WHEN p.type = 'penalite' THEN p.montant END), 0) AS penalites
  FROM paiements p JOIN reservations r ON r.id = p.reservation_id
 WHERE p.statut = 'accepte' AND NOT (p.type = 'location' AND r.statut = 'annulee')
```

- `SUM(CASE WHEN … THEN montant END)` : additionne seulement les lignes qui correspondent (une « somme conditionnelle »).
- On compte seulement les paiements **acceptés**, et on exclut les locations **annulées après paiement** (remboursées).

**Équipements les plus demandés** :

```sql
SELECT m.nom, SUM(d.quantite) AS quantite_louee, COUNT(DISTINCT d.reservation_id) AS nb_reservations, SUM(d.montant_ligne) AS revenus
  FROM details_location d JOIN reservations r … JOIN materiels m …
 WHERE r.statut IN ('confirmee', 'en_cours', 'terminee')     -- seulement les locations réellement payées
 GROUP BY m.id, m.nom ORDER BY quantite_louee DESC LIMIT 10
```

**Taux de disponibilité** (calculé en JavaScript) :

```js
const utilisable = ['maintenance', 'hors_service'].includes(m.etat) ? 0 : Math.max(0, m.quantite_totale - Number(m.sorties));
total += m.quantite_totale; dispo += utilisable;
taux_disponibilite_global: total ? dispo / total : 0     // on évite la division par zéro
```

= unités utilisables et non sorties aujourd'hui ÷ unités totales du parc.

**Autres** : réservations par statut (`GROUP BY statut`), revenus par mois (`DATE_FORMAT(p.date_paiement, '%Y-%m')`), pénalités par statut et type, locations en retard (`statut = 'en_cours' AND date_fin < CURDATE()`).

### Transactions, historique et demandes de conseil

- `GET /api/admin/transactions?statut=&type=` : tous les paiements avec filtres.
- `GET /api/admin/historique` : les 200 dernières actions.
- `GET /api/admin/contacts` et `PATCH /api/admin/contacts/:id` : demandes « Demander conseil », marquées « traitée ».

---

## 3. Front-end

### `public/js/paiement.js`

```js
form.numero_carte.addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ');
});
// garde seulement les chiffres, 16 max, et ajoute un espace tous les 4 chiffres : 4242 4242 4242 4242
```

- Fonctionne pour une location (`?reservation=ID`) ou une pénalité (`?penalite=ID`).
- Après le paiement : `form.reset()` vide les champs, puis redirection vers le reçu.
- `autocomplete="off"` sur le formulaire : le navigateur ne mémorise pas la carte.

### `public/js/recu.js`

Affiche le reçu (lignes, total, référence) ; bouton **Imprimer** → `window.print()`. Le CSS `@media print` cache l'en-tête et le pied de page.

### `public/js/admin.js`

Même structure que l'espace responsable : un objet `vues` avec une fonction par onglet (`stats`, `materiel`, `categories`, `utilisateurs`, `transactions`, `contacts`, `historique`) et un seul écouteur de clics qui lit `data-action`.

---

## 4. `tests/parcours.js` – les tests automatiques

```js
async function api(methode, url, corps, jeton) { … fetch(BASE + url, …) … }   // appelle la vraie API
function verifier(cond, libelle) { if (cond) { ok++; console.log('  ✔', libelle); } else { ko++; console.log('  ✘', libelle); } }

verifier(est.data.montant_total === 120, 'total 120 $');                    // exemple du cahier des charges
verifier(r.status === 409, 'matériel en maintenance non réservable');
verifier(r.status === 403, 'un responsable ne peut pas créer de demande client');
verifier(r.status === 402 && r.data.statut === 'refuse', 'carte de test refusée');
```

**Utilisation :** serveur démarré + base fraîchement initialisée (`npm run init-db`), puis `npm test` → **37 réussi(s), 0 échec(s)**.

Ce sont des **tests d'intégration** : ils passent par le vrai serveur et la vraie base, du début à la fin du parcours.

---

## Démo à faire pendant la défense

1. Client → **Mes réservations** → **Payer** → carte `4000 0000 0000 0002` → « Paiement refusé ».
2. Carte `4242 4242 4242 4242`, expiration `12/30`, CVV `123` → reçu.
3. Ouvrir phpMyAdmin → table `paiements` : aucune colonne de carte, seulement montant, statut, référence.
4. Admin → **Statistiques**, puis **Transactions**, puis **Demandes de conseil**.
5. Terminal → `npm test`.

## Questions probables et réponses

| Question | Réponse courte |
|---|---|
| Où est stocké le numéro de carte ? | Nulle part : il sert seulement à la simulation, puis il est oublié. |
| Comment savoir si un paiement est accepté ou refusé ? | La fonction `simulerTransaction` : la carte `4000 0000 0000 0002` est refusée, toute autre carte valide est acceptée. |
| Qu'est-ce que l'algorithme de Luhn ? | Un calcul de contrôle qui détecte les erreurs de frappe dans un numéro de carte. |
| Peut-on payer deux fois ? | Non : si la réservation est déjà `confirmee`, le serveur répond 409. |
| Comment calculez-vous les revenus ? | Somme des paiements acceptés, sans les locations remboursées, séparée entre locations et pénalités. |
| Comment calculez-vous le taux de disponibilité ? | Unités utilisables non sorties ÷ unités totales du parc, à la date du jour. |
| À quoi servent les tests ? | À vérifier en une commande que toutes les règles fonctionnent encore après une modification. |

## Pour t'entraîner

1. Ajoute une 2e carte refusée dans `simulerTransaction` (ex. `4000000000009995`) et teste-la.
2. Ajoute une statistique « nombre de clients » (`SELECT COUNT(*) FROM utilisateurs WHERE role_id = 1`) et affiche-la dans un nouveau bloc de `admin.js`.
3. Ajoute un test dans `tests/parcours.js` : un client ne peut pas payer la réservation d'un autre client (attendu : 404).
