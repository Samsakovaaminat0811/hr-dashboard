import {writeFile} from 'node:fs/promises';

const mainId=process.env.MAIN_SHEET_ID;
const peopleId=process.env.PEOPLE_SHEET_ID;
if(!mainId||!peopleId) throw new Error('Sheet IDs are not configured');

const get=async(id,gid)=>{
  const url='https://docs.google.com/spreadsheets/d/'+id+'/gviz/tq?tqx=out:html&gid='+gid;
  const response=await fetch(url);
  if(!response.ok) throw new Error('Google Sheets '+response.status);
  return response.text();
};
const decode=value=>value.replace(/<[^>]+>/g,'').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
const table=html=>[...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(row=>[...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell=>decode(cell[1])));
const num=value=>{
  if(value==null||value==='') return null;
  const parsed=Number(String(value).replace(/[%\s ]/g,'').replace(',','.'));
  return Number.isFinite(parsed)?parsed:null;
};

const main=table(await get(mainId,'1251070794'));
const rowIndex=(label,start=0)=>main.findIndex((item,index)=>index>=start&&(item[0]||'').trim()===label);
const row=(label,start=0)=>{
  const index=rowIndex(label,start);
  if(index<0) throw new Error('Missing metric '+label);
  return main[index];
};
const sectionRow=(section,label)=>{
  const sectionIndex=rowIndex(section);
  if(sectionIndex<0) throw new Error('Missing section '+section);
  return row(label,sectionIndex+1);
};

const head=row('Численность');
let count=0;
for(let month=0;month<12;month++) if(num(head[2+month*3])!=null) count=month+1;
if(!count) throw new Error('No current-year data');

const pairFromRow=(source,scale=1)=>{
  const previous=[];
  const current=[];
  for(let month=0;month<count;month++){
    const oldValue=num(source[1+month*3]);
    const newValue=num(source[2+month*3]);
    previous.push(oldValue==null?null:oldValue/scale);
    current.push(newValue==null?null:newValue/scale);
  }
  return [previous,current];
};
const pair=(label,scale=1)=>pairFromRow(row(label),scale);
const sectionPair=(section,label,scale=1)=>pairFromRow(sectionRow(section,label),scale);

const metrics={
  hc:pair('Численность'),
  hi:pair('Принятые'),
  ex:pair('Уволенные'),
  tu:pair('% текучки'),
  closeRate:pair('% закрытия вакансий'),
  plan:pair('План штата'),
  fillRate:pair('% заполняемости'),
  vacancies:pair('Открытые вакансии'),
  candidates:pair('Кол-во кандидатов'),
  interviews:pair('Собеседования'),
  funnel:pair('Конверсия воронки (%)'),
  hireSpend:pair('Общая сумма затрат на найм'),
  cost:pair('Стоимость найма (на 1 чел)'),
  pay:pair('Общая сумма ФОТ',1e6),
  rev:pair('Выручка',1e6),
  ot:pair('Переработки (часы)'),
  sal:pair('Средняя ЗП')
};

const efficiency={
  revenue:sectionPair('Операционная эффективность','Выручка',1e6),
  revenuePerEmployee:sectionPair('Операционная эффективность','Выручка на 1 сотрудника'),
  grossProfit:sectionPair('Операционная эффективность','Валовая прибыль',1e6),
  grossProfitPerEmployee:sectionPair('Операционная эффективность','Валовая прибыль на 1 сотрудника'),
  liters:sectionPair('Операционная эффективность','Выпуск в литрах'),
  litersPerEmployee:sectionPair('Операционная эффективность','Выпуск на 1 сотрудника'),
  outputRub:sectionPair('Операционная эффективность','Выпуск в рублях',1e6),
  outputRubPerEmployee:sectionPair('Операционная эффективность','Выпуск (руб) на 1 сотрудника'),
  payrollShare:sectionPair('Операционная эффективность','% от выработки (ФОТ/Выручка)')
};

const labels=['ОПР, чел','Вспомогательный, чел','ППР, чел','РСС, чел','Коммерция, чел','RnD, чел'];
const distribution=labels.map(label=>({label:label.replace(', чел',''),values:sectionPair('Распределение персонала',label)}));
const payrollDistribution=labels.map(label=>({label:label.replace(', чел',''),values:sectionPair('ФОТ распределению персонала',label,1e6)}));

const peopleRows=table(await get(peopleId,'251230291')).slice(1).filter(item=>item[3]&&item[6]&&item[8]);
const referenceDate=new Date();
const ages=[];
const categories={};
const tenure={'0–1 год':0,'1–3 года':0,'3–5 лет':0,'5–8 лет':0,'8–10 лет':0,'10+ лет':0};
let male=0,female=0,tenureCount=0;
const normalize=value=>{
  const key=(value||'Не указано').trim().toLowerCase();
  const map={'основные рабочие':'Основные рабочие','вспомогательный персонал':'Вспомогательные','рсс':'РСС','производственный персонал':'Производственные','коммерция':'Коммерция','декрет':'Декрет','rnd':'RnD','не указано':'Не указано'};
  return map[key]||value.trim();
};
for(const person of peopleRows){
  const gender=person[6].toLowerCase();
  if(gender==='м') male++;
  else if(gender==='ж') female++;
  const category=normalize(person[2]);
  categories[category]=(categories[category]||0)+1;
  const birth=person[8].match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if(birth){
    let age=referenceDate.getFullYear()-Number(birth[3]);
    const month=Number(birth[2])-1;
    const day=Number(birth[1]);
    if(referenceDate.getMonth()<month||(referenceDate.getMonth()===month&&referenceDate.getDate()<day)) age--;
    if(age>=14&&age<=90) ages.push(age);
  }
  const years=num(person[11]);
  if(years!=null&&years>=0&&years<=60){
    tenureCount++;
    if(years<1) tenure['0–1 год']++;
    else if(years<3) tenure['1–3 года']++;
    else if(years<5) tenure['3–5 лет']++;
    else if(years<8) tenure['5–8 лет']++;
    else if(years<10) tenure['8–10 лет']++;
    else tenure['10+ лет']++;
  }
}
ages.sort((a,b)=>a-b);
const ageBands={'до 25':0,'25–34':0,'35–44':0,'45–54':0,'55+':0};
for(const age of ages){
  if(age<25) ageBands['до 25']++;
  else if(age<35) ageBands['25–34']++;
  else if(age<45) ageBands['35–44']++;
  else if(age<55) ageBands['45–54']++;
  else ageBands['55+']++;
}
const sorted=object=>Object.entries(object).sort((a,b)=>b[1]-a[1]);
const people={
  count:peopleRows.length,
  male,
  female,
  tenureCount,
  ageCount:ages.length,
  avgAge:ages.length?ages.reduce((sum,value)=>sum+value,0)/ages.length:0,
  medianAge:ages.length?ages[Math.floor(ages.length/2)]:0,
  ageBands:Object.entries(ageBands),
  categories:sorted(categories),
  tenure:Object.entries(tenure)
};

const payload={updatedAt:new Date().toISOString(),metrics,efficiency,distribution,payrollDistribution,people};
await writeFile('data.js','window.HR_DATA='+JSON.stringify(payload)+';\n','utf8');
console.log('Updated aggregate data for',peopleRows.length,'employees and',count,'months');
