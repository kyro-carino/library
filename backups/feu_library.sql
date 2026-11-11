-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1:3307
-- Generation Time: Oct 09, 2026 at 11:07 AM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `feu_library`
--

-- --------------------------------------------------------

--
-- Table structure for table `auth_users`
--

CREATE TABLE `auth_users` (
  `id` int(11) NOT NULL,
  `username` varchar(100) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `display_name` varchar(255) NOT NULL,
  `role` enum('admin','librarian','patron') NOT NULL DEFAULT 'patron',
  `status` enum('Active','Inactive') NOT NULL DEFAULT 'Active',
  `patron_id` varchar(20) DEFAULT NULL,
  `avatar_data_url` longtext DEFAULT NULL,
  `avatar_preset` varchar(50) DEFAULT NULL,
  `last_login` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `auth_users`
--

INSERT INTO `auth_users` (`id`, `username`, `email`, `password_hash`, `display_name`, `role`, `status`, `patron_id`, `avatar_data_url`, `avatar_preset`, `last_login`, `created_at`, `updated_at`) VALUES
(5, 'admin', 'admin@library.local', '$2y$10$xABUEl.k5bapKeGWcSrTZ.5GDffI5xuhPXGZtZOZi7dIM2YIMhkwy', 'Library Administrator', 'admin', 'Active', NULL, NULL, NULL, '2026-10-08 12:29:55', '2026-10-03 13:49:35', '2026-10-08 04:29:55');

-- --------------------------------------------------------

--
-- Table structure for table `books`
--

CREATE TABLE `books` (
  `id` varchar(20) NOT NULL,
  `title` varchar(255) NOT NULL,
  `author` varchar(255) NOT NULL,
  `category` varchar(100) DEFAULT NULL,
  `isbn` varchar(20) DEFAULT NULL,
  `year` int(11) DEFAULT NULL,
  `location` varchar(20) DEFAULT NULL,
  `status` enum('Available','Borrowed','Overdue') DEFAULT 'Available',
  `borrowed_by` varchar(20) DEFAULT NULL,
  `issue_date` date DEFAULT NULL,
  `due_date` date DEFAULT NULL,
  `description` text DEFAULT NULL,
  `format` enum('Hardcover','Paperback','E-book','Audiobook') DEFAULT NULL,
  `cover_url` text DEFAULT NULL,
  `renewal_count` int(11) NOT NULL DEFAULT 0,
  `deleted_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ;

--
-- Dumping data for table `books`
--

INSERT INTO `books` (`id`, `title`, `author`, `category`, `isbn`, `year`, `location`, `status`, `borrowed_by`, `issue_date`, `due_date`, `description`, `format`, `cover_url`, `renewal_count`, `deleted_at`, `created_at`, `updated_at`) VALUES
('SEED-B01', 'The Great Gatsby', 'F. Scott Fitzgerald', 'Literature', '9780743273565', 1925, 'A-12', 'Borrowed', 'SEED-U12', '2026-10-04', '2026-10-11', '[DEV SEED] A glittering, doomed summer on Long Island.', 'Paperback', 'https://covers.openlibrary.org/b/isbn/9780743273565-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-10-04 09:39:59'),
('SEED-B02', '1984', 'George Orwell', 'Literature', '9780451524935', 1949, 'A-01', 'Available', NULL, NULL, NULL, '[DEV SEED] A totalitarian future where language itself is rewritten.', 'Paperback', 'https://covers.openlibrary.org/b/isbn/9780451524935-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-10-04 13:53:19'),
('SEED-B03', 'To Kill a Mockingbird', 'Harper Lee', 'Literature', '9780061120084', 1960, 'A-07', 'Available', NULL, NULL, NULL, '[DEV SEED] A small-town trial and a child’s early lessons in conscience.', 'Hardcover', 'https://covers.openlibrary.org/b/isbn/9780061120084-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B04', 'Brave New World', 'Aldous Huxley', 'Literature', '9780060850524', 1932, 'A-15', 'Available', NULL, NULL, NULL, '[DEV SEED] A society engineered for comfort at a quiet cost.', 'Paperback', 'https://covers.openlibrary.org/b/isbn/9780060850524-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B05', 'Leaves of Grass', 'Walt Whitman', 'Literature', '9781593080834', 1855, 'F-03', 'Available', NULL, NULL, NULL, '[DEV SEED] An expansive collection that helped define American poetry.', 'Paperback', 'https://covers.openlibrary.org/b/isbn/9781593080834-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B06', 'A Brief History of Time', 'Stephen Hawking', 'Science', '9780553380163', 1988, 'D-19', 'Available', NULL, NULL, NULL, '[DEV SEED] An accessible tour of cosmology for non-specialists.', 'Paperback', 'https://covers.openlibrary.org/b/isbn/9780553380163-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-10-03 21:34:02'),
('SEED-B07', 'Cosmos', 'Carl Sagan', 'Science', '9780345539434', 1980, 'D-06', 'Available', NULL, NULL, NULL, '[DEV SEED] A guided tour of the universe and our place in it.', 'Hardcover', 'https://covers.openlibrary.org/b/isbn/9780345539434-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B08', 'The Selfish Gene', 'Richard Dawkins', 'Science', '9780198788607', 1976, 'D-14', 'Available', NULL, NULL, NULL, '[DEV SEED] A gene’s-eye view of evolution.', 'Paperback', 'https://covers.openlibrary.org/b/isbn/9780198788607-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B09', 'Astrophysics for People in a Hurry', 'Neil deGrasse Tyson', 'Science', '9780393609394', 2017, 'D-25', 'Available', NULL, NULL, NULL, '[DEV SEED] Big cosmic ideas in short chapters.', 'Hardcover', 'https://covers.openlibrary.org/b/isbn/9780393609394-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B10', 'Sapiens', 'Yuval Noah Harari', 'History', '9780062316097', 2011, 'D-02', 'Available', NULL, NULL, NULL, '[DEV SEED] How Homo sapiens came to dominate the planet.', 'Paperback', 'https://covers.openlibrary.org/b/isbn/9780062316097-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-10-03 21:34:06'),
('SEED-B11', 'Guns, Germs, and Steel', 'Jared Diamond', 'History', '9780393317558', 1997, 'D-22', 'Available', NULL, NULL, NULL, '[DEV SEED] Why history’s advantages fell to some societies and not others.', 'Paperback', 'https://covers.openlibrary.org/b/isbn/9780393317558-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B12', 'The Silk Roads', 'Peter Frankopan', 'History', '9781101912379', 2015, 'D-11', 'Available', NULL, NULL, NULL, '[DEV SEED] World history centered on the routes linking East and West.', 'Paperback', 'https://covers.openlibrary.org/b/isbn/9781101912379-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B13', 'A People’s History of the United States', 'Howard Zinn', 'History', '9780062397348', 1980, 'D-30', 'Available', NULL, NULL, NULL, '[DEV SEED] American history told from the ground up.', 'Paperback', 'https://covers.openlibrary.org/b/isbn/9780062397348-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B14', 'Meditations', 'Marcus Aurelius', 'Philosophy', '9780140449334', 2006, 'E-11', 'Available', NULL, NULL, NULL, '[DEV SEED] A Roman emperor’s private notebook on staying calm and useful.', 'Paperback', 'https://covers.openlibrary.org/b/isbn/9780140449334-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B15', 'The Republic', 'Plato', 'Philosophy', '9780140449140', 2007, 'E-02', 'Available', NULL, NULL, NULL, '[DEV SEED] A dialogue on justice, the soul, and the ideal city.', 'Paperback', 'https://covers.openlibrary.org/b/isbn/9780140449140-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B16', 'Beyond Good and Evil', 'Friedrich Nietzsche', 'Philosophy', '9780486298689', 1886, 'E-17', 'Available', NULL, NULL, NULL, '[DEV SEED] A provocation aimed at familiar moral assumptions.', 'Paperback', 'https://covers.openlibrary.org/b/isbn/9780486298689-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B17', 'Clean Code', 'Robert C. Martin', 'Technology', '9780132350884', 2008, 'B-04', 'Borrowed', 'SEED-U08', '2026-09-29', '2026-10-06', '[DEV SEED] A field guide to writing software that stays readable.', 'Hardcover', 'https://covers.openlibrary.org/b/isbn/9780132350884-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B18', 'The Pragmatic Programmer', 'Andrew Hunt', 'Technology', '9780135957059', 2019, 'B-09', 'Available', NULL, NULL, NULL, '[DEV SEED] Field-tested habits for well-crafted software.', 'Hardcover', 'https://covers.openlibrary.org/b/isbn/9780135957059-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B19', 'Refactoring', 'Martin Fowler', 'Technology', '9780134757599', 1999, 'B-13', 'Available', NULL, NULL, NULL, '[DEV SEED] Small, safe steps for improving existing code.', 'Hardcover', 'https://covers.openlibrary.org/b/isbn/9780134757599-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B20', 'The Design of Everyday Things', 'Don Norman', 'Arts', '9780465050659', 2013, 'B-18', 'Available', NULL, NULL, NULL, '[DEV SEED] Why everyday objects confuse us, and what good design owes users.', 'Paperback', 'https://covers.openlibrary.org/b/isbn/9780465050659-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B21', 'Don\'t Make Me Think', 'Steve Krug', 'Arts', '9780321965516', 2000, 'B-21', 'Available', NULL, NULL, NULL, '[DEV SEED] A practical case for usability.', 'Paperback', 'https://covers.openlibrary.org/b/isbn/9780321965516-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B22', 'Ways of Seeing', 'John Berger', 'Arts', '9780140135152', 1972, 'F-21', 'Available', NULL, NULL, NULL, '[DEV SEED] How images teach us to look, and who that looking serves.', 'Paperback', 'https://covers.openlibrary.org/b/isbn/9780140135152-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B23', 'Atomic Habits', 'James Clear', 'Psychology', '9780735211292', 2018, 'C-07', 'Borrowed', 'SEED-U05', '2026-09-30', '2026-10-07', '[DEV SEED] Building good habits through small compounding changes.', 'Hardcover', 'https://covers.openlibrary.org/b/isbn/9780735211292-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B24', 'Thinking, Fast and Slow', 'Daniel Kahneman', 'Psychology', '9780374533557', 2011, 'C-11', 'Available', NULL, NULL, NULL, '[DEV SEED] Two systems of thought and the biases they leave behind.', 'Paperback', 'https://covers.openlibrary.org/b/isbn/9780374533557-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-10-04 14:03:45'),
('SEED-B25', 'Man’s Search for Meaning', 'Viktor E. Frankl', 'Psychology', '9780807014271', 2006, 'C-22', 'Available', NULL, NULL, NULL, '[DEV SEED] A psychiatrist’s account of purpose under extreme hardship.', 'Paperback', 'https://covers.openlibrary.org/b/isbn/9780807014271-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B26', 'Deep Work', 'Cal Newport', 'Business', '9781455586691', 2016, 'C-14', 'Available', NULL, NULL, NULL, '[DEV SEED] Protecting long stretches of undistracted focus.', 'Hardcover', 'https://covers.openlibrary.org/b/isbn/9781455586691-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B27', 'The Lean Startup', 'Eric Ries', 'Business', '9780307887894', 2011, 'C-08', 'Available', NULL, NULL, NULL, '[DEV SEED] Building products through measured experiments.', 'Hardcover', 'https://covers.openlibrary.org/b/isbn/9780307887894-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B28', 'Good to Great', 'Jim Collins', 'Business', '9780066620992', 2001, 'C-02', 'Available', NULL, NULL, NULL, '[DEV SEED] What separates companies that make a lasting leap.', 'Hardcover', 'https://covers.openlibrary.org/b/isbn/9780066620992-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B29', 'A Mathematician’s Apology', 'G. H. Hardy', 'Mathematics', '9780521427067', 1940, 'M-04', 'Available', NULL, NULL, NULL, '[DEV SEED] A defense of pure mathematics as a creative art.', 'Paperback', 'https://covers.openlibrary.org/b/isbn/9780521427067-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B30', 'How to Solve It', 'George Pólya', 'Mathematics', '9780691164076', 1945, 'M-09', 'Available', NULL, NULL, NULL, '[DEV SEED] A practical method for attacking unfamiliar problems.', 'Paperback', 'https://covers.openlibrary.org/b/isbn/9780691164076-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B31', 'The Art of Computer Programming, Vol. 1', 'Donald E. Knuth', 'Computer Science', '9780201896831', 1997, 'CS-01', 'Borrowed', 'SEED-U14', '2026-09-27', '2026-10-04', '[DEV SEED] Foundational algorithms and the craft of programming.', 'Hardcover', 'https://covers.openlibrary.org/b/isbn/9780201896831-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B32', 'Introduction to Algorithms', 'Thomas H. Cormen', 'Computer Science', '9780262033848', 2009, 'CS-07', 'Available', NULL, NULL, NULL, '[DEV SEED] A standard reference for algorithm design and analysis.', 'Hardcover', 'https://covers.openlibrary.org/b/isbn/9780262033848-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B33', 'Structure and Interpretation of Computer Programs', 'Harold Abelson', 'Computer Science', '9780262510875', 1996, 'CS-12', 'Available', NULL, NULL, NULL, '[DEV SEED] Programming as a way of expressing ideas.', 'Paperback', 'https://covers.openlibrary.org/b/isbn/9780262510875-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B34', 'Pedagogy of the Oppressed', 'Paulo Freire', 'Education', '9780826412768', 1970, 'ED-03', 'Overdue', 'SEED-U09', '2026-09-15', '2026-09-22', '[DEV SEED] A critique of banking-model education and a case for dialogue.', 'Paperback', 'https://covers.openlibrary.org/b/isbn/9780826412768-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B35', 'Teaching to Transgress', 'bell hooks', 'Education', '9780415908085', 1994, 'ED-08', 'Available', NULL, NULL, NULL, '[DEV SEED] Education as a practice of freedom.', 'Paperback', 'https://covers.openlibrary.org/b/isbn/9780415908085-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B36', 'Mindset', 'Carol S. Dweck', 'Education', '9780345472328', 2006, 'ED-14', 'Available', NULL, NULL, NULL, '[DEV SEED] How beliefs about ability shape learning.', 'Paperback', 'https://covers.openlibrary.org/b/isbn/9780345472328-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B37', 'The Sociological Imagination', 'C. Wright Mills', 'Social Sciences', '9780195133738', 1959, 'SS-02', 'Overdue', 'SEED-U03', '2026-09-17', '2026-09-24', '[DEV SEED] Connecting private troubles to public issues.', 'Paperback', 'https://covers.openlibrary.org/b/isbn/9780195133738-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B38', 'Bowling Alone', 'Robert D. Putnam', 'Social Sciences', '9780743203043', 2000, 'SS-11', 'Available', NULL, NULL, NULL, '[DEV SEED] The decline of civic life in late-twentieth-century America.', 'Paperback', 'https://covers.openlibrary.org/b/isbn/9780743203043-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B39', 'Orientalism', 'Edward W. Said', 'Social Sciences', '9780394740676', 1978, 'SS-18', 'Available', NULL, NULL, NULL, '[DEV SEED] How the West constructed a version of the East.', 'Paperback', 'https://covers.openlibrary.org/b/isbn/9780394740676-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-B40', 'Design Patterns', 'Erich Gamma', 'Computer Science', '9780201633610', 1994, 'B-01', 'Available', NULL, NULL, NULL, '[DEV SEED] Reusable solutions to recurring design problems.', 'Hardcover', 'https://covers.openlibrary.org/b/isbn/9780201633610-M.jpg', 0, NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43');

-- --------------------------------------------------------

--
-- Table structure for table `id_counters`
--

CREATE TABLE `id_counters` (
  `name` varchar(32) NOT NULL,
  `next_value` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `id_counters`
--

INSERT INTO `id_counters` (`name`, `next_value`) VALUES
('books', 1),
('reservations', 1),
('transactions', 4),
('users', 4);

-- --------------------------------------------------------

--
-- Table structure for table `notif_prefs`
--

CREATE TABLE `notif_prefs` (
  `id` int(11) NOT NULL DEFAULT 1,
  `due_notification` tinyint(1) DEFAULT 1,
  `overdue_notification` tinyint(1) DEFAULT 1,
  `new_user_notification` tinyint(1) DEFAULT 0,
  `returns_notification` tinyint(1) DEFAULT 1,
  `system_notification` tinyint(1) DEFAULT 1,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ;

--
-- Dumping data for table `notif_prefs`
--

INSERT INTO `notif_prefs` (`id`, `due_notification`, `overdue_notification`, `new_user_notification`, `returns_notification`, `system_notification`, `updated_at`) VALUES
(1, 1, 1, 0, 1, 1, '2026-09-30 18:13:41');

-- --------------------------------------------------------

--
-- Table structure for table `reservations`
--

CREATE TABLE `reservations` (
  `id` varchar(20) NOT NULL,
  `book_id` varchar(20) NOT NULL,
  `user_id` varchar(20) NOT NULL,
  `status` enum('active','cancelled','fulfilled') NOT NULL DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `schema_migrations`
--

CREATE TABLE `schema_migrations` (
  `version` varchar(64) NOT NULL,
  `applied_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `schema_migrations`
--

INSERT INTO `schema_migrations` (`version`, `applied_at`) VALUES
('001_baseline', '2026-10-04 09:38:35'),
('002_foreign_keys', '2026-10-04 09:38:35'),
('003_indexes', '2026-10-04 09:38:35'),
('004_check_constraints', '2026-10-04 09:38:35'),
('005_open_loan_guard', '2026-10-04 09:38:35');

-- --------------------------------------------------------

--
-- Table structure for table `seed_meta`
--

CREATE TABLE `seed_meta` (
  `name` varchar(64) NOT NULL,
  `applied_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `seed_meta`
--

INSERT INTO `seed_meta` (`name`, `applied_at`) VALUES
('dev_catalog_v1', '2026-09-30 19:09:43');

-- --------------------------------------------------------

--
-- Table structure for table `settings`
--

CREATE TABLE `settings` (
  `id` int(11) NOT NULL DEFAULT 1,
  `fine_per_day` decimal(10,2) DEFAULT 10.00,
  `loan_days` int(11) DEFAULT 7,
  `max_books_per_user` int(11) DEFAULT 5,
  `max_renewals` int(11) DEFAULT 2,
  `grace_period_days` int(11) DEFAULT 1,
  `overdue_fines_enabled` tinyint(1) DEFAULT 1,
  `date_format` varchar(20) DEFAULT 'short',
  `time_format` varchar(10) DEFAULT '12h',
  `page_size` int(11) DEFAULT 25,
  `language` varchar(10) DEFAULT 'en',
  `confirm_deletes` tinyint(1) DEFAULT 1,
  `landing_page` varchar(50) DEFAULT 'dashboard',
  `density` varchar(20) DEFAULT 'comfortable',
  `library_name` varchar(255) DEFAULT NULL,
  `library_email` varchar(255) DEFAULT NULL,
  `library_phone` varchar(20) DEFAULT NULL,
  `library_address` text DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ;

--
-- Dumping data for table `settings`
--

INSERT INTO `settings` (`id`, `fine_per_day`, `loan_days`, `max_books_per_user`, `max_renewals`, `grace_period_days`, `overdue_fines_enabled`, `date_format`, `time_format`, `page_size`, `language`, `confirm_deletes`, `landing_page`, `density`, `library_name`, `library_email`, `library_phone`, `library_address`, `updated_at`) VALUES
(1, 10.00, 7, 5, 2, 1, 1, 'short', '12h', 25, 'en', 1, 'dashboard', 'comfortable', 'FEU Roosevelt Library', 'library@feuroosevelt.edu.ph', '(02) 8373-0701', 'Circumferential Road, Cainta, Rizal', '2026-09-30 18:13:41');

-- --------------------------------------------------------

--
-- Table structure for table `transactions`
--

CREATE TABLE `transactions` (
  `id` varchar(20) NOT NULL,
  `type` enum('issue','return') NOT NULL,
  `book_id` varchar(20) DEFAULT NULL,
  `book_title` varchar(255) NOT NULL,
  `user_id` varchar(20) DEFAULT NULL,
  `user_name` varchar(255) NOT NULL,
  `issue_date` date NOT NULL,
  `due_date` date DEFAULT NULL,
  `return_date` date DEFAULT NULL,
  `fine` decimal(10,2) DEFAULT 0.00,
  `status` enum('Borrowed','Overdue','Returned') DEFAULT 'Borrowed',
  `renewal_count` int(11) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `open_book_id` varchar(20) GENERATED ALWAYS AS (if(`type` = 'issue' and `return_date` is null and `status` in ('Borrowed','Overdue'),`book_id`,NULL)) VIRTUAL
) ;

--
-- Dumping data for table `transactions`
--

INSERT INTO `transactions` (`id`, `type`, `book_id`, `book_title`, `user_id`, `user_name`, `issue_date`, `due_date`, `return_date`, `fine`, `status`, `renewal_count`, `created_at`, `updated_at`) VALUES
('SEED-T01', 'issue', 'SEED-B02', '1984', 'SEED-U01', 'Reyes, Luna A.', '2026-09-28', '2026-10-05', '2026-10-04', 0.00, 'Returned', 0, '2026-09-30 19:09:43', '2026-10-03 21:32:58'),
('SEED-T02', 'issue', 'SEED-B17', 'Clean Code', 'SEED-U08', 'Lim, Paolo S.', '2026-09-29', '2026-10-06', NULL, 0.00, 'Borrowed', 0, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-T03', 'issue', 'SEED-B23', 'Atomic Habits', 'SEED-U05', 'Garcia, Mika L.', '2026-09-30', '2026-10-07', NULL, 0.00, 'Borrowed', 0, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-T04', 'issue', 'SEED-B31', 'The Art of Computer Programming, Vol. 1', 'SEED-U14', 'Santiago, Jules H.', '2026-09-27', '2026-10-04', NULL, 0.00, 'Borrowed', 0, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-T05', 'issue', 'SEED-B10', 'Sapiens', 'SEED-U15', 'Mercado, Nina C.', '2026-09-26', '2026-10-03', '2026-10-04', 0.00, 'Returned', 0, '2026-09-30 19:09:43', '2026-10-03 21:34:06'),
('SEED-T06', 'issue', 'SEED-B06', 'A Brief History of Time', 'SEED-U02', 'Santos, Marco J.', '2026-09-11', '2026-09-18', '2026-10-04', 150.00, 'Returned', 0, '2026-09-30 19:09:43', '2026-10-03 21:34:02'),
('SEED-T07', 'issue', 'SEED-B24', 'Thinking, Fast and Slow', 'SEED-U13', 'Dela Peña, Kara V.', '2026-09-13', '2026-09-20', '2026-10-04', 130.00, 'Returned', 0, '2026-09-30 19:09:43', '2026-10-04 14:03:45'),
('SEED-T08', 'issue', 'SEED-B34', 'Pedagogy of the Oppressed', 'SEED-U09', 'Navarro, Celine M.', '2026-09-15', '2026-09-22', NULL, 0.00, 'Overdue', 0, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-T09', 'issue', 'SEED-B37', 'The Sociological Imagination', 'SEED-U03', 'Villanueva, Aria P.', '2026-09-17', '2026-09-24', NULL, 0.00, 'Overdue', 0, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-T10', 'issue', 'SEED-B01', 'The Great Gatsby', 'SEED-U04', 'Cruz, Noah D.', '2026-09-01', '2026-09-08', '2026-09-09', 0.00, 'Returned', 0, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-T11', 'issue', 'SEED-B07', 'Cosmos', 'SEED-U06', 'Tan, Eli R.', '2026-09-03', '2026-09-10', '2026-09-10', 0.00, 'Returned', 0, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-T12', 'issue', 'SEED-B20', 'The Design of Everyday Things', 'SEED-U07', 'Ramos, Sofia K.', '2026-09-05', '2026-09-12', '2026-09-13', 0.00, 'Returned', 0, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-T13', 'issue', 'SEED-B26', 'Deep Work', 'SEED-U12', 'Bautista, Theo N.', '2026-09-07', '2026-09-14', '2026-09-21', 60.00, 'Returned', 0, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-T14', 'issue', 'SEED-B32', 'Introduction to Algorithms', 'SEED-U08', 'Lim, Paolo S.', '2026-09-09', '2026-09-16', '2026-09-23', 60.00, 'Returned', 0, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-T15', 'issue', 'SEED-B11', 'Guns, Germs, and Steel', 'SEED-U01', 'Reyes, Luna A.', '2026-09-10', '2026-09-17', '2026-09-17', 0.00, 'Returned', 0, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-T16', 'issue', 'SEED-B14', 'Meditations', 'SEED-U11', 'Fernandez, Ivy G.', '2026-09-12', '2026-09-19', '2026-09-26', 60.00, 'Returned', 0, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-T17', 'issue', 'SEED-B40', 'Design Patterns', 'SEED-U14', 'Santiago, Jules H.', '2026-09-19', '2026-09-26', '2026-09-27', 0.00, 'Returned', 0, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-T18', 'issue', 'SEED-B28', 'Good to Great', 'SEED-U12', 'Bautista, Theo N.', '2026-09-21', '2026-09-28', '2026-09-30', 10.00, 'Returned', 0, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('TX-0001', 'issue', 'SEED-B01', 'The Great Gatsby', 'SEED-U12', 'Bautista, Theo N.', '2026-10-04', '2026-10-11', NULL, 0.00, 'Borrowed', 0, '2026-10-04 09:39:59', '2026-10-04 09:39:59'),
('TX-0002', 'issue', 'SEED-B02', '1984', 'SEED-U04', 'Cruz, Noah D.', '2026-10-04', '2026-10-11', '2026-10-04', 0.00, 'Returned', 0, '2026-10-04 09:40:38', '2026-10-04 09:40:48'),
('TX-0003', 'issue', 'SEED-B02', '1984', 'SEED-U12', 'Bautista, Theo N.', '2026-10-04', '2026-10-11', '2026-10-04', 0.00, 'Returned', 0, '2026-10-04 13:52:56', '2026-10-04 13:53:19');

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` varchar(20) NOT NULL,
  `last_name` varchar(100) NOT NULL,
  `first_name` varchar(100) NOT NULL,
  `middle_initial` varchar(2) DEFAULT NULL,
  `program` varchar(100) DEFAULT NULL,
  `year_level` int(11) DEFAULT NULL,
  `contact` varchar(255) DEFAULT NULL,
  `status` enum('Active','Inactive') DEFAULT 'Active',
  `deleted_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`id`, `last_name`, `first_name`, `middle_initial`, `program`, `year_level`, `contact`, `status`, `deleted_at`, `created_at`, `updated_at`) VALUES
('2026-001', 'asda', 'asdas', '', 'BSIT', 1, 'tae@gmail.com', 'Active', '2026-10-08 11:49:02', '2026-10-08 03:48:51', '2026-10-08 03:49:02'),
('2026-002', 'dirk', 'drik', '', 'BS Psychology', 2, 'tae@gmail.com', 'Active', NULL, '2026-10-08 04:13:16', '2026-10-08 04:13:16'),
('2026-003', 'roky', 'burt', 'C', 'BSIT', 1, 'rokybart@gmail.com', 'Active', NULL, '2026-10-08 04:14:33', '2026-10-08 04:14:33'),
('SEED-U01', 'Reyes', 'Luna', 'A', 'BS Information Technology', 2, 'luna.reyes@example.invalid', 'Active', NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-U02', 'Santos', 'Marco', 'J', 'BS Psychology', 3, 'marco.santos@example.invalid', 'Active', NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-U03', 'Villanueva', 'Aria', 'P', 'BS Architecture', 1, 'aria.villanueva@example.invalid', 'Active', NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-U04', 'Cruz', 'Noah', 'D', 'BS Accountancy', 4, 'noah.cruz@example.invalid', 'Active', NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-U05', 'Garcia', 'Mika', 'L', 'BS Nursing', 2, 'mika.garcia@example.invalid', 'Active', NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-U06', 'Tan', 'Eli', 'R', 'BS Civil Engineering', 3, 'eli.tan@example.invalid', 'Active', NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-U07', 'Ramos', 'Sofia', 'K', 'BS Biology', 1, 'sofia.ramos@example.invalid', 'Active', NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-U08', 'Lim', 'Paolo', 'S', 'BS Computer Science', 4, 'paolo.lim@example.invalid', 'Active', NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-U09', 'Navarro', 'Celine', 'M', 'BS Education', 2, 'celine.navarro@example.invalid', 'Active', NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-U10', 'Ocampo', 'Diego', 'F', 'BA Communication', 3, 'diego.ocampo@example.invalid', 'Inactive', NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-U11', 'Fernandez', 'Ivy', 'G', 'BS Mathematics', 1, 'ivy.fernandez@example.invalid', 'Active', NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-U12', 'Bautista', 'Theo', 'N', 'BS Business Administration', 2, 'theo.bautista@example.invalid', 'Active', NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-U13', 'Dela Peña', 'Kara', 'V', 'BS Psychology', 4, 'kara.delapena@example.invalid', 'Active', NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-U14', 'Santiago', 'Jules', 'H', 'BS Information Technology', 3, 'jules.santiago@example.invalid', 'Active', NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43'),
('SEED-U15', 'Mercado', 'Nina', 'C', 'BA Political Science', 2, 'nina.mercado@example.invalid', 'Active', NULL, '2026-09-30 19:09:43', '2026-09-30 19:09:43');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `auth_users`
--
ALTER TABLE `auth_users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `username` (`username`),
  ADD UNIQUE KEY `email` (`email`),
  ADD KEY `idx_auth_patron` (`patron_id`);

--
-- Indexes for table `books`
--
ALTER TABLE `books`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_status` (`status`),
  ADD KEY `idx_borrowed_by` (`borrowed_by`),
  ADD KEY `idx_books_category` (`category`),
  ADD KEY `idx_books_created` (`created_at`),
  ADD KEY `idx_books_isbn` (`isbn`);

--
-- Indexes for table `id_counters`
--
ALTER TABLE `id_counters`
  ADD PRIMARY KEY (`name`);

--
-- Indexes for table `notif_prefs`
--
ALTER TABLE `notif_prefs`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `reservations`
--
ALTER TABLE `reservations`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_res_book` (`book_id`,`status`),
  ADD KEY `idx_res_user` (`user_id`,`status`);

--
-- Indexes for table `schema_migrations`
--
ALTER TABLE `schema_migrations`
  ADD PRIMARY KEY (`version`);

--
-- Indexes for table `seed_meta`
--
ALTER TABLE `seed_meta`
  ADD PRIMARY KEY (`name`);

--
-- Indexes for table `settings`
--
ALTER TABLE `settings`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `transactions`
--
ALTER TABLE `transactions`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uk_tx_open_book` (`open_book_id`),
  ADD KEY `idx_book_id` (`book_id`),
  ADD KEY `idx_user_id` (`user_id`),
  ADD KEY `idx_type` (`type`),
  ADD KEY `idx_status` (`status`),
  ADD KEY `idx_tx_book_status` (`book_id`,`status`),
  ADD KEY `idx_tx_created` (`created_at`),
  ADD KEY `idx_tx_issue_date` (`issue_date`),
  ADD KEY `idx_tx_return_date` (`return_date`),
  ADD KEY `idx_tx_open` (`type`,`return_date`,`due_date`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_status` (`status`),
  ADD KEY `idx_users_name` (`last_name`,`first_name`),
  ADD KEY `idx_users_contact` (`contact`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `auth_users`
--
ALTER TABLE `auth_users`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `auth_users`
--
ALTER TABLE `auth_users`
  ADD CONSTRAINT `fk_auth_patron` FOREIGN KEY (`patron_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `books`
--
ALTER TABLE `books`
  ADD CONSTRAINT `fk_books_borrowed_by` FOREIGN KEY (`borrowed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `reservations`
--
ALTER TABLE `reservations`
  ADD CONSTRAINT `fk_res_book` FOREIGN KEY (`book_id`) REFERENCES `books` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_res_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `transactions`
--
ALTER TABLE `transactions`
  ADD CONSTRAINT `fk_transactions_book` FOREIGN KEY (`book_id`) REFERENCES `books` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_transactions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
