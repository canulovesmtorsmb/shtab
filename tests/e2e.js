// Сквозная проверка синхронизации v2: два «устройства» (отдельные профили браузера) и локальный Worker.
// Запуск: node e2e.js <backup.json>
const { chromium } = require("playwright");
const fs = require("fs");
const APP = "http://127.0.0.1:8000/index.html";
const WORKER = "http://127.0.0.1:8787";
const KEY = "E2eSpace_" + Math.random().toString(36).slice(2, 10) + "_qwertyuiop";
let fails = 0;
const ok = (c, m) => { console.log((c ? "  OK   " : "  FAIL ") + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const backup = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
// Устройство B: та же база, но разошедшаяся, как два настоящих устройства
const bB = JSON.parse(JSON.stringify(backup));
const L = bB.data.lessons;
const removedOnB = L.splice(0, 40).map((l) => l.id);                 // 40 занятий есть только на A
const editedOnB = L.slice(0, 30).map((l) => { l.topic = "ПРАВКА НА B " + l.id.slice(0, 4); l.updatedAt = Date.now() + 5000; return l.id; });
const staleOnB = L.slice(30, 45).map((l) => { l.topic = "СТАРАЯ ВЕРСИЯ НА B"; l.updatedAt = 1000; return l.id; });
const addedOnB = [];
for (let k = 0; k < 25; k++) { const id = "onlyB-" + k; addedOnB.push(id); L.push({ id, date: "2026-12-0" + ((k % 9) + 1), time: "10:00", status: "planned", studentId: L[0].studentId, topic: "новое на B " + k, duration: 60, cost: 1000, updatedAt: Date.now() + 1000 }); }

async function device(browser, name) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.dismiss().catch(() => {}));
  page.on("pageerror", (e) => console.log(`   [${name}] ошибка страницы:`, e.message));
  await page.goto(APP);
  await page.waitForFunction(() => typeof doImportFile === "function" && typeof db !== "undefined" && db && state && state.cache && state.cache.lessons, null, { timeout: 60000 });
  // ждём, пока закончится посев при первом запуске и стартовые задачи приложения (они идут на 3,5 с)
  await page.waitForFunction(() => localStorage.getItem("shtab-base-202606") === "1" && localStorage.getItem("shtab-fresh-202606") === "1", null, { timeout: 60000 });
  await sleep(5000);
  return { ctx, page, name };
}
async function importInto(d, data) {
  await d.page.evaluate(async (txt) => { doImportFile(new File([txt], "b.json")); }, JSON.stringify(data));
  await d.page.waitForFunction((n) => (state.cache.lessons || []).length === n, data.data.lessons.length, { timeout: 60000 });
  await d.page.evaluate(() => { _syncDirty = { seq: 0, m: {} }; syncDirtyFlush(); }); // импорт для подготовки, не правка
}
async function connect(d, merge) {
  return d.page.evaluate(async ({ key, url, merge }) => {
    const c = syncCfg(); c.key = key; c.url = url; syncSave(c);
    const t0 = Date.now(); await syncJoin(key, merge); await syncNow();
    return { ms: Date.now() - t0, err: window._syncState.err, dirty: syncDirtyCount() };
  }, { key: KEY, url: WORKER, merge });
}
const syncNowOn = (d) => d.page.evaluate(async () => { await syncNow(); return { err: window._syncState.err, dirty: syncDirtyCount() }; });
const lessonsOf = (d) => d.page.evaluate(() => Object.fromEntries((state.cache.lessons || []).map((l) => [String(l.id), { t: l.topic, u: recU(l), st: l.status }])));
const stats = async () => (await (await fetch(`${WORKER}/v2/stats?space=${KEY}`)).json());

