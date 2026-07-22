import {readFile, writeFile} from 'node:fs/promises';
import {getSheetTitleById, getSheetValues} from './google-sheets.mjs';

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
const peopleSheet = `списочная численность_${monthNames[monthNumber - 1]}`;
const peopleRows = (await getSheetValues(peopleId, peopleSheet)).slice(1).filter((cells) => cells[0] || cells[3]);

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
  const gender = (cells[8] || '').toLowerCase();
  if (gender === 'м') male++;
  else if (gender === 'ж') female++;

  const category = normalizeCategory(cells[2]);
  cats[category] = (cats[category] || 0) + 1;

  let process = (cells[1] || 'Не указано').trim();
  const processKey = process.toLowerCase().replace(/\s+/g, ' ');
  if (processKey === 'склад' || processKey.startsWith('складскладской учет и хранение') || processKey.startsWith('складской учет и хранение')) {
    process = 'Складской учет и хранение (сырье и упаковка)';
  }
  processes[process] = (processes[process] || 0) + 1;

  const contract = normalizeContract(cells[15]);
  contracts[contract] = (contracts[contract] || 0) + 1;

  const birth = (cells[10] || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (birth) {
    let age = ref.getFullYear() - Number(birth[3]);
    const month = Number(birth[2]) - 1;
    const day = Number(birth[1]);
    if (ref.getMonth() < month || (ref.getMonth() === month && ref.getDate() < day)) age--;
    if (age >= 14 && age <= 90) ages.push(age);
  }

  const years = num(cells[13]);
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

// The current workforce register is the single source of truth for actual headcount.
metrics.hc[1][metrics.hc[1].length - 1] = people.count;

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
