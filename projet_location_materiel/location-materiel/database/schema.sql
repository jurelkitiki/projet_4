-- =============================================================
--  Système transactionnel de location de matériel informatique
--  Schéma MySQL (compatible MySQL 8 / MariaDB 10.5+)
-- =============================================================
DROP DATABASE IF EXISTS location_materiel;
CREATE DATABASE location_materiel CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE location_materiel;

-- Rôles : client, responsable, administrateur
CREATE TABLE roles (
  id   INT AUTO_INCREMENT PRIMARY KEY,
  nom  VARCHAR(30) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE utilisateurs (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  nom           VARCHAR(80)  NOT NULL,
  prenom        VARCHAR(80)  NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  mot_de_passe  VARCHAR(255) NOT NULL,          -- hash bcrypt, jamais en clair
  telephone     VARCHAR(30)  NULL,
  role_id       INT NOT NULL,
  actif         TINYINT(1) NOT NULL DEFAULT 1,
  cree_le       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_util_role FOREIGN KEY (role_id) REFERENCES roles(id)
) ENGINE=InnoDB;

CREATE TABLE categories (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  nom          VARCHAR(80) NOT NULL UNIQUE,
  description  VARCHAR(255) NULL
) ENGINE=InnoDB;

-- ÉtatMatériel : disponible, loue, maintenance, hors_service
CREATE TABLE materiels (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  categorie_id      INT NOT NULL,
  nom               VARCHAR(120) NOT NULL,
  description       TEXT NULL,
  quantite_totale   INT NOT NULL CHECK (quantite_totale >= 0),
  tarif_journalier  DECIMAL(10,2) NOT NULL CHECK (tarif_journalier >= 0),
  etat              ENUM('disponible','loue','maintenance','hors_service') NOT NULL DEFAULT 'disponible',
  actif             TINYINT(1) NOT NULL DEFAULT 1,   -- 0 = retiré du parc (suppression logique)
  cree_le           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_mat_cat FOREIGN KEY (categorie_id) REFERENCES categories(id)
) ENGINE=InnoDB;

-- RéservationLocation
CREATE TABLE reservations (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  utilisateur_id       INT NOT NULL,
  date_debut           DATE NOT NULL,
  date_fin             DATE NOT NULL,
  nb_jours             INT NOT NULL,
  montant_total        DECIMAL(10,2) NOT NULL,
  statut               ENUM('en_attente','validee','refusee','annulee','confirmee','en_cours','terminee')
                       NOT NULL DEFAULT 'en_attente',
  motif                VARCHAR(255) NULL,             -- motif de refus / d'annulation
  demande_annulation   TINYINT(1) NOT NULL DEFAULT 0,
  expiration_paiement  DATETIME NULL,                 -- blocage temporaire après validation
  valide_par           INT NULL,
  valide_le            DATETIME NULL,
  cree_le              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_dates CHECK (date_fin >= date_debut),
  CONSTRAINT fk_res_util FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id),
  CONSTRAINT fk_res_valid FOREIGN KEY (valide_par) REFERENCES utilisateurs(id),
  INDEX idx_res_dates (date_debut, date_fin),
  INDEX idx_res_statut (statut)
) ENGINE=InnoDB;

-- DétailLocation : tarif appliqué figé au moment de la demande
CREATE TABLE details_location (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  reservation_id  INT NOT NULL,
  materiel_id     INT NOT NULL,
  quantite        INT NOT NULL CHECK (quantite > 0),
  tarif_applique  DECIMAL(10,2) NOT NULL,
  nb_jours        INT NOT NULL,
  montant_ligne   DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_det_res FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE,
  CONSTRAINT fk_det_mat FOREIGN KEY (materiel_id) REFERENCES materiels(id)
) ENGINE=InnoDB;

-- Pénalité : montant distinct du paiement initial
CREATE TABLE penalites (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  reservation_id  INT NOT NULL,
  type            ENUM('retard','dommage') NOT NULL,
  montant         DECIMAL(10,2) NOT NULL CHECK (montant >= 0),
  description     VARCHAR(255) NULL,
  statut          ENUM('non_reglee','reglee') NOT NULL DEFAULT 'non_reglee',
  cree_par        INT NULL,
  cree_le         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pen_res FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  CONSTRAINT fk_pen_user FOREIGN KEY (cree_par) REFERENCES utilisateurs(id)
) ENGINE=InnoDB;

-- Paiement : toujours lié à une réservation. AUCUNE donnée de carte stockée.
CREATE TABLE paiements (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  reservation_id  INT NOT NULL,
  penalite_id     INT NULL,                         -- renseigné si règlement d'une pénalité
  type            ENUM('location','penalite') NOT NULL DEFAULT 'location',
  montant         DECIMAL(10,2) NOT NULL,
  mode            VARCHAR(30) NOT NULL DEFAULT 'carte_simulee',
  statut          ENUM('en_attente','accepte','refuse') NOT NULL DEFAULT 'en_attente',
  reference       VARCHAR(40) NOT NULL UNIQUE,
  date_paiement   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pai_res FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  CONSTRAINT fk_pai_pen FOREIGN KEY (penalite_id) REFERENCES penalites(id)
) ENGINE=InnoDB;

CREATE TABLE remises (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  reservation_id  INT NOT NULL UNIQUE,
  date_remise     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responsable_id  INT NOT NULL,
  observations    VARCHAR(255) NULL,
  CONSTRAINT fk_rem_res FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  CONSTRAINT fk_rem_resp FOREIGN KEY (responsable_id) REFERENCES utilisateurs(id)
) ENGINE=InnoDB;

-- Retour : date effective et observations
CREATE TABLE retours (
  id                     INT AUTO_INCREMENT PRIMARY KEY,
  reservation_id         INT NOT NULL UNIQUE,
  date_retour_effective  DATE NOT NULL,
  etat_materiel          ENUM('bon','endommage') NOT NULL DEFAULT 'bon',
  jours_retard           INT NOT NULL DEFAULT 0,
  observations           VARCHAR(255) NULL,
  responsable_id         INT NOT NULL,
  enregistre_le          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ret_res FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  CONSTRAINT fk_ret_resp FOREIGN KEY (responsable_id) REFERENCES utilisateurs(id)
) ENGINE=InnoDB;

-- Historique des actions sur les locations
CREATE TABLE historique (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  reservation_id  INT NULL,
  utilisateur_id  INT NULL,
  action          VARCHAR(60) NOT NULL,
  details         VARCHAR(255) NULL,
  date_action     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_his_res FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE SET NULL,
  CONSTRAINT fk_his_user FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE SET NULL
) ENGINE=InnoDB;


-- Demandes de conseil envoyées depuis le site (formulaire « Demander conseil », visiteurs non connectés)
CREATE TABLE demandes_contact (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  nom           VARCHAR(120) NOT NULL,
  organisation  VARCHAR(150) NULL,
  email         VARCHAR(150) NOT NULL,
  telephone     VARCHAR(30)  NULL,
  date_debut    DATE NULL,
  nb_jours      INT NULL,
  message       TEXT NOT NULL,
  statut        ENUM('nouvelle','traitee') NOT NULL DEFAULT 'nouvelle',
  cree_le       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

INSERT INTO roles (nom) VALUES ('client'), ('responsable'), ('administrateur');
