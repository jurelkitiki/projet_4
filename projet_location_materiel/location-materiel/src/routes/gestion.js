// Modules 3 et 5 – Validation des demandes, remise, retour et pénalités (responsable / administrateur)
const router = require('express').Router();
const { body, param, query } = require('express-validator');
const { pool, transaction } = require('../config/db');
const valider = require('../middleware/valider');
const { authentifier, autoriser } = require('../middleware/auth');
const { asyncHandler, ErreurApp } = require('../utils/erreurs');
const loc = require('../services/location');

router.use(authentifier, autoriser('responsable', 'administrateur'));

const STATUTS = ['en_attente', 'validee', 'refusee', 'annulee', 'confirmee', 'en_cours', 'terminee'];

// Verrouille et renvoie une réservation, en vérifiant son statut
async function reservationVerrouillee(conn, id, statutsPermis) {
  const [[r]] = await conn.query('SELECT * FROM reservations WHERE id = ? FOR UPDATE', [id]);
  if (!r) throw new ErreurApp(404, 'Réservation introuvable.');
  if (statutsPermis && !statutsPermis.includes(r.statut)) {
    throw new ErreurApp(409, `Action impossible : la réservation est au statut « ${r.statut} ».`);
  }
  return r;
}

const lignesDe = async (conn, id) =>
  (await conn.query(
    `SELECT d.*, m.nom AS materiel FROM details_location d JOIN materiels m ON m.id = d.materiel_id
      WHERE d.reservation_id = ? ORDER BY d.materiel_id`, [id]))[0];

/* --------------------------- Consultation --------------------------- */

// GET /api/gestion/reservations?statut=en_attente&recherche=gagnon
router.get('/reservations',
  [query('statut').optional({ values: 'falsy' }).isIn(STATUTS)], valider,
  asyncHandler(async (req, res) => {
    const cond = [];
    const params = [];
    if (req.query.statut) { cond.push('r.statut = ?'); params.push(req.query.statut); }
    if (req.query.annulation === '1') cond.push('r.demande_annulation = 1');
    if (req.query.recherche) {
      cond.push("(CONCAT(u.prenom, ' ', u.nom) LIKE ? OR u.email LIKE ? OR r.id = ?)");
      params.push(`%${req.query.recherche}%`, `%${req.query.recherche}%`, Number(req.query.recherche) || 0);
    }
    const [rows] = await pool.query(
      `SELECT r.*, CONCAT(u.prenom, ' ', u.nom) AS client, u.email,
              (SELECT GROUP_CONCAT(CONCAT(d.quantite, ' × ', m.nom) SEPARATOR ', ')
                 FROM details_location d JOIN materiels m ON m.id = d.materiel_id WHERE d.reservation_id = r.id) AS resume,
              (SELECT p.statut FROM paiements p WHERE p.reservation_id = r.id AND p.type = 'location'
                ORDER BY p.id DESC LIMIT 1) AS statut_paiement,
              (r.statut = 'en_cours' AND r.date_fin < CURDATE()) AS en_retard
         FROM reservations r JOIN utilisateurs u ON u.id = r.utilisateur_id
        ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
        ORDER BY r.date_debut, r.id LIMIT 500`,
      params
    );
    res.json(rows);
  }));

/* --------------------- Module 3 : validation --------------------- */

// POST /api/gestion/reservations/:id/valider
// Vérifie la disponibilité (avec verrous) puis bloque temporairement le matériel jusqu'au paiement.
router.post('/reservations/:id/valider', [param('id').isInt()], valider, asyncHandler(async (req, res) => {
  const delai = Number(process.env.PAIEMENT_DELAI_MINUTES || 30);
  await transaction(async (conn) => {
    const r = await reservationVerrouillee(conn, req.params.id, ['en_attente']);
    if (r.date_debut < loc.aujourdhui()) throw new ErreurApp(409, 'La date de début est dépassée : refusez cette demande.');
    for (const l of await lignesDe(conn, r.id)) {
      const { disponible } = await loc.quantiteDisponible(conn, l.materiel_id, r.date_debut, r.date_fin,
        { exclureReservation: r.id, verrou: true });
      if (l.quantite > disponible) {
        throw new ErreurApp(409, `Quantité insuffisante pour « ${l.materiel} » (${disponible} disponible(s)). Refusez la demande ou attendez une libération.`);
      }
    }
    await conn.query(
      `UPDATE reservations SET statut = 'validee', valide_par = ?, valide_le = NOW(),
              expiration_paiement = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?`,
      [req.user.id, delai, r.id]
    );
    await loc.journaliser(conn, { reservationId: r.id, utilisateurId: req.user.id, action: 'DEMANDE_VALIDEE',
      details: `Matériel bloqué ${delai} min en attente du paiement` });
  });
  res.json({ message: `Demande validée. Le client dispose de ${delai} minutes pour payer.` });
}));

