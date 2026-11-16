# Guide de défense – Membre 1 : Fondations et sécurité

**Ta partie :** la base de données MySQL, le démarrage du serveur Express, la connexion à MySQL, l'inscription et la connexion, la protection par rôle, la validation des données et le formulaire « Demander conseil ».

**Ton rôle Scrum :** Scrum Master (animer les réunions, tenir le journal de bord à jour).

**Phrase d'ouverture pour la défense :**
> « J'ai construit les fondations : la base de données, le serveur, et tout ce qui garantit qu'un utilisateur est bien celui qu'il prétend être et qu'il n'accède qu'à ce que son rôle permet. »

---

## Tes fichiers

| Fichier | À quoi il sert |
|---|---|
| `database/schema.sql` | Crée la base et les 12 tables |
| `database/init.js` | Exécute `schema.sql` et ajoute les données de test (`npm run init-db`) |
| `.env.example` | Modèle de configuration (mot de passe MySQL, clé secrète…) |
| `src/server.js` | Point d'entrée : démarre Express, branche les routes, gère les erreurs |
| `src/config/db.js` | Connexion à MySQL (pool) + transactions |
| `src/middleware/auth.js` | Vérifie le jeton de connexion et le rôle |
| `src/middleware/valider.js` | Renvoie une erreur 400 si une donnée est invalide |
| `src/utils/erreurs.js` | Classe `ErreurApp` et `asyncHandler` |
| `src/routes/auth.js` | Inscription, connexion, profil |
| `src/routes/contact.js` | Formulaire « Demander conseil » |
| `public/connexion.html`, `public/js/connexion.js` | Page de connexion |
| `public/inscription.html`, `public/js/inscription.js` | Page d'inscription |

---

## 1. `database/schema.sql` – la base de données

```sql
DROP DATABASE IF EXISTS location_materiel;      -- supprime l'ancienne base (repartir de zéro)
CREATE DATABASE location_materiel CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
                                                -- utf8mb4 = accepte tous les caractères (é, à, emoji)
USE location_materiel;                          -- les commandes suivantes s'appliquent à cette base
```

```sql
CREATE TABLE utilisateurs (
  id            INT AUTO_INCREMENT PRIMARY KEY, -- numéro unique, généré automatiquement (1, 2, 3…)
  nom           VARCHAR(80)  NOT NULL,          -- texte de 80 caractères max, obligatoire
  email         VARCHAR(150) NOT NULL UNIQUE,   -- UNIQUE : deux comptes ne peuvent pas avoir le même courriel
  mot_de_passe  VARCHAR(255) NOT NULL,          -- le HASH bcrypt (60 caractères), jamais le mot de passe en clair
  role_id       INT NOT NULL,                   -- quel rôle a cet utilisateur
  actif         TINYINT(1) NOT NULL DEFAULT 1,  -- 1 = actif, 0 = désactivé par l'admin
  cree_le       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- date de création remplie par MySQL
  CONSTRAINT fk_util_role FOREIGN KEY (role_id) REFERENCES roles(id)
                                                -- clé étrangère : role_id doit exister dans la table roles
) ENGINE=InnoDB;                                -- InnoDB = moteur qui gère les clés étrangères et les transactions
```

Points à expliquer :

- **Clé primaire (`PRIMARY KEY`)** : identifie une ligne de façon unique.
- **Clé étrangère (`FOREIGN KEY`)** : lien entre deux tables. MySQL refuse une réservation pour un utilisateur qui n'existe pas.
- **`CHECK`** : contrôle de cohérence directement dans MySQL. Exemple dans `reservations` :
  ```sql
  CONSTRAINT chk_dates CHECK (date_fin >= date_debut)   -- impossible d'enregistrer une fin avant le début
  ```
- **`ENUM`** : liste fermée de valeurs. Exemple :
  ```sql
  etat ENUM('disponible','loue','maintenance','hors_service') NOT NULL DEFAULT 'disponible'
  ```
- **`DECIMAL(10,2)`** pour l'argent (et non `FLOAT`) : valeur exacte au cent près, sans erreur d'arrondi.
- **`INDEX idx_res_dates (date_debut, date_fin)`** : accélère la recherche des réservations qui se chevauchent.
- **`ON DELETE CASCADE`** sur `details_location` : si on supprime une réservation, ses lignes partent avec elle.
- **`paiements`** n'a **aucune colonne pour la carte**. C'est voulu (spécification « aucune donnée bancaire »).

---

## 2. `database/init.js` – créer la base avec `npm run init-db`

