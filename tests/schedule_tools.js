// Проход 3: накладки при записи и переносе, шаблон из расписания, «Продлить на месяц», объединение, архив вместо удаления.
const { chromium } = require("playwright");
let fails = 0; const ok = (c, m) => { console.log((c ? "  OK   " : "  FAIL ") + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ timezoneId: "Asia/Bishkek", viewport: { width: 1200, height: 900 } }); const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("http://127.0.0.1:8000/index.html");
  await p.waitForFunction(() => localStorage.getItem("shtab-base-202606") === "1" && typeof db !== "undefined" && db); await p.waitForTimeout(3500);
  const today = await p.evaluate(() => lessonTodayIso());
  ok(today === "2026-10-29" || today > "2026-10-29", "сегодня по МСК: " + today);
  await p.evaluate(async () => {
    const now = Date.now(); const S = (id, name, rate, x) => dbPut("students", Object.assign({ id, name, rate, status: "активен", createdAt: now, updatedAt: now }, x || {}));
    await S("A", "Аня", 1500); await S("B", "Боря", 1000); await S("C", "Архивный", 1000, { archived: true }); await S("D", "Дубль Ани", 1500); await S("E", "Пустой", 1000);
    const Lsn = (id, sid, date, time, x) => dbPut("lessons", Object.assign({ id, studentId: sid, date, time, duration: 60, cost: 1500, status: "planned", createdAt: now, updatedAt: now }, x || {}));
    for (const d of ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"]) await Lsn("A" + d, "A", d, "17:00");
    await Lsn("Amoved", "A", "2026-11-25", "17:00", { moves: [{ from: "2026-11-30", to: "2026-11-25", at: now }] });
    await Lsn("B1", "B", "2026-11-03", "15:00", { cost: 1000 });
    await Lsn("D1", "D", "2026-09-01", "12:00", { status: "done" }); await Lsn("D2", "D", "2026-09-08", "12:00", { status: "done" });
    await dbPut("trainers", { id: "T1", studentId: "D", title: "тренажёр", createdAt: now, updatedAt: now });
    await dbPut("trash", { id: "TR1", store: "lessons", rec: { id: "gone", studentId: "A", date: "2026-12-14", time: "17:00" }, at: now, updatedAt: now });
    await dbPut("events", { id: "sch-t1", scope: "school", type: "Урок в школе", title: "5Б русский", date: "2026-11-02", time: "08:00", duration: 45, tz: "Asia/Bishkek", repeat: "none", ex: {}, createdAt: now, updatedAt: now });
    await dbPut("slots", { id: "SLB", studentId: "B", wd: 0, time: "17:30", duration: 60, createdAt: now, updatedAt: now });
    await dbPut("slots", { id: "SLC", studentId: "C", wd: 0, time: "12:00", duration: 60, createdAt: now, updatedAt: now });
    await loadAll();
  });
  const box = (sel) => p.locator("#ui-ov " + sel);
  const clickBtn = (re) => p.locator("#ui-ov button", { hasText: re }).click();
  const ovText = () => p.locator("#ui-ov").innerText();
  const lesson = (id) => p.evaluate(async (id) => (await dbAll("lessons")).find((l) => l.id === id) || null, id);

  console.log("1. Поиск накладок: занятия и школьные уроки, с длительностью");
  const c1 = await p.evaluate(() => [busyConflicts("2026-11-02", "17:30", 60).map((c) => c.name), busyConflicts("2026-11-02", "18:00", 60).length, busyConflicts("2026-11-02", "16:00", 60).length, busyConflicts("2026-11-02", "16:00", 61).length,
    busyConflicts("2026-11-02", "05:10", 30).map((c) => c.name), busyConflicts("2026-11-02", "04:00", 60).length, conflictText(busyConflicts("2026-11-02", "17:30", 60))]);
  ok(c1[0].join() === "Аня" && c1[1] === 0 && c1[2] === 0 && c1[3] === 1, "17:30 пересекается с Аней 17:00–18:00, 18:00 и 16:00–17:00 – нет, 16:00 на 61 мин – да");
  ok(c1[4].join() === "школа, 5Б русский" && c1[5] === 0, "05:10 МСК попадает на школьный урок 08:00 по Бишкеку, 04:00–05:00 МСК – нет");
  ok(/Аня 20:00–21:00/.test(c1[6]), "текст накладки во времени экрана: " + c1[6]);

  console.log("2. Сохранение занятия в занятое время спрашивает");
  await p.evaluate(() => editFrom("lessons", { studentId: "B", date: "2026-11-02", time: "17:30", duration: 60, status: "planned", cost: 1000 })); await p.waitForTimeout(400);
  await p.locator(".editor-foot button", { hasText: /^Сохранить$/ }).click(); await p.waitForSelector("#ui-ov");
  ok(/Накладка по времени: Аня 20:00–21:00/.test(await ovText()), "окно: накладка с Аней");
  await clickBtn(/^Отмена$/); await p.waitForTimeout(500);
  let nB = await p.evaluate(async () => (await dbAll("lessons")).filter((l) => l.studentId === "B" && l.date === "2026-11-02").length);
  ok(nB === 0, "после «Отмена» занятие не записано");
  await p.locator(".editor-foot button", { hasText: /^Сохранить$/ }).click(); await p.waitForSelector("#ui-ov"); await clickBtn(/^Да$/); await p.waitForTimeout(700);
  nB = await p.evaluate(async () => (await dbAll("lessons")).filter((l) => l.studentId === "B" && l.date === "2026-11-02").length);
  ok(nB === 1, "после «Да» занятие записано");
  await p.evaluate(async () => { const x = (await dbAll("lessons")).find((l) => l.studentId === "B" && l.date === "2026-11-02"); await dbDel("lessons", x.id); await loadAll(); });

  console.log("3. Перенос и перетаскивание спрашивают");
  await p.evaluate(() => moveLesson(state.cache.lessons.find((l) => l.id === "B1")));
  await box('input[type="date"]').fill("2026-11-02"); await box('input[type="time"]').fill("17:15"); await clickBtn(/^Перенести$/); await p.waitForTimeout(300);
  ok(/Накладка по времени: Аня/.test(await ovText()), "перенос на 02.11 17:15: окно о накладке");
  await clickBtn(/^Да$/); await p.waitForTimeout(700);
  let l = await lesson("B1"); ok(l.date === "2026-11-02" && l.time === "17:15" && !("_mvOk" in l), "после «Да» перенесено, лишних полей нет");
  await p.evaluate(() => calMoveTime({ kind: "lesson", ev: state.cache.lessons.find((x) => x.id === "B1") }, "2026-11-09", 20)); await p.waitForSelector("#ui-ov");
  ok(/Накладка по времени: Аня/.test(await ovText()), "перетаскивание на 09.11 20:00 по Бишкеку: окно о накладке");
  await clickBtn(/^Отмена$/); await p.waitForTimeout(400);
  l = await lesson("B1"); ok(l.date === "2026-11-02" && l.time === "17:15", "после «Отмена» занятие на месте");
  await p.evaluate(() => calMoveItem({ kind: "lesson", ev: state.cache.lessons.find((x) => x.id === "B1") }, "2026-11-04")); await p.waitForTimeout(600);
  l = await lesson("B1"); ok(l.date === "2026-11-04" && !(await p.locator("#ui-ov").count()), "на свободный день переносится без вопросов");

  console.log("4. Шаблон из расписания");
  await p.evaluate(() => slotsFromSchedule()); await p.waitForSelector("#ui-ov");
  const fs = await ovText(); ok(/Пн 17:00 МСК – Аня, 60 мин/i.test(fs) && !/Боря/.test(fs), "нашёл Аню по понедельникам 17:00, Борю (одно занятие) – нет");
  await clickBtn(/^Добавить$/); await p.waitForTimeout(600);
  const slots = await p.evaluate(async () => (await dbAll("slots")).map((s) => s.studentId + s.wd + s.time).sort());
  ok(slots.join() === "A017:00,B017:30,C012:00", "в шаблоне: " + slots.join());

  console.log("5. Продлить на месяц: без повторов, мимо переносов, корзины, отпуска, архива; накладки видны");
  await p.evaluate(async () => { const a = state.cache.students.find((s) => s.id === "A"); a.away = [{ from: "2026-12-21", to: "2026-12-31" }]; a.updatedAt = Date.now(); await dbPut("students", a); await loadAll(); });
  await p.evaluate(() => slotExtend()); await p.waitForSelector("#ui-ov");
  const ex = await ovText();
  ok(/Создать занятий: 5/.test(ex) && /Аня: 1 \(07\.12–07\.12\)/.test(ex) && /Боря: 4 \(09\.11–30\.11\)/.test(ex), "план: Аня только 07.12, Боря 4 занятия после своего последнего (04.11)");
  ok(/отпуск – 1/.test(ex) && /ушёл или в архиве – \d+/.test(ex), "в окне: пропущен отпуск и архивный ученик");
  ok(/Накладки по времени: 3/.test(ex) && /09\.11 20:30 \(17:30 МСК\) Боря ↔ Аня 20:00–21:00/.test(ex) && !/30\.11 .*Боря ↔/.test(ex), "в окне: 3 накладки Бори с Аней, 30.11 свободно (занятие Ани оттуда перенесено)");
  await clickBtn(/^Без накладок \(2\)$/i); await p.waitForTimeout(800);
  const newL = await p.evaluate(async () => (await dbAll("lessons")).filter((l) => /^tpl-/.test(l.series || "")).map((l) => l.studentId + " " + l.date + " " + l.time + " " + l.cost).sort());
  ok(newL.join() === "A 2026-12-07 17:00 1500,B 2026-11-30 17:30 1000", "созданы только занятия без накладок, по цене каждого: " + newL.join());
  await p.evaluate(() => slotGenerate("2026-11-30", "2026-12-07")); await p.waitForSelector("#ui-ov");
  const rg = await ovText(); ok(/Создать занятий: 1\./.test(rg) && /Боря: 1 \(07\.12/.test(rg) && !/Аня:/.test(rg) && /Боря ↔ Аня/.test(rg), "повторный разворот 30.11–07.12: только недостающее занятие Бори, и видна его накладка с Аней");
  await clickBtn(/^Отмена$/i);

  console.log("6. Объединение дубля");
  await p.evaluate(() => studentMerge(state.cache.students.find((s) => s.id === "D")));
  await box("select").selectOption("A");
  ok(/перейдут: занятий 2, тренажёров 1/.test(await ovText()), "окно: перейдут 2 занятия и тренажёр");
  await clickBtn(/^Объединить$/); await p.waitForTimeout(900);
  const mg = await p.evaluate(async () => { const L = await dbAll("lessons"), T = await dbAll("trainers"), S = await dbAll("students"); const d = S.find((s) => s.id === "D"), a = S.find((s) => s.id === "A"); return { d1: L.find((l) => l.id === "D1").studentId, t: T.find((t) => t.id === "T1").studentId, st: d.status, arch: d.archived, into: d.mergedInto, note: a.notes }; });
  ok(mg.d1 === "A" && mg.t === "A" && mg.st === "объединён" && mg.arch && mg.into === "A" && /Объединён с карточкой «Дубль Ани»/.test(mg.note), "записи у Ани, дубль в архиве с пометкой");

  console.log("7. Удалить ученика с занятиями нельзя, можно в архив");
  await p.evaluate(() => { state.active = "students"; removeRec(state.cache.students.find((s) => s.id === "B")); }); await p.waitForSelector("#ui-ov");
  ok(/Удалить нельзя/.test(await ovText()) && /занятий 2/.test(await ovText()), "окно «Удалить нельзя», у Бори 2 занятия");
  await clickBtn(/^В архив$/); await p.waitForTimeout(700);
  const bb = await p.evaluate(async () => { const S = await dbAll("students"); const s = S.find((x) => x.id === "B"); return s ? s.archived : "нет карточки"; });
  ok(bb === true, "Боря в архиве, карточка цела");
  await p.evaluate(() => { state.active = "students"; removeRec(state.cache.students.find((s) => s.id === "E")); }); await p.waitForSelector("#ui-ov");
  ok(/Удалить запись\?/.test(await ovText()), "ученика без записей можно удалить как раньше");
  await clickBtn(/^Отмена$/);

  console.log("8. Кнопки на месте");
  await p.evaluate(() => { go("calendar"); }); await p.waitForTimeout(400);
  ok(/Продлить на месяц/i.test(await p.evaluate(() => document.getElementById("view").innerText)), "в календаре кнопка «Продлить на месяц»");
  await p.evaluate(() => slotEditor()); await p.waitForSelector("#ui-ov");
  const se = await ovText(); ok(/Из расписания/i.test(se) && /Продлить на месяц/i.test(se) && /Развернуть/i.test(se), "в шаблоне недели: Из расписания, Развернуть, Продлить на месяц");
  await clickBtn(/^Закрыть$/);
  await p.evaluate(async () => { await dbPut("slots", { id: "SLE", studentId: "E", wd: 3, time: "10:00", duration: 60, createdAt: Date.now(), updatedAt: Date.now() }); await loadAll(); go("dashboard"); }); await p.waitForTimeout(400);
  ok(/Расписание до \d\d\.\d\d: продлить на месяц/i.test(await p.evaluate(() => document.getElementById("view").innerText)), "на главной подсказка продлить расписание");
  ok(errs.length === 0, "ошибок страницы: " + errs.length + " " + errs.join(" | "));
  await b.close(); console.log(fails ? "ПРОВАЛОВ: " + fails : "НАКЛАДКИ, ШАБЛОН И ПОРЯДОК В ДАННЫХ РАБОТАЮТ"); process.exit(fails ? 1 : 0);
})();
