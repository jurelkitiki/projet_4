// Crée la base (schema.sql) puis insère des données de test.
// Utilisation : npm run init-db
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  console.log('Création du schéma...');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')
    .replace(/location_materiel/g, process.env.DB_NAME || 'location_materiel');
  await conn.query(schema);

  console.log('Insertion des données de test...');
  const hash = await bcrypt.hash('Motdepasse123!', 10);
  await conn.query(
    `INSERT INTO utilisateurs (nom, prenom, email, mot_de_passe, telephone, role_id) VALUES
     ('Admin', 'Principal', 'admin@location.test', ?, '514-000-0001', 3),
     ('Tremblay', 'Julie', 'responsable@location.test', ?, '514-000-0002', 2),
     ('Gagnon', 'Marc', 'client@location.test', ?, '514-000-0003', 1),
     ('Roy', 'Sofia', 'client2@location.test', ?, '514-000-0004', 1)`,
    [hash, hash, hash, hash]
  );

  await conn.query(
    `INSERT INTO categories (nom, description) VALUES
     ('Ordinateurs portables', 'Dell, Lenovo et MacBook'),
     ('Projecteurs', 'De la salle de classe à l''auditorium'),
     ('Tablettes', 'iPad et Galaxy Tab, avec étui ou stylet'),
     ('Casques et micros', 'Visioconférence, enregistrement et examens oraux'),
     ('Câbles et adaptateurs', 'HDMI, USB-C et rallonges')`
  );

  await conn.query(
    `INSERT INTO materiels (categorie_id, nom, description, quantite_totale, tarif_journalier, etat) VALUES
     (1, 'Ordinateur portable Dell Latitude 5440', 'Intel i5, 16 Go RAM, SSD 512 Go, Windows 11', 10, 15.00, 'disponible'),
     (1, 'MacBook Air M2', 'Apple M2, 8 Go RAM, 256 Go', 4, 22.00, 'disponible'),
     (1, 'Lenovo ThinkPad E14', 'Ryzen 5, 16 Go RAM, idéal pour le développement', 6, 14.00, 'disponible'),
     (2, 'Projecteur Epson EB-X49', '3600 lumens, HDMI/VGA', 5, 10.00, 'disponible'),
     (2, 'Projecteur portable BenQ GV31', 'Mini projecteur avec haut-parleur intégré', 2, 12.00, 'maintenance'),
     (3, 'iPad 10e génération', '64 Go, Wi-Fi, avec étui', 8, 9.00, 'disponible'),
     (3, 'Samsung Galaxy Tab S9 FE', '128 Go, stylet S Pen inclus', 4, 8.50, 'disponible'),
     (4, 'Casque Jabra Evolve2 40', 'Casque filaire USB avec micro', 15, 3.00, 'disponible'),
     (4, 'Micro USB Blue Yeti', 'Micro pour enregistrement et visioconférence', 3, 5.00, 'disponible'),
     (5, 'Câble HDMI 3 m', 'HDMI 2.0, 4K', 30, 1.00, 'disponible'),
     (5, 'Adaptateur USB-C vers HDMI', 'Compatible Mac et PC', 12, 1.50, 'disponible'),
     (5, 'Rallonge électrique 6 prises', 'Avec protection contre les surtensions', 10, 1.00, 'hors_service')`
  );

  await conn.end();
  console.log('Base prête. Comptes de test (mot de passe : Motdepasse123!) :');
  console.log('  admin@location.test | responsable@location.test | client@location.test');
})().catch((e) => { console.error('Erreur :', e.message); process.exit(1); });
