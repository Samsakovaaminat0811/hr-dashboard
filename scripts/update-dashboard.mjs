import {readFile, writeFile} from 'node:fs/promises';
import {getSheetTitleById, getSheetTitles, getSheetValues} from './google-sheets.mjs';

const mainId = process.env.MAIN_SHEET_ID;
const peopleId = process.env.PEOPLE_SHEET_ID;
if (!mainId || !peopleId) throw new Error('Sheet IDs are not configured');

const num = (value) => {
  if (value == null || value === '' || String(value).startsWith('#')) return null;
  const parsed = Number(String(value).replace(/[%\s\u00a0]/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

const mainSheet = await getSheetTitleById(mainId, 1251070794);
const main = await getSheetValues(mainId, mainSheet);
const row = (label) => {
  const found = main.find((cells) => (cells[0] || '').trim() === label);
  if (!found) throw new Error(`Missing metric ${label}`);
  return found;
};

const rowInSection = (section, label) => {
  const start = main.findIndex((cells) => (cells[0] || '').trim() === section);
  if (start < 0) throw new Error(`Missing section ${section}`);
  const wanted = label.trim();
  const found = main.slice(start + 1).find((cells) => (cells[0] || '').trim() === wanted);
  if (!found) throw new Error(`Missing metric ${label} in ${section}`);
  return found;
};

const head = row('Численность');
let count = 0;
for (let month = 0; month < 12; month++) {
  if (num(head[2 + month * 3]) != null) count = month + 1;
}
if (!count) throw new Error('No current-year data');

const pair = (label, scale = 1) => {
  const cells = row(label);
  const prev = [];
  const curr = [];
  for (let month = 0; month < count; month++) {
    const a = num(cells[1 + month * 3]);
    const b = num(cells[2 + month * 3]);
    prev.push(a == null ? null : a / scale);
    curr.push(b == null ? null : b / scale);
  }
  return [prev, curr];
};

const pairFrom = (cells, scale = 1) => {
  const prev = [];
  const curr = [];
  for (let month = 0; month < count; month++) {
    const a = num(cells[1 + month * 3]);
    const b = num(cells[2 + month * 3]);
    prev.push(a == null ? null : a / scale);
    curr.push(b == null ? null : b / scale);
  }
  return [prev, curr];
};

const metrics = {
  hc: pair('Численность'),
  hi: pair('Принятые'),
  ex: pair('Уволенные'),
  tu: pair('% текучки'),
  closeRate: pair('% закрытия вакансий'),
  plan: pair('План штата'),
  fillRate: pair('% заполняемости'),
  vacancies: pair('Открытые вакансии'),
  candidates: pair('Кол-во кандидатов'),
  interviews: pair('Собеседования'),
  hires: pair('Успешные наймы'),
  funnel: pair('Конверсия воронки (%)'),
  hireSpend: pair('Общая сумма затрат на найм'),
  pay: pair('Общая сумма ФОТ', 1e6),
  rev: pair('Выручка', 1e6),
  cost: pair('Стоимость найма (на 1 чел)'),
  ot: pair('Переработки (часы)'),
  sal: pair('Средняя ЗП'),
};

const efficiency = {
  revenue: pairFrom(rowInSection('Эффективность/Производительность', 'Выручка'), 1e6),
  revenuePerEmployee: pairFrom(rowInSection('Эффективность/Производительность', 'Выручка на 1 сотрудника')),
  grossProfit: pairFrom(rowInSection('Эффективность/Производительность', 'Валовая прибыль'), 1e6),
  grossProfitPerEmployee: pairFrom(rowInSection('Эффективность/Производительность', 'Валовая прибыль на 1 сотрудника')),
  liters: pairFrom(rowInSection('Эффективность/Производительность', 'Выпуск в литрах')),
  litersPerEmployee: pairFrom(rowInSection('Эффективность/Производительность', 'Выпуск на 1 сотрудника')),
  outputRub: pairFrom(rowInSection('Эффективность/Производительность', 'Выпуск в рублях'), 1e6),
  outputRubPerEmployee: pairFrom(rowInSection('Эффективность/Производительность', 'Выпуск (руб) на 1 сотрудника')),
  payrollShare: pairFrom(rowInSection('Эффективность/Производительность', '% от выработки (ФОТ/Выручка)')),
};

const distribution = [
  ['ОПР', 'ОПР, чел'],
  ['Вспомогательный', 'Вспомогательный, чел'],
  ['ППР', 'ППР, чел'],
  ['РСС', 'РСС, чел'],
  ['Коммерция', 'Коммерция, чел'],
  ['RnD', 'RnD, чел'],
].map(([label, source]) => ({label, values: pairFrom(rowInSection('Распределение персонала', source))}));

const payrollDistribution = [
  ['ОПР', 'ОПР, чел'],
  ['Вспомогательный', 'Вспомогательный, чел'],
  ['ППР', 'ППР, чел'],
  ['РСС', 'РСС, чел'],
  ['Коммерция', 'Коммерция, чел'],
  ['RnD', 'RnD, чел'],
].map(([label, source]) => ({label, values: pairFrom(rowInSection('ФОТ по распределению персонала', source))}));

const monthNumber = Number(new Intl.DateTimeFormat('en', {timeZone: 'Europe/Moscow', month: 'numeric'}).format(new Date()));
const monthNames = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const peopleSheetPrefix = 'списочная численность_';
const peopleSheetTitles = new Set(await getSheetTitles(peopleId));
const rosterMonths = monthNames
  .map((month, index) => ({index, title: `${peopleSheetPrefix}${month}`}))
  .filter(({index, title}) => index < monthNumber && peopleSheetTitles.has(title));
if (!rosterMonths.length) throw new Error(`Missing workforce worksheets with prefix ${peopleSheetPrefix}`);

const normalizeHeader = (value) => String(value || '')
  .toLowerCase()
  .replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gu, ' ')
  .trim();

const findPeopleColumn = (field, aliases, headers) => {
  const wanted = aliases.map(normalizeHeader);
  const normalizedHeaders = headers.map(normalizeHeader);
  const index = normalizedHeaders.findIndex((header) => wanted.some((alias) => header === alias || header.includes(alias)));
  if (index < 0) {
    throw new Error(`Missing workforce column ${field}; headers: ${headers.filter(Boolean).join(' | ')}`);
  }
  return index;
};

const getPeopleColumns = (headers) => ({
  snils: findPeopleColumn('snils', ['снилс', 'снилс сотрудника', 'страховой номер'], headers),
  process: findPeopleColumn('process', ['процесс', 'процесс/функция', 'подразделение'], headers),
  category: findPeopleColumn('category', ['категория', 'категория персонала'], headers),
  gender: findPeopleColumn('gender', ['пол'], headers),
  birthDate: findPeopleColumn('birthDate', ['дата рождения', 'др', 'день рождения'], headers),
  tenureYears: findPeopleColumn('tenureYears', ['стаж', 'стаж лет', 'стаж работы', 'количество лет'], headers),
  contractType: findPeopleColumn('contractType', ['тип договора', 'вид договора', 'договор', 'форма оформления'], headers),
});

const normalizeSnils = (value) => String(value || '').replace(/\D/g, '');
const buildRoster = (values, sheetTitle) => {
  const headers = values[0] || [];
  const columns = getPeopleColumns(headers);
  const rows = values.slice(1).filter((cells) =>
    cells[columns.process] || cells[columns.category] || cells[columns.gender] || cells[columns.snils]
  );
  const bySnils = new Map();
  let missingSnils = 0;
  for (const cells of rows) {
    const snils = normalizeSnils(cells[columns.snils]);
    if (!snils) {
      missingSnils++;
      continue;
    }
    bySnils.set(snils, cells);
  }
  if (missingSnils) throw new Error(`${sheetTitle}: ${missingSnils} workforce rows are missing SNILS`);
  return {columns, rows, bySnils};
};

const rosters = [];
for (const month of rosterMonths) {
  const values = await getSheetValues(peopleId, month.title);
  rosters.push({...month, ...buildRoster(values, month.title)});
}

const latestRoster = rosters.at(-1);
const peopleSheet = latestRoster.title;
const peopleColumns = latestRoster.columns;
const peopleRows = latestRoster.rows;

const ensureMetricMonth = (series, index, fill = null) => {
  while (series[0].length <= index) series[0].push(fill);
  while (series[1].length <= index) series[1].push(fill);
};
const snilsMovementStartMonth = 7; // August, zero-based.
const movementRosters = rosters.filter(({index}) => index >= snilsMovementStartMonth);
if (movementRosters.length) {
  for (const key of ['hc', 'hi', 'ex', 'tu', 'hires', 'fillRate']) ensureMetricMonth(metrics[key], latestRoster.index);
}
for (const roster of rosters) {
  if (roster.index < snilsMovementStartMonth) continue;
  const previous = rosters.find((item) => item.index === roster.index - 1);
  metrics.hc[1][roster.index] = roster.rows.length;
  metrics.fillRate[1][roster.index] = metrics.plan[1][roster.index] ? Number((roster.rows.length / metrics.plan[1][roster.index] * 100).toFixed(1)) : null;
  if (!metrics.avgHc) metrics.avgHc = [Array(metrics.hc[0].length).fill(null), Array(metrics.hc[1].length).fill(null)];
  ensureMetricMonth(metrics.avgHc, roster.index);
  metrics.avgHc[1][roster.index] = previous ? (previous.rows.length + roster.rows.length) / 2 : roster.rows.length;
  if (previous) {
    let hired = 0;
    let exited = 0;
    for (const snils of roster.bySnils.keys()) {
      if (!previous.bySnils.has(snils)) hired++;
    }
    for (const snils of previous.bySnils.keys()) {
      if (!roster.bySnils.has(snils)) exited++;
    }
    metrics.hi[1][roster.index] = hired;
    metrics.hires[1][roster.index] = hired;
    metrics.ex[1][roster.index] = exited;
    metrics.tu[1][roster.index] = metrics.avgHc[1][roster.index] ? Number((exited / metrics.avgHc[1][roster.index] * 100).toFixed(1)) : null;
  }
}

const ref = new Date();
const ages = [];
const cats = {};
const processes = {};
const contracts = {};
const ten = {'0–1 год': 0, '1–3 года': 0, '3–5 лет': 0, '5–8 лет': 0, '8–10 лет': 0, '10+ лет': 0};
let male = 0;
let female = 0;
let tenureCount = 0;

const normalizeCategory = (value) => {
  const key = (value || 'Не указано').trim().toLowerCase();
  const map = {
    'основные рабочие': 'Основные рабочие',
    'вспомогательный персонал': 'Вспомогательные',
    'рсс': 'РСС',
    'производственный персонал': 'Производственные',
    'коммерция': 'Коммерция',
    'декрет': 'Декрет',
    'rnd': 'RnD',
    'не указано': 'Не указано',
  };
  return map[key] || value.trim();
};

const normalizeContract = (value) => {
  const key = (value || 'Не указано').trim().toLowerCase().replace(/\s+/g, ' ');
  const map = {
    'тд': 'ТД',
    'т/д': 'ТД',
    'трудовой договор': 'ТД',
    'б/д': 'Б/Д',
    'бд': 'Б/Д',
    'без договора': 'Б/Д',
    'сезон': 'Сезон',
    'сезонный': 'Сезон',
    'ка': 'КА',
    'ип': 'ИП',
    'не указано': 'Не указано',
  };
  return map[key] || value.trim();
};

for (const cells of peopleRows) {
  const gender = (cells[peopleColumns.gender] || '').toLowerCase();
  if (gender === 'м') male++;
  else if (gender === 'ж') female++;

  const category = normalizeCategory(cells[peopleColumns.category]);
  cats[category] = (cats[category] || 0) + 1;

  let process = (cells[peopleColumns.process] || 'Не указано').trim();
  const processKey = process.toLowerCase().replace(/\s+/g, ' ');
  if (processKey === 'склад' || processKey.startsWith('складскладской учет и хранение') || processKey.startsWith('складской учет и хранение')) {
    process = 'Складской учет и хранение (сырье и упаковка)';
  }
  processes[process] = (processes[process] || 0) + 1;

  const contract = normalizeContract(cells[peopleColumns.contractType]);
  contracts[contract] = (contracts[contract] || 0) + 1;

  const birth = (cells[peopleColumns.birthDate] || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (birth) {
    let age = ref.getFullYear() - Number(birth[3]);
    const month = Number(birth[2]) - 1;
    const day = Number(birth[1]);
    if (ref.getMonth() < month || (ref.getMonth() === month && ref.getDate() < day)) age--;
    if (age >= 14 && age <= 90) ages.push(age);
  }

  const years = num(cells[peopleColumns.tenureYears]);
  if (years != null && years >= 0 && years <= 60) {
    tenureCount++;
    if (years < 1) ten['0–1 год']++;
    else if (years < 3) ten['1–3 года']++;
    else if (years < 5) ten['3–5 лет']++;
    else if (years < 8) ten['5–8 лет']++;
    else if (years < 10) ten['8–10 лет']++;
    else ten['10+ лет']++;
  }
}

ages.sort((a, b) => a - b);
const ageBands = {'до 25': 0, '25–34': 0, '35–44': 0, '45–54': 0, '55+': 0};
for (const age of ages) {
  if (age < 25) ageBands['до 25']++;
  else if (age < 35) ageBands['25–34']++;
  else if (age < 45) ageBands['35–44']++;
  else if (age < 55) ageBands['45–54']++;
  else ageBands['55+']++;
}

const sorted = (value) => Object.entries(value).sort((a, b) => b[1] - a[1]);
const people = {
  count: peopleRows.length,
  male,
  female,
  tenureCount,
  ageCount: ages.length,
  avgAge: ages.reduce((sum, age) => sum + age, 0) / ages.length,
  medianAge: ages[Math.floor(ages.length / 2)],
  ageBands: Object.entries(ageBands),
  categories: sorted(cats),
  processes: sorted(processes),
  contractTypes: sorted(contracts),
  tenure: Object.entries(ten),
};

if (latestRoster.index >= snilsMovementStartMonth) {
  metrics.hc[1][latestRoster.index] = people.count;
}

const currentText = await readFile('data.js', 'utf8');
const current = JSON.parse(currentText.replace(/^window\.HR_DATA=/, '').replace(/;\s*$/, ''));

const next = {
  ...current,
  updatedAt: new Date().toISOString(),
  metrics,
  people,
  efficiency,
  distribution,
  payrollDistribution,
};

const output = `window.HR_DATA=${JSON.stringify(next)};\n`;
await writeFile('data.js', output, 'utf8');
console.log(JSON.stringify({
  updatedAt: next.updatedAt,
  months: count,
  people: next.people.count,
  june: {
    pay2026: next.metrics.pay[1][5],
    revenue2026: next.metrics.rev[1][5],
    revenuePerEmployee2026: next.efficiency.revenuePerEmployee[1][5],
    grossProfit2026: next.efficiency.grossProfit[1][5],
    opStaff2026: next.distribution[0].values[1][5],
    opPayroll2026: next.payrollDistribution[0].values[1][5],
  },
  bytes: output.length,
}, null, 2));
