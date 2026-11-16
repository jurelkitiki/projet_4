// Module 2 – Réservation et calcul du coût (côté client)
const router = require('express').Router();
const { body, param } = require('express-validator');
const { pool, transaction } = require('../config/db');
const valider = require('../middleware/valider');
const { authentifier, autoriser } = require('../middleware/auth');
const { asyncHandler, ErreurApp } = require('../utils/erreurs');
const loc = require('../services/location');

// Charge une réservation complète (lignes, paiements, pénalités, remise, retour)
async function chargerReservation(id) {
  const [[r]] = await pool.query(
    `SELECT r.*, u.nom, u.prenom, u.email, u.telephone
       FROM reservations r JOIN utilisateurs u ON u.id = r.utilisateur_id WHERE r.id = ?`, [id]);
  if (!r) return null;
  const [details] = await pool.query(
    `SELECT d.*, m.nom AS materiel, c.nom AS categorie
       FROM details_location d JOIN materiels m ON m.id = d.materiel_id JOIN categories c ON c.id = m.categorie_id
      WHERE d.reservation_id = ? ORDER BY d.id`, [id]);
  const [paiements] = await pool.query('SELECT * FROM paiements WHERE reservation_id = ? ORDER BY date_paiement', [id]);
  const [penalites] = await pool.query('SELECT * FROM penalites WHERE reservation_id = ? ORDER BY cree_le', [id]);
  const [[remise]] = await pool.query('SELECT * FROM remises WHERE reservation_id = ?', [id]);
  const [[retour]] = await pool.query('SELECT * FROM retours WHERE reservation_id = ?', [id]);
  const [historique] = await pool.query(
    `SELECT h.action, h.details, h.date_action, CONCAT(u.prenom, ' ', u.nom) AS auteur
       FROM historique h LEFT JOIN utilisateurs u ON u.id = h.utilisateur_id
      WHERE h.reservation_id = ? ORDER BY h.date_action, h.id`, [id]);
  return { ...r, details, paiements, penalites, remise: remise || null, retour: retour || null, historique };
}

// Calcule les lignes et le total d'un panier ; vérifie la disponibilité de chaque équipement
async function calculerPanier(conn, articles, debut, fin, opts = {}) {
  const jours = loc.verifierPeriode(debut, fin);
  if (!Array.isArray(articles) || !articles.length) throw new ErreurApp(400, 'Sélectionnez au moins un équipement.');

  // Regroupe les doublons (même équipement ajouté deux fois)
  const quantites = new Map();
  for (const a of articles) {
    const id = Number(a.materiel_id);
    const q = Number(a.quantite);
    if (!Number.isInteger(id) || !Number.isInteger(q) || q < 1) throw new ErreurApp(400, 'Quantité ou équipement invalide.');
    quantites.set(id, (quantites.get(id) || 0) + q);
  }

  const lignes = [];
  for (const [materielId, quantite] of [...quantites].sort((a, b) => a[0] - b[0])) {
    const { materiel, disponible } = await loc.quantiteDisponible(conn, materielId, debut, fin, opts);
    const [[m]] = await conn.query('SELECT tarif_journalier FROM materiels WHERE id = ?', [materielId]);
    lignes.push({
      materiel_id: materielId,
      materiel: materiel.nom,
      etat: materiel.etat,
      quantite,
      disponible,
      suffisant: quantite <= disponible,
      tarif_applique: Number(m.tarif_journalier),
      nb_jours: jours,
      montant_ligne: loc.montantLigne(m.tarif_journalier, jours, quantite),
    });
  }
  const total = Math.round(lignes.reduce((s, l) => s + l.montant_ligne, 0) * 100) / 100;
  return { nb_jours: jours, lignes, montant_total: total };
}

const reglesPanier = [
  body('date_debut').isISO8601().withMessage('Date de début invalide.'),
  body('date_fin').isISO8601().withMessage('Date de fin invalide.'),
  body('articles').isArray({ min: 1 }).withMessage('Sélectionnez au moins un équipement.'),
  body('articles.*.materiel_id').isInt({ min: 1 }).withMessage('Équipement invalide.'),
  body('articles.*.quantite').isInt({ min: 1, max: 1000 }).withMessage('Quantité invalide.'),
];

// POST /api/reservations/estimation — calcul du coût et des disponibilités, sans rien enregistrer
router.post('/estimation', reglesPanier, valider, asyncHandler(async (req, res) => {
  const { articles, date_debut, date_fin } = req.body;
  res.json(await calculerPanier(pool, articles, date_debut, date_fin));
}));

