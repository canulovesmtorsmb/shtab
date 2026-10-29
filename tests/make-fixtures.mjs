// Вымышленные данные для тестов: база той же формы и объёма, что настоящая, и школьный слой.
// Никаких настоящих имён и расписаний. Запуск: node make-fixtures.mjs <папка>
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2] || ".";
fs.mkdirSync(out, { recursive: true });
let seed = 20261029;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const hex = (n) => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join("");
const uuid = () => `${hex(8)}-${hex(4)}-4${hex(3)}-${pick(["8", "9", "a", "b"])}${hex(3)}-${hex(12)}`;
const p2 = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
const day = (s) => new Date(s + "T00:00:00Z");
const add = (d, n) => new Date(d.getTime() + n * 86400000);
const ms = (s) => Date.parse(s + "T12:00:00Z");
const TODAY = "2026-10-29";
const WORDS = "урок тема разбор текст задание сочинение правило орфограмма пунктуация герой автор образ сюжет композиция повесть рассказ стихотворение лирика эпитет метафора анализ".split(" ");
const text = (n) => Array.from({ length: n }, () => pick(WORDS)).join(" ");

// ---------- база ----------
const SUBJ = ["Русский язык", "Литература", "ЕГЭ русский язык", "ОГЭ русский язык", "ЕГЭ литература", "РКИ"];
const students = [], lessons = [];
for (let k = 0; k < 64; k++) {
  const id = k === 0 ? "c5705d73-ce" : (k % 3 ? uuid() : hex(9));
  const created = ms(iso(add(day("2026-03-20"), Math.floor(rnd() * 180))));
  students.push({ id, name: `Ученик ${p2(k + 1)}`, grade: `${5 + (k % 7)} класс`, subject: pick(SUBJ), rate: pick([1000, 1500, 1500, 2000]), status: k < 24 ? "активен" : "", archived: k >= 40, contact: "", notes: k % 5 ? "" : text(12), createdAt: created, updatedAt: created + 3600000 });
}
const times = ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "21:00"];
for (const s of students.slice(0, 40)) {
  const wd = Math.floor(rnd() * 7), tm = pick(times), start = add(day("2026-05-11"), Math.floor(rnd() * 60)), end = s.archived ? add(start, 70 + Math.floor(rnd() * 40)) : day("2026-11-30");
  for (let d = add(start, (wd - start.getUTCDay() + 7) % 7); d <= end && lessons.length < 884; d = add(d, 7)) {
    const ds = iso(d), past = ds < TODAY, st = past ? (rnd() < 0.08 ? "cancelled" : "done") : (rnd() < 0.04 ? "cancelled" : "planned");
    const u = Math.min(ms(ds) + 7200000, ms("2026-10-28"));  // все метки раньше начала тестов
    lessons.push({ id: uuid(), studentId: s.id, date: ds, time: tm, duration: pick([60, 60, 60, 90]), subject: s.subject, topic: rnd() < 0.6 ? text(3) : "", cost: s.rate, status: st, paid: st === "done" && ds < "2026-10-01", createdAt: u - 86400000, updatedAt: u });
  }
}
const events = [];
for (let k = 0; k < 24; k++) {
  const d = iso(add(day("2026-06-01"), Math.floor(rnd() * 200)));
  events.push({ id: uuid(), scope: pick(["work", "personal"]), type: pick(["Другое", "Занятие", "Ознакомительное"]), title: "Событие " + (k + 1), date: d, time: pick(["", "11:00", "15:00", "19:00"]), repeat: k % 6 ? "none" : "weekly", until: k % 6 ? "" : iso(add(day(d), 56)), ex: {}, comments: [], notes: "", createdAt: Math.min(ms(d), ms("2026-10-28")), updatedAt: Math.min(ms(d), ms("2026-10-28")) });
}
const big = "Конспект. " + text(40) + "\n";
const notes = [{ id: "75dbd893-0b1e-4c2a-9a31-7f0e6c1d2b44", title: "Большая заметка", text: big.repeat(Math.ceil(1000000 / Buffer.byteLength(big))).slice(0, 560000), createdAt: ms("2026-07-01"), updatedAt: ms("2026-07-01") }];
for (let k = 0; k < 5; k++) notes.push({ id: uuid(), title: "Заметка " + (k + 1), text: text(60), createdAt: ms("2026-08-01"), updatedAt: ms("2026-08-01") });
const trainers = [];
for (let k = 0; k < 46; k++) { const sid = students[k % 30].id; trainers.push({ id: uuid(), studentId: sid, title: "Тренажёр " + (k + 1), html: "<section>" + Array.from({ length: 90 }, () => "<p>" + text(40) + "</p>").join("") + "</section>", createdAt: ms("2026-09-01"), updatedAt: ms("2026-09-01") }); }
const data = { students, lessons, events, notes, trainers, subs: [], tasks: [], slots: [], trash: [] };
fs.writeFileSync(path.join(out, "backup.json"), JSON.stringify({ app: "shtab", version: 9, exportedAt: TODAY + "T12:00:00.000Z", data }));

