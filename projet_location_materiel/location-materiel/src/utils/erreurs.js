// Erreur métier avec code HTTP (ex. 400, 403, 404, 409)
class ErreurApp extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Enveloppe un contrôleur async pour transmettre les erreurs à Express
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { ErreurApp, asyncHandler };
