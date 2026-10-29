// «Добавить из файла»: тренажёры из воскресной дельты привязываются к ученику по имени.
const { chromium } = require("playwright");
const fs = require("fs");
let fails = 0; const ok = (c, m) => { console.log((c ? "  OK   " : "  FAIL ") + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ timezoneId: "Asia/Bishkek" }); const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("http://127.0.0.1:8000/index.html");
  await p.waitForFunction(() => localStorage.getItem("shtab-base-202606") === "1" && typeof db !== "undefined" && db); await p.waitForTimeout(3500);
  await p.evaluate(async () => { const now = Date.now();
    await dbPut("students", { id: "A1", name: "Аня 9 класс", createdAt: now, updatedAt: now });
    await dbPut("students", { id: "A0", name: "Аня 9 класс", archived: true, createdAt: now, updatedAt: now });
    await dbPut("students", { id: "Y1", name: "Ёжик", createdAt: now, updatedAt: now }); await loadAll(); go("calendar"); });
  fs.writeFileSync(__dirname + "/delta_names.json", JSON.stringify({ app: "shtab", data: { trainers: [
    { id: "trn-1", studentName: "Аня 9 класс", title: "Тренажёр 1", updatedAt: 1 },
    { id: "trn-2", studentName: " ежик ", title: "Тренажёр 2", updatedAt: 1 },
    { id: "trn-3", studentName: "Нет такого", title: "Тренажёр 3", updatedAt: 1 },
    { id: "trn-4", studentId: "A0", studentName: "Аня 9 класс", title: "Тренажёр 4", updatedAt: 1 } ] } }));
  await p.setInputFiles("#merge-file", __dirname + "/delta_names.json"); await p.waitForSelector("#ui-ov");
  const dlg = await p.locator("#ui-ov").innerText();
  ok(/Новых записей: 4/.test(dlg) && /Не нашёл учеников по имени: Нет такого\. Эти записи придут без привязки/.test(dlg), "окно: 4 новых, ненайденное имя названо");
  await p.locator("#ui-ov button", { hasText: /^Да$/i }).click(); await p.waitForTimeout(800);
  const t = await p.evaluate(async () => Object.fromEntries((await dbAll("trainers")).map((x) => [x.id, x.studentId || ""])));
  ok(t["trn-1"] === "A1" && t["trn-2"] === "Y1" && t["trn-3"] === "" && t["trn-4"] === "A0", "привязка: активная карточка важнее архивной, ё = е, без имени пусто, явный id не трогается " + JSON.stringify(t));
  ok(errs.length === 0, "ошибок страницы: " + errs.length + " " + errs.join(" | "));
  await b.close(); console.log(fails ? "ПРОВАЛОВ: " + fails : "ДЕЛЬТА ПРИВЯЗЫВАЕТСЯ ПО ИМЕНИ"); process.exit(fails ? 1 : 0);
})();
