const BASE = "http://127.0.0.1:8787", SPACE = "IcsSpace_" + Math.random().toString(36).slice(2, 10) + "_abcdefgh";
let fails = 0; const ok = (c, m) => { console.log((c ? "  OK   " : "  FAIL ") + m); if (!c) fails++; };
const recs = [
  { s: "students", i: "S1", u: 1, d: { id: "S1", name: "Ученик 11 класс", updatedAt: 1 } },
  { s: "lessons", i: "L1", u: 1, d: { id: "L1", studentId: "S1", date: "2026-11-03", time: "17:00", duration: 60, status: "planned", updatedAt: 1 } },
  { s: "lessons", i: "L2", u: 1, d: { id: "L2", studentId: "S1", date: "2026-11-03", time: "21:00", duration: 90, status: "planned", updatedAt: 1 } },
  { s: "events", i: "sch-5b-rus-027", u: 1, d: { id: "sch-5b-rus-027", scope: "school", title: "5Б русский", topic: "Контрольная", date: "2026-10-30", time: "11:25", duration: 45, tz: "Asia/Bishkek", repeat: "none", updatedAt: 1 } },
  { s: "events", i: "sch-vac-2026-11-11", u: 1, d: { id: "sch-vac-2026-11-11", scope: "school", title: "Осенние каникулы", date: "2026-11-11", time: "", repeat: "daily", until: "2026-11-15", updatedAt: 1 } },
  { s: "events", i: "E1", u: 1, d: { id: "E1", title: "Личное", date: "2026-11-05", time: "19:00", repeat: "none", updatedAt: 1 } },
];
let r = await fetch(`${BASE}/v2/push?space=${SPACE}`, { method: "POST", body: JSON.stringify(recs) });
ok(r.status === 200, "записи приняты");
const ics = await (await fetch(`${BASE}/ics?key=${SPACE}`)).text();
const blk = (uid) => { const i = ics.indexOf("UID:" + uid + "@shtab"); return i < 0 ? "" : ics.slice(i, ics.indexOf("END:VEVENT", i)); };
ok(/DTSTART:20261103T140000Z/.test(blk("lesson-L1")) && /DTEND:20261103T150000Z/.test(blk("lesson-L1")), "занятие 17:00 МСК → 14:00Z–15:00Z");
ok(/DTSTART:20261103T180000Z/.test(blk("lesson-L2")) && /DTEND:20261103T193000Z/.test(blk("lesson-L2")), "занятие 21:00 МСК, 90 мин → 18:00Z–19:30Z");
ok(/DTSTART:20261030T052500Z/.test(blk("ev-sch-5b-rus-027")) && /SUMMARY:5Б русский: Контрольная/.test(blk("ev-sch-5b-rus-027")), "школьный урок 11:25 Бишкек → 05:25Z, в названии тема");
ok(["11", "12", "13", "14", "15"].every((d) => blk("ev-sch-vac-2026-11-11-2026-11-" + d).includes("DTSTART;VALUE=DATE:202611" + d)), "каникулы развёрнуты на все 5 дней");
ok(/DTSTART:20261105T190000\r?\n/.test(blk("ev-E1")), "обычное событие без пояса осталось как было: 19:00");
console.log(fails ? "ПРОВАЛОВ: " + fails : "ICS С СЕРВЕРА ПРАВИЛЬНЫЙ"); process.exit(fails ? 1 : 0);
