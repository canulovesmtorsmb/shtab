// Школьный слой расходится по устройствам через синхронизацию v2.
const { chromium } = require("playwright");
const fs = require("fs");
const APP = "http://127.0.0.1:8000/index.html", WORKER = "http://127.0.0.1:8787";
const KEY = "SchoolSpace_" + Math.random().toString(36).slice(2, 10) + "_abcdefgh";
let fails = 0; const ok = (c, m) => { console.log((c ? "  OK   " : "  FAIL ") + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function device(b, name) {
  const ctx = await b.newContext({ timezoneId: "Asia/Bishkek" }); const page = await ctx.newPage(); const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(APP);
  await page.waitForFunction(() => localStorage.getItem("shtab-base-202606") === "1" && localStorage.getItem("shtab-fresh-202606") === "1", null, { timeout: 60000 });
  await sleep(5000);
  return { ctx, page, errs, name };
}
const connect = (d, merge) => d.page.evaluate(async ({ key, url, merge }) => { const c = syncCfg(); c.key = key; c.url = url; syncSave(c); await syncJoin(key, merge); await syncNow(); return { err: window._syncState.err, dirty: syncDirtyCount() }; }, { key: KEY, url: WORKER, merge });
const schoolCount = (d) => d.page.evaluate(() => (state.cache.events || []).filter((e) => String(e.id).startsWith("sch-")).length);
(async () => {
  const b = await chromium.launch();
  const school = JSON.parse(fs.readFileSync(__dirname + "/school.json", "utf8"));
  const A = await device(b, "A"), B = await device(b, "B");
  ok(!(await connect(A, true)).err, "A подключено");
  ok(!(await connect(B, false)).err, "B подключено");
  console.log("1. На A «Добавить из файла», B забирает");
  await A.page.evaluate(async (j) => { const pl = await mergePlan(j); await mergeApply(pl); }, school);
  await A.page.waitForFunction(() => syncDirtyCount() > 0 || true); await sleep(300);
  const pa = await A.page.evaluate(async () => { await syncNow(); return { err: window._syncState.err, dirty: syncDirtyCount() }; });
  ok(!pa.err && pa.dirty === 0, "A отправило все школьные записи: " + JSON.stringify(pa));
  const st = await (await fetch(`${WORKER}/v2/stats?space=${KEY}`)).json();
  ok((st.counts.events || 0) === 914, "на сервере событий: " + st.counts.events);
  await B.page.evaluate(async () => { await syncNow(); });
  ok((await schoolCount(B)) === 914, "на B пришли все 914 школьных записей");
  console.log("2. Отметка на B доходит до A, удаление строки КТП с A доходит до B");
  await B.page.evaluate(async () => { const ev = state.cache.events.find((e) => e.id === "sch-5b-rus-027"); toggleOcc(ev, "2026-10-30", "done"); await new Promise((r) => setTimeout(r, 500)); await syncNow(); });
  await A.page.evaluate(async () => { await syncNow(); });
  const doneA = await A.page.evaluate(() => { const e = state.cache.events.find((x) => x.id === "sch-5b-rus-027"); return !!(e.ex && e.ex["2026-10-30"] && e.ex["2026-10-30"].done); });
  ok(doneA, "отметка «проведено» с B видна на A");
  const j2 = JSON.parse(JSON.stringify(school)); j2.data.events = j2.data.events.filter((e) => e.id !== "sch-8v-lit-069");
  const pl2 = await A.page.evaluate(async (j) => { const pl = await mergePlan(j); await mergeApply(pl); await syncNow(); return pl.stat; }, j2);
  ok(pl2.del === 1 && pl2.upd === 0 && pl2.old === 0, "повторная загрузка без одной строки: " + JSON.stringify(pl2));
  await B.page.evaluate(async () => { await syncNow(); });
  ok((await schoolCount(B)) === 913, "на B строка тоже ушла");
  const stillDone = await B.page.evaluate(() => { const e = state.cache.events.find((x) => x.id === "sch-5b-rus-027"); return !!(e.ex && e.ex["2026-10-30"] && e.ex["2026-10-30"].done); });
  ok(stillDone, "отметка на B не сбилась");
  ok(A.errs.length === 0 && B.errs.length === 0, "ошибок страницы нет");
  await b.close();
  console.log(fails ? `\nПРОВАЛОВ: ${fails}` : "\nШКОЛЬНЫЙ СЛОЙ СИНХРОНИЗИРУЕТСЯ");
  process.exit(fails ? 1 : 0);
})();
