// Все браузерные тесты начинаются 29.10.2026 в 12:00 МСК, дальше время идёт как обычно,
// у всех «устройств» и у самого теста по одной шкале.
// Так проверки с датами (ноябрь, «продлить на месяц», автозакрытие) не устаревают.
const pw = require("playwright");
const START = new Date(process.env.SHTAB_TEST_NOW || "2026-10-29T09:00:00Z");
// метки времени, которые ставит сам тест в Node, идут по тем же часам, что и браузер
const realNow = Date.now, shift = START.getTime() - realNow();
const shifted = () => realNow() + shift;
Date.now = shifted;
const launch = pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch = async (...args) => {
  const b = await launch(...args);
  const newContext = b.newContext.bind(b);
  b.newContext = async (...o) => {
    const c = await newContext(...o), t = shifted();
    // Playwright сверяет часы страницы с Date.now в Node, поэтому на время установки он настоящий
    Date.now = realNow;
    try { await c.clock.install({ time: new Date(t) }); } finally { Date.now = shifted; }
    return c;
  };
  b.newPage = async (...o) => (await b.newContext(...o)).newPage();
  return b;
};