(async () => {
  const browser = await chromium.launch();
  const A = await device(browser, "A"), B = await device(browser, "B");
  console.log("Подготовка: A – сегодняшняя выгрузка, B – разошедшаяся копия");
  await importInto(A, backup); await importInto(B, bB);
  ok(true, `A: ${backup.data.lessons.length} занятий, B: ${bB.data.lessons.length} занятий`);

  console.log("1. A подключается и отдаёт свою базу");
  let r = await connect(A, true);
  ok(!r.err && r.dirty === 0, `A синхронизирована за ${r.ms} мс, ошибок нет, неотправленного ${r.dirty}`);
  let st = await stats();
  ok(st.counts.lessons === backup.data.lessons.length, `на сервере занятий ${st.counts.lessons}`);

  console.log("2. B подключается со слиянием");
  r = await connect(B, true);
  ok(!r.err && r.dirty === 0, `B синхронизирована за ${r.ms} мс, ошибок нет`);
  await syncNowOn(A); await syncNowOn(B); await syncNowOn(A);
  const la = await lessonsOf(A), lb = await lessonsOf(B);
  const ka = Object.keys(la).sort(), kb = Object.keys(lb).sort();
  ok(ka.length === kb.length && ka.join() === kb.join(), `наборы занятий совпали: A ${ka.length}, B ${kb.length}`);
  const expectN = backup.data.lessons.length + addedOnB.length;
  ok(ka.length === expectN, `объединение без потерь: ожидалось ${expectN}, есть ${ka.length}`);
  ok(removedOnB.every((id) => la[id] && lb[id]), "40 занятий, которых не было на B, теперь есть на обоих");
  ok(addedOnB.every((id) => la[id] && lb[id]), "25 занятий, созданных только на B, теперь есть на обоих");
  ok(editedOnB.every((id) => la[id].t.startsWith("ПРАВКА НА B") && lb[id].t.startsWith("ПРАВКА НА B")), "30 более новых правок с B победили на обоих");
  ok(staleOnB.every((id) => la[id].t !== "СТАРАЯ ВЕРСИЯ НА B" && lb[id].t !== "СТАРАЯ ВЕРСИЯ НА B"), "15 устаревших версий с B проиграли на обоих");
  ok(ka.every((id) => JSON.stringify(la[id]) === JSON.stringify(lb[id])), "содержимое каждого занятия совпало на A и B");

  console.log("3. Обычная правка, создание и удаление через интерфейсные функции");
  const id0 = ka.find((id) => !id.startsWith("onlyB"));
  await A.page.evaluate(async (id) => { const l = state.cache.lessons.find((x) => String(x.id) === id); l.topic = "правка на A в 3"; l.updatedAt = Date.now(); await dbPut("lessons", l); }, id0);
  await A.page.evaluate(async () => { await dbPut("students", { id: "stud-new-test", name: "Новый ученик", subject: "ЕГЭ русский язык", rate: 1500, status: "активен", createdAt: Date.now(), updatedAt: Date.now() }); });
  const delId = addedOnB[3];
  await B.page.evaluate(async (id) => { await dbDel("lessons", id); }, delId);
  await syncNowOn(A); await syncNowOn(B); await syncNowOn(A);
  const lb2 = await lessonsOf(B), la2 = await lessonsOf(A);
  ok(lb2[id0] && lb2[id0].t === "правка на A в 3", "правка с A дошла до B");
  ok(await B.page.evaluate(() => !!(state.cache.students || []).find((s) => s.id === "stud-new-test")), "новый ученик с A появился на B");
  ok(!la2[delId] && !lb2[delId], "удаление на B дошло до A");

  console.log("4. Конфликт: одна запись правится на обоих, побеждает поздняя");
  await A.page.evaluate(async (id) => { const l = state.cache.lessons.find((x) => String(x.id) === id); l.topic = "КОНФЛИКТ: A раньше"; l.updatedAt = Date.now(); await dbPut("lessons", l); }, id0);
  await sleep(30);
  await B.page.evaluate(async (id) => { const l = state.cache.lessons.find((x) => String(x.id) === id); l.topic = "КОНФЛИКТ: B позже"; l.updatedAt = Date.now(); await dbPut("lessons", l); }, id0);
  await syncNowOn(B); await syncNowOn(A); await syncNowOn(B);
  ok((await lessonsOf(A))[id0].t === "КОНФЛИКТ: B позже" && (await lessonsOf(B))[id0].t === "КОНФЛИКТ: B позже", "обе стороны сошлись на более поздней правке");

  console.log("5. Нет сети: правка не теряется и уходит после восстановления");
  await A.ctx.setOffline(true);
  await A.page.evaluate(async (id) => { const l = state.cache.lessons.find((x) => String(x.id) === id); l.topic = "сделано без сети"; l.updatedAt = Date.now(); await dbPut("lessons", l); }, id0);
  r = await syncNowOn(A);
  ok(!!r.err && r.dirty >= 1, `без сети: ошибка показана («${(r.err || "").slice(0, 40)}…»), в очереди ${r.dirty}`);
  const persisted = await A.page.evaluate(() => { syncDirtyFlush(); const d = JSON.parse(localStorage.getItem("shtab-sync-dirty")); return Object.keys(d.m.lessons || {}).length; });
  ok(persisted >= 1, "очередь неотправленного сохранена в памяти браузера и переживёт перезапуск");
  await A.ctx.route(WORKER + "/**", (rt) => rt.abort());          // сервер недоступен, но страница перезапускается
  await A.ctx.setOffline(false);
  await A.page.reload(); await A.page.waitForFunction(() => typeof syncNow === "function" && db && state.cache.lessons && state.cache.lessons.length > 0);
  const afterReload = await A.page.evaluate(() => syncDirtyCount());
  ok(afterReload >= 1, `после перезапуска приложения в очереди по-прежнему ${afterReload}`);
  await A.ctx.unroute(WORKER + "/**");
  r = await syncNowOn(A); await syncNowOn(B);
  ok(!r.err && r.dirty === 0, "после перезапуска и появления сети очередь ушла");
  ok((await lessonsOf(B))[id0].t === "сделано без сети", "правка, сделанная без сети, дошла до B");

  console.log("6. Новое устройство без слияния: забирает облако и не тащит туда своё");
  const C = await device(browser, "C");
  const seedN = await C.page.evaluate(() => (state.cache.lessons || []).length);
  r = await connect(C, false);
  const lc = await lessonsOf(C);
  st = await stats();
  ok(!r.err, `C подключена без слияния (встроенных демо-занятий было ${seedN})`);
  ok(Object.keys(await lessonsOf(A)).every((id) => lc[id]), "на C пришли все занятия облака");
  ok(st.counts.lessons === Object.keys(await lessonsOf(A)).length, `в облако с C ничего лишнего не ушло: занятий на сервере ${st.counts.lessons}`);

  console.log("7. Старое приложение больше не может затереть базу июльской копией");
  const res = await (await fetch(`${WORKER}/state?space=${KEY}`)).json();
  ok(res.data === null && res.upgraded === true, "GET /state для этого пространства пустой");

  console.log("8. Автозакрытие ждёт свежих данных");
  const auto = await A.page.evaluate(() => { window._syncState.pulledAt = 0; const a = syncFreshForAuto(); window._syncState.pulledAt = Date.now(); const b = syncFreshForAuto(); return [a, b]; });
  ok(auto[0] === false && auto[1] === true, "без свежего чтения с сервера автозакрытие пропускается");

  console.log("9. Экран синхронизации и проверка связи открываются без ошибок");
  const ui = await A.page.evaluate(async () => { state.active = "sync"; render(); await new Promise((r) => setTimeout(r, 300)); const t = document.getElementById("view").innerText; syncDiag(); await new Promise((r) => setTimeout(r, 1500)); const box = Array.from(document.querySelectorAll(".note")).map((n) => n.innerText).find((x) => x.includes("Ревизия сервера")) || ""; return { t, box }; });
  ok(/Перечитать всё с сервера/i.test(ui.t) && /всё отправлено/i.test(ui.t), "экран синхронизации: новые кнопки и статус «всё отправлено»");
  if (!(/Перечитать всё с сервера/i.test(ui.t) && /всё отправлено/i.test(ui.t))) console.log("--- статус ---\n" + (ui.t.match(/СТАТУС[\s\S]{0,400}/i)||[""])[0]);
  ok(/Ревизия сервера/.test(ui.box) && !/расходится/.test(ui.box.split("Сравниваю")[1] || "x расходится"), "проверка связи: сервер и устройство сходятся по всем коллекциям");
  if (/расходится/.test(ui.box)) console.log(ui.box);

  await browser.close();
  console.log(fails ? `\nПРОВАЛОВ: ${fails}` : "\nВСЕ СКВОЗНЫЕ ПРОВЕРКИ ПРОЙДЕНЫ");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("СБОЙ ТЕСТА:", e); process.exit(2); });
