import {readFile} from 'node:fs/promises';

const endpoint = process.env.HR_INGEST_URL;
const token = process.env.HR_INGEST_TOKEN;

if (!endpoint || !token) {
  throw new Error('HR_INGEST_URL and HR_INGEST_TOKEN are required');
}

const [data, peopleData] = await Promise.all([
  readFile('data.js', 'utf8'),
  readFile('people-data.js', 'utf8'),
]);

const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-HR-Ingest-Token': token,
  },
  body: JSON.stringify({data, peopleData}),
});

const responseText = await response.text();
if (!response.ok) {
  throw new Error(`HR database publish failed (${response.status}): ${responseText.slice(0, 300)}`);
}

const result = JSON.parse(responseText);
console.log(`Published HR datasets to database at ${result.updatedAt}`);