router.post('/reservations/:id/refuser',
  [param('id').isInt(), body('motif').trim().notEmpty().withMessage('Indiquez le motif du refus.').isLength({ max: 255 })],
  valider,
  asyncHandler(async (req, res) => {
    await transaction(async (conn) => {
      const r = await reservationVerrouillee(conn, req.params.id, ['en_attente', 'validee']);
      await conn.query(
        "UPDATE reservations SET statut = 'refusee', motif = ?, valide_par = ?, valide_le = NOW(), expiration_paiement = NULL WHERE id = ?",
        [req.body.motif, req.user.id, r.id]);
      await loc.journaliser(conn, { reservationId: r.id, utilisateurId: req.user.id, action: 'DEMANDE_REFUSEE', details: req.body.motif });
    });
    res.json({ message: 'Demande refusée. Le client verra le motif dans ses réservations.' });
  }));

// Traitement d'une demande d'annulation d'une réservation déjà payée
router.post('/reservations/:id/annulation',
  [param('id').isInt(), body('decision').isIn(['accepter', 'refuser']).withMessage('Décision invalide.')],
  valider,
  asyncHandler(async (req, res) => {
    await transaction(async (conn) => {
      const r = await reservationVerrouillee(conn, req.params.id, ['confirmee']);
      if (!r.demande_annulation) throw new ErreurApp(409, 'Aucune demande d\'annulation pour cette réservation.');
      if (req.body.decision === 'accepter') {
        await conn.query("UPDATE reservations SET statut = 'annulee', demande_annulation = 0 WHERE id = ?", [r.id]);
        await loc.journaliser(conn, { reservationId: r.id, utilisateurId: req.user.id, action: 'ANNULATION_ACCEPTEE',
          details: `Remboursement simulé de ${Number(r.montant_total).toFixed(2)} $` });
      } else {
        await conn.query('UPDATE reservations SET demande_annulation = 0 WHERE id = ?', [r.id]);
        await loc.journaliser(conn, { reservationId: r.id, utilisateurId: req.user.id, action: 'ANNULATION_REFUSEE' });
      }
    });
    res.json({ message: req.body.decision === 'accepter' ? 'Annulation acceptée, matériel libéré.' : 'Demande d\'annulation refusée.' });
  }));

/* ---------------- Module 5 : remise et retour du matériel ---------------- */

// POST /api/gestion/reservations/:id/remise — seulement si confirmée ET paiement initial accepté
router.post('/reservations/:id/remise',
  [param('id').isInt(), body('observations').optional({ values: 'falsy' }).trim().isLength({ max: 255 })], valider,
  asyncHandler(async (req, res) => {
    await transaction(async (conn) => {
      const r = await reservationVerrouillee(conn, req.params.id, ['confirmee']);
      if (r.demande_annulation) throw new ErreurApp(409, 'Une demande d\'annulation est en attente : traitez-la d\'abord.');
      const [[paye]] = await conn.query(
        "SELECT id FROM paiements WHERE reservation_id = ? AND type = 'location' AND statut = 'accepte' LIMIT 1", [r.id]);
      if (!paye) throw new ErreurApp(409, 'Le paiement initial n\'a pas été accepté : remise impossible.');
      if (r.date_fin < loc.aujourdhui()) throw new ErreurApp(409, 'La période de location est terminée.');

      for (const l of await lignesDe(conn, r.id)) {
        const [[m]] = await conn.query('SELECT etat FROM materiels WHERE id = ? FOR UPDATE', [l.materiel_id]);
        if (m.etat === 'maintenance' || m.etat === 'hors_service') {
          throw new ErreurApp(409, `« ${l.materiel} » est en ${m.etat.replace('_', ' ')} : remise impossible.`);
        }
      }
      await conn.query('INSERT INTO remises (reservation_id, responsable_id, observations) VALUES (?, ?, ?)',
        [r.id, req.user.id, req.body.observations || null]);
      await conn.query("UPDATE reservations SET statut = 'en_cours' WHERE id = ?", [r.id]);
      for (const l of await lignesDe(conn, r.id)) await loc.actualiserEtatMateriel(conn, l.materiel_id);
      await loc.journaliser(conn, { reservationId: r.id, utilisateurId: req.user.id, action: 'MATERIEL_REMIS', details: req.body.observations || null });
    });
    res.json({ message: 'Remise du matériel enregistrée.' });
  }));

