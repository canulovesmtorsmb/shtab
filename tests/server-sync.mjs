// Серверные проверки v2 на локальной D1. Запуск: node test_server.mjs <backup.json>
import fs from "node:fs";
const BASE = "http://127.0.0.1:8787";
const SPACE = "TestSpace_" + Math.random().toString(36).slice(2, 10) + "_abcdefgh";
let fails = 0;
function ok(cond, msg) { console.log((cond ? "  OK   " : "  FAIL ") + msg); if (!cond) fails++; }
async function push(arr) {
  const r = await fetch(`${BASE}/v2/push?space=${SPACE}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(arr) });
  return { status: r.status, j: await r.json() };
}
async function pullAll() {
  let cur = { r: 0, s: "", i: "" }, rows = [], pages = 0;
  for (;;) {
    const r = await fetch(`${BASE}/v2/pull?space=${SPACE}&r=${cur.r}&s=${encodeURIComponent(cur.s)}&i=${encodeURIComponent(cur.i)}`);
    const t = await r.text(); const j = JSON.parse(t); pages++;
    rows = rows.concat(j.rows); cur = j.cur;
    if (!j.rows.length) break;
  }
  return { rows, pages, cur };
}
function utf8(s) { return Buffer.byteLength(s, "utf8"); }

console.log("1. Базовая запись и чтение");
let p = await push([{ s: "lessons", i: "L1", u: 100, d: { id: "L1", topic: "старая", updatedAt: 100 } }]);
ok(p.status === 200 && p.j.applied === 1, "запись принята: " + JSON.stringify(p.j));
let all = await pullAll();
ok(all.rows.length === 1 && all.rows[0].d.topic === "старая", "чтение отдаёт запись");

console.log("2. Правило: новее побеждает");
p = await push([{ s: "lessons", i: "L1", u: 50, d: { id: "L1", topic: "СТАРЕЕ", updatedAt: 50 } }]);
ok(p.j.applied === 0, "более старая версия не применяется");
p = await push([{ s: "lessons", i: "L1", u: 200, d: { id: "L1", topic: "новая", updatedAt: 200 } }]);
ok(p.j.applied === 1, "более новая применяется");
all = await pullAll();
ok(all.rows[0].d.topic === "новая", "на сервере новая версия");
p = await push([{ s: "lessons", i: "L1", u: 200, d: { id: "L1", topic: "та же метка", updatedAt: 200 } }]);
ok(p.j.applied === 0, "равная метка не перезаписывает");

console.log("3. Удаления");
p = await push([{ s: "lessons", i: "L1", u: 150, x: 1 }]);
ok(p.j.applied === 0, "удаление старше правки не действует");
p = await push([{ s: "lessons", i: "L1", u: 200, x: 1 }]);
ok(p.j.applied === 1, "удаление с равной меткой сильнее записи");
all = await pullAll();
ok(all.rows.length === 1 && all.rows[0].x === 1 && all.rows[0].d === null, "сервер отдаёт надгробие");
p = await push([{ s: "lessons", i: "L1", u: 300, d: { id: "L1", topic: "воскрешена правкой", updatedAt: 300 } }]);
ok(p.j.applied === 1, "правка новее удаления возвращает запись");

console.log("4. Дельта: после курсора приходят только новые изменения");
const before = (await pullAll()).cur;
p = await push([{ s: "students", i: "S1", u: 10, d: { id: "S1", name: "Новый", updatedAt: 10 } }]);
let r = await fetch(`${BASE}/v2/pull?space=${SPACE}&r=${before.r}&s=${encodeURIComponent(before.s)}&i=${encodeURIComponent(before.i)}`);
let j = await r.json();
ok(j.rows.length === 1 && j.rows[0].i === "S1", "после курсора только одна новая запись");

console.log("5. Мусор отбрасывается");
p = await push([{ s: "", i: "z", u: 1, d: { id: "z" } }, { s: "lessons", u: 1, d: { id: "q" } }, { s: "lessons", i: "q2", u: 1, d: "строка" }]);
ok(p.status === 200 && p.j.applied === 0, "записи без store, без id или не-объект не пишутся");
r = await fetch(`${BASE}/v2/push?space=${SPACE}`, { method: "POST", body: "{}" });
ok(r.status === 400, "тело не массив: 400");
r = await fetch(`${BASE}/v2/push?space=short`, { method: "POST", body: "[]" });
ok(r.status === 400, "короткий ключ пространства: 400");

console.log("6. Старый /state после перехода");
r = await fetch(`${BASE}/state?space=${SPACE}`);
j = await r.json();
ok(j.data === null && j.upgraded === true, "GET /state больше не отдаёт снимок");
r = await fetch(`${BASE}/state?space=${SPACE}`, { method: "POST", body: JSON.stringify({ data: { lessons: [] } }) });
ok(r.status === 409, "POST /state отклоняется: 409");

console.log("7. База на несколько мегабайт: частями туда и обратно");
const bk = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).data;
const recs = [];
for (const st of Object.keys(bk)) for (const rec of (bk[st] || [])) if (rec && rec.id != null)
  recs.push({ s: st, i: String(rec.id), u: Math.max(Number(rec.updatedAt) || 0, Number(rec.updated) || 0, Number(rec.createdAt) || 0), d: rec });
let batch = [], bytes = 2, sent = 0, reqs = 0, maxReq = 0;
async function flush() { if (!batch.length) return; const body = JSON.stringify(batch); maxReq = Math.max(maxReq, utf8(body)); const q = await push(batch); reqs++; if (q.status !== 200) { console.log("     ошибка", q.status, JSON.stringify(q.j).slice(0, 200)); fails++; } else sent += q.j.applied; batch = []; bytes = 2; }
for (const x of recs) { const b = utf8(JSON.stringify(x)) + 1; if (bytes + b > 1200000) await flush(); batch.push(x); bytes += b; }
await flush();
ok(sent === recs.length, `записано ${sent} из ${recs.length} записей за ${reqs} запросов, самый крупный запрос ${(maxReq / 1048576).toFixed(2)} МБ`);
all = await pullAll();
const got = new Map(all.rows.filter(x => !x.x).map(x => [x.s + "|" + x.i, x.d]));
let same = 0, diff = 0;
for (const x of recs) { const g = got.get(x.s + "|" + x.i); if (g && JSON.stringify(g) === JSON.stringify(x.d)) same++; else diff++; }
ok(diff === 0, `полный круг: совпало ${same}, расходится ${diff}; страниц при чтении ${all.pages}`);
const bigRow = all.rows.find(x => x.i && x.i.startsWith("75dbd893"));
ok(!!bigRow, "большая заметка (~1 МБ) прошла целиком");

console.log("8. Статистика и календарь");
r = await fetch(`${BASE}/v2/stats?space=${SPACE}`); j = await r.json();
ok(j.counts.lessons >= bk.lessons.length && j.rev > 0, `stats: занятий ${j.counts.lessons}, ревизия ${j.rev}`);
r = await fetch(`${BASE}/ics?key=${SPACE}`); const ics = await r.text();
const nEv = (ics.match(/BEGIN:VEVENT/g) || []).length;
ok(r.status === 200 && nEv > 500, `ICS собирается из новых записей: ${nEv} событий`);

console.log(fails ? `\nПРОВАЛОВ: ${fails}` : "\nВСЕ ПРОВЕРКИ СЕРВЕРА ПРОЙДЕНЫ");
process.exit(fails ? 1 : 0);
