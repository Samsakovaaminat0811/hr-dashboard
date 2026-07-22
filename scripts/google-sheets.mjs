import {createSign} from 'node:crypto';

const base64url = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
let accessToken;

const getAccessToken = async () => {
  if (accessToken) return accessToken;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !privateKey) throw new Error('Google service account credentials are not configured');

  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url({alg: 'RS256', typ: 'JWT'})}.${base64url({
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  const assertion = `${unsigned}.${signer.sign(privateKey, 'base64url')}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`Google OAuth ${response.status}`);
  accessToken = (await response.json()).access_token;
  return accessToken;
};

const api = async (url) => {
  const response = await fetch(url, {
    headers: {Authorization: `Bearer ${await getAccessToken()}`},
  });
  if (!response.ok) throw new Error(`Google Sheets ${response.status}: ${url}`);
  return response.json();
};

export const getSheetTitleById = async (spreadsheetId, sheetId) => {
  const data = await api(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`);
  const sheet = data.sheets?.find(({properties}) => properties.sheetId === sheetId);
  if (!sheet) throw new Error(`Missing worksheet gid=${sheetId}`);
  return sheet.properties.title;
};

export const getSheetValues = async (spreadsheetId, sheetName) => {
  const range = encodeURIComponent(`${sheetName}!A:ZZ`);
  const data = await api(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE`);
  return data.values || [];
};