```js
require('dotenv').config();                 // lit le fichier .env et remplit process.env
const mysql = require('mysql2/promise');    // version de mysql2 qui fonctionne avec await
const bcrypt = require('bcryptjs');         // pour hacher les mots de passe des comptes de test

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost', // où est MySQL ; 'localhost' par défaut
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  multipleStatements: true,                 // autorise plusieurs commandes SQL en une seule fois
});
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'); // lit le fichier .sql
await conn.query(schema);                   // l'exécute dans MySQL (comme dans phpMyAdmin)

const hash = await bcrypt.hash('Motdepasse123!', 10);  // hache le mot de passe de test (coût 10)
await conn.query(`INSERT INTO utilisateurs (...) VALUES (..., ?, ...)`, [hash, ...]);
                                            // les ? sont remplacés par les valeurs du tableau
```

**Question probable :** *« Pourquoi `multipleStatements` seulement ici ? »*
Parce que ce script exécute un fichier entier. Dans l'application, c'est désactivé : une injection SQL ne pourrait pas ajouter une deuxième commande.

---

## 3. `src/server.js` – le point d'entrée

```js
require('dotenv').config();                 // ligne 1 : charge .env AVANT tout le reste
const express = require('express');
const { pool } = require('./config/db');

if (!process.env.JWT_SECRET) {              // sécurité : refuse de démarrer sans clé secrète
  console.error('JWT_SECRET manquant : copiez .env.example en .env');
  process.exit(1);                          // arrête le programme
}

const app = express();                      // crée l'application
app.use(express.json({ limit: '100kb' }));  // lit le corps JSON des requêtes → req.body ; limite la taille

app.use((req, res, next) => {               // middleware maison : en-têtes de sécurité
  res.setHeader('X-Content-Type-Options', 'nosniff'); // le navigateur ne devine pas le type des fichiers
  res.setHeader('X-Frame-Options', 'DENY');           // interdit d'afficher le site dans une iframe (clickjacking)
  next();                                   // passe au middleware suivant
});

app.use('/api/auth', require('./routes/auth'));         // toutes les URL /api/auth/... → routes/auth.js
app.use('/api', require('./routes/catalogue'));
app.use('/api/reservations', require('./routes/reservations'));
// … paiements, gestion, admin, contact …
app.use('/api', (req, res) => res.status(404).json({ message: 'Route introuvable.' }));
                                            // toute autre URL /api inconnue → 404 en JSON

app.use(express.static(path.join(__dirname, '..', 'public')));
                                            // sert les fichiers du dossier public (index.html, css, js…)
```

