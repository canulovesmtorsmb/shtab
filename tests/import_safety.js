// «Заменить базу»: подтверждение словом, копия перед заменой.
const { chromium } = require("playwright"); const fs = require("fs");
let fails = 0; const ok = (c, m) => { console.log((c ? "  OK   " : "  FAIL ") + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ acceptDownloads: true }); const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("http://127.0.0.1:8000/index.html");
  await p.waitForFunction(() => localStorage.getItem("shtab-base-202606") === "1" && typeof db !== "undefined" && db); await p.waitForTimeout(4000);
  await p.evaluate(async () => { await dbPut("students", { id: "keep-1", name: "Было до замены", updatedAt: Date.now() }); state.cache.students = await dbAll("students"); render(); });
  const btn = await p.evaluate(() => document.getElementById("btn-import").innerText.trim().toLowerCase());
  ok(btn === "заменить базу", "кнопка называется «Заменить базу»");
  fs.writeFileSync(__dirname + "/repl.json", JSON.stringify({ app: "shtab", data: { students: [{ id: "new-1", name: "Из файла", updatedAt: 1 }] } }));
  // 1) неверное слово
  await p.setInputFiles("#import-file", "repl.json");
  await p.waitForSelector("text=Подтверждение"); await p.locator("button", { hasText: /^Дальше$/i }).click();
  await p.waitForTimeout(300); await p.keyboard.type("да"); await p.locator(".ui-box button, button", { hasText: /^(ОК|OK|Готово|Применить)$/i }).last().click().catch(async () => { await p.keyboard.press("Enter"); });
  await p.waitForTimeout(1500);
  let names = await p.evaluate(async () => (await dbAll("students")).map((s) => s.name));
  ok(names.includes("Было до замены") && !names.includes("Из файла"), "неверное слово: база не тронута");
  // 2) верное слово
  await p.setInputFiles("#import-file", "repl.json");
  await p.waitForSelector("text=Подтверждение"); await p.locator("button", { hasText: /^Дальше$/i }).click();
  await p.waitForTimeout(300); await p.keyboard.type("ЗАМЕНИТЬ");
  const dlP = p.waitForEvent("download", { timeout: 8000 }).catch(() => null);
  await p.locator("button", { hasText: /^(ОК|OK|Готово|Применить)$/i }).last().click().catch(async () => { await p.keyboard.press("Enter"); });
  const dl = await dlP; ok(!!dl && /shtab-backup/.test(dl.suggestedFilename()), "перед заменой скачалась копия: " + (dl && dl.suggestedFilename()));
  await p.waitForTimeout(2500);
  names = await p.evaluate(async () => (await dbAll("students")).map((s) => s.name));
  ok(names.includes("Из файла") && !names.includes("Было до замены"), "после слова ЗАМЕНИТЬ база заменена");
  ok(errs.length === 0, "ошибок страницы: " + errs.length + " " + errs.join("|"));
  await b.close(); console.log(fails ? "ПРОВАЛОВ: " + fails : "ЗАМЕНА БАЗЫ ЗАЩИЩЕНА"); process.exit(fails ? 1 : 0);
})();
