const { validationResult } = require('express-validator');

// À placer après les règles express-validator : renvoie 400 si une donnée est invalide
function valider(req, res, next) {
  const erreurs = validationResult(req);
  if (!erreurs.isEmpty()) {
    return res.status(400).json({
      message: erreurs.array()[0].msg,
      erreurs: erreurs.array().map((e) => ({ champ: e.path, message: e.msg })),
    });
  }
  next();
}

module.exports = valider;
