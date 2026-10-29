// Устройство в Бишкеке не закрывает занятие, которое по Москве ещё не началось.
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch(); let fails = 0;
  const ctx = await b.newContext({ timezoneId: "Asia/Bishkek" }); const p = await ctx.newPage(); const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("http://127.0.0.1:8000/index.html");
  await p.waitForFunction(() => localStorage.getItem("shtab-base-202606") === "1" && db && state.cache.lessons); await p.waitForTimeout(4500);
  const r = await p.evaluate(async () => {
    // занятие сегодня через 40 минут по московскому времени
    const ms = Date.now() + 40 * 60000;
    const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const pp = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    const l = { id: "tz-test", date: `${pp.year}-${pp.month}-${pp.day}`, time: `${pp.hour}:${pp.minute}`, duration: 60, status: "planned", cost: 1000, updatedAt: Date.now() };
    await dbPut("lessons", l); state.cache.lessons = await dbAll("lessons");
    const ended = lessonEnded(l);
    autoCloseLessons(); await new Promise((r) => setTimeout(r, 800));
    const after = (await dbAll("lessons")).find((x) => x.id === "tz-test");
    return { msk: l.date + " " + l.time, ended, status: after.status };
  });
  console.log(`  занятие в ${r.msk} МСК (через 40 мин): lessonEnded=${r.ended}, после автозакрытия «${r.status}», ошибок страницы ${errs.length}`);
  if (r.ended || r.status !== "planned" || errs.length) fails++;
  await b.close(); console.log(fails ? "ПРОВАЛ" : "БУДУЩЕЕ ЗАНЯТИЕ НА БИШКЕКСКОМ УСТРОЙСТВЕ НЕ ЗАКРЫВАЕТСЯ"); process.exit(fails ? 1 : 0);
})();
