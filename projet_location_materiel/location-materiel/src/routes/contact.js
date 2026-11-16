// Demande de conseil : formulaire public « Demander conseil » (en-tête, accueil, pied de page)
const router = require('express').Router();
const { body } = require('express-validator');
const { pool } = require('../config/db');
const valider = require('../middleware/valider');
const { asyncHandler } = require('../utils/erreurs');

// Crée la table si la base a été initialisée avant l'ajout de cette fonctionnalité
pool.query(`CREATE TABLE IF NOT EXISTS demandes_contact (
  id INT AUTO_INCREMENT PRIMARY KEY, nom VARCHAR(120) NOT NULL, organisation VARCHAR(150) NULL,
  email VARCHAR(150) NOT NULL, telephone VARCHAR(30) NULL, date_debut DATE NULL, nb_jours INT NULL,
  message TEXT NOT NULL, statut ENUM('nouvelle','traitee') NOT NULL DEFAULT 'nouvelle',
  cree_le DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB`).catch((e) => console.error('demandes_contact :', e.message));

// POST /api/contact
router.post('/',
  [
    body('nom').trim().notEmpty().withMessage('Indiquez votre nom.').isLength({ max: 120 }),
    body('organisation').optional({ values: 'falsy' }).trim().isLength({ max: 150 }),
    body('email').trim().isEmail().withMessage('Adresse courriel invalide.').normalizeEmail(),
    body('telephone').optional({ values: 'falsy' }).trim().isLength({ max: 30 }),
    body('date_debut').optional({ values: 'falsy' }).isISO8601().withMessage('Date de début invalide.'),
    body('nb_jours').optional({ values: 'falsy' }).isInt({ min: 1, max: 90 }).withMessage('Nombre de jours invalide (1 à 90).').toInt(),
    body('message').trim().isLength({ min: 10, max: 2000 }).withMessage('Décrivez votre projet en au moins 10 caractères.'),
  ],
  valider,
  asyncHandler(async (req, res) => {
    const { nom, organisation, email, telephone, date_debut, nb_jours, message } = req.body;
    await pool.query(
      `INSERT INTO demandes_contact (nom, organisation, email, telephone, date_debut, nb_jours, message)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nom, organisation || null, email, telephone || null, date_debut || null, nb_jours || null, message]);
    res.status(201).json({ message: 'Demande envoyée. Un responsable vous répond dans la journée ouvrable.' });
  }));

module.exports = router;
