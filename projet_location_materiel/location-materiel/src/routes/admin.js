// Administration : utilisateurs et rôles, transactions, statistiques (Module 6)
const router = require('express').Router();
const { body, param, query } = require('express-validator');
const { pool } = require('../config/db');
const valider = require('../middleware/valider');
const { authentifier, autoriser } = require('../middleware/auth');
const { asyncHandler, ErreurApp } = require('../utils/erreurs');
const { journaliser } = require('../services/location');

router.use(authentifier, autoriser('administrateur'));

/* ---------------------- Utilisateurs et rôles ---------------------- */

router.get('/utilisateurs', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT u.id, u.nom, u.prenom, u.email, u.telephone, u.actif, u.cree_le, r.nom AS role,
            (SELECT COUNT(*) FROM reservations x WHERE x.utilisateur_id = u.id) AS nb_reservations
       FROM utilisateurs u JOIN roles r ON r.id = u.role_id ORDER BY r.id DESC, u.nom`);
  res.json(rows);
}));

router.patch('/utilisateurs/:id',
  [
    param('id').isInt(),
    body('role').optional().isIn(['client', 'responsable', 'administrateur']).withMessage('Rôle invalide.'),
    body('actif').optional().isBoolean().withMessage('Valeur invalide.').toBoolean(),
  ],
  valider,
  asyncHandler(async (req, res) => {
    if (Number(req.params.id) === req.user.id) throw new ErreurApp(409, 'Vous ne pouvez pas modifier votre propre rôle ou statut.');
    const sets = [];
    const params = [];
    if (req.body.role) { sets.push('role_id = (SELECT id FROM roles WHERE nom = ?)'); params.push(req.body.role); }
    if (req.body.actif !== undefined) { sets.push('actif = ?'); params.push(req.body.actif ? 1 : 0); }
    if (!sets.length) throw new ErreurApp(400, 'Aucune modification fournie.');
    const [r] = await pool.query(`UPDATE utilisateurs SET ${sets.join(', ')} WHERE id = ?`, [...params, req.params.id]);
    if (!r.affectedRows) throw new ErreurApp(404, 'Utilisateur introuvable.');
    await journaliser(pool, { utilisateurId: req.user.id, action: 'UTILISATEUR_MODIFIE',
      details: `#${req.params.id} ${JSON.stringify(req.body)}` });
    res.json({ message: 'Utilisateur mis à jour.' });
  }));

/* --------------------------- Transactions --------------------------- */

router.get('/transactions',
  [query('statut').optional({ values: 'falsy' }).isIn(['en_attente', 'accepte', 'refuse']),
    query('type').optional({ values: 'falsy' }).isIn(['location', 'penalite'])],
  valider,
  asyncHandler(async (req, res) => {
    const cond = [];
    const params = [];
    if (req.query.statut) { cond.push('p.statut = ?'); params.push(req.query.statut); }
    if (req.query.type) { cond.push('p.type = ?'); params.push(req.query.type); }
    const [rows] = await pool.query(
      `SELECT p.*, r.statut AS statut_reservation, CONCAT(u.prenom, ' ', u.nom) AS client, u.email
         FROM paiements p JOIN reservations r ON r.id = p.reservation_id JOIN utilisateurs u ON u.id = r.utilisateur_id
        ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY p.date_paiement DESC, p.id DESC LIMIT 1000`, params);
    res.json(rows);
  }));

