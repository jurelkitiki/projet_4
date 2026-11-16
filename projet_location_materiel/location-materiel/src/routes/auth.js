const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body } = require('express-validator');
const { pool } = require('../config/db');
const valider = require('../middleware/valider');
const { authentifier } = require('../middleware/auth');
const { asyncHandler } = require('../utils/erreurs');

const creerJeton = (u) =>
  jwt.sign({ id: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });

// POST /api/auth/inscription — création d'un compte client
router.post(
  '/inscription',
  [
    body('nom').trim().notEmpty().withMessage('Le nom est obligatoire.').isLength({ max: 80 }),
    body('prenom').trim().notEmpty().withMessage('Le prénom est obligatoire.').isLength({ max: 80 }),
    body('email').trim().isEmail().withMessage('Adresse courriel invalide.').normalizeEmail(),
    body('telephone').optional({ values: 'falsy' }).trim().isLength({ max: 30 }),
    body('mot_de_passe')
      .isLength({ min: 8 }).withMessage('Le mot de passe doit contenir au moins 8 caractères.')
      .matches(/\d/).withMessage('Le mot de passe doit contenir au moins un chiffre.'),
  ],
  valider,
  asyncHandler(async (req, res) => {
    const { nom, prenom, email, telephone, mot_de_passe } = req.body;
    const [existe] = await pool.query('SELECT id FROM utilisateurs WHERE email = ?', [email]);
    if (existe.length) return res.status(409).json({ message: 'Un compte existe déjà avec ce courriel.' });

    const hash = await bcrypt.hash(mot_de_passe, 10);
    const [r] = await pool.query(
      `INSERT INTO utilisateurs (nom, prenom, email, mot_de_passe, telephone, role_id)
       VALUES (?, ?, ?, ?, ?, (SELECT id FROM roles WHERE nom = 'client'))`,
      [nom, prenom, email, hash, telephone || null]
    );
    const user = { id: r.insertId, nom, prenom, email, role: 'client' };
    res.status(201).json({ jeton: creerJeton(user), utilisateur: user });
  })
);

// POST /api/auth/connexion
router.post(
  '/connexion',
  [
    body('email').trim().isEmail().withMessage('Adresse courriel invalide.').normalizeEmail(),
    body('mot_de_passe').notEmpty().withMessage('Mot de passe requis.'),
  ],
  valider,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT u.id, u.nom, u.prenom, u.email, u.mot_de_passe, u.actif, r.nom AS role
         FROM utilisateurs u JOIN roles r ON r.id = u.role_id WHERE u.email = ?`,
      [req.body.email]
    );
    const u = rows[0];
    if (!u || !(await bcrypt.compare(req.body.mot_de_passe, u.mot_de_passe))) {
      return res.status(401).json({ message: 'Courriel ou mot de passe incorrect.' });
    }
    if (!u.actif) return res.status(403).json({ message: 'Ce compte a été désactivé.' });
    delete u.mot_de_passe;
    delete u.actif;
    res.json({ jeton: creerJeton(u), utilisateur: u });
  })
);

// GET /api/auth/moi — profil de l'utilisateur connecté
router.get('/moi', authentifier, (req, res) => res.json(req.user));

module.exports = router;
