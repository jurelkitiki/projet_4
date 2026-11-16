// Logique métier : dates, calcul des montants, disponibilités, historique
const { ErreurApp } = require('../utils/erreurs');

const UN_JOUR = 24 * 60 * 60 * 1000;

// Statuts qui immobilisent du matériel.
// Une demande "validee" ne bloque le stock que tant que son délai de paiement n'est pas expiré.
const CONDITION_BLOQUANTE = `(
  r.statut IN ('confirmee', 'en_cours')
  OR (r.statut = 'validee' AND r.expiration_paiement > NOW())
)`;

// Date du jour au format AAAA-MM-JJ (heure locale du serveur)
function aujourdhui() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function versDate(chaine) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(chaine || '')) return null;
  const d = new Date(`${chaine}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== chaine ? null : d;
}

// Nombre de jours facturés, bornes incluses (du 10 au 12 = 3 jours)
function nombreDeJours(debut, fin) {
  return Math.round((versDate(fin) - versDate(debut)) / UN_JOUR) + 1;
}

// Vérifie une période de location : dates valides, fin >= début, début pas dans le passé
function verifierPeriode(debut, fin) {
  const d = versDate(debut);
  const f = versDate(fin);
  if (!d || !f) throw new ErreurApp(400, 'Dates invalides (format attendu : AAAA-MM-JJ).');
  if (f < d) throw new ErreurApp(400, 'La date de fin doit être postérieure ou égale à la date de début.');
  if (debut < aujourdhui()) throw new ErreurApp(400, 'La date de début ne peut pas être dans le passé.');
  const jours = nombreDeJours(debut, fin);
  if (jours > 90) throw new ErreurApp(400, 'La durée maximale de location est de 90 jours.');
  return jours;
}

// Montant d'une ligne = tarif journalier × nombre de jours × quantité (arrondi au cent)
function montantLigne(tarif, jours, quantite) {
  return Math.round(Number(tarif) * jours * quantite * 100) / 100;
}

// Quantité encore disponible pour un équipement sur une période.
// conn : connexion (ou pool). Avec verrou=true, la ligne du matériel est verrouillée (SELECT ... FOR UPDATE)
// pour éviter que deux validations simultanées dépassent le stock.
async function quantiteDisponible(conn, materielId, debut, fin, { exclureReservation = null, verrou = false } = {}) {
  const [mats] = await conn.query(
    `SELECT id, nom, quantite_totale, etat, actif FROM materiels WHERE id = ? ${verrou ? 'FOR UPDATE' : ''}`,
    [materielId]
  );
  if (!mats.length || !mats[0].actif) throw new ErreurApp(404, `Équipement #${materielId} introuvable.`);
  const m = mats[0];
  if (m.etat === 'maintenance' || m.etat === 'hors_service') return { materiel: m, disponible: 0 };

  // Chevauchement : début_existant <= fin_demandée ET fin_existante >= début_demandé.
  // Un matériel remis et non rendu (en_cours) reste bloqué au moins jusqu'à aujourd'hui (retard).
  const [rows] = await conn.query(
    `SELECT COALESCE(SUM(d.quantite), 0) AS reserve
       FROM details_location d
       JOIN reservations r ON r.id = d.reservation_id
      WHERE d.materiel_id = ?
        AND ${CONDITION_BLOQUANTE}
        AND r.date_debut <= ?
        AND (CASE WHEN r.statut = 'en_cours' THEN GREATEST(r.date_fin, CURDATE()) ELSE r.date_fin END) >= ?
        AND (? IS NULL OR r.id <> ?)`,
    [materielId, fin, debut, exclureReservation, exclureReservation]
  );
  return { materiel: m, disponible: Math.max(0, m.quantite_totale - Number(rows[0].reserve)) };
}

// Enregistre une action dans l'historique
async function journaliser(conn, { reservationId = null, utilisateurId = null, action, details = null }) {
  await conn.query(
    'INSERT INTO historique (reservation_id, utilisateur_id, action, details) VALUES (?, ?, ?, ?)',
    [reservationId, utilisateurId, action, details]
  );
}

// Met à jour l'état "loue" / "disponible" d'un équipement selon le nombre d'unités actuellement sorties
async function actualiserEtatMateriel(conn, materielId) {
  const [[m]] = await conn.query('SELECT quantite_totale, etat FROM materiels WHERE id = ?', [materielId]);
  if (!m || m.etat === 'maintenance' || m.etat === 'hors_service') return;
  const [[{ sorties }]] = await conn.query(
    `SELECT COALESCE(SUM(d.quantite), 0) AS sorties
       FROM details_location d JOIN reservations r ON r.id = d.reservation_id
      WHERE d.materiel_id = ? AND r.statut = 'en_cours'`,
    [materielId]
  );
  const nouvelEtat = Number(sorties) >= m.quantite_totale && m.quantite_totale > 0 ? 'loue' : 'disponible';
  if (nouvelEtat !== m.etat) await conn.query('UPDATE materiels SET etat = ? WHERE id = ?', [nouvelEtat, materielId]);
}

// Génère une référence de transaction lisible (ex. PAY-20261102-4F7A9C)
function referenceTransaction(prefixe = 'PAY') {
  const jour = aujourdhui().replace(/-/g, '');
  const alea = Math.random().toString(16).slice(2, 8).toUpperCase();
  return `${prefixe}-${jour}-${alea}`;
}

module.exports = {
  CONDITION_BLOQUANTE,
  aujourdhui,
  versDate,
  nombreDeJours,
  verifierPeriode,
  montantLigne,
  quantiteDisponible,
  journaliser,
  actualiserEtatMateriel,
  referenceTransaction,
};
