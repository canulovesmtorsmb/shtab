// Подключение по ссылке с ключом: окно выбора, слияние, ключ убран из адреса
const { chromium } = require("playwright");
(async () => {
  let fails = 0; const ok = (c, m) => { console.log((c ? "  OK   " : "  FAIL ") + m); if (!c) fails++; };
  const b = await chromium.launch(); const ctx = await b.newContext(); const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("  ошибка страницы:", e.message));
  await p.goto("http://127.0.0.1:8000/index.html");
  await p.waitForFunction(() => localStorage.getItem("shtab-base-202606") === "1" && db && state.cache.lessons); await p.waitForTimeout(4500);
  await p.evaluate(() => { const c = syncCfg(); c.url = "http://127.0.0.1:8787"; syncSave(c); });
  const KEY = "LinkSpace_" + Math.random().toString(36).slice(2, 10) + "_abcdefghij";
  await p.goto("about:blank"); await p.goto("http://127.0.0.1:8000/index.html#key=" + KEY);
  await p.waitForFunction(() => db && state.cache.lessons); await p.waitForTimeout(2500);
  ok(!/key=/.test(await p.evaluate(() => location.href)), "ключ убран из адресной строки");
  const btns = await p.$$eval("button", (bs) => bs.map((x) => x.innerText.trim().toLowerCase()));
  ok(btns.includes("слить с облаком") && btns.includes("только забрать облако") && btns.includes("отмена"), "окно выбора с тремя кнопками");
  const dlg = await p.evaluate(() => document.body.innerText);
  ok(/пока нет ваших записей/.test(dlg), "новое устройство: окно предупреждает, что здесь только демо-база");
  const prim = await p.$$eval("button.btn-primary", (bs) => bs.map((x) => x.innerText.trim().toLowerCase()));
  ok(prim.includes("только забрать облако"), "главная кнопка на новом устройстве – «Только забрать облако»");
  await p.click('button:has-text("Слить с облаком")'); await p.waitForTimeout(4000);
  const r = await p.evaluate(() => ({ key: syncCfg().key, dirty: syncDirtyCount(), err: window._syncState.err, n: state.cache.lessons.length }));
  const st = await (await fetch("http://127.0.0.1:8787/v2/stats?space=" + KEY)).json();
  console.log("   состояние:", JSON.stringify(r), "сервер:", JSON.stringify(st).slice(0,200));
  ok(r.key === KEY && !r.err && r.dirty === 0, "устройство подключено, ошибок нет, всё отправлено");
  ok(!(st.counts && st.counts.lessons), `даже при «Слить с облаком» демо-база в облако не ушла: занятий на сервере ${(st.counts && st.counts.lessons) || 0}`);
  await b.close(); console.log(fails ? "ПРОВАЛОВ: " + fails : "ПОДКЛЮЧЕНИЕ ПО ССЫЛКЕ РАБОТАЕТ"); process.exit(fails ? 1 : 0);
})();
