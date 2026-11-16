require('dotenv').config();
const path = require('path');
const express = require('express');
const { pool } = require('./config/db');
const { journaliser } = require('./services/location');

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET manquant : copiez .env.example en .env');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '100kb' }));

// En-têtes de sécurité de base
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// API
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/catalogue'));
app.use('/api/reservations', require('./routes/reservations'));
app.use('/api/paiements', require('./routes/paiements'));
app.use('/api/gestion', require('./routes/gestion'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/contact', require('./routes/contact'));
app.use('/api', (req, res) => res.status(404).json({ message: 'Route introuvable.' }));

// Front-end (HTML/CSS/JS statiques)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Gestion centralisée des erreurs
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'JSON invalide.' });
  if (err.status) return res.status(err.status).json({ message: err.message });
  console.error(err);
  res.status(500).json({ message: 'Erreur interne du serveur.' });
});

// Tâche périodique : annule les réservations validées dont le délai de paiement est expiré
async function annulerPaiementsExpires() {
  try {
    const [rows] = await pool.query(
      "SELECT id FROM reservations WHERE statut = 'validee' AND expiration_paiement <= NOW()");
    for (const { id } of rows) {
      const [r] = await pool.query(
        "UPDATE reservations SET statut = 'annulee', motif = 'Délai de paiement expiré', expiration_paiement = NULL WHERE id = ? AND statut = 'validee'",
        [id]);
      if (r.affectedRows) await journaliser(pool, { reservationId: id, action: 'PAIEMENT_EXPIRE', details: 'Réservation annulée, matériel libéré' });
    }
  } catch (e) {
    console.error('Vérification des expirations :', e.message);
  }
}

const PORT = Number(process.env.PORT || 3000);
if (require.main === module) {
  app.listen(PORT, () => console.log(`Serveur démarré : http://localhost:${PORT}`));
  setInterval(annulerPaiementsExpires, 60 * 1000);
  annulerPaiementsExpires();
}

module.exports = app;
