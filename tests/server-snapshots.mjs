// Снимки облака: снимок дня, версии без дублей, выгрузка, откат с подтверждением, отмена отката, срок 60 дней.
import { execFileSync } from "node:child_process";
const BASE = "http://127.0.0.1:8787";
const SPACE = "SnapSpace_" + Math.random().toString(36).slice(2, 10) + "_abcdefgh";
let fails = 0;
const ok = (c, m) => { console.log((c ? "  OK   " : "  FAIL ") + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (shift) => new Date(Date.now() + 3 * 3600000 + shift * 86400000).toISOString().slice(0, 10);
const D1 = day(-2), D2 = day(-1), TODAY = day(0), OLD = day(-70);
const sql = (q) => execFileSync(new URL("./node_modules/.bin/wrangler", import.meta.url).pathname, ["d1", "execute", "shtab", "--local", "--json", "--command", q], { cwd: process.env.SHTAB_WR_DIR || new URL(".", import.meta.url).pathname, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const rows = (q) => { const t = sql(q); const j = JSON.parse(t.slice(t.indexOf("["))); return (j[0] && j[0].results) || []; };
const push = async (arr) => (await fetch(`${BASE}/v2/push?space=${SPACE}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(arr) })).json();
const pull = async () => { let cur = { r: 0, s: "", i: "" }, all = []; for (;;) { const j = await (await fetch(`${BASE}/v2/pull?space=${SPACE}&r=${cur.r}&s=${encodeURIComponent(cur.s)}&i=${encodeURIComponent(cur.i)}`)).json(); all = all.concat(j.rows); cur = j.cur; if (!j.rows.length) break; } return all; };
const state = async () => { const m = {}; (await pull()).forEach((r) => { m[r.s + "/" + r.i] = r; }); return m; };
const snaps = async () => (await (await fetch(`${BASE}/v2/snaps?space=${SPACE}`)).json()).snaps;
const snapFile = async (label) => (await fetch(`${BASE}/v2/snap?space=${SPACE}&label=${encodeURIComponent(label)}`)).json();
const restore = async (label, confirm) => { const r = await fetch(`${BASE}/v2/restore?space=${SPACE}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label, confirm }) }); return { status: r.status, j: await r.json() }; };
const relabel = (from, to) => { sql(`UPDATE snaps SET label='${to}' WHERE space='${SPACE}' AND label='${from}'; UPDATE snapvers SET first_day='${to}' WHERE space='${SPACE}' AND first_day='${from}'; UPDATE snapvers SET last_day='${to}' WHERE space='${SPACE}' AND last_day='${from}';`); };

console.log("1. Пустое пространство снимков не делает, первая синхронизация дня делает");
await push([{ s: "lessons", i: "L1", u: 100, d: { id: "L1", topic: "старая", updatedAt: 100 } }, { s: "lessons", i: "L2", u: 100, d: { id: "L2", topic: "удалят", updatedAt: 100 } }, { s: "students", i: "S1", u: 100, d: { id: "S1", name: "Аня", updatedAt: 100 } }]);
ok((await snaps()).length === 0, "после первой записи в пустое пространство снимка нет");
await pull(); await sleep(800);
let sn = await snaps();
ok(sn.length === 1 && sn[0].label === TODAY && sn[0].n === 3 && sn[0].kind === "day", "после чтения появился снимок дня: " + JSON.stringify(sn.map((x) => [x.label, x.n, x.kind])));
await pull(); await sleep(500);
ok((await snaps()).length === 1, "второй раз за день снимок не повторяется");
relabel(TODAY, D1);

console.log("2. На следующий день: снимок до правок, затем правки, ещё день – снимок после правок");
await push([{ s: "lessons", i: "L1", u: 200, d: { id: "L1", topic: "новая", updatedAt: 200 } }, { s: "lessons", i: "L3", u: 200, d: { id: "L3", topic: "добавлена", updatedAt: 200 } }, { s: "lessons", i: "L2", u: 200, x: 1 }]);
sn = await snaps();
ok(sn.map((x) => x.label).join() === [TODAY, D1].join() && sn[0].n === 3, "запись дня сначала сохранила состояние до правок");
relabel(TODAY, D2);
await pull(); await sleep(800);
sn = await snaps();
ok(sn.map((x) => x.label).join() === [TODAY, D2, D1].join() && sn[0].n === 3, "три снимка: сегодня, вчера, позавчера");
const vers = rows(`SELECT store, id, upd, first_day, last_day FROM snapvers WHERE space='${SPACE}' ORDER BY store, id, upd`);
ok(vers.length === 5, "версий хранится 5, а не 9: одинаковое не дублируется " + JSON.stringify(vers.map((v) => v.id + "@" + v.upd)));
const s1 = vers.find((v) => v.id === "S1");
ok(s1.first_day === D1 && s1.last_day === TODAY, "неизменный ученик – одна версия на все дни");

console.log("3. Выгрузка снимка в формате бэкапа");
const f1 = await snapFile(D1), f3 = await snapFile(TODAY);
ok(f1.app === "shtab" && f1.snapshot === D1 && f1.data.lessons.map((l) => l.id + ":" + l.topic).sort().join() === "L1:старая,L2:удалят" && f1.data.students.length === 1, "позавчера: L1 старая, L2 на месте");
ok(f3.data.lessons.map((l) => l.id + ":" + l.topic).sort().join() === "L1:новая,L3:добавлена", "сегодня: L1 новая, L3 есть, L2 нет");
ok((await fetch(`${BASE}/v2/snap?space=${SPACE}&label=1999-01-01`)).status === 404, "несуществующий снимок – 404");

console.log("4. Откат к позавчера");
let r = await restore(D1, "да");
ok(r.status === 400 && r.j.error === "need_confirm", "без слова ВЕРНУТЬ – отказ");
r = await restore(D1, "ВЕРНУТЬ");
ok(r.status === 200 && r.j.restored === 2 && r.j.removed === 1 && /~/.test(r.j.undo), "откат: вернулось 2 записи, удалена 1, сохранена точка отмены " + JSON.stringify(r.j));
let st = await state();
ok(st["lessons/L1"].d.topic === "старая" && st["lessons/L1"].u > 1e12 && st["lessons/L2"].x === 0 && st["lessons/L3"].x === 1 && st["students/S1"].u === 100, "в облаке L1 старая со свежей меткой, L2 вернулась, L3 удалена, S1 не тронут");
sn = await snaps();
ok(sn.some((x) => x.label === r.j.undo && x.kind === "before-restore"), "в списке есть снимок «перед откатом»");

console.log("5. Отмена отката и срок хранения");
sql(`INSERT INTO snaps (space, label, at, rev, n, bytes, kind) VALUES ('${SPACE}', '${OLD}', 1, 1, 1, 1, 'day'); INSERT INTO snapvers (space, store, id, upd, data, first_day, last_day) VALUES ('${SPACE}', 'lessons', 'OLDV', 1, '{"id":"OLDV"}', '${OLD}', '${OLD}');`);
const undo = r.j.undo;
r = await restore(undo, "ВЕРНУТЬ");
st = await state();
ok(r.status === 200 && st["lessons/L1"].d.topic === "новая" && st["lessons/L3"].x === 0 && st["lessons/L2"].x === 1, "отмена отката: L1 новая, L3 снова есть, L2 снова удалена");
ok(!(await snaps()).some((x) => x.label === OLD) && rows(`SELECT COUNT(*) AS n FROM snapvers WHERE space='${SPACE}' AND id='OLDV'`)[0].n === 0, "снимок старше 60 дней и его версии удалены");
ok(rows(`SELECT COUNT(*) AS n FROM snaps WHERE space='${SPACE}'`)[0].n >= 4, "свежие снимки на месте");

console.log(fails ? `\nПРОВАЛОВ: ${fails}` : "\nСНИМКИ ОБЛАКА РАБОТАЮТ");
process.exit(fails ? 1 : 0);
