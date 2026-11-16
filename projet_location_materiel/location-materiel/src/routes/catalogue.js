// Module 1 – Gestion du parc et des tarifs (+ consultation publique du catalogue)
const router = require('express').Router();
const { body, param, query } = require('express-validator');
const { pool } = require('../config/db');
const valider = require('../middleware/valider');
const { authentifier, autoriser } = require('../middleware/auth');
const { asyncHandler, ErreurApp } = require('../utils/erreurs');
const { verifierPeriode, quantiteDisponible, journaliser } = require('../services/location');

const ETATS = ['disponible', 'loue', 'maintenance', 'hors_service'];

/* ---------------------------- Catégories ---------------------------- */

router.get('/categories', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT c.*, (SELECT COUNT(*) FROM materiels m WHERE m.categorie_id = c.id AND m.actif = 1) AS nb_materiels
       FROM categories c ORDER BY c.nom`
  );
  res.json(rows);
}));

const reglesCategorie = [
  body('nom').trim().notEmpty().withMessage('Le nom de la catégorie est obligatoire.').isLength({ max: 80 }),
  body('description').optional({ values: 'null' }).trim().isLength({ max: 255 }),
];

router.post('/categories', authentifier, autoriser('administrateur'), reglesCategorie, valider,
  asyncHandler(async (req, res) => {
    try {
      const [r] = await pool.query('INSERT INTO categories (nom, description) VALUES (?, ?)',
        [req.body.nom, req.body.description || null]);
      res.status(201).json({ id: r.insertId, message: 'Catégorie ajoutée.' });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') throw new ErreurApp(409, 'Cette catégorie existe déjà.');
      throw e;
    }
  }));

router.put('/categories/:id', authentifier, autoriser('administrateur'),
  [param('id').isInt(), ...reglesCategorie], valider,
  asyncHandler(async (req, res) => {
    const [r] = await pool.query('UPDATE categories SET nom = ?, description = ? WHERE id = ?',
      [req.body.nom, req.body.description || null, req.params.id]);
    if (!r.affectedRows) throw new ErreurApp(404, 'Catégorie introuvable.');
    res.json({ message: 'Catégorie modifiée.' });
  }));

router.delete('/categories/:id', authentifier, autoriser('administrateur'), [param('id').isInt()], valider,
  asyncHandler(async (req, res) => {
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM materiels WHERE categorie_id = ?', [req.params.id]);
    if (n > 0) throw new ErreurApp(409, 'Impossible de supprimer : des équipements utilisent cette catégorie.');
    const [r] = await pool.query('DELETE FROM categories WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) throw new ErreurApp(404, 'Catégorie introuvable.');
    res.json({ message: 'Catégorie supprimée.' });
  }));

/* ---------------------------- Matériel ---------------------------- */

// GET /api/materiels?categorie=1&recherche=dell&debut=2026-11-10&fin=2026-11-12
// Si debut et fin sont fournis, la quantité disponible sur la période est calculée.
router.get('/materiels',
  [
    query('categorie').optional({ values: 'falsy' }).isInt(),
    query('debut').optional({ values: 'falsy' }).isISO8601(),
    query('fin').optional({ values: 'falsy' }).isISO8601(),
  ],
  valider,
  asyncHandler(async (req, res) => {
    const { categorie, recherche, debut, fin } = req.query;
    const conditions = ['m.actif = 1'];
    const params = [];
    if (categorie) { conditions.push('m.categorie_id = ?'); params.push(categorie); }
    if (recherche) { conditions.push('(m.nom LIKE ? OR m.description LIKE ?)'); params.push(`%${recherche}%`, `%${recherche}%`); }

    const [rows] = await pool.query(
      `SELECT m.*, c.nom AS categorie FROM materiels m JOIN categories c ON c.id = m.categorie_id
        WHERE ${conditions.join(' AND ')} ORDER BY c.nom, m.nom`,
      params
    );

    if (debut && fin) {
      verifierPeriode(debut, fin);
      for (const m of rows) {
        m.disponible_periode = (await quantiteDisponible(pool, m.id, debut, fin)).disponible;
      }
    }
    res.json(rows);
  }));

router.get('/materiels/:id', [param('id').isInt()], valider, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT m.*, c.nom AS categorie FROM materiels m JOIN categories c ON c.id = m.categorie_id
      WHERE m.id = ? AND m.actif = 1`, [req.params.id]);
  if (!rows.length) throw new ErreurApp(404, 'Équipement introuvable.');
  res.json(rows[0]);
}));