router.get('/historique', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT h.*, CONCAT(u.prenom, ' ', u.nom) AS auteur FROM historique h
       LEFT JOIN utilisateurs u ON u.id = h.utilisateur_id ORDER BY h.date_action DESC, h.id DESC LIMIT 200`);
  res.json(rows);
}));

/* ------------------------ Demandes de conseil ------------------------ */

router.get('/contacts', asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM demandes_contact ORDER BY statut, cree_le DESC LIMIT 500');
  res.json(rows);
}));

router.patch('/contacts/:id',
  [param('id').isInt(), body('statut').isIn(['nouvelle', 'traitee']).withMessage('Statut invalide.')], valider,
  asyncHandler(async (req, res) => {
    const [r] = await pool.query('UPDATE demandes_contact SET statut = ? WHERE id = ?', [req.body.statut, req.params.id]);
    if (!r.affectedRows) throw new ErreurApp(404, 'Demande introuvable.');
    res.json({ message: req.body.statut === 'traitee' ? 'Demande marquée comme traitée.' : 'Demande remise à traiter.' });
  }));

/* ---------------------------- Statistiques ---------------------------- */

router.get('/statistiques', asyncHandler(async (req, res) => {
  const [parStatut] = await pool.query('SELECT statut, COUNT(*) AS nb FROM reservations GROUP BY statut');

  const [[revenus]] = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN p.type = 'location' THEN p.montant END), 0) AS locations,
            COALESCE(SUM(CASE WHEN p.type = 'penalite' THEN p.montant END), 0) AS penalites
       FROM paiements p JOIN reservations r ON r.id = p.reservation_id
      WHERE p.statut = 'accepte' AND NOT (p.type = 'location' AND r.statut = 'annulee')`);
  const [[rembourse]] = await pool.query(
    `SELECT COALESCE(SUM(p.montant), 0) AS montant FROM paiements p JOIN reservations r ON r.id = p.reservation_id
      WHERE p.statut = 'accepte' AND p.type = 'location' AND r.statut = 'annulee'`);

  const [revenusParMois] = await pool.query(
    `SELECT DATE_FORMAT(p.date_paiement, '%Y-%m') AS mois, SUM(p.montant) AS montant
       FROM paiements p JOIN reservations r ON r.id = p.reservation_id
      WHERE p.statut = 'accepte' AND NOT (p.type = 'location' AND r.statut = 'annulee')
      GROUP BY mois ORDER BY mois DESC LIMIT 12`);

  const [plusDemandes] = await pool.query(
    `SELECT m.id, m.nom, SUM(d.quantite) AS quantite_louee, COUNT(DISTINCT d.reservation_id) AS nb_reservations,
            SUM(d.montant_ligne) AS revenus
       FROM details_location d JOIN reservations r ON r.id = d.reservation_id JOIN materiels m ON m.id = d.materiel_id
      WHERE r.statut IN ('confirmee', 'en_cours', 'terminee')
      GROUP BY m.id, m.nom ORDER BY quantite_louee DESC LIMIT 10`);

  // Taux de disponibilité aujourd'hui : unités utilisables et non sorties / unités totales du parc
  const [parc] = await pool.query(
    `SELECT m.id, m.nom, m.quantite_totale, m.etat,
            COALESCE((SELECT SUM(d.quantite) FROM details_location d JOIN reservations r ON r.id = d.reservation_id
                       WHERE d.materiel_id = m.id AND r.statut = 'en_cours'), 0) AS sorties
       FROM materiels m WHERE m.actif = 1 ORDER BY m.nom`);
  let total = 0;
  let dispo = 0;
  const disponibilite = parc.map((m) => {
    const utilisable = ['maintenance', 'hors_service'].includes(m.etat) ? 0 : Math.max(0, m.quantite_totale - Number(m.sorties));
    total += m.quantite_totale;
    dispo += utilisable;
    return { ...m, disponibles: utilisable, taux: m.quantite_totale ? utilisable / m.quantite_totale : 0 };
  });

  const [penalites] = await pool.query(
    'SELECT statut, type, COUNT(*) AS nb, SUM(montant) AS montant FROM penalites GROUP BY statut, type');

  const [[retards]] = await pool.query(
    "SELECT COUNT(*) AS nb FROM reservations WHERE statut = 'en_cours' AND date_fin < CURDATE()");

  res.json({
    reservations_par_statut: parStatut,
    revenus: { ...revenus, total: revenus.locations + revenus.penalites, rembourse: rembourse.montant },
    revenus_par_mois: revenusParMois,
    equipements_plus_demandes: plusDemandes,
    taux_disponibilite_global: total ? dispo / total : 0,
    disponibilite,
    penalites,
    locations_en_retard: retards.nb,
  });
}));

module.exports = router;
