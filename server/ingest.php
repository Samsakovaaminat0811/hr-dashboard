<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Allow: POST');
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$providedToken = (string) ($_SERVER['HTTP_X_HR_INGEST_TOKEN'] ?? '');
$expectedToken = (string) ($config['ingest_token'] ?? '');
if ($expectedToken === '' || !hash_equals($expectedToken, $providedToken)) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}

try {
    $body = file_get_contents('php://input');
    if ($body === false || strlen($body) > 20 * 1024 * 1024) {
        throw new RuntimeException('Invalid request size');
    }

    $input = json_decode($body, true, 4, JSON_THROW_ON_ERROR);
    $datasets = [
        'data' => $input['data'] ?? null,
        'people-data' => $input['peopleData'] ?? null,
    ];

    foreach ($datasets as $dataset => $payload) {
        if (!is_string($payload) || $payload === '' || strlen($payload) > 10 * 1024 * 1024) {
            throw new RuntimeException("Invalid {$dataset} payload");
        }
    }
    if (strpos($datasets['data'], 'window.HR_DATA=') !== 0 ||
        strpos($datasets['people-data'], 'window.HR_PEOPLE_DATA=') !== 0) {
        throw new RuntimeException('Unexpected payload format');
    }

    $database = db();
    $database->exec(
        'CREATE TABLE IF NOT EXISTS dashboard_data (
            dashboard VARCHAR(32) NOT NULL,
            dataset VARCHAR(64) NOT NULL,
            payload LONGTEXT NOT NULL,
            updated_at DATETIME(6) NOT NULL,
            PRIMARY KEY (dashboard, dataset)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    $database->beginTransaction();
    $statement = $database->prepare(
        'INSERT INTO dashboard_data (dashboard, dataset, payload, updated_at)
         VALUES (:dashboard, :dataset, :payload, UTC_TIMESTAMP(6))
         ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = VALUES(updated_at)'
    );
    foreach ($datasets as $dataset => $payload) {
        $statement->execute([
            'dashboard' => 'hr',
            'dataset' => $dataset,
            'payload' => $payload,
        ]);
    }
    $database->commit();

    echo json_encode([
        'ok' => true,
        'updatedAt' => gmdate('c'),
        'datasets' => array_keys($datasets),
    ]);
} catch (JsonException | RuntimeException $error) {
    if (isset($database) && $database->inTransaction()) {
        $database->rollBack();
    }
    error_log('HR dashboard ingest failed: ' . $error->getMessage());
    http_response_code(400);
    echo json_encode(['error' => 'Invalid payload']);
} catch (Throwable $error) {
    if (isset($database) && $database->inTransaction()) {
        $database->rollBack();
    }
    error_log('HR dashboard database update failed: ' . $error->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'Database update failed']);
}
