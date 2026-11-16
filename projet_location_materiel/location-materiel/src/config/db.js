const mysql = require('mysql2/promise');

// Pool de connexions MySQL partagé par toute l'application
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'location_materiel',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,      // les dates restent au format 'AAAA-MM-JJ' (pas de décalage de fuseau)
  decimalNumbers: true,   // DECIMAL renvoyé en nombre JS
});

// Exécute une fonction dans une transaction (COMMIT si OK, ROLLBACK sinon)
async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const resultat = await fn(conn);
    await conn.commit();
    return resultat;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, transaction };
