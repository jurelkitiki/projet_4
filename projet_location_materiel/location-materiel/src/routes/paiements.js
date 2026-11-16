// Module 4 – Paiement simulé et facturation
// IMPORTANT : aucune donnée de carte n'est enregistrée ni journalisée. Les champs servent uniquement
// à simuler la saisie ; seuls le montant, le statut et une référence sont conservés.
const router = require('express').Router();
const { body, param } = require('express-validator');
const { pool, transaction } = require('../config/db');
const valider = require('../middleware/valider');
const { authentifier, autoriser } = require('../middleware/auth');
const { asyncHandler, ErreurApp } = require('../utils/erreurs');
const loc = require('../services/location');
const { chargerReservation } = require('./reservations');

// Algorithme de Luhn : contrôle de validité du format d'un numéro de carte
function luhnValide(numero) {
  let somme = 0;
  let double = false;
  for (let i = numero.length - 1; i >= 0; i--) {
    let n = Number(numero[i]);
    if (double) { n *= 2; if (n > 9) n -= 9; }
    somme += n;
    double = !double;
  }
  return somme % 10 === 0;
}

// Cartes de test : 4242 4242 4242 4242 = acceptée, 4000 0000 0000 0002 = refusée (fonds insuffisants)
function simulerTransaction(numero) {
  if (numero === '4000000000000002') return { statut: 'refuse', message: 'Paiement refusé par la banque (simulation : fonds insuffisants).' };
  return { statut: 'accepte', message: 'Paiement accepté.' };
}

const reglesCarte = [
  body('titulaire').trim().notEmpty().withMessage('Nom du titulaire requis.').isLength({ max: 100 }),
  body('numero_carte').customSanitizer((v) => String(v || '').replace(/[\s-]/g, ''))
    .matches(/^\d{16}$/).withMessage('Le numéro de carte doit contenir 16 chiffres.')
    .custom(luhnValide).withMessage('Numéro de carte invalide.'),
  body('expiration').matches(/^(0[1-9]|1[0-2])\/\d{2}$/).withMessage('Expiration invalide (MM/AA).')
    .custom((v) => {
      const [mm, aa] = v.split('/').map(Number);
      const fin = new Date(2000 + aa, mm, 1); // 1er jour du mois suivant
      return fin > new Date();
    }).withMessage('La carte est expirée.'),
  body('cvv').matches(/^\d{3,4}$/).withMessage('CVV invalide.'),
];

// POST /api/paiements/reservations/:id — paiement de la location (après validation par le responsable)
router.post('/reservations/:id', authentifier, autoriser('client'), [param('id').isInt(), ...reglesCarte], valider,
  asyncHandler(async (req, res) => {
    const simulation = simulerTransaction(req.body.numero_carte);
    const resultat = await transaction(async (conn) => {
      const [[r]] = await conn.query(
        'SELECT *, (expiration_paiement > NOW()) AS dans_les_temps FROM reservations WHERE id = ? FOR UPDATE', [req.params.id]);
      if (!r || r.utilisateur_id !== req.user.id) throw new ErreurApp(404, 'Réservation introuvable.');
      if (r.statut === 'confirmee') throw new ErreurApp(409, 'Cette réservation est déjà payée.');
      if (r.statut !== 'validee') throw new ErreurApp(409, 'Le paiement n\'est possible qu\'après validation de la demande par le responsable.');
      if (!r.dans_les_temps) {
        await conn.query("UPDATE reservations SET statut = 'annulee', motif = 'Délai de paiement expiré', expiration_paiement = NULL WHERE id = ?", [r.id]);
        await loc.journaliser(conn, { reservationId: r.id, action: 'PAIEMENT_EXPIRE', details: 'Réservation annulée, matériel libéré' });
        return { expire: true };
      }

      const reference = loc.referenceTransaction('PAY');
      const [p] = await conn.query(
        `INSERT INTO paiements (reservation_id, type, montant, mode, statut, reference)
         VALUES (?, 'location', ?, 'carte_simulee', ?, ?)`, [r.id, r.montant_total, simulation.statut, reference]);

      if (simulation.statut === 'accepte') {
        await conn.query("UPDATE reservations SET statut = 'confirmee', expiration_paiement = NULL WHERE id = ?", [r.id]);
        await loc.journaliser(conn, { reservationId: r.id, utilisateurId: req.user.id, action: 'PAIEMENT_ACCEPTE',
          details: `${Number(r.montant_total).toFixed(2)} $ (${reference})` });
      } else {
        await loc.journaliser(conn, { reservationId: r.id, utilisateurId: req.user.id, action: 'PAIEMENT_REFUSE', details: reference });
      }
      return { paiement_id: p.insertId, reference };
    });

    // Le paiement expiré est validé (COMMIT) avant de renvoyer l'erreur, pour libérer le matériel
    if (resultat.expire) throw new ErreurApp(410, 'Le délai de paiement est expiré : la réservation a été annulée. Faites une nouvelle demande.');
    res.status(simulation.statut === 'accepte' ? 201 : 402).json({
      statut: simulation.statut, message: simulation.message, ...resultat,
    });
  }));

