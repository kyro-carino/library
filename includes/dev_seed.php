<?php

declare(strict_types=1);

const DEV_ADMIN_USERNAME = 'admin';
const DEV_ADMIN_EMAIL = 'admin@library.local';
const DEV_ADMIN_DISPLAY = 'Library Administrator';

function developmentAdminPassword(): ?string {
    $password = getenv('DEV_ADMIN_PASSWORD');
    if ($password === false || $password === '') {
        return null;
    }
    $lower = strtolower($password);
    if (strlen($password) < 12 || str_contains($lower, 'admin') || str_contains($lower, 'password') || str_contains($lower, '12345')) {
        throw new RuntimeException('DEV_ADMIN_PASSWORD must be at least 12 characters and must not contain "admin", "password" or "12345".');
    }
    return $password;
}

function ensureDevCatalogSeed(PDO $pdo): void {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS seed_meta (
          name VARCHAR(64) PRIMARY KEY,
          applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");

    $lock = (int)$pdo->query("SELECT GET_LOCK('feu_dev_catalog_seed', 8)")->fetchColumn();
    if (!$lock) {
        return;
    }

    try {
        $flag = $pdo->prepare('SELECT name FROM seed_meta WHERE name = ?');
        $flag->execute(['dev_catalog_v1']);
        if ($flag->fetch()) {
            return;
        }

        $pdo->beginTransaction();
        try {
            seedDevUsers($pdo);
            seedDevBooks($pdo);
            seedDevTransactions($pdo);
            $pdo->prepare('INSERT INTO seed_meta (name) VALUES (?)')->execute(['dev_catalog_v1']);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            error_log('[feu-library] dev seed: ' . $e->getMessage());
            throw $e;
        }
    } finally {
        $pdo->query("SELECT RELEASE_LOCK('feu_dev_catalog_seed')");
    }
}

function seedDevUsers(PDO $pdo): void {
    $users = [
        ['SEED-U01', 'Reyes', 'Luna', 'A', 'BS Information Technology', 2, 'luna.reyes@example.invalid', 'Active'],
        ['SEED-U02', 'Santos', 'Marco', 'J', 'BS Psychology', 3, 'marco.santos@example.invalid', 'Active'],
        ['SEED-U03', 'Villanueva', 'Aria', 'P', 'BS Architecture', 1, 'aria.villanueva@example.invalid', 'Active'],
        ['SEED-U04', 'Cruz', 'Noah', 'D', 'BS Accountancy', 4, 'noah.cruz@example.invalid', 'Active'],
        ['SEED-U05', 'Garcia', 'Mika', 'L', 'BS Nursing', 2, 'mika.garcia@example.invalid', 'Active'],
        ['SEED-U06', 'Tan', 'Eli', 'R', 'BS Civil Engineering', 3, 'eli.tan@example.invalid', 'Active'],
        ['SEED-U07', 'Ramos', 'Sofia', 'K', 'BS Biology', 1, 'sofia.ramos@example.invalid', 'Active'],
        ['SEED-U08', 'Lim', 'Paolo', 'S', 'BS Computer Science', 4, 'paolo.lim@example.invalid', 'Active'],
        ['SEED-U09', 'Navarro', 'Celine', 'M', 'BS Education', 2, 'celine.navarro@example.invalid', 'Active'],
        ['SEED-U10', 'Ocampo', 'Diego', 'F', 'BA Communication', 3, 'diego.ocampo@example.invalid', 'Inactive'],
        ['SEED-U11', 'Fernandez', 'Ivy', 'G', 'BS Mathematics', 1, 'ivy.fernandez@example.invalid', 'Active'],
        ['SEED-U12', 'Bautista', 'Theo', 'N', 'BS Business Administration', 2, 'theo.bautista@example.invalid', 'Active'],
        ['SEED-U13', 'Dela Peña', 'Kara', 'V', 'BS Psychology', 4, 'kara.delapena@example.invalid', 'Active'],
        ['SEED-U14', 'Santiago', 'Jules', 'H', 'BS Information Technology', 3, 'jules.santiago@example.invalid', 'Active'],
        ['SEED-U15', 'Mercado', 'Nina', 'C', 'BA Political Science', 2, 'nina.mercado@example.invalid', 'Active'],
    ];
    $stmt = $pdo->prepare('
        INSERT INTO users (id, last_name, first_name, middle_initial, program, year_level, contact, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE id = id
    ');
    foreach ($users as $u) {
        $stmt->execute($u);
    }
}

function seedDevBooks(PDO $pdo): void {
    $blurb = static function (string $text): string {
        return '[DEV SEED] ' . $text;
    };
    $cover = static function (string $isbn): string {
        return 'https://covers.openlibrary.org/b/isbn/' . $isbn . '-M.jpg';
    };

    $books = [
        ['SEED-B01', 'The Great Gatsby', 'F. Scott Fitzgerald', 'Literature', '9780743273565', 1925, 'A-12', $blurb('A glittering, doomed summer on Long Island.'), 'Paperback', $cover('9780743273565')],
        ['SEED-B02', '1984', 'George Orwell', 'Literature', '9780451524935', 1949, 'A-01', $blurb('A totalitarian future where language itself is rewritten.'), 'Paperback', $cover('9780451524935')],
        ['SEED-B03', 'To Kill a Mockingbird', 'Harper Lee', 'Literature', '9780061120084', 1960, 'A-07', $blurb('A small-town trial and a child’s early lessons in conscience.'), 'Hardcover', $cover('9780061120084')],
        ['SEED-B04', 'Brave New World', 'Aldous Huxley', 'Literature', '9780060850524', 1932, 'A-15', $blurb('A society engineered for comfort at a quiet cost.'), 'Paperback', $cover('9780060850524')],
        ['SEED-B05', 'Leaves of Grass', 'Walt Whitman', 'Literature', '9781593080834', 1855, 'F-03', $blurb('An expansive collection that helped define American poetry.'), 'Paperback', $cover('9781593080834')],
        ['SEED-B06', 'A Brief History of Time', 'Stephen Hawking', 'Science', '9780553380163', 1988, 'D-19', $blurb('An accessible tour of cosmology for non-specialists.'), 'Paperback', $cover('9780553380163')],
        ['SEED-B07', 'Cosmos', 'Carl Sagan', 'Science', '9780345539434', 1980, 'D-06', $blurb('A guided tour of the universe and our place in it.'), 'Hardcover', $cover('9780345539434')],
        ['SEED-B08', 'The Selfish Gene', 'Richard Dawkins', 'Science', '9780198788607', 1976, 'D-14', $blurb('A gene’s-eye view of evolution.'), 'Paperback', $cover('9780198788607')],
        ['SEED-B09', 'Astrophysics for People in a Hurry', 'Neil deGrasse Tyson', 'Science', '9780393609394', 2017, 'D-25', $blurb('Big cosmic ideas in short chapters.'), 'Hardcover', $cover('9780393609394')],
        ['SEED-B10', 'Sapiens', 'Yuval Noah Harari', 'History', '9780062316097', 2011, 'D-02', $blurb('How Homo sapiens came to dominate the planet.'), 'Paperback', $cover('9780062316097')],
        ['SEED-B11', 'Guns, Germs, and Steel', 'Jared Diamond', 'History', '9780393317558', 1997, 'D-22', $blurb('Why history’s advantages fell to some societies and not others.'), 'Paperback', $cover('9780393317558')],
        ['SEED-B12', 'The Silk Roads', 'Peter Frankopan', 'History', '9781101912379', 2015, 'D-11', $blurb('World history centered on the routes linking East and West.'), 'Paperback', $cover('9781101912379')],
        ['SEED-B13', 'A People’s History of the United States', 'Howard Zinn', 'History', '9780062397348', 1980, 'D-30', $blurb('American history told from the ground up.'), 'Paperback', $cover('9780062397348')],
        ['SEED-B14', 'Meditations', 'Marcus Aurelius', 'Philosophy', '9780140449334', 2006, 'E-11', $blurb('A Roman emperor’s private notebook on staying calm and useful.'), 'Paperback', $cover('9780140449334')],
        ['SEED-B15', 'The Republic', 'Plato', 'Philosophy', '9780140449140', 2007, 'E-02', $blurb('A dialogue on justice, the soul, and the ideal city.'), 'Paperback', $cover('9780140449140')],
        ['SEED-B16', 'Beyond Good and Evil', 'Friedrich Nietzsche', 'Philosophy', '9780486298689', 1886, 'E-17', $blurb('A provocation aimed at familiar moral assumptions.'), 'Paperback', $cover('9780486298689')],
        ['SEED-B17', 'Clean Code', 'Robert C. Martin', 'Technology', '9780132350884', 2008, 'B-04', $blurb('A field guide to writing software that stays readable.'), 'Hardcover', $cover('9780132350884')],
        ['SEED-B18', 'The Pragmatic Programmer', 'Andrew Hunt', 'Technology', '9780135957059', 2019, 'B-09', $blurb('Field-tested habits for well-crafted software.'), 'Hardcover', $cover('9780135957059')],
        ['SEED-B19', 'Refactoring', 'Martin Fowler', 'Technology', '9780134757599', 1999, 'B-13', $blurb('Small, safe steps for improving existing code.'), 'Hardcover', $cover('9780134757599')],
        ['SEED-B20', 'The Design of Everyday Things', 'Don Norman', 'Arts', '9780465050659', 2013, 'B-18', $blurb('Why everyday objects confuse us, and what good design owes users.'), 'Paperback', $cover('9780465050659')],
        ['SEED-B21', "Don't Make Me Think", 'Steve Krug', 'Arts', '9780321965516', 2000, 'B-21', $blurb('A practical case for usability.'), 'Paperback', $cover('9780321965516')],
        ['SEED-B22', 'Ways of Seeing', 'John Berger', 'Arts', '9780140135152', 1972, 'F-21', $blurb('How images teach us to look, and who that looking serves.'), 'Paperback', $cover('9780140135152')],
        ['SEED-B23', 'Atomic Habits', 'James Clear', 'Psychology', '9780735211292', 2018, 'C-07', $blurb('Building good habits through small compounding changes.'), 'Hardcover', $cover('9780735211292')],
        ['SEED-B24', 'Thinking, Fast and Slow', 'Daniel Kahneman', 'Psychology', '9780374533557', 2011, 'C-11', $blurb('Two systems of thought and the biases they leave behind.'), 'Paperback', $cover('9780374533557')],
        ['SEED-B25', 'Man’s Search for Meaning', 'Viktor E. Frankl', 'Psychology', '9780807014271', 2006, 'C-22', $blurb('A psychiatrist’s account of purpose under extreme hardship.'), 'Paperback', $cover('9780807014271')],
        ['SEED-B26', 'Deep Work', 'Cal Newport', 'Business', '9781455586691', 2016, 'C-14', $blurb('Protecting long stretches of undistracted focus.'), 'Hardcover', $cover('9781455586691')],
        ['SEED-B27', 'The Lean Startup', 'Eric Ries', 'Business', '9780307887894', 2011, 'C-08', $blurb('Building products through measured experiments.'), 'Hardcover', $cover('9780307887894')],
        ['SEED-B28', 'Good to Great', 'Jim Collins', 'Business', '9780066620992', 2001, 'C-02', $blurb('What separates companies that make a lasting leap.'), 'Hardcover', $cover('9780066620992')],
        ['SEED-B29', 'A Mathematician’s Apology', 'G. H. Hardy', 'Mathematics', '9780521427067', 1940, 'M-04', $blurb('A defense of pure mathematics as a creative art.'), 'Paperback', $cover('9780521427067')],
        ['SEED-B30', 'How to Solve It', 'George Pólya', 'Mathematics', '9780691164076', 1945, 'M-09', $blurb('A practical method for attacking unfamiliar problems.'), 'Paperback', $cover('9780691164076')],
        ['SEED-B31', 'The Art of Computer Programming, Vol. 1', 'Donald E. Knuth', 'Computer Science', '9780201896831', 1997, 'CS-01', $blurb('Foundational algorithms and the craft of programming.'), 'Hardcover', $cover('9780201896831')],
        ['SEED-B32', 'Introduction to Algorithms', 'Thomas H. Cormen', 'Computer Science', '9780262033848', 2009, 'CS-07', $blurb('A standard reference for algorithm design and analysis.'), 'Hardcover', $cover('9780262033848')],
        ['SEED-B33', 'Structure and Interpretation of Computer Programs', 'Harold Abelson', 'Computer Science', '9780262510875', 1996, 'CS-12', $blurb('Programming as a way of expressing ideas.'), 'Paperback', $cover('9780262510875')],
        ['SEED-B34', 'Pedagogy of the Oppressed', 'Paulo Freire', 'Education', '9780826412768', 1970, 'ED-03', $blurb('A critique of banking-model education and a case for dialogue.'), 'Paperback', $cover('9780826412768')],
        ['SEED-B35', 'Teaching to Transgress', 'bell hooks', 'Education', '9780415908085', 1994, 'ED-08', $blurb('Education as a practice of freedom.'), 'Paperback', $cover('9780415908085')],
        ['SEED-B36', 'Mindset', 'Carol S. Dweck', 'Education', '9780345472328', 2006, 'ED-14', $blurb('How beliefs about ability shape learning.'), 'Paperback', $cover('9780345472328')],
        ['SEED-B37', 'The Sociological Imagination', 'C. Wright Mills', 'Social Sciences', '9780195133738', 1959, 'SS-02', $blurb('Connecting private troubles to public issues.'), 'Paperback', $cover('9780195133738')],
        ['SEED-B38', 'Bowling Alone', 'Robert D. Putnam', 'Social Sciences', '9780743203043', 2000, 'SS-11', $blurb('The decline of civic life in late-twentieth-century America.'), 'Paperback', $cover('9780743203043')],
        ['SEED-B39', 'Orientalism', 'Edward W. Said', 'Social Sciences', '9780394740676', 1978, 'SS-18', $blurb('How the West constructed a version of the East.'), 'Paperback', $cover('9780394740676')],
        ['SEED-B40', 'Design Patterns', 'Erich Gamma', 'Computer Science', '9780201633610', 1994, 'B-01', $blurb('Reusable solutions to recurring design problems.'), 'Hardcover', $cover('9780201633610')],
    ];

    $stmt = $pdo->prepare('
        INSERT INTO books (id, title, author, category, year, location, status, description, format, cover_url, renewal_count)
        VALUES (?, ?, ?, ?, ?, ?, \'Available\', ?, ?, ?, 0)
        ON DUPLICATE KEY UPDATE id = id
    ');
    foreach ($books as $b) {
        unset($b[4]); // the ISBN only feeds the cover URL above; it is no longer stored
        $stmt->execute(array_values($b));
    }
}

function seedDevTransactions(PDO $pdo): void {
    $settings = loadSettingsRow($pdo);
    $today = new DateTimeImmutable('now', new DateTimeZone(APP_TIMEZONE));
    $iso = static function (DateTimeImmutable $d): string {
        return $d->format('Y-m-d');
    };
    $ago = static function (int $days) use ($today, $iso): string {
        return $iso($today->modify("-{$days} days"));
    };
    $from = static function (int $days) use ($today, $iso): string {
        return $iso($today->modify("+{$days} days"));
    };

    $nameOf = static function (PDO $pdo, string $userId): string {
        $stmt = $pdo->prepare('SELECT last_name, first_name, middle_initial FROM users WHERE id = ?');
        $stmt->execute([$userId]);
        $row = $stmt->fetch();
        return $row ? formatUserName($row['last_name'], $row['first_name'], $row['middle_initial'] ?? '') : $userId;
    };
    $titleOf = static function (PDO $pdo, string $bookId): string {
        $stmt = $pdo->prepare('SELECT title FROM books WHERE id = ?');
        $stmt->execute([$bookId]);
        return (string)$stmt->fetchColumn();
    };

    $open = [
        // Active loans (due in the future)
        ['SEED-T01', 'SEED-B02', 'SEED-U01', $ago(3), $from(4), null, 0.00, 'Borrowed'],
        ['SEED-T02', 'SEED-B17', 'SEED-U08', $ago(2), $from(5), null, 0.00, 'Borrowed'],
        ['SEED-T03', 'SEED-B23', 'SEED-U05', $ago(1), $from(6), null, 0.00, 'Borrowed'],
        ['SEED-T04', 'SEED-B31', 'SEED-U14', $ago(4), $from(3), null, 0.00, 'Borrowed'],
        ['SEED-T05', 'SEED-B10', 'SEED-U15', $ago(5), $from(2), null, 0.00, 'Borrowed'],
        // Overdue loans
        ['SEED-T06', 'SEED-B06', 'SEED-U02', $ago(20), $ago(13), null, 0.00, 'Overdue'],
        ['SEED-T07', 'SEED-B24', 'SEED-U13', $ago(18), $ago(11), null, 0.00, 'Overdue'],
        ['SEED-T08', 'SEED-B34', 'SEED-U09', $ago(16), $ago(9), null, 0.00, 'Overdue'],
        ['SEED-T09', 'SEED-B37', 'SEED-U03', $ago(14), $ago(7), null, 0.00, 'Overdue'],
        // Returned (some on time, some late with fines)
        ['SEED-T10', 'SEED-B01', 'SEED-U04', $ago(30), $ago(23), $ago(22), 0.00, 'Returned'],
        ['SEED-T11', 'SEED-B07', 'SEED-U06', $ago(28), $ago(21), $ago(21), 0.00, 'Returned'],
        ['SEED-T12', 'SEED-B20', 'SEED-U07', $ago(26), $ago(19), $ago(18), 0.00, 'Returned'],
        ['SEED-T13', 'SEED-B26', 'SEED-U12', $ago(24), $ago(17), $ago(10), 0.00, 'Returned'],
        ['SEED-T14', 'SEED-B32', 'SEED-U08', $ago(22), $ago(15), $ago(8), 0.00, 'Returned'],
        ['SEED-T15', 'SEED-B11', 'SEED-U01', $ago(21), $ago(14), $ago(14), 0.00, 'Returned'],
        ['SEED-T16', 'SEED-B14', 'SEED-U11', $ago(19), $ago(12), $ago(5), 0.00, 'Returned'],
        ['SEED-T17', 'SEED-B40', 'SEED-U14', $ago(12), $ago(5), $ago(4), 0.00, 'Returned'],
        ['SEED-T18', 'SEED-B28', 'SEED-U12', $ago(10), $ago(3), $ago(1), 0.00, 'Returned'],
    ];

    $insert = $pdo->prepare('
        INSERT INTO transactions (id, type, book_id, book_title, user_id, user_name, issue_date, due_date, return_date, fine, status, renewal_count)
        VALUES (?, \'issue\', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON DUPLICATE KEY UPDATE id = id
    ');
    $updateBookOpen = $pdo->prepare('
        UPDATE books
        SET status = ?, borrowed_by = ?, issue_date = ?, due_date = ?, renewal_count = 0
        WHERE id = ? AND deleted_at IS NULL
    ');
    $clearBook = $pdo->prepare('
        UPDATE books
        SET status = \'Available\', borrowed_by = NULL, issue_date = NULL, due_date = NULL, renewal_count = 0
        WHERE id = ? AND deleted_at IS NULL
    ');

    foreach ($open as $row) {
        [$id, $bookId, $userId, $issue, $due, $returned, $fine, $status] = $row;
        if ($status === 'Returned' && $returned) {
            $fine = calculateFineAmount($due, $returned, $settings);
        }
        $insert->execute([
            $id,
            $bookId,
            $titleOf($pdo, $bookId),
            $userId,
            $nameOf($pdo, $userId),
            $issue,
            $due,
            $returned,
            $fine,
            $status,
        ]);
        if ($status === 'Returned') {
            $clearBook->execute([$bookId]);
        } else {
            $updateBookOpen->execute([$status, $userId, $issue, $due, $bookId]);
        }
    }
}