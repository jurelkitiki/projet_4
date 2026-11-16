const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

// Vérifie le jeton JWT envoyé dans l'en-tête Authorization: Bearer <jeton>
async function authentifier(req, res, next) {
  const entete = req.headers.authorization || '';
  const jeton = entete.startsWith('Bearer ') ? entete.slice(7) : null;
  if (!jeton) return res.status(401).json({ message: 'Connexion requise.' });

  try {
    const charge = jwt.verify(jeton, process.env.JWT_SECRET);
    // On relit l'utilisateur pour tenir compte d'un changement de rôle ou d'une désactivation
    const [rows] = await pool.query(
      `SELECT u.id, u.nom, u.prenom, u.email, u.actif, r.nom AS role
         FROM utilisateurs u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      [charge.id]
    );
    if (!rows.length || !rows[0].actif) {
      return res.status(401).json({ message: 'Compte introuvable ou désactivé.' });
    }
    req.user = rows[0];
    next();
  } catch {
    return res.status(401).json({ message: 'Session expirée, veuillez vous reconnecter.' });
  }
}

// Restreint une route à un ou plusieurs rôles
const autoriser = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'Accès refusé pour votre rôle.' });
  }
  next();
};

module.exports = { authentifier, autoriser };
