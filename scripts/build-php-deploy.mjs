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

const phpPayload = (javascript) =>
  `<?php\nreturn <<<'JS'\n${javascript.trim()}\nJS;\n`;

await mkdir(outputDir, {recursive: true});
await Promise.all([
  writeFile(`${outputDir}/index.html`, serverIndex, 'utf8'),
  readFile('data.js', 'utf8').then((value) =>
    writeFile(`${outputDir}/data.payload.php`, phpPayload(value), 'utf8')),
  readFile('people-data.js', 'utf8').then((value) =>
    writeFile(`${outputDir}/people-data.payload.php`, phpPayload(value), 'utf8')),
]);

console.log(`Built protected HR deployment in ${outputDir}`);
