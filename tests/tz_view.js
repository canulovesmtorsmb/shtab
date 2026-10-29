// Показ занятий по времени устройства (Бишкек) с МСК в скобках + слой «Школа» + «Добавить из файла».
const { chromium } = require("playwright");
const fs = require("fs");
let fails = 0;
function ok(c, m) { console.log((c ? "  OK   " : "  FAIL ") + m); if (!c) fails++; }

async function boot(b, tz) {
  const ctx = await b.newContext({ timezoneId: tz, acceptDownloads: true });
  const p = await ctx.newPage(); const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("http://127.0.0.1:8000/index.html");
  await p.waitForFunction(() => localStorage.getItem("shtab-base-202606") === "1" && typeof db !== "undefined" && db && state.cache.lessons);
  await p.waitForTimeout(4500);
  return { ctx, p, errs };
}
async function confirmYes(p) { await p.waitForSelector("text=Подтверждение"); await p.locator("button", { hasText: /^Да$/ }).last().click(); }

(async () => {
  const b = await chromium.launch();
  // ---------------- Бишкек ----------------
  console.log("1. Устройство в Бишкеке, занятия хранятся по МСК");
  let { ctx, p, errs } = await boot(b, "Asia/Bishkek");
  const sid = await p.evaluate(() => (state.cache.students[0] || {}).id);
  const base = await p.evaluate(async (sid) => {
    const mk = (id, date, time) => ({ id, studentId: sid, date, time, duration: 60, status: "planned", cost: 1000, subject: "Русский язык", topic: "тест " + id, createdAt: Date.now(), updatedAt: Date.now() });
    await dbPut("lessons", mk("tzA", "2026-11-03", "17:00"));
    await dbPut("lessons", mk("tzB", "2026-11-03", "21:00"));
    state.cache.lessons = await dbAll("lessons");
    const d3 = dayItems("2026-11-03").filter((x) => x.ev.id && x.ev.id.startsWith("tz")).map((x) => [x.ev.id, x.lt, x.shift, itTimeLabel(x)]);
    const d4 = dayItems("2026-11-04").filter((x) => x.ev.id && x.ev.id.startsWith("tz")).map((x) => [x.ev.id, x.lt, x.shift, itTimeLabel(x)]);
    return { d3, d4, diff: tzDiffers(), lab: lessonTimeLabel({ date: "2026-11-03", time: "17:00" }) };
  }, sid);
  ok(base.diff === true, "приложение видит, что пояс устройства не МСК");
  ok(JSON.stringify(base.d3) === JSON.stringify([["tzA", "20:00", true, "20:00 (17:00 МСК)"]]), "03.11: занятие 17:00 МСК стоит в 20:00 с подписью «(17:00 МСК)» " + JSON.stringify(base.d3));
  ok(JSON.stringify(base.d4) === JSON.stringify([["tzB", "00:00", true, "00:00 (21:00 МСК)"]]), "занятие 21:00 МСК 03.11 переехало на 04.11 00:00 " + JSON.stringify(base.d4));

  console.log("2. Неделя по часам и панель дня");
  await p.evaluate(() => { go("calendar"); state.calView = "week"; state.calAnchor = "2026-11-03"; render(); });
  await p.waitForTimeout(400);
  let wk = await p.evaluate(() => Array.from(document.querySelectorAll(".wk2-day")).map((c) => [c.dataset.iso, Array.from(c.querySelectorAll(".wk2-ev")).map((n) => n.innerText.replace(/\s+/g, " ").trim())]).filter((x) => x[1].some((t) => /тест tz/.test(t))));
  const wkS = JSON.stringify(wk);
  ok(/2026-11-03.*20:00 .*\(17:00 МСК\) тест tzA/.test(wkS), "карточка недели 03.11: «20:00 …» и «(17:00 МСК) тест tzA»");
  const night = await p.evaluate(() => { const rows = Array.from(document.querySelectorAll(".wk2-allday")).filter((r) => (r.querySelector(".lbl") || {}).textContent === "ночь"); if (!rows.length) return null; const cells = rows[0].querySelectorAll(".cell"); return Array.from(cells).map((c) => c.innerText.replace(/\s+/g, " ").trim()); });
  ok(night && /^00:00 .+ \(21:00 МСК\)$/.test(night[2]) && !night[1], "ночное занятие 04.11 00:00 в строке «ночь» над сеткой, сетка не растягивается: " + JSON.stringify(night && night[2]));
  const gridTop = await p.evaluate(() => (document.querySelector(".wk2-time") || {}).textContent);
  ok(gridTop === "08:00", "сетка недели начинается с 08:00, а не с полуночи (" + gridTop + ")");
  await p.evaluate(() => { state.calView = "month"; state.calAnchor = "2026-11-03"; state.calSel = "2026-11-04"; render(); });
  await p.waitForTimeout(300);
  const dp = await p.evaluate(() => (document.querySelector(".day-panel") || {}).innerText || "");
  ok(/00:00 \(21:00 МСК\)/.test(dp), "панель дня 04.11 показывает «00:00 (21:00 МСК)»");

  console.log("3. Перенос перетаскиванием пересчитывается обратно в МСК");
  const mv = await p.evaluate(async () => {
    const itA = dayItems("2026-11-03").find((x) => x.ev.id === "tzA");
    calMoveTime(itA, "2026-11-05", 18); await new Promise((r) => setTimeout(r, 500));
    const itB = dayItems("2026-11-04").find((x) => x.ev.id === "tzB");
    calMoveItem(itB, "2026-11-06"); await new Promise((r) => setTimeout(r, 500));
    const L = await dbAll("lessons"); const a = L.find((x) => x.id === "tzA"), bb = L.find((x) => x.id === "tzB");
    return { a: a.date + " " + a.time, b: bb.date + " " + bb.time, bl: lessonLocal(bb) };
  });
  ok(mv.a === "2026-11-05 15:00", "в сетку 05.11 на 18:00 по Бишкеку → в базе 05.11 15:00 МСК (" + mv.a + ")");
  ok(mv.b === "2026-11-05 21:00" && mv.bl.date === "2026-11-06" && mv.bl.time === "00:00", "ночное занятие на день вперёд: в базе 05.11 21:00 МСК, на экране 06.11 00:00 (" + mv.b + ")");

  console.log("4. Форма занятия: время по Москве, рядом время устройства");
  await p.evaluate(() => { const l = state.cache.lessons.find((x) => x.id === "tzA"); editFrom("lessons", l); });
  await p.waitForTimeout(400);
  const ed = await p.evaluate(() => (document.querySelector(".editor") || {}).innerText || "");
  ok(/Время \(МСК\)/i.test(ed), "подпись поля «Время (МСК)»");
  ok(/У вас: 18:00/.test(ed), "подсказка «У вас: 18:00»");
  await p.evaluate(() => { const i = document.querySelector('.editor input[type="time"]'); i.value = "21:30"; i.dispatchEvent(new Event("input")); });
  const ed2 = await p.evaluate(() => (document.querySelector(".editor") || {}).innerText || "");
  ok(/У вас: 06\.11 00:30/.test(ed2), "при 21:30 МСК подсказка «У вас: 06.11 00:30»");
  await p.evaluate(() => goBack && goBack());

  console.log("5. Главная «Сегодня» и напоминание");
  const dash = await p.evaluate(async (sid) => {
    const ms = Date.now() + 3 * 3600000;
    const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const pp = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    const l = { id: "tzC", studentId: sid, date: `${pp.year}-${pp.month}-${pp.day}`, time: `${pp.hour}:${pp.minute}`, duration: 60, status: "planned", updatedAt: Date.now() };
    await dbPut("lessons", l); state.cache.lessons = await dbAll("lessons");
    go("dashboard"); await new Promise((r) => setTimeout(r, 300));
    const lab = lessonTimeLabel(l), loc = lessonLocal(l);
    return { lab, txt: document.getElementById("view").innerText, today: todayIso(), loc };
  }, sid);
  ok(dash.loc.date === dash.today ? dash.txt.indexOf(dash.lab) >= 0 : true, "на главной занятие с подписью «" + dash.lab + "»");
  const rem = await p.evaluate(async (sid) => {
    const ms = Date.now() + 9.5 * 60000;
    const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const pp = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    const l = { id: "tzR", studentId: sid, date: `${pp.year}-${pp.month}-${pp.day}`, time: `${pp.hour}:${pp.minute}`, duration: 60, status: "planned", updatedAt: Date.now() };
    await dbPut("lessons", l); state.cache.lessons = await dbAll("lessons");
    let got = null; const old = window.lsNotify; window.lsNotify = function (t, body) { got = body; };
    try { lessonReminders(); } finally { window.lsNotify = old; }
    return { got, lab: lessonTimeLabel(l) };
  }, sid);
  ok(rem.got && rem.got.indexOf(rem.lab) >= 0 && /МСК/.test(rem.got), "напоминание: «" + rem.got + "»");

  console.log("6. «Добавить из файла»: слой «Школа» из КТП");
  const before = await p.evaluate(() => ({ L: state.cache.lessons.length, S: state.cache.students.length, E: state.cache.events.length }));
  await p.evaluate(() => go("calendar"));
  await p.setInputFiles("#merge-file", "school.json");
  await p.waitForSelector("text=Подтверждение");
  const dlg = await p.evaluate(() => document.querySelector(".ui-ov, .uibox, [class*=ov]") ? document.body.innerText : document.body.innerText);
  ok(/Новых записей: 914/.test(dlg) && /Удалится из слоя «sch-»: 0/.test(dlg), "диалог: «Новых записей: 914», «Удалится из слоя: 0»");
  await p.locator("button", { hasText: /^Да$/ }).last().click();
  await p.waitForFunction(() => (state.cache.events || []).filter((e) => String(e.id).startsWith("sch-")).length === 914, null, { timeout: 30000 });
  const after = await p.evaluate(() => ({ L: state.cache.lessons.length, S: state.cache.students.length, E: state.cache.events.length }));
  ok(after.L === before.L && after.S === before.S && after.E === before.E + 914, `остальная база не тронута: занятий ${before.L}→${after.L}, учеников ${before.S}→${after.S}, событий ${before.E}→${after.E}`);
  const sch = await p.evaluate(() => { state.calScope = "school"; const d = dayItems("2026-10-30").map((x) => [itTimeLabel(x), x.ev.title, x.shift]); const all = dayItems("2026-11-12").map((x) => x.ev.title); state.calScope = "all"; return { d, all }; });
  ok(sch.d.length === 5 && sch.d[0][0] === "08:00" && sch.d[4][0] === "11:25" && sch.d.every((x) => !x[2]), "фильтр «Школа», 30.10: 5 уроков 08:00…11:25 без скобок (Бишкек = Бишкек)");
  ok(sch.all.indexOf("Осенние каникулы") >= 0, "12.11 в календаре стоит «Осенние каникулы»");
  await p.evaluate(() => { state.calView = "month"; state.calAnchor = "2026-10-30"; state.calSel = null; state.calScope = "all"; render(); });
  await p.waitForTimeout(300);
  const cell = await p.evaluate(() => (document.querySelector('.cal-cell[data-iso="2026-10-30"]') || {}).innerText || "");
  ok(/08:00 Школа: 5 ур\./.test(cell), "в месяце школьный день свёрнут в одну строку: " + JSON.stringify(cell));
  await p.evaluate(() => { state.calView = "week"; state.calAnchor = "2026-10-30"; render(); });
  await p.waitForTimeout(300);
  const wkSch = await p.evaluate(() => { const c = document.querySelector('.wk2-day[data-iso="2026-10-30"]'); return c ? Array.from(c.querySelectorAll(".wk2-ev")).map((n) => n.innerText.replace(/\s+/g, " ")) : []; });
  ok(wkSch.some((t) => /11:25 5Б русский Контрольная работа/.test(t)), "в неделе урок с темой: " + JSON.stringify(wkSch.filter((t) => /5Б русский/.test(t))));

  console.log("7. Повторная загрузка, отметка «проведено», обновление КТП, удаление строки");
  await p.setInputFiles("#merge-file", "school.json");
  await p.waitForTimeout(500);
  const t1 = await p.evaluate(() => document.getElementById("toast").textContent);
  ok(/нет ничего нового/.test(t1), "тот же файл второй раз: «" + t1 + "»");
  await p.evaluate(async () => { const ev = state.cache.events.find((e) => e.id === "sch-5b-rus-027"); toggleOcc(ev, "2026-10-30", "done"); await new Promise((r) => setTimeout(r, 400)); });
  const j = JSON.parse(fs.readFileSync(__dirname + "/school.json", "utf8"));
  j.data.events.forEach((e) => { e.updatedAt += 1000; e.srcAt += 1000; });
  j.data.events.find((e) => e.id === "sch-5b-rus-027").topic = "Повторение перед каникулами";
  j.data.events = j.data.events.filter((e) => e.id !== "sch-8v-lit-069");
  fs.writeFileSync(__dirname + "/school2.json", JSON.stringify(j));
  await p.setInputFiles("#merge-file", "school2.json");
  await p.waitForSelector("text=Подтверждение");
  const dlg2 = await p.evaluate(() => document.body.innerText);
  ok(/Обновится: 1\n/.test(dlg2) && /Удалится из слоя «sch-»: 1/.test(dlg2), "КТП изменилось в одной строке и одну убрали: «Обновится: 1», «Удалится из слоя: 1»");
  await p.locator("button", { hasText: /^Да$/ }).last().click();
  await p.waitForFunction(() => (state.cache.events || []).filter((e) => String(e.id).startsWith("sch-")).length === 913, null, { timeout: 30000 });
  const upd = await p.evaluate(() => { const e = state.cache.events.find((x) => x.id === "sch-5b-rus-027"); return { topic: e.topic, done: !!(e.ex && e.ex["2026-10-30"] && e.ex["2026-10-30"].done), gone: !state.cache.events.some((x) => x.id === "sch-8v-lit-069"), tomb: !!((JSON.parse(localStorage.getItem("shtab-del") || "{}").events || {})["sch-8v-lit-069"]) }; });
  ok(upd.topic === "Повторение перед каникулами", "тема урока обновилась из файла");
  ok(upd.done, "отметка «проведено» на уроке сохранилась после обновления");
  ok(upd.gone && upd.tomb, "строка, убранная из КТП, ушла из календаря и помечена удалённой для синхронизации");
  const old = await p.evaluate(async (j2) => { const e = state.cache.events.find((x) => x.id === "sch-5b-rus-028"); e.topic = "правка в ШТАБе"; e.updatedAt = Date.now(); await dbPut("events", e); state.cache.events = await dbAll("events"); const pl = await mergePlan(j2); return pl.stat; }, j);
  ok(old.old === 1 && old.upd === 0, "правка, сделанная в ШТАБе позже файла, не перетирается: " + JSON.stringify(old));

  console.log("8. Экспорт .ics: время в UTC, телефон покажет правильно");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.evaluate(() => exportICS())]);
  const ics = fs.readFileSync(await dl.path(), "utf8");
  const blk = (uid) => { const i = ics.indexOf("UID:" + uid + "@shtab"); return i < 0 ? "" : ics.slice(i, ics.indexOf("END:VEVENT", i)); };
  ok(/DTSTART:20261105T120000Z/.test(blk("lesson-tzA")) && /DTEND:20261105T130000Z/.test(blk("lesson-tzA")), "занятие 05.11 15:00 МСК → 12:00Z–13:00Z");
  ok(/DTSTART:20261030T052500Z/.test(blk("ev-sch-5b-rus-027-2026-10-30")) && /DTEND:20261030T061000Z/.test(blk("ev-sch-5b-rus-027-2026-10-30")), "школьный урок 11:25 Бишкек → 05:25Z–06:10Z (45 мин)");
  ok(/DTSTART;VALUE=DATE:20261111/.test(blk("ev-sch-vac-2026-11-11-2026-11-11")), "каникулы выгружены как события на весь день");
  ok(errs.length === 0, "ошибок страницы: " + errs.length + (errs.length ? " " + errs.join(" | ") : ""));
  await ctx.close();

  // ---------------- Москва ----------------
  console.log("9. То же приложение на устройстве в Москве");
  ({ ctx, p, errs } = await boot(b, "Europe/Moscow"));
  const m = await p.evaluate(async () => {
    const l = { id: "tzM", date: "2026-11-03", time: "17:00", duration: 60, status: "planned", updatedAt: Date.now() };
    await dbPut("lessons", l); state.cache.lessons = await dbAll("lessons");
    const sch = { id: "sch-x", scope: "school", type: "Урок в школе", title: "5Б русский", date: "2026-11-03", time: "08:00", tz: "Asia/Bishkek", duration: 45, repeat: "none", ex: {}, updatedAt: Date.now() };
    await dbPut("events", sch); state.cache.events = await dbAll("events");
    const it = dayItems("2026-11-03").find((x) => x.ev.id === "sch-x");
    editFrom("lessons", l); await new Promise((r) => setTimeout(r, 300));
    const ed = document.querySelector(".editor").innerText;
    return { diff: tzDiffers(), lab: lessonTimeLabel(l), sch: itTimeLabel(it), edMsk: /Время \(МСК\)/i.test(ed), edHint: /У вас:/.test(ed) };
  });
  ok(m.diff === false && m.lab === "17:00", "в Москве без скобок: «" + m.lab + "»");
  ok(!m.edMsk && !m.edHint, "в Москве форма без «(МСК)» и без подсказки");
  ok(m.sch === "05:00 (08:00 Бишкек)", "школьный урок 08:00 по Бишкеку в Москве: «" + m.sch + "»");
  console.log("10. Настройка «Время на экране: Бишкек» на компьютере с московским поясом");
  const dz = await p.evaluate(async () => {
    go("calendar"); state.calView = "week"; state.calAnchor = "2026-11-03"; render(); await new Promise((r) => setTimeout(r, 200));
    const sel = Array.from(document.querySelectorAll("select")).find((s) => s.getAttribute("aria-label") === "Время на экране");
    sel.value = "Asia/Bishkek"; sel.dispatchEvent(new Event("change")); await new Promise((r) => setTimeout(r, 400));
    const l = state.cache.lessons.find((x) => x.id === "tzM"), it = dayItems("2026-11-03").find((x) => x.ev.id === "sch-x");
    const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bishkek", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const lab0 = lessonTimeLabel(l), sch0 = itTimeLabel(it); const itL = dayItems("2026-11-03").find((x) => x.ev.id === "tzM"); calMoveTime(itL, "2026-11-05", 18); await new Promise((r) => setTimeout(r, 400));
    const moved = (await dbAll("lessons")).find((x) => x.id === "tzM");
    const saved = (await dbAll("settings")).find((x) => x.id === "app") || {};
    const week = document.getElementById("view").innerText;
    return { lab: lab0, sch: sch0, today: todayIso(), bk: f, moved: moved.date + " " + moved.time, saved: saved.dispTz, hint: /занятия хранятся по МСК/.test(week) };
  });
  ok(dz.lab === "20:00 (17:00 МСК)", "занятие 17:00 МСК на экране: «" + dz.lab + "»");
  ok(dz.sch === "08:00", "школьный урок снова 08:00: «" + dz.sch + "»");
  ok(dz.today === dz.bk, "«сегодня» считается по Бишкеку: " + dz.today);
  ok(dz.moved === "2026-11-05 15:00", "перенос на 18:00 по Бишкеку пишет 15:00 МСК: " + dz.moved);
  ok(dz.saved === "Asia/Bishkek" && dz.hint, "настройка сохранена (уйдёт на все устройства), подсказка в календаре есть");
  ok(errs.length === 0, "ошибок страницы: " + errs.length);
  await ctx.close();
  await b.close();
  console.log(fails ? `\nПРОВАЛОВ: ${fails}` : "\nВСЕ ПРОВЕРКИ ПОЯСА И ШКОЛЬНОГО СЛОЯ ПРОЙДЕНЫ");
  process.exit(fails ? 1 : 0);
})();
