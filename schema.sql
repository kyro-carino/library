-- FEU Roosevelt Library — schema only (MySQL 8.0+ / MariaDB 10.4+)
-- Does not insert sample data. After importing, run `php tools/migrate.php --yes` from the project
-- folder to apply the managed schema steps (indexes, constraints, open-loan guard).
-- Development sample data is created automatically when APP_ENV=development.

CREATE DATABASE IF NOT EXISTS feu_library
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE feu_library;

CREATE TABLE IF NOT EXISTS books (
  id VARCHAR(20) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  author VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  isbn VARCHAR(20),
  year INT,
  location VARCHAR(20),
  status ENUM('Available','Borrowed','Overdue') DEFAULT 'Available',
  borrowed_by VARCHAR(20),
  issue_date DATE,
  due_date DATE,
  description TEXT,
  format ENUM('Hardcover','Paperback','E-book','Audiobook'),
  cover_url TEXT,
  renewal_count INT NOT NULL DEFAULT 0,
  deleted_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status (status),
  INDEX idx_borrowed_by (borrowed_by),
  INDEX idx_books_category (category),
  INDEX idx_books_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(20) PRIMARY KEY,
  last_name VARCHAR(100) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  middle_initial VARCHAR(2),
  program VARCHAR(100),
  year_level INT,
  student_number VARCHAR(50),
  contact VARCHAR(255),
  status ENUM('Active','Inactive') DEFAULT 'Active',
  deleted_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  active_contact VARCHAR(255) GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL AND contact IS NOT NULL AND TRIM(contact) <> '' THEN LOWER(TRIM(contact)) ELSE NULL END) VIRTUAL,
  INDEX idx_status (status),
  INDEX idx_users_name (last_name, first_name),
  INDEX idx_users_contact (contact),
  UNIQUE INDEX uk_users_student_number (student_number),
  UNIQUE INDEX uk_users_active_contact (active_contact)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS transactions (
  id VARCHAR(20) PRIMARY KEY,
  type ENUM('issue','return') NOT NULL,
  book_id VARCHAR(20),
  book_title VARCHAR(255) NOT NULL,
  user_id VARCHAR(20),
  user_name VARCHAR(255) NOT NULL,
  issue_date DATE NOT NULL,
  due_date DATE,
  return_date DATE,
  fine DECIMAL(10, 2) DEFAULT 0,
  status ENUM('Borrowed','Overdue','Returned') DEFAULT 'Borrowed',
  renewal_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_book_id (book_id),
  INDEX idx_user_id (user_id),
  INDEX idx_type (type),
  INDEX idx_status (status),
  INDEX idx_tx_book_status (book_id, status),
  INDEX idx_tx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settings (
  id INT PRIMARY KEY DEFAULT 1,
  fine_per_day DECIMAL(10, 2) DEFAULT 10,
  loan_days INT DEFAULT 7,
  max_books_per_user INT DEFAULT 5,
  max_renewals INT DEFAULT 2,
  grace_period_days INT DEFAULT 1,
  overdue_fines_enabled BOOLEAN DEFAULT TRUE,
  date_format VARCHAR(20) DEFAULT 'short',
  time_format VARCHAR(10) DEFAULT '12h',
  page_size INT DEFAULT 25,
  language VARCHAR(10) DEFAULT 'en',
  confirm_deletes BOOLEAN DEFAULT TRUE,
  landing_page VARCHAR(50) DEFAULT 'dashboard',
  density VARCHAR(20) DEFAULT 'comfortable',
  library_name VARCHAR(255),
  library_email VARCHAR(255),
  library_phone VARCHAR(20),
  library_address TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_id CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notif_prefs (
  id INT PRIMARY KEY DEFAULT 1,
  due_notification BOOLEAN DEFAULT TRUE,
  overdue_notification BOOLEAN DEFAULT TRUE,
  new_user_notification BOOLEAN DEFAULT FALSE,
  returns_notification BOOLEAN DEFAULT TRUE,
  system_notification BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_id_notifs CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  role ENUM('admin','librarian','patron') NOT NULL DEFAULT 'patron',
  status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
  patron_id VARCHAR(20) NULL,
  avatar_data_url LONGTEXT NULL,
  avatar_preset VARCHAR(50) NULL,
  last_login DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_auth_patron (patron_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reservations (
  id VARCHAR(20) PRIMARY KEY,
  book_id VARCHAR(20) NOT NULL,
  user_id VARCHAR(20) NOT NULL,
  status ENUM('active','cancelled','fulfilled') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_res_book (book_id, status),
  INDEX idx_res_user (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS id_counters (
  name VARCHAR(32) PRIMARY KEY,
  next_value INT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO settings (id, fine_per_day, loan_days, max_books_per_user, max_renewals,
  grace_period_days, overdue_fines_enabled, date_format, time_format, page_size, language,
  confirm_deletes, landing_page, density, library_name, library_email, library_phone,
  library_address)
VALUES (
  1, 10, 7, 5, 2, 1, TRUE, 'short', '12h', 25, 'en', TRUE, 'dashboard', 'comfortable',
  'FEU Roosevelt Library', 'library@feuroosevelt.edu.ph', '(02) 8373-0701',
  'Circumferential Road, Cainta, Rizal'
) ON DUPLICATE KEY UPDATE id = id;

INSERT INTO notif_prefs (id, due_notification, overdue_notification, new_user_notification,
  returns_notification, system_notification)
VALUES (1, TRUE, TRUE, FALSE, TRUE, TRUE)
ON DUPLICATE KEY UPDATE id = id;

INSERT INTO id_counters (name, next_value) VALUES
  ('books', 1),
  ('users', 1),
  ('transactions', 1),
  ('reservations', 1)
ON DUPLICATE KEY UPDATE name = name;

-- Foreign keys: fresh database only. tools/migrate.php adds any that are missing and is the
-- repeatable way to apply them; do NOT re-run this file on a database that has records.

ALTER TABLE books
  ADD CONSTRAINT fk_books_borrowed_by
  FOREIGN KEY (borrowed_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE transactions
  ADD CONSTRAINT fk_transactions_book
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE transactions
  ADD CONSTRAINT fk_transactions_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE auth_users
  ADD CONSTRAINT fk_auth_patron
  FOREIGN KEY (patron_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE reservations
  ADD CONSTRAINT fk_res_book
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE reservations
  ADD CONSTRAINT fk_res_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE;