// POST /api/gestion/reservations/:id/retour
// Calcule automatiquement la pénalité de retard ; une pénalité de dommage peut être ajoutée.
router.post('/reservations/:id/retour',
  [
    param('id').isInt(),
    body('date_retour_effective').isISO8601().withMessage('Date de retour invalide.'),
    body('etat_materiel').isIn(['bon', 'endommage']).withMessage('État du matériel invalide.'),
    body('observations').optional({ values: 'falsy' }).trim().isLength({ max: 255 }),
    body('montant_dommage').optional({ values: 'falsy' }).isFloat({ min: 0, max: 100000 }).withMessage('Montant du dommage invalide.').toFloat(),
    body('materiels_maintenance').optional().isArray(),
    body('materiels_maintenance.*').isInt(),
  ],
  valider,
  asyncHandler(async (req, res) => {
    const multiplicateur = Number(process.env.PENALITE_MULTIPLICATEUR_RETARD || 1.5);
    const { date_retour_effective: dateRetour, etat_materiel: etat, observations } = req.body;
    const montantDommage = Number(req.body.montant_dommage || 0);
    if (dateRetour > loc.aujourdhui()) throw new ErreurApp(400, 'La date de retour ne peut pas être dans le futur.');

    const resultat = await transaction(async (conn) => {
      const r = await reservationVerrouillee(conn, req.params.id, ['en_cours']);
      if (dateRetour < r.date_debut) throw new ErreurApp(400, 'La date de retour est antérieure au début de la location.');
      const lignes = await lignesDe(conn, r.id);
      const joursRetard = Math.max(0, loc.nombreDeJours(r.date_fin, dateRetour) - 1);

      await conn.query(
        `INSERT INTO retours (reservation_id, date_retour_effective, etat_materiel, jours_retard, observations, responsable_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [r.id, dateRetour, etat, joursRetard, observations || null, req.user.id]);

      const penalites = [];
      if (joursRetard > 0) {
        const tarifJour = lignes.reduce((s, l) => s + Number(l.tarif_applique) * l.quantite, 0);
        const montant = Math.round(tarifJour * joursRetard * multiplicateur * 100) / 100;
        const desc = `${joursRetard} jour(s) de retard × ${tarifJour.toFixed(2)} $/jour × ${multiplicateur}`;
        await conn.query(
          "INSERT INTO penalites (reservation_id, type, montant, description, cree_par) VALUES (?, 'retard', ?, ?, ?)",
          [r.id, montant, desc, req.user.id]);
        penalites.push({ type: 'retard', montant, description: desc });
      }
      if (etat === 'endommage' && montantDommage > 0) {
        const desc = observations || 'Matériel endommagé';
        await conn.query(
          "INSERT INTO penalites (reservation_id, type, montant, description, cree_par) VALUES (?, 'dommage', ?, ?, ?)",
          [r.id, montantDommage, desc, req.user.id]);
        penalites.push({ type: 'dommage', montant: montantDommage, description: desc });
      }

      await conn.query("UPDATE reservations SET statut = 'terminee' WHERE id = ?", [r.id]);

      // Matériel endommagé : mise en maintenance des équipements indiqués, sinon remise en disponibilité
      const enMaintenance = (req.body.materiels_maintenance || []).map(Number)
        .filter((id) => lignes.some((l) => l.materiel_id === id));
      for (const id of enMaintenance) await conn.query("UPDATE materiels SET etat = 'maintenance' WHERE id = ?", [id]);
      for (const l of lignes) await loc.actualiserEtatMateriel(conn, l.materiel_id);

      await loc.journaliser(conn, { reservationId: r.id, utilisateurId: req.user.id, action: 'RETOUR_ENREGISTRE',
        details: `Retour le ${dateRetour}, état : ${etat}${joursRetard ? `, ${joursRetard} j de retard` : ''}` });
      for (const p of penalites) {
        await loc.journaliser(conn, { reservationId: r.id, utilisateurId: req.user.id, action: 'PENALITE',
          details: `${p.type} : ${p.montant.toFixed(2)} $` });
      }
      return { jours_retard: joursRetard, penalites };
    });
    res.json({ message: 'Retour enregistré.', ...resultat });
  }));

/* ------------------------------ Pénalités ------------------------------ */

router.get('/penalites', [query('statut').optional({ values: 'falsy' }).isIn(['non_reglee', 'reglee'])], valider,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT pe.*, CONCAT(u.prenom, ' ', u.nom) AS client, u.email
         FROM penalites pe JOIN reservations r ON r.id = pe.reservation_id JOIN utilisateurs u ON u.id = r.utilisateur_id
        ${req.query.statut ? 'WHERE pe.statut = ?' : ''} ORDER BY pe.cree_le DESC`,
      req.query.statut ? [req.query.statut] : []);
    res.json(rows);
  }));

// Ajout manuel d'une pénalité (ex. dommage constaté après coup)
router.post('/reservations/:id/penalites',
  [
    param('id').isInt(),
    body('type').isIn(['retard', 'dommage']).withMessage('Type de pénalité invalide.'),
    body('montant').isFloat({ min: 0.01, max: 100000 }).withMessage('Montant invalide.').toFloat(),
    body('description').trim().notEmpty().withMessage('Décrivez la pénalité.').isLength({ max: 255 }),
  ],
  valider,
  asyncHandler(async (req, res) => {
    await transaction(async (conn) => {
      await reservationVerrouillee(conn, req.params.id, ['en_cours', 'terminee']);
      await conn.query('INSERT INTO penalites (reservation_id, type, montant, description, cree_par) VALUES (?, ?, ?, ?, ?)',
        [req.params.id, req.body.type, req.body.montant, req.body.description, req.user.id]);
      await loc.journaliser(conn, { reservationId: Number(req.params.id), utilisateurId: req.user.id, action: 'PENALITE',
        details: `${req.body.type} : ${req.body.montant.toFixed(2)} $` });
    });
    res.status(201).json({ message: 'Pénalité enregistrée.' });
  }));

// Règlement simulé d'une pénalité au comptoir (enregistré par le responsable)
router.post('/penalites/:id/regler', [param('id').isInt()], valider, asyncHandler(async (req, res) => {
  const reference = await transaction(async (conn) => {
    const [[p]] = await conn.query('SELECT * FROM penalites WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!p) throw new ErreurApp(404, 'Pénalité introuvable.');
    if (p.statut === 'reglee') throw new ErreurApp(409, 'Cette pénalité est déjà réglée.');
    const ref = loc.referenceTransaction('PEN');
    await conn.query(
      `INSERT INTO paiements (reservation_id, penalite_id, type, montant, mode, statut, reference)
       VALUES (?, ?, 'penalite', ?, 'comptoir_simule', 'accepte', ?)`, [p.reservation_id, p.id, p.montant, ref]);
    await conn.query("UPDATE penalites SET statut = 'reglee' WHERE id = ?", [p.id]);
    await loc.journaliser(conn, { reservationId: p.reservation_id, utilisateurId: req.user.id, action: 'PENALITE_REGLEE',
      details: `${Number(p.montant).toFixed(2)} $ au comptoir (${ref})` });
    return ref;
  });
  res.json({ message: 'Règlement de la pénalité enregistré.', reference });
}));

module.exports = router;