// POST /api/paiements/penalites/:id — règlement en ligne simulé d'une pénalité
router.post('/penalites/:id', authentifier, autoriser('client'), [param('id').isInt(), ...reglesCarte], valider,
  asyncHandler(async (req, res) => {
    const simulation = simulerTransaction(req.body.numero_carte);
    const resultat = await transaction(async (conn) => {
      const [[pe]] = await conn.query(
        `SELECT pe.*, r.utilisateur_id FROM penalites pe JOIN reservations r ON r.id = pe.reservation_id
          WHERE pe.id = ? FOR UPDATE`, [req.params.id]);
      if (!pe || pe.utilisateur_id !== req.user.id) throw new ErreurApp(404, 'Pénalité introuvable.');
      if (pe.statut === 'reglee') throw new ErreurApp(409, 'Cette pénalité est déjà réglée.');
      const reference = loc.referenceTransaction('PEN');
      const [p] = await conn.query(
        `INSERT INTO paiements (reservation_id, penalite_id, type, montant, mode, statut, reference)
         VALUES (?, ?, 'penalite', ?, 'carte_simulee', ?, ?)`, [pe.reservation_id, pe.id, pe.montant, simulation.statut, reference]);
      if (simulation.statut === 'accepte') {
        await conn.query("UPDATE penalites SET statut = 'reglee' WHERE id = ?", [pe.id]);
        await loc.journaliser(conn, { reservationId: pe.reservation_id, utilisateurId: req.user.id, action: 'PENALITE_REGLEE',
          details: `${Number(pe.montant).toFixed(2)} $ en ligne (${reference})` });
      }
      return { paiement_id: p.insertId, reference };
    });
    res.status(simulation.statut === 'accepte' ? 201 : 402).json({ statut: simulation.statut, message: simulation.message, ...resultat });
  }));

// GET /api/paiements/mes — historique des paiements du client
router.get('/mes', authentifier, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.* FROM paiements p JOIN reservations r ON r.id = p.reservation_id
      WHERE r.utilisateur_id = ? ORDER BY p.date_paiement DESC, p.id DESC`, [req.user.id]);
  res.json(rows);
}));

// GET /api/paiements/:id/recu — reçu consultable (propriétaire, responsable ou admin)
router.get('/:id/recu', authentifier, [param('id').isInt()], valider, asyncHandler(async (req, res) => {
  const [[p]] = await pool.query('SELECT * FROM paiements WHERE id = ?', [req.params.id]);
  if (!p) throw new ErreurApp(404, 'Paiement introuvable.');
  const reservation = await chargerReservation(p.reservation_id);
  if (req.user.role === 'client' && reservation.utilisateur_id !== req.user.id) throw new ErreurApp(403, 'Accès refusé.');
  const penalite = p.penalite_id ? reservation.penalites.find((x) => x.id === p.penalite_id) : null;
  delete reservation.historique;
  res.json({ paiement: p, reservation, penalite });
}));

module.exports = router;
