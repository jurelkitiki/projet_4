# LocaTech – Système transactionnel de location de matériel informatique

Site web de location de matériel informatique à la journée (portables, tablettes, projecteurs, casques, câbles) :
catalogue avec disponibilités selon les dates, calcul automatique du prix, validation par un responsable,
paiement simulé, remise, retour, pénalités, administration et statistiques.

**Technologies :** Node.js · Express · MySQL (mysql2) · HTML / CSS / JavaScript · JWT · bcrypt · express-validator

---

## 1. Lancer le projet (pas à pas, sous Windows)

### Étape 0 – Installer les logiciels (une seule fois)

| Logiciel | Où le trouver | Pour vérifier |
|---|---|---|
| **Node.js** (version LTS) | https://nodejs.org | `node -v` affiche `v20…` ou plus |
| **XAMPP** (pour MySQL) | https://www.apachefriends.org | XAMPP s'ouvre et affiche la ligne MySQL |

Après l'installation de Node.js, **fermez et rouvrez** le terminal.

### Étape 1 – Décompresser le projet

1. Clic droit sur `location-materiel.zip` → **Extraire tout**.
2. Placez le dossier **en dehors de OneDrive** si possible, par exemple `C:\projets\location-materiel`.
3. ⚠️ Windows crée souvent un dossier en double : `location-materiel\location-materiel\`. Le **bon dossier** est celui qui contient `package.json`.

### Étape 2 – Démarrer MySQL

Ouvrez **XAMPP Control Panel** → cliquez sur **Start** à côté de **MySQL** (la ligne devient verte).
Apache n'est pas nécessaire.

### Méthode A – Le plus simple : double-cliquer sur `LANCER.bat`

Dans le dossier qui contient `package.json`, double-cliquez sur **`LANCER.bat`**.
La première fois, il installe tout, crée la base de données, puis ouvre le site dans le navigateur.
Les fois suivantes, il démarre directement.

> Si Windows affiche « Windows a protégé votre ordinateur » : **Informations complémentaires** → **Exécuter quand même**.
> Laissez la fenêtre noire ouverte pendant que vous utilisez le site (la fermer arrête le serveur).

### Méthode B – Avec le terminal (à connaître pour la défense)

Ouvrez un terminal dans le dossier du projet (dans l'Explorateur : tapez `cmd` dans la barre d'adresse, puis Entrée), puis :

```bat
npm install
```
Télécharge les bibliothèques (Express, mysql2…) dans `node_modules`. Une seule fois, environ 1 minute.

```bat
copy .env.example .env
notepad .env
```
Crée le fichier de configuration. Avec XAMPP, laissez `DB_USER=root` et `DB_PASSWORD=` (vide).
Changez `JWT_SECRET` par une longue phrase de votre choix. Enregistrez et fermez.

```bat
npm run init-db
```
Crée la base `location_materiel` et les données de test. Le message doit finir par **« Base prête »**.
⚠️ Cette commande **efface** la base et la recrée : ne la relancez que pour repartir de zéro.

```bat
npm run dev
```
Démarre le serveur. Quand vous voyez **`Serveur démarré : http://localhost:3000`**, ouvrez cette adresse.
Pour arrêter : **Ctrl + C** dans le terminal.

### Les fois suivantes

1. XAMPP → **Start** MySQL.
2. Double-clic sur `LANCER.bat` (ou `npm run dev` dans le terminal).
3. http://localhost:3000

### Repartir de zéro avant une démo

Double-cliquez sur **`REINITIALISER-BASE.bat`** (ou `npm run init-db`) : toutes les réservations sont effacées et les données de test sont remises.

---

## 2. Comptes et cartes de test

Mot de passe pour tous les comptes : **`Motdepasse123!`**

| Rôle | Courriel | Ce qu'il peut faire |
|---|---|---|
| Client | `client@location.test` | Réserver, payer, suivre ses réservations |
| Client | `client2@location.test` | (pour tester deux clients) |
| Responsable du matériel | `responsable@location.test` | Valider, remettre, enregistrer les retours, pénalités |
| Administrateur | `admin@location.test` | Tout, plus le parc, les tarifs, les utilisateurs et les statistiques |

| Carte (paiement simulé) | Résultat |
|---|---|
| `4242 4242 4242 4242` | Accepté |
| `4000 0000 0000 0002` | Refusé |

Expiration future (ex. `12/30`), CVV quelconque (ex. `123`). **Aucune donnée de carte n'est enregistrée.**

**Astuce :** ouvrez le compte responsable dans une **fenêtre de navigation privée** à côté du compte client.

---

## 3. Parcours d'une location

```
Client                   Responsable                 Client                Responsable
Demande ───────────────▶ Valide (ou refuse) ───────▶ Paie (simulation) ──▶ Remise ──────▶ Retour
[en_attente]             [validee]                   [confirmee]           [en_cours]     [terminee]
                         matériel bloqué 30 min                                           + pénalités éventuelles
                         (sinon annulée automatiquement)
```

---

## 4. Tests automatiques

Serveur démarré + base fraîchement initialisée (`npm run init-db`), puis dans un **deuxième** terminal :

```bat
npm test
```
Résultat attendu : **37 réussi(s), 0 échec(s)** (calcul des 120 $, règles de gestion, conflits de réservation, paiements, pénalités, rôles, demandes de conseil).

---

## 5. Problèmes fréquents

