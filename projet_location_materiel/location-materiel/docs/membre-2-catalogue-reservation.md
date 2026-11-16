# Guide de défense – Membre 2 : Catalogue, disponibilités et réservation

**Ta partie :** Module 1 (parc d'équipements et tarifs), Module 2 (réservation et calcul du coût), et l'interface publique : accueil, catalogue, panier, design.

**Ton rôle Scrum :** Product Owner (tu représentes le cahier des charges et tu décides de l'ordre des user stories).

**Phrase d'ouverture pour la défense :**
> « Ma partie, c'est tout ce que le client voit avant d'envoyer sa demande : le catalogue, les disponibilités sur ses dates, le calcul exact du prix et le panier. C'est aussi là qu'on empêche les doubles réservations. »

---

## Tes fichiers

| Fichier | À quoi il sert |
|---|---|
| `src/services/location.js` | **Le cœur métier** : dates, nombre de jours, montant d'une ligne, quantité disponible, historique |
| `src/routes/catalogue.js` | API des catégories et du matériel (lecture publique, modification par l'admin) |
| `src/routes/reservations.js` | Estimation du prix, création de la demande, mes réservations, annulation |
| `public/index.html` + `js/accueil.js` | Page d'accueil |
| `public/catalogue.html` + `js/catalogue.js` | Catalogue avec filtres, dates et ajout au panier |
| `public/panier.html` + `js/panier.js` | Récapitulatif et envoi de la demande |
| `public/js/app.js` | Fonctions communes : `api()`, session, panier, en-tête, panier latéral, pied de page |
| `public/js/illustrations.js` | Dessins SVG du matériel |
| `public/css/style.css` | Tout le design (couleurs, boutons, mise en page mobile) |

---

## 1. `src/services/location.js` – les règles de gestion

### Nombre de jours (bornes incluses)

```js
const UN_JOUR = 24 * 60 * 60 * 1000;              // un jour en millisecondes
function nombreDeJours(debut, fin) {
  return Math.round((versDate(fin) - versDate(debut)) / UN_JOUR) + 1;
}
// du 10 au 12 : (12 - 10) = 2 jours d'écart, + 1 = 3 jours facturés
```

`versDate` crée la date en **UTC** (`'2026-11-10T00:00:00Z'`) pour éviter les problèmes de changement d'heure.

### Vérifier une période

```js
function verifierPeriode(debut, fin) {
  const d = versDate(debut); const f = versDate(fin);
  if (!d || !f) throw new ErreurApp(400, 'Dates invalides (format attendu : AAAA-MM-JJ).');
  if (f < d) throw new ErreurApp(400, 'La date de fin doit être postérieure ou égale à la date de début.');
  if (debut < aujourdhui()) throw new ErreurApp(400, 'La date de début ne peut pas être dans le passé.');
  const jours = nombreDeJours(debut, fin);
  if (jours > 90) throw new ErreurApp(400, 'La durée maximale de location est de 90 jours.');
  return jours;
}
```

→ Règle du cahier des charges : *« Une réservation contient obligatoirement une date de début et une date de fin valide. »*

### Le calcul du montant

```js
function montantLigne(tarif, jours, quantite) {
  return Math.round(Number(tarif) * jours * quantite * 100) / 100;   // arrondi au cent
}
```

Exemple du cahier des charges : `montantLigne(15, 3, 2)` = **90** ; `montantLigne(10, 3, 1)` = **30** ; total **120 $**.
`* 100`, `Math.round`, puis `/ 100` : évite les erreurs du type `0.1 + 0.2 = 0.30000000000000004`.

### La disponibilité – LA fonction la plus importante

```js
const CONDITION_BLOQUANTE = `(
  r.statut IN ('confirmee', 'en_cours')                          -- payée ou déjà remise : bloque
  OR (r.statut = 'validee' AND r.expiration_paiement > NOW())    -- validée : bloque seulement pendant les 30 min
)`;
```

Une demande **en attente** ne bloque pas le stock : elle n'est pas encore acceptée.

```js
async function quantiteDisponible(conn, materielId, debut, fin, { exclureReservation = null, verrou = false } = {}) {
  const [mats] = await conn.query(
    `SELECT id, nom, quantite_totale, etat, actif FROM materiels WHERE id = ? ${verrou ? 'FOR UPDATE' : ''}`, [materielId]);
  // FOR UPDATE : verrouille la ligne jusqu'à la fin de la transaction (utilisé lors de la validation)
  if (!mats.length || !mats[0].actif) throw new ErreurApp(404, …);
  const m = mats[0];
  if (m.etat === 'maintenance' || m.etat === 'hors_service') return { materiel: m, disponible: 0 };
  // règle : « un équipement en maintenance ou hors service ne peut pas être réservé »

  const [rows] = await conn.query(
    `SELECT COALESCE(SUM(d.quantite), 0) AS reserve
       FROM details_location d JOIN reservations r ON r.id = d.reservation_id
      WHERE d.materiel_id = ?
        AND ${CONDITION_BLOQUANTE}
        AND r.date_debut <= ?                                   -- la réservation existante commence avant MA fin
        AND (CASE WHEN r.statut = 'en_cours' THEN GREATEST(r.date_fin, CURDATE()) ELSE r.date_fin END) >= ?
                                                                -- et finit après MON début (= chevauchement)
        AND (? IS NULL OR r.id <> ?)`,                          -- on peut ignorer une réservation (celle qu'on valide)
    [materielId, fin, debut, exclureReservation, exclureReservation]);
  return { materiel: m, disponible: Math.max(0, m.quantite_totale - Number(rows[0].reserve)) };
}
```

**Le test de chevauchement à savoir expliquer au tableau :**

```
existante :      |=======|            début_existant <= ma_fin   ET   fin_existante >= mon_début
ma demande :          |=======|       → les deux périodes se chevauchent
```

- `COALESCE(SUM(...), 0)` : si aucune réservation, `SUM` renvoie `NULL` ; `COALESCE` le remplace par 0.
- Le `CASE … GREATEST(r.date_fin, CURDATE())` : un matériel remis mais **pas encore rendu** (en retard) reste bloqué jusqu'à aujourd'hui.
- Disponible = quantité totale − quantité déjà réservée sur la période.

---

## 2. `src/routes/catalogue.js` – Module 1

```js
// GET /api/materiels?categorie=1&recherche=dell&debut=2026-11-10&fin=2026-11-12
const conditions = ['m.actif = 1'];        // on n'affiche jamais le matériel retiré du parc
const params = [];
if (categorie) { conditions.push('m.categorie_id = ?'); params.push(categorie); }
if (recherche) { conditions.push('(m.nom LIKE ? OR m.description LIKE ?)'); params.push(`%${recherche}%`, `%${recherche}%`); }
// la requête est construite morceau par morceau, mais les VALEURS passent toujours par des ?

if (debut && fin) {
  verifierPeriode(debut, fin);
  for (const m of rows) m.disponible_periode = (await quantiteDisponible(pool, m.id, debut, fin)).disponible;
}
```

**Les routes d'administration** utilisent `authentifier, autoriser('administrateur')` :

| Route | Effet |
|---|---|
| `POST /api/materiels` | Ajoute un équipement |
| `PUT /api/materiels/:id` | Modifie (nom, catégorie, quantité, **tarif**, état). Un changement de tarif est noté dans l'historique (`TARIF_MODIFIE`) |
| `DELETE /api/materiels/:id` | **Retrait logique** : `actif = 0`. Refusé si une réservation active l'utilise (409) |
| `PATCH /api/materiels/:id/etat` | Maintenance / hors service (aussi permis au responsable) |
| `POST/PUT/DELETE /api/categories` | Gestion des catégories ; suppression refusée si des équipements l'utilisent |

**Pourquoi un retrait logique ?** Les anciennes réservations pointent vers cet équipement. Le supprimer casserait l'historique et les statistiques.

---

## 3. `src/routes/reservations.js` – Module 2

### `calculerPanier` : prix et disponibilités d'un panier

```js
const quantites = new Map();                 // regroupe les doublons (même équipement ajouté 2 fois)
for (const a of articles) {
  const id = Number(a.materiel_id); const q = Number(a.quantite);
  if (!Number.isInteger(id) || !Number.isInteger(q) || q < 1) throw new ErreurApp(400, 'Quantité ou équipement invalide.');
  quantites.set(id, (quantites.get(id) || 0) + q);
}
for (const [materielId, quantite] of […]) {
  const { materiel, disponible } = await loc.quantiteDisponible(conn, materielId, debut, fin);
  const [[m]] = await conn.query('SELECT tarif_journalier FROM materiels WHERE id = ?', [materielId]);
  lignes.push({ …, quantite, disponible, suffisant: quantite <= disponible,
    tarif_applique: Number(m.tarif_journalier),          // le tarif vient de la BASE, jamais du navigateur
    montant_ligne: loc.montantLigne(m.tarif_journalier, jours, quantite) });
}
const total = Math.round(lignes.reduce((s, l) => s + l.montant_ligne, 0) * 100) / 100;
// reduce additionne toutes les lignes → Montant total = somme des montants
```

**Point de sécurité essentiel :** le navigateur envoie seulement `materiel_id` et `quantite`. **Le prix est toujours recalculé par le serveur.** Un client qui modifierait le JavaScript ne peut pas changer le prix.

### `POST /api/reservations/estimation` (public)

Renvoie le calcul sans rien enregistrer : utilisé par le panier latéral et la page panier.

### `POST /api/reservations` – créer la demande

```js
router.post('/', authentifier, autoriser('client'), reglesPanier, valider, asyncHandler(async (req, res) => {
  const id = await transaction(async (conn) => {
    const calc = await calculerPanier(conn, articles, date_debut, date_fin);
    const manquant = calc.lignes.find((l) => !l.suffisant);
    if (manquant) throw new ErreurApp(409, `Quantité insuffisante pour « ${manquant.materiel} » …`);
    const [r] = await conn.query(`INSERT INTO reservations (… statut) VALUES (…, 'en_attente')`, […]);
    for (const l of calc.lignes) {
      await conn.query(`INSERT INTO details_location (reservation_id, materiel_id, quantite, tarif_applique, nb_jours, montant_ligne) …`);
    }
    await loc.journaliser(conn, { reservationId: r.insertId, action: 'DEMANDE_CREEE', … });
    return r.insertId;
  });
  res.status(201).json({ id, message: '…' });
}));
```

- Tout est dans une **transaction** : réservation + lignes + historique, ou rien.
- Le **tarif est figé** dans `details_location.tarif_applique` : si l'admin change le prix demain, la réservation garde le prix d'aujourd'hui (le test automatique le vérifie).

### `POST /api/reservations/:id/annuler`

| Statut actuel | Résultat |
|---|---|
| `en_attente` ou `validee` | Annulation immédiate, le matériel est libéré |
| `confirmee` (payée) | **Demande** d'annulation (`demande_annulation = 1`), traitée par le responsable (Membre 3) |
| autre | 409 « ne peut plus être annulée » |

---

## 4. Le front-end

### `public/js/app.js` – la fonction `api`

```js
async function api(url, { methode = 'GET', corps } = {}) {
  const res = await fetch('/api' + url, {
    method: methode,
    headers: { 'Content-Type': 'application/json',
      ...(session.jeton ? { Authorization: `Bearer ${session.jeton}` } : {}) },  // ajoute le jeton si connecté
    body: corps !== undefined ? JSON.stringify(corps) : undefined,             // objet JS → texte JSON
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && session.jeton) { session.fermer(); location.href = 'connexion.html?retour=…'; }
  if (!res.ok) { const err = new Error(data.message); err.status = res.status; throw err; }
  return data;
}
```

Toutes les pages l'utilisent : `await App.api('/materiels?categorie=1')`.

### Le panier (dans le navigateur)

```js
const panier = {
  lire() { return JSON.parse(localStorage.getItem('panier')) || { articles: [], date_debut: '', date_fin: '' }; },
  ajouter(materiel, quantite) { … },   // ajoute ou augmente la quantité
  vider() { … },
};
```

Le panier reste dans `localStorage` jusqu'à l'envoi de la demande : il n'est enregistré dans MySQL qu'au moment de `POST /api/reservations`.

### `public/js/catalogue.js`

- Lit `?categorie=…&debut=…&fin=…` dans l'adresse (venant de la recherche de l'accueil).
- Appelle `/api/materiels?…` et affiche une carte par équipement, avec la pastille « X disponible(s) » ou « Complet sur la période ».
- Bouton **Ajouter au panier** : vérifie que la quantité ne dépasse pas la disponibilité, puis ouvre le panier latéral (`App.ouvrirPanier()`).

### Sécurité de l'affichage : `App.esc`

```js
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', … }[c]));
```

Chaque texte venant de la base passe par `esc()` avant d'être inséré dans la page : un nom d'équipement contenant `<script>` s'affiche comme du texte, sans s'exécuter (protection **XSS**).

### `public/css/style.css`

- Les couleurs sont des **variables CSS** dans `:root` (`--bleu`, `--marine`, `--jaune`…) : changer une variable change tout le site.
- Les illustrations utilisent `--i1` à `--i4` : chaque carte redéfinit ces variables pour colorer le dessin.
- `@media (max-width: 720px)` : version mobile (une colonne, tableaux transformés en cartes).
- La police Montserrat est **dans le projet** (`public/fonts`) : le site fonctionne même sans Internet.

---

## Démo à faire pendant la défense

1. Accueil → choisir des dates → **Voir les disponibilités**.
2. Ajouter 2 portables + 1 projecteur sur 3 jours → montrer **120 $** dans le panier latéral.
3. Montrer un équipement « Maintenance » (non réservable).
4. Ouvrir les outils de développement (F12) → onglet Réseau → montrer la requête `POST /api/reservations` : on n'envoie **pas** de prix.

## Questions probables et réponses

| Question | Réponse courte |
|---|---|
| Comment calculez-vous le prix ? | Tarif journalier × jours × quantité par ligne, puis somme. Calcul fait sur le serveur avec le tarif de la base. |
| Que se passe-t-il si deux clients demandent le dernier portable ? | Les deux demandes peuvent être « en attente », mais la **validation** revérifie le stock avec un verrou : la deuxième est refusée (409). |
| Pourquoi une demande en attente ne bloque-t-elle pas le stock ? | Sinon un client pourrait bloquer tout le parc sans payer. Le stock est bloqué à la validation, 30 min, puis au paiement. |
| Pourquoi garder le tarif dans `details_location` ? | Pour que le prix d'une réservation ne change pas si l'admin modifie le tarif après. |
| Pourquoi 3 jours du 10 au 12 ? | Les deux dates sont incluses : le matériel est utilisé le 10, le 11 et le 12. |
| Le panier est-il dans la base ? | Non, dans le navigateur (`localStorage`) jusqu'à l'envoi de la demande. |

## Pour t'entraîner

1. Change le tarif d'un équipement dans Administration → vérifie que le catalogue change mais pas une ancienne réservation.
2. Dans `verifierPeriode`, passe la durée maximale de 90 à 30 jours et teste.
3. Ajoute une nouvelle couleur de catégorie (`.c-6`) dans `style.css`.