const reglesMateriel = [
  body('nom').trim().notEmpty().withMessage('Le nom est obligatoire.').isLength({ max: 120 }),
  body('description').optional({ values: 'null' }).trim().isLength({ max: 2000 }),
  body('categorie_id').isInt({ min: 1 }).withMessage('Catégorie invalide.'),
  body('quantite_totale').isInt({ min: 0, max: 10000 }).withMessage('Quantité invalide.').toInt(),
  body('tarif_journalier').isFloat({ min: 0, max: 100000 }).withMessage('Tarif journalier invalide.').toFloat(),
  body('etat').optional().isIn(ETATS).withMessage('État invalide.'),
];

router.post('/materiels', authentifier, autoriser('administrateur'), reglesMateriel, valider,
  asyncHandler(async (req, res) => {
    const { nom, description, categorie_id, quantite_totale, tarif_journalier, etat } = req.body;
    const [r] = await pool.query(
      `INSERT INTO materiels (nom, description, categorie_id, quantite_totale, tarif_journalier, etat)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [nom, description || null, categorie_id, quantite_totale, tarif_journalier, etat || 'disponible']
    );
    await journaliser(pool, { utilisateurId: req.user.id, action: 'MATERIEL_AJOUTE', details: `${nom} (#${r.insertId})` });
    res.status(201).json({ id: r.insertId, message: 'Équipement ajouté.' });
  }));

router.put('/materiels/:id', authentifier, autoriser('administrateur'), [param('id').isInt(), ...reglesMateriel], valider,
  asyncHandler(async (req, res) => {
    const { nom, description, categorie_id, quantite_totale, tarif_journalier, etat } = req.body;
    const [[ancien]] = await pool.query('SELECT tarif_journalier FROM materiels WHERE id = ? AND actif = 1', [req.params.id]);
    if (!ancien) throw new ErreurApp(404, 'Équipement introuvable.');
    await pool.query(
      `UPDATE materiels SET nom = ?, description = ?, categorie_id = ?, quantite_totale = ?, tarif_journalier = ?,
              etat = COALESCE(?, etat) WHERE id = ?`,
      [nom, description || null, categorie_id, quantite_totale, tarif_journalier, etat || null, req.params.id]
    );
    if (Number(ancien.tarif_journalier) !== Number(tarif_journalier)) {
      await journaliser(pool, { utilisateurId: req.user.id, action: 'TARIF_MODIFIE',
        details: `${nom} : ${ancien.tarif_journalier} $ → ${tarif_journalier} $` });
    }
    res.json({ message: 'Équipement modifié. Les réservations existantes conservent leur tarif d\'origine.' });
  }));

// Retrait du parc : suppression logique pour conserver l'historique des locations
router.delete('/materiels/:id', authentifier, autoriser('administrateur'), [param('id').isInt()], valider,
  asyncHandler(async (req, res) => {
    const [[{ n }]] = await pool.query(
      `SELECT COUNT(*) AS n FROM details_location d JOIN reservations r ON r.id = d.reservation_id
        WHERE d.materiel_id = ? AND r.statut IN ('en_attente','validee','confirmee','en_cours')`, [req.params.id]);
    if (n > 0) throw new ErreurApp(409, 'Impossible de retirer : des réservations actives utilisent cet équipement.');
    const [r] = await pool.query('UPDATE materiels SET actif = 0 WHERE id = ? AND actif = 1', [req.params.id]);
    if (!r.affectedRows) throw new ErreurApp(404, 'Équipement introuvable.');
    await journaliser(pool, { utilisateurId: req.user.id, action: 'MATERIEL_RETIRE', details: `#${req.params.id}` });
    res.json({ message: 'Équipement retiré du parc.' });
  }));

// PATCH /api/materiels/:id/etat — mise en maintenance / hors service (responsable ou admin)
router.patch('/materiels/:id/etat', authentifier, autoriser('responsable', 'administrateur'),
  [param('id').isInt(), body('etat').isIn(['disponible', 'maintenance', 'hors_service']).withMessage('État invalide.')],
  valider,
  asyncHandler(async (req, res) => {
    const [r] = await pool.query('UPDATE materiels SET etat = ? WHERE id = ? AND actif = 1', [req.body.etat, req.params.id]);
    if (!r.affectedRows) throw new ErreurApp(404, 'Équipement introuvable.');
    await journaliser(pool, { utilisateurId: req.user.id, action: 'ETAT_MATERIEL', details: `#${req.params.id} → ${req.body.etat}` });
    res.json({ message: 'État mis à jour.' });
  }));

module.exports = router;
