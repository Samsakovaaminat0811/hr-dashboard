import {mkdir, readFile, writeFile} from 'node:fs/promises';

const outputDir = '.deploy/hr';
const loaderStart = '<script>var dataVersion=Date.now();';
const loaderBoundary = '</script><script>';
const serverScripts = '<script src="data.php"></script><script src="people-data.php"></script><script>';

const index = await readFile('index.html', 'utf8');
const loaderStartIndex = index.indexOf(loaderStart);
const loaderEndIndex = index.indexOf(loaderBoundary, loaderStartIndex);
if (loaderStartIndex < 0 || loaderEndIndex < 0) {
  throw new Error('Dashboard data loader was not found in index.html');
}

const serverIndex = [
  index.slice(0, loaderStartIndex),
  serverScripts,
  index.slice(loaderEndIndex + loaderBoundary.length),
].join('');

const phpEndpoint = (fileName) => `<?php
require __DIR__ . '/bootstrap.php';
require_login();
header('Content-Type: application/javascript; charset=utf-8');
header('Cache-Control: no-store');
readfile(__DIR__ . '/${fileName}');
`;
const accessRules = `DirectoryIndex index.php
Options -Indexes
<FilesMatch "^(config\\.php|bootstrap\\.php|.*\\.payload\\.php|data\\.js|people-data\\.js)$">
  Require all denied
</FilesMatch>
<IfModule mod_headers.c>
  Header always set X-Content-Type-Options "nosniff"
  Header always set Referrer-Policy "same-origin"
</IfModule>
`;

await mkdir(outputDir, {recursive: true});
const [data, peopleData] = await Promise.all([
  readFile('data.js', 'utf8'),
  readFile('people-data.js', 'utf8'),
]);
await Promise.all([
  writeFile(`${outputDir}/index.html`, serverIndex, 'utf8'),
  writeFile(`${outputDir}/data.js`, data, 'utf8'),
  writeFile(`${outputDir}/people-data.js`, peopleData, 'utf8'),
  writeFile(`${outputDir}/data.php`, phpEndpoint('data.js'), 'utf8'),
  writeFile(`${outputDir}/people-data.php`, phpEndpoint('people-data.js'), 'utf8'),
  writeFile(`${outputDir}/.htaccess`, accessRules, 'utf8'),
]);

console.log(`Built protected HR deployment in ${outputDir}`);
