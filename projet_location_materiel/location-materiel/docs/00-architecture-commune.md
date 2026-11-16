# Guide commun – comprendre l'architecture de LocaTech

> À lire par **les 4 membres** avant leur guide personnel. L'enseignant peut poser ces questions à n'importe qui.

---

## 1. Le projet en 30 secondes

LocaTech est un **site web transactionnel** de location de matériel informatique :
un client choisit du matériel et des dates, voit le prix, envoie une demande ;
un **responsable** la valide ; le client **paie (simulation)** ; le responsable **remet** puis **récupère** le matériel et applique d'éventuelles **pénalités** ;
un **administrateur** gère le parc, les tarifs, les utilisateurs et consulte les **statistiques**.

**Technologies :**

| Couche | Technologie | Rôle |
|---|---|---|
| Base de données | **MySQL** (ou MariaDB) | Stocke les utilisateurs, le matériel, les réservations, les paiements… |
| Serveur (back-end) | **Node.js + Express** | Reçoit les requêtes, applique les règles de gestion, parle à MySQL |
| Accès à MySQL | **mysql2** | Bibliothèque qui envoie les requêtes SQL depuis Node.js |
| Sécurité | **bcryptjs**, **jsonwebtoken (JWT)**, **express-validator** | Mots de passe hachés, jeton de connexion, validation des données |
| Interface (front-end) | **HTML, CSS, JavaScript** (sans framework) | Pages affichées dans le navigateur, qui appellent l'API avec `fetch()` |

---

## 2. Le chemin d'une requête (à savoir dessiner au tableau)

```
 NAVIGATEUR                         SERVEUR NODE / EXPRESS                         MYSQL
 ──────────                         ──────────────────────                         ─────
 page HTML + JS
   │  fetch('/api/reservations', {POST, JSON})
   ▼
                     server.js  ──►  express.json()  (lit le JSON → req.body)
                                ──►  routes/reservations.js
                                       ├─ authentifier   (vérifie le jeton JWT)
                                       ├─ autoriser('client') (vérifie le rôle)
                                       ├─ règles express-validator + valider
                                       └─ fonction de la route
                                              └─ pool.query('INSERT …', [valeurs]) ──►  table reservations
                                              ◄────────────────────────────────────────  résultat
   ◄──────────── res.json({ id, message })  (réponse JSON)
 le JS met la page à jour
```

**Phrase à retenir :** *« Le navigateur n'accède jamais directement à MySQL. Il appelle l'API Express, qui vérifie l'identité, le rôle et les données, puis exécute une requête SQL paramétrée. »*

---

## 3. Organisation des dossiers

```
location-materiel/
├── database/            → schéma SQL + script de création (Membre 1)
├── src/
│   ├── server.js        → point d'entrée du serveur (Membre 1)
│   ├── config/db.js     → connexion MySQL (Membre 1)
│   ├── middleware/      → auth.js (jeton + rôle), valider.js (Membre 1)
│   ├── utils/erreurs.js → erreurs et asyncHandler (Membre 1)
│   ├── services/location.js → règles métier : dates, prix, disponibilités (Membre 2)
│   └── routes/          → une « route » = un groupe d'URL de l'API
│        ├── auth.js, contact.js         (Membre 1)
│        ├── catalogue.js, reservations.js (Membre 2)
│        ├── gestion.js                   (Membre 3)
│        └── paiements.js, admin.js       (Membre 4)
├── public/              → tout ce que le navigateur reçoit (HTML, CSS, JS, polices)
├── tests/parcours.js    → tests automatiques (Membre 4)
└── docs/                → ces guides + le fichier Excel de suivi agile
```

---

## 4. Le cycle de vie d'une réservation (statuts)

```
en_attente ──(responsable valide)──► validee ──(client paie, accepté)──► confirmee ──(remise)──► en_cours ──(retour)──► terminee
     │                                  │  └──(30 min sans paiement)──► annulee
     └──(responsable refuse)──► refusee └──(client annule)──► annulee
                                     confirmee ──(annulation acceptée)──► annulee
```

| Statut | Qui le déclenche | Fichier |
|---|---|---|
| `en_attente` | Client envoie la demande | `routes/reservations.js` |
| `validee` / `refusee` | Responsable | `routes/gestion.js` |
| `confirmee` | Paiement accepté | `routes/paiements.js` |
| `en_cours` | Remise du matériel | `routes/gestion.js` |
| `terminee` | Retour enregistré | `routes/gestion.js` |
| `annulee` | Client, responsable ou expiration | `reservations.js`, `gestion.js`, `server.js` |