**La gestion centralisée des erreurs** (4 paramètres = middleware d'erreur pour Express) :

```js
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'JSON invalide.' });
  if (err.status) return res.status(err.status).json({ message: err.message }); // nos ErreurApp (400, 403, 409…)
  console.error(err);                                     // erreur imprévue : on la note dans la console
  res.status(500).json({ message: 'Erreur interne du serveur.' }); // sans révéler les détails au visiteur
});
```

**La tâche périodique** (règle « en cas d'expiration du paiement, le matériel redevient disponible ») :

```js
async function annulerPaiementsExpires() {
  const [rows] = await pool.query(
    "SELECT id FROM reservations WHERE statut = 'validee' AND expiration_paiement <= NOW()");
  for (const { id } of rows) { /* UPDATE … statut = 'annulee' … + historique */ }
}
setInterval(annulerPaiementsExpires, 60 * 1000);   // toutes les 60 secondes
```

---

## 4. `src/config/db.js` – la connexion à MySQL

```js
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'location_materiel',
  connectionLimit: 10,        // jusqu'à 10 connexions ouvertes en même temps, réutilisées
  dateStrings: true,          // les dates restent du texte 'AAAA-MM-JJ' : pas de décalage de fuseau horaire
  decimalNumbers: true,       // les DECIMAL arrivent comme des nombres JavaScript
});
```

**Pourquoi un « pool » ?** Ouvrir une connexion à MySQL est lent. Le pool garde des connexions prêtes et les prête à chaque requête.

```js
async function transaction(fn) {
  const conn = await pool.getConnection();   // emprunte UNE connexion (la transaction doit rester sur la même)
  try {
    await conn.beginTransaction();           // début : rien n'est définitif
    const resultat = await fn(conn);         // on exécute toutes les requêtes
    await conn.commit();                     // tout a réussi → on enregistre tout
    return resultat;
  } catch (err) {
    await conn.rollback();                   // une erreur → on annule TOUT (rien n'est enregistré à moitié)
    throw err;
  } finally {
    conn.release();                          // dans tous les cas, on rend la connexion au pool
  }
}
```

**Exemple à donner :** créer une réservation = 1 ligne dans `reservations` + plusieurs lignes dans `details_location` + 1 ligne d'historique. Si la 3e requête échoue, la transaction annule les 2 premières.

---

## 5. `src/utils/erreurs.js`

```js
class ErreurApp extends Error {         // une erreur « prévue », avec un code HTTP
  constructor(status, message) { super(message); this.status = status; }
}
// utilisation : throw new ErreurApp(409, 'Quantité insuffisante');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// Express 4 n'attrape pas les erreurs des fonctions async : asyncHandler les transmet
// au middleware d'erreur (next(err)). Sans lui, le serveur ne répondrait jamais.
```

---

## 6. `src/routes/auth.js` – inscription et connexion

### Inscription

```js
router.post('/inscription',
  [                                                    // 1) règles de validation (express-validator)
    body('nom').trim().notEmpty().withMessage('Le nom est obligatoire.').isLength({ max: 80 }),
    body('email').trim().isEmail().withMessage('Adresse courriel invalide.').normalizeEmail(),
    body('mot_de_passe')
      .isLength({ min: 8 }).withMessage('… au moins 8 caractères.')
      .matches(/\d/).withMessage('… au moins un chiffre.'),   // \d = un chiffre
  ],
  valider,                                             // 2) si une règle échoue → 400, on s'arrête là
  asyncHandler(async (req, res) => {                   // 3) la fonction principale
    const [existe] = await pool.query('SELECT id FROM utilisateurs WHERE email = ?', [email]);
    if (existe.length) return res.status(409).json({ message: 'Un compte existe déjà avec ce courriel.' });

    const hash = await bcrypt.hash(mot_de_passe, 10);  // hachage : irréversible, avec un sel aléatoire
    const [r] = await pool.query(
      `INSERT INTO utilisateurs (nom, prenom, email, mot_de_passe, telephone, role_id)
       VALUES (?, ?, ?, ?, ?, (SELECT id FROM roles WHERE nom = 'client'))`,
      [nom, prenom, email, hash, telephone || null]);  // rôle forcé à « client » : impossible de s'inscrire admin
    res.status(201).json({ jeton: creerJeton(user), utilisateur: user });  // 201 = créé
  }));
```

### Connexion

```js
const u = rows[0];
if (!u || !(await bcrypt.compare(req.body.mot_de_passe, u.mot_de_passe))) {
  return res.status(401).json({ message: 'Courriel ou mot de passe incorrect.' });
}
```

- `bcrypt.compare` refait le hachage du mot de passe tapé avec le **sel** contenu dans le hash enregistré, puis compare les deux.
- Le message est **le même** que le courriel soit inconnu ou que le mot de passe soit faux : un pirate ne peut pas savoir quels courriels existent.

### Le jeton JWT

```js
const creerJeton = (u) =>
  jwt.sign({ id: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '8h' });
```

- Le jeton contient l'id et le rôle, **signés** avec `JWT_SECRET`. Si quelqu'un modifie le jeton, la signature ne correspond plus et il est rejeté.
- Le navigateur le garde dans `localStorage` et l'envoie à chaque requête : `Authorization: Bearer <jeton>` (voir `public/js/app.js`, fonction `api`).

---

## 7. `src/middleware/auth.js` – qui es-tu et as-tu le droit ?

```js
async function authentifier(req, res, next) {
  const entete = req.headers.authorization || '';
  const jeton = entete.startsWith('Bearer ') ? entete.slice(7) : null;  // enlève « Bearer »
  if (!jeton) return res.status(401).json({ message: 'Connexion requise.' });
  try {
    const charge = jwt.verify(jeton, process.env.JWT_SECRET);  // vérifie signature + expiration
    const [rows] = await pool.query(`SELECT … FROM utilisateurs … WHERE u.id = ?`, [charge.id]);
    if (!rows.length || !rows[0].actif) return res.status(401).json({ message: 'Compte introuvable ou désactivé.' });
    req.user = rows[0];          // les routes suivantes savent qui fait la requête
    next();
  } catch {
    return res.status(401).json({ message: 'Session expirée, veuillez vous reconnecter.' });
  }
}
```

**Pourquoi relire l'utilisateur dans MySQL ?** Si l'administrateur change son rôle ou désactive le compte, l'effet est **immédiat**, même avec un ancien jeton.

```js
const autoriser = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ message: 'Accès refusé pour votre rôle.' });
  next();
};
// utilisation : router.post('/', authentifier, autoriser('client'), …)
```

- **401** = pas connecté. **403** = connecté mais pas le bon rôle.
- Les pages HTML font aussi un contrôle (`App.exigerRole`), mais c'est **seulement pour l'affichage**. La vraie protection est sur le serveur.

---

## 8. `src/middleware/valider.js`

```js
function valider(req, res, next) {
  const erreurs = validationResult(req);           // récupère les erreurs des règles body(...)
  if (!erreurs.isEmpty()) {
    return res.status(400).json({ message: erreurs.array()[0].msg, erreurs: … });  // 1er message affiché
  }
  next();
}
```

---

## 9. Les injections SQL – LA question classique

```js
// ❌ DANGEREUX (jamais dans le projet)
pool.query("SELECT * FROM utilisateurs WHERE email = '" + email + "'");
// Si email = "' OR '1'='1", la requête renvoie tous les utilisateurs.

// ✅ CE QUE FAIT LE PROJET : requête paramétrée
pool.query('SELECT * FROM utilisateurs WHERE email = ?', [email]);
// mysql2 envoie la valeur séparément : elle est traitée comme du texte, jamais comme du SQL.
```

---

## 10. `src/routes/contact.js` – « Demander conseil »

- Route **publique** (pas de `authentifier`) : un visiteur peut écrire sans compte.
- Validation : nom obligatoire, courriel valide, `nb_jours` entre 1 et 90, message de 10 à 2 000 caractères.
- `CREATE TABLE IF NOT EXISTS demandes_contact` au chargement : la fonctionnalité marche même sur une base créée avant son ajout.
- L'administrateur lit les demandes dans **Administration → Demandes de conseil** (`GET /api/admin/contacts`).

---

## 11. Front-end : `public/js/connexion.js`

```js
const { jeton, utilisateur } = await App.api('/auth/connexion', { methode: 'POST', corps: App.donneesFormulaire(form) });
App.session.ouvrir(jeton, utilisateur);           // enregistre le jeton dans localStorage
const retour = new URLSearchParams(location.search).get('retour');
location.href = retour && retour.startsWith('/') && !retour.startsWith('//') ? retour : parDefaut;
// on n'accepte qu'un chemin local : empêche une redirection vers un site malveillant
```

---

## Démo à faire pendant la défense

1. Ouvrir phpMyAdmin → table `utilisateurs` → montrer la colonne `mot_de_passe` (`$2a$10$…`).
2. S'inscrire avec un mot de passe sans chiffre → message d'erreur du serveur.
3. Se connecter en **client**, taper `http://localhost:3000/admin.html` → « Accès refusé ».
4. Montrer `.env` (sans dévoiler la vraie clé) et expliquer `JWT_SECRET`.

## Questions probables et réponses

| Question | Réponse courte |
|---|---|
| Différence entre hacher et chiffrer ? | Le chiffrement est réversible avec une clé ; le hachage ne l'est pas. Pour un mot de passe, on hache. |
| Qu'est-ce que le sel ? | Une valeur aléatoire ajoutée avant le hachage, différente pour chaque utilisateur : deux mots de passe identiques donnent deux hash différents. |
| Pourquoi bcrypt et pas SHA-256 ? | bcrypt est volontairement lent (coût 10 = 1 024 tours) : les attaques par force brute deviennent très longues. |
| Où est stocké le jeton ? Risque ? | Dans `localStorage`. Le risque est le XSS ; on le limite en échappant toutes les données affichées (`App.esc`). |
| Pourquoi `.env` n'est pas dans Git ? | Il contient des secrets (mot de passe MySQL, clé JWT). On partage `.env.example` à la place. |
| Que se passe-t-il si MySQL est arrêté ? | `npm run init-db` affiche `ECONNREFUSED`, l'API répond 500 ; il faut démarrer MySQL (XAMPP). |
| Qu'est-ce qu'une transaction ? | Un groupe de requêtes « tout ou rien » : COMMIT si tout réussit, ROLLBACK sinon. |

## Pour t'entraîner

1. Ajoute une règle : le prénom doit faire au moins 2 caractères (`isLength({ min: 2 })`). Teste l'inscription.
2. Change la durée du jeton à 1 h dans `.env` (`JWT_EXPIRES_IN=1h`).
3. Dans phpMyAdmin, essaie d'insérer une réservation avec `date_fin` avant `date_debut` : observe l'erreur du `CHECK`.
