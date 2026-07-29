<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';
require_login();

header('Content-Type: application/javascript; charset=utf-8');
header('Cache-Control: no-store');

try {
    $statement = db()->prepare(
        'SELECT payload FROM dashboard_data WHERE dashboard = :dashboard AND dataset = :dataset'
    );
    $statement->execute(['dashboard' => 'hr', 'dataset' => 'data']);
    $payload = $statement->fetchColumn();
    if (is_string($payload) && $payload !== '') {
        header('X-HR-Data-Source: database');
        echo $payload;
        exit;
    }
} catch (PDOException $error) {
    error_log('HR dashboard database read failed: ' . $error->getMessage());
}

header('X-HR-Data-Source: file-fallback');
readfile(__DIR__ . '/data.js');