// POST /api/reservations — création d'une demande de location (statut en_attente)
router.post('/', authentifier, autoriser('client'), reglesPanier, valider, asyncHandler(async (req, res) => {
  const { articles, date_debut, date_fin } = req.body;
  const id = await transaction(async (conn) => {
    const calc = await calculerPanier(conn, articles, date_debut, date_fin);
    const manquant = calc.lignes.find((l) => !l.suffisant);
    if (manquant) {
      throw new ErreurApp(409, `Quantité insuffisante pour « ${manquant.materiel} » : ${manquant.disponible} disponible(s) sur cette période.`);
    }
    const [r] = await conn.query(
      `INSERT INTO reservations (utilisateur_id, date_debut, date_fin, nb_jours, montant_total, statut)
       VALUES (?, ?, ?, ?, ?, 'en_attente')`,
      [req.user.id, date_debut, date_fin, calc.nb_jours, calc.montant_total]
    );
    for (const l of calc.lignes) {
      await conn.query(
        `INSERT INTO details_location (reservation_id, materiel_id, quantite, tarif_applique, nb_jours, montant_ligne)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [r.insertId, l.materiel_id, l.quantite, l.tarif_applique, l.nb_jours, l.montant_ligne]
      );
    }
    await loc.journaliser(conn, { reservationId: r.insertId, utilisateurId: req.user.id, action: 'DEMANDE_CREEE',
      details: `Total ${calc.montant_total.toFixed(2)} $ pour ${calc.nb_jours} jour(s)` });
    return r.insertId;
  });
  res.status(201).json({ id, message: 'Demande de location envoyée. Elle doit être validée par un responsable avant le paiement.' });
}));

// GET /api/reservations/mes — réservations du client connecté
router.get('/mes', authentifier, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT r.*,
            (SELECT GROUP_CONCAT(CONCAT(d.quantite, ' × ', m.nom) SEPARATOR ', ')
               FROM details_location d JOIN materiels m ON m.id = d.materiel_id WHERE d.reservation_id = r.id) AS resume,
            (SELECT statut FROM paiements p WHERE p.reservation_id = r.id AND p.type = 'location'
              ORDER BY p.id DESC LIMIT 1) AS statut_paiement,
            (SELECT COALESCE(SUM(montant), 0) FROM penalites pe WHERE pe.reservation_id = r.id AND pe.statut = 'non_reglee') AS penalites_dues
       FROM reservations r WHERE r.utilisateur_id = ? ORDER BY r.cree_le DESC, r.id DESC`,
    [req.user.id]
  );
  res.json(rows);
}));

// GET /api/reservations/penalites — pénalités du client connecté
router.get('/penalites', authentifier, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT pe.* FROM penalites pe JOIN reservations r ON r.id = pe.reservation_id
      WHERE r.utilisateur_id = ? ORDER BY pe.cree_le DESC`, [req.user.id]);
  res.json(rows);
}));

// GET /api/reservations/:id — détail (propriétaire, responsable ou admin)
router.get('/:id', authentifier, [param('id').isInt()], valider, asyncHandler(async (req, res) => {
  const r = await chargerReservation(req.params.id);
  if (!r) throw new ErreurApp(404, 'Réservation introuvable.');
  if (req.user.role === 'client' && r.utilisateur_id !== req.user.id) throw new ErreurApp(403, 'Accès refusé.');
  res.json(r);
}));

// POST /api/reservations/:id/annuler
// - en attente ou validée (non payée) : annulation immédiate
// - confirmée (payée, pas encore remise) : demande d'annulation à traiter par un responsable
router.post('/:id/annuler', authentifier, autoriser('client'),
  [param('id').isInt(), body('motif').optional({ values: 'falsy' }).trim().isLength({ max: 255 })], valider,
  asyncHandler(async (req, res) => {
    const message = await transaction(async (conn) => {
      const [[r]] = await conn.query('SELECT * FROM reservations WHERE id = ? FOR UPDATE', [req.params.id]);
      if (!r || r.utilisateur_id !== req.user.id) throw new ErreurApp(404, 'Réservation introuvable.');
      const motif = req.body.motif || 'Annulée par le client';

      if (['en_attente', 'validee'].includes(r.statut)) {
        await conn.query("UPDATE reservations SET statut = 'annulee', motif = ?, expiration_paiement = NULL WHERE id = ?", [motif, r.id]);
        await loc.journaliser(conn, { reservationId: r.id, utilisateurId: req.user.id, action: 'ANNULATION', details: motif });
        return 'Réservation annulée. Le matériel est de nouveau disponible.';
      }
      if (r.statut === 'confirmee') {
        if (r.demande_annulation) throw new ErreurApp(409, 'Une demande d\'annulation est déjà en cours.');
        await conn.query('UPDATE reservations SET demande_annulation = 1, motif = ? WHERE id = ?', [motif, r.id]);
        await loc.journaliser(conn, { reservationId: r.id, utilisateurId: req.user.id, action: 'DEMANDE_ANNULATION', details: motif });
        return 'Demande d\'annulation envoyée au responsable du matériel.';
      }
      throw new ErreurApp(409, 'Cette réservation ne peut plus être annulée.');
    });
    res.json({ message });
  }));

module.exports = router;
module.exports.chargerReservation = chargerReservation;