// ---------- школьный слой: 914 записей ----------
const TZ = "Asia/Bishkek", BELL = ["08:00", "08:50", "09:40", "10:35", "11:25"];
// день недели (пн=0) → пять уроков: [код, класс, предмет]
const P = { r5: ["5b", "5Б", "rus", "русский"], l5: ["5b", "5Б", "lit", "литература"], r8: ["8v", "8В", "rus", "русский"], l8: ["8v", "8В", "lit", "литература"], r4: ["4a", "4А", "rus", "русский"], r7: ["7v", "7В", "rus", "русский"] };
const GRID = [["r4", "r5", "r8", "l8", "r7"], ["r4", "l5", "r7", "l8", "r8"], ["r4", "r5", "r8", "r7", "l5"], ["l5", "r4", "l8", "r8", "r7"], ["r4", "r8", "l8", "l5", "r5"]];
const VAC = [["Осенние", "2026-11-11", "2026-11-15"], ["Зимние", "2026-12-30", "2027-01-11"], ["Весенние", "2027-03-20", "2027-03-28"]];
const HOL = [["Праздник 1", "2026-11-07"], ["Праздник 2", "2027-01-07"], ["Праздник 3", "2027-02-23"], ["Праздник 4", "2027-03-08"], ["Праздник 5", "2027-05-01"], ["Праздник 6", "2027-05-09"]];
const off = (ds) => VAC.some((v) => ds >= v[1] && ds <= v[2]) || HOL.some((h) => h[1] === ds);
const SRC = ms("2026-10-20");
const rows = {};
for (let d = day("2026-09-01"); iso(d) <= "2027-06-20"; d = add(d, 1)) {
  const wd = (d.getUTCDay() + 6) % 7, ds = iso(d);
  if (wd > 4 || off(ds)) continue;
  GRID[wd].forEach((k, i) => { if (k) (rows[k] = rows[k] || []).push({ ds, period: i + 1, time: BELL[i] }); });
}
const ev = [];
for (const k of Object.keys(rows)) {
  const [code, cls, subj, title] = P[k], list = rows[k];
  let shift = 0;
  if (k === "r5") { const at = list.findIndex((x) => x.ds === "2026-10-30" && x.time === "11:25"); shift = 27 - (at + 1); }
  list.forEach((x, i) => {
    const no = i + 1 + shift, id = `sch-${code}-${subj}-${String(no).padStart(3, "0")}`;
    ev.push({ id, type: "Урок в школе", scope: "school", title: `${cls} ${title}`, date: x.ds, time: x.time, duration: 45, tz: TZ,
      topic: (k === "r5" && no === 27) ? "Контрольная работа" : "Тема " + no, lessonNo: no, period: x.period, room: "101", cls, notes: `Урок ${x.period} (${x.time}), каб. 101.`,
      repeat: "none", until: "", ex: {}, comments: [], src: `КТП ${cls} ${title}`, srcAt: SRC, createdAt: SRC, updatedAt: SRC });
  });
}
const allDay = (id, title, a, b) => ({ id, type: "Другое", scope: "school", title, date: a, time: "", repeat: a === b ? "none" : "daily", until: a === b ? "" : b, ex: {}, comments: [], notes: "", src: "график", srcAt: SRC, createdAt: SRC, updatedAt: SRC });
VAC.forEach((v) => ev.push(allDay("sch-vac-" + v[1], v[0] + " каникулы", v[1], v[2])));
HOL.forEach((h) => ev.push(allDay("sch-hol-" + h[1], "Праздник: " + h[0], h[1], h[1])));
// ровно 914 записей: лишнее снимаем с конца года, опорные уроки не трогаем
ev.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
const keep = new Set(["sch-5b-rus-027", "sch-8v-lit-069"]);
for (let i = ev.length - 1; ev.length > 914 && i >= 0; i--) if (ev[i].scope === "school" && ev[i].time && !keep.has(ev[i].id)) ev.splice(i, 1);
const must = { n914: ev.length === 914, k027: ev.some((e) => e.id === "sch-5b-rus-027" && e.date === "2026-10-30" && e.time === "11:25"), k069: ev.some((e) => e.id === "sch-8v-lit-069"),
  fri: ev.filter((e) => e.date === "2026-10-30" && e.time).map((e) => e.time).sort().join() === BELL.join(), uniq: new Set(ev.map((e) => e.id)).size === ev.length };
if (Object.values(must).some((x) => !x)) { console.error("школьный слой не сошёлся:", must, ev.length); process.exit(1); }
fs.writeFileSync(path.join(out, "school.json"), JSON.stringify({ app: "shtab", kind: "layer", layer: "sch-", title: "Тестовый школьный слой", tz: TZ, exportedAt: "2026-10-20T12:00:00", data: { events: ev } }, null, 1));
const sz = (f) => (fs.statSync(path.join(out, f)).size / 1048576).toFixed(2);
console.log(`фикстуры: учеников ${students.length}, занятий ${lessons.length}, база ${sz("backup.json")} МБ; школьный слой ${ev.length} записей`);