| Message | Cause | Solution |
|---|---|---|
| `npm error enoent Could not read package.json` | Mauvais dossier (dossier en double) | `cd location-materiel` puis `dir` : il faut voir `package.json` |
| `'node' n'est pas reconnu…` | Node.js absent ou terminal ouvert avant l'installation | Installer Node.js LTS, fermer et rouvrir le terminal |
| `ECONNREFUSED` (à `npm run init-db`) | MySQL n'est pas démarré | XAMPP → Start MySQL |
| `Access denied for user 'root'` | Mauvais mot de passe MySQL dans `.env` | Corriger `DB_PASSWORD` (vide par défaut avec XAMPP) |
| `JWT_SECRET manquant` | Le fichier `.env` n'existe pas | `copy .env.example .env` |
| `EADDRINUSE :3000` | Le serveur tourne déjà (autre fenêtre) | Fermer l'autre fenêtre, ou mettre `PORT=3001` dans `.env` |
| Le bouton **Payer** n'apparaît pas | La demande n'est pas encore validée | Se connecter en responsable → **Valider** |
| Une ancienne version de la page s'affiche | Cache du navigateur | **Ctrl + F5** |

---

## 6. Structure du projet

```
location-materiel/
├── LANCER.bat / REINITIALISER-BASE.bat   # lancement en double-clic (Windows)
├── .env.example                          # modèle de configuration
├── database/
│   ├── schema.sql                        # tables, clés, contraintes
│   └── init.js                           # crée la base + données de test
├── src/
│   ├── server.js                         # point d'entrée Express, erreurs, expiration des paiements
│   ├── config/db.js                      # pool MySQL + transactions
│   ├── middleware/auth.js, valider.js    # jeton JWT, rôles, validation
│   ├── services/location.js              # règles métier (dates, prix, disponibilités)
│   ├── routes/
│   │   ├── auth.js                       # inscription, connexion
│   │   ├── catalogue.js                  # Module 1 : catégories, matériel, tarifs
│   │   ├── reservations.js               # Module 2 : estimation, demande, annulation
│   │   ├── gestion.js                    # Modules 3 et 5 : validation, remise, retour, pénalités
│   │   ├── paiements.js                  # Module 4 : paiement simulé, reçus
│   │   ├── admin.js                      # utilisateurs, transactions, Module 6 : statistiques
│   │   └── contact.js                    # demandes « Demander conseil »
│   └── utils/erreurs.js
├── public/                               # site (HTML, CSS, JS, polices)
│   ├── index.html                        # accueil
│   ├── catalogue.html, panier.html
│   ├── mes-reservations.html, mes-paiements.html, paiement.html, recu.html
│   ├── responsable.html, admin.html, connexion.html, inscription.html
│   ├── css/style.css, fonts/
│   └── js/                               # un fichier par page + app.js (commun) + illustrations.js
├── tests/parcours.js                     # tests automatiques
└── docs/
    ├── 00-architecture-commune.md        # à lire par tout le monde
    ├── membre-1-fondations-securite.md
    ├── membre-2-catalogue-reservation.md
    ├── membre-3-validation-remise-retour.md
    ├── membre-4-paiement-administration.md
    └── Suivi-agile-Projet4-LocaTech.xlsx # Scrum : backlog, sprints, Kanban, burndown, journal de bord
```

---

## 7. Répartition de l'équipe

| Membre | Rôle Scrum | Partie | Guide |
|---|---|---|---|
| 1 | Scrum Master | Base de données, serveur, connexion, rôles, sécurité, demande de conseil | `docs/membre-1-fondations-securite.md` |
| 2 | Product Owner | Catalogue, disponibilités, calcul du prix, panier, accueil et design | `docs/membre-2-catalogue-reservation.md` |
| 3 | Développeur | Validation, remise, retour, pénalités, espace responsable | `docs/membre-3-validation-remise-retour.md` |
| 4 | Responsable des tests | Paiement, reçus, administration, statistiques, tests | `docs/membre-4-paiement-administration.md` |

Les guides expliquent le code ligne par ligne, avec un scénario de démo et les questions probables de l'enseignant.

---

## 8. API REST (résumé)

Les routes protégées attendent l'en-tête `Authorization: Bearer <jeton>`.

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/api/auth/inscription`, `/api/auth/connexion` | public |
| GET | `/api/categories`, `/api/materiels?categorie=&recherche=&debut=&fin=` | public |
| POST/PUT/DELETE | `/api/categories[/:id]`, `/api/materiels[/:id]` | admin |
| PATCH | `/api/materiels/:id/etat` | responsable, admin |
| POST | `/api/reservations/estimation` | public |
| POST | `/api/reservations` · GET `/api/reservations/mes` · POST `/api/reservations/:id/annuler` | client |
| GET | `/api/reservations/:id` | propriétaire, responsable, admin |
| GET/POST | `/api/gestion/…` (valider, refuser, annulation, remise, retour, pénalités) | responsable, admin |
| POST | `/api/paiements/reservations/:id`, `/api/paiements/penalites/:id` | client |
| GET | `/api/paiements/mes`, `/api/paiements/:id/recu` | client (ses reçus), staff |
| GET/PATCH | `/api/admin/utilisateurs`, `/api/admin/transactions`, `/api/admin/statistiques`, `/api/admin/historique`, `/api/admin/contacts` | admin |
| POST | `/api/contact` | public |

---

## 9. Sécurité

- Mots de passe hachés avec **bcrypt** ; connexion par jeton **JWT** signé avec `JWT_SECRET`.
- Contrôle du rôle sur **chaque** route côté serveur.
- **Validation côté serveur** de toutes les entrées ; requêtes SQL **paramétrées** (aucune injection SQL).
- Échappement HTML de toutes les données affichées (protection XSS).
- Transactions SQL et verrous (`SELECT … FOR UPDATE`) contre les doubles réservations.
- Aucune donnée bancaire conservée.

La police Montserrat (`public/fonts`) est distribuée sous licence SIL Open Font License (voir `public/fonts/OFL-Montserrat.txt`).