---

## 5. Les 11 tables (+1) de la base

| Table | Entité du cahier des charges | Contenu |
|---|---|---|
| `roles` | Rôle | client, responsable, administrateur |
| `utilisateurs` | Utilisateur | nom, courriel, **mot de passe haché**, rôle |
| `categories` | CatégorieMatériel | Ordinateurs portables, Projecteurs… |
| `materiels` | Matériel + ÉtatMatériel | nom, quantité totale, **tarif journalier**, état |
| `reservations` | RéservationLocation | dates, nombre de jours, montant total, statut |
| `details_location` | DétailLocation | une ligne par équipement : quantité, **tarif appliqué**, montant |
| `paiements` | Paiement | montant, mode, statut, référence (**aucune donnée de carte**) |
| `penalites` | Pénalité | retard ou dommage, montant, réglée ou non |
| `remises` | (Module 5) | date de remise, responsable |
| `retours` | Retour | date effective, état du matériel, jours de retard |
| `historique` | Historique | toutes les actions (qui, quoi, quand) |
| `demandes_contact` | (ajout) | demandes « Demander conseil » des visiteurs |

---

## 6. Questions générales que l'enseignant peut poser à tout le monde

**Q : Pourquoi séparer front-end et back-end ?**
R : Le front-end (navigateur) n'est pas fiable : n'importe qui peut modifier le JavaScript. Toutes les règles importantes (prix, disponibilités, rôles) sont donc **vérifiées sur le serveur**. Le front-end ne fait qu'afficher et envoyer des demandes.

**Q : Qu'est-ce qu'une API REST ?**
R : Un ensemble d'URL que le serveur expose, où le verbe HTTP indique l'action : `GET` lire, `POST` créer, `PUT` remplacer, `PATCH` modifier une partie, `DELETE` supprimer. Les données circulent en **JSON**.

**Q : Que veut dire `async` / `await` ?**
R : MySQL répond après quelques millisecondes. `await` attend le résultat **sans bloquer** le serveur, qui peut traiter d'autres requêtes pendant ce temps.

**Q : Qu'est-ce qu'un middleware ?**
R : Une fonction exécutée **avant** la fonction finale d'une route, qui peut laisser passer (`next()`) ou bloquer la requête. Exemples : `authentifier`, `autoriser`, `valider`.

**Q : Comment éviter qu'un même ordinateur soit loué deux fois ?**
R : Le calcul de disponibilité additionne les quantités déjà réservées sur des **périodes qui se chevauchent**, et la validation utilise une **transaction** avec un verrou `SELECT … FOR UPDATE` (Membre 2 et 3 détaillent).

**Q : Comment sont codés les codes HTTP ?**
R : 200 OK, 201 créé, 400 donnée invalide, 401 pas connecté, 403 rôle interdit, 404 introuvable, 409 conflit (ex. stock insuffisant), 402 paiement refusé, 410 délai expiré, 500 erreur serveur.

**Q : Comment avez-vous travaillé en équipe ?**
R : Méthode **Scrum** : 5 sprints d'une semaine, un Product Backlog de user stories, un tableau Kanban, un burndown et le journal de bord (fichier `docs/Suivi-agile-Projet4-LocaTech.xlsx`).

---

## 7. Scénario de démonstration complet (environ 6 minutes)

| Ordre | Qui présente | Action à l'écran |
|---|---|---|
| 1 | Membre 2 | Accueil → menu « Location de matériel » → recherche avec des dates → catalogue → ajout au panier → panier latéral → récapitulatif → **Envoyer la demande** |
| 2 | Membre 1 | Montrer l'inscription, la connexion, puis la table `utilisateurs` dans phpMyAdmin (mot de passe haché) ; essayer d'ouvrir `admin.html` en client → accès refusé |
| 3 | Membre 3 | Se connecter en responsable → **Valider** la demande → expliquer les 30 min de blocage |
| 4 | Membre 4 | Client → **Payer** (carte 4000…0002 refusée, puis 4242… acceptée) → **reçu** |
| 5 | Membre 3 | Responsable → **Remise** → **Retour** avec dommage → pénalité |
| 6 | Membre 4 | Client paie la pénalité → Admin → **Statistiques**, transactions, demandes de conseil |
| 7 | Tous | `npm test` dans le terminal : 37 vérifications réussies |
