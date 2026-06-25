// ШТАБ · бэкенд синхронизации (Cloudflare Worker + D1)
// Хранит состояние Штаба по секретному ключу-пространству (space).
// Никакой привязки к пользователю: кто знает ключ — видит данные.
// Слияние по принципу "последняя запись побеждает" (по updatedAt).

// --- Слияние состояния по записям (id + updatedAt) с надгробиями удалений (__deleted) ---
function splitDel(data){var del=(data&&data.__deleted)||{},clean={};if(data)for(var k in data){if(k==="__deleted")continue;clean[k]=data[k];}return{data:clean,del:del};}
function mergeDel(a,b){var out={};[a||{},b||{}].forEach(function(m){for(var st in m){out[st]=out[st]||{};var ids=m[st]||{};for(var id in ids){var t=ids[id]||0;if(!out[st][id]||t>out[st][id])out[st][id]=t;}}});return out;}
function mergeState(stored,incoming){
  var S=splitDel(stored),I=splitDel(incoming);
  var del=mergeDel(S.del,I.del);
  var stores={};[S.data,I.data].forEach(function(d){for(var k in d)stores[k]=1;});
  var out={};
  for(var st in stores){
    var map={},order=[];
    var add=function(arr){(arr||[]).forEach(function(rec,i){var id=(rec&&rec.id!=null)?String(rec.id):("__i"+i);if(!(id in map))order.push(id);var cur=map[id];if(!cur||(Number(rec&&rec.updatedAt)||0)>=(Number(cur&&cur.updatedAt)||0))map[id]=rec;});};
    add(S.data[st]);add(I.data[st]);
    var dmap=del[st]||{},res=[];
    order.forEach(function(id){var rec=map[id];var t=dmap[id]||0;if(t&&t>=(Number(rec&&rec.updatedAt)||0))return;res.push(rec);});
    out[st]=res;
  }
  out.__deleted=del;
  return out;
}
function normalizeState(state){var S=splitDel(state),keys=Object.keys(S.data).sort(),out={};keys.forEach(function(k){var arr=(S.data[k]||[]).slice().sort(function(a,b){var ai=(a&&a.id!=null)?String(a.id):"",bi=(b&&b.id!=null)?String(b.id):"";return ai<bi?-1:(ai>bi?1:0);});out[k]=arr;});out.__deleted=S.del;return JSON.stringify(out);}
async function handleAsk(body, env){
  const q = ((body && body.question) || "").toString().slice(0, 2000);
  if (!q) return { answer: null, note: "empty" };
  if (!env.AI_API_KEY) return { answer: null, note: "ai_not_configured" };
  const base = (env.AI_API_BASE || "https://api.groq.com/openai/v1").replace(/\/+$/, "");
  const model = (body && typeof body.model === "string" && body.model.trim()) ? body.model.trim().slice(0, 80) : (env.AI_MODEL || "llama-3.3-70b-versatile");
  const ctx = ((body && body.context) || "").toString().slice(0, 14000);
  const sys = "Ты ассистент приложения ШТАБ (командный центр преподавателя). Отвечай СТРОГО валидным JSON без markdown и без пояснений: {\"say\": \"короткий ответ пользователю на русском, его зачитают вслух\", \"action\": null ИЛИ объект действия}. Если пользователь просто спрашивает — action=null, ответь в say на основе блока ДАННЫЕ, не выдумывай. Если пользователь просит ВЫПОЛНИТЬ действие — заполни action и в say кратко подтверди намерение. Возможные действия: add_lesson{studentName или studentId, date YYYY-MM-DD, time HH:MM, topic, cost}; move_lesson{lessonId, date, time}; mark_paid{lessonId}; mark_done{lessonId}; edit_lesson{lessonId, date, time, topic, cost}; add_student{name, subject, grade, rate, contact}; add_sub{studentName или studentId, kind('занятий' или 'период'), lessons, amount, date}; add_order{topic, clientName, deadline, price}; add_event{title, date, time, type, repeat('none','daily','weekly','biweekly','monthly')}; add_task{text, dueDate}; close_task{taskId}; mark_habit{habitId, date}; add_comment{target: student или lesson, id, text}; set_field{target: student или lesson, id, field, text}; copy_text{text}; make_ics{title, date, time, durationMin}; social{url}; undo{}. id и имена бери ТОЛЬКО из блока ДАННЫЕ (у строк указан {id ...}). Сегодняшняя дата есть в ДАННЫХ; относительные даты (завтра, в среду) переводи в YYYY-MM-DD сам. Если запрос неоднозначен (несколько подходящих записей, например двое с одним именем, или не хватает даты/времени) — не угадывай: верни action null и задай короткий уточняющий вопрос в say. Ты можешь сам сочинять тексты (отчёт родителю, письмо клиенту, домашнее задание, описание занятия, итоги) и класть их в поле text для add_comment, set_field или copy_text. copy_text используй, когда текст нужно просто подготовить для копирования (письмо, сообщение). make_ics — добавить событие в календарь устройства. social — статистика соцсети по ссылке. Для итогов недели и месяца бери готовые цифры из блока АНАЛИТИКА, не пересчитывай. Никогда не удаляй данные и не придумывай id.";
  const hist = Array.isArray(body && body.history) ? body.history.filter(function(m){return m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string";}).slice(-8).map(function(m){return { role: m.role, content: m.content.slice(0, 1500) };}) : [];
  const messages = [{ role: "system", content: sys }].concat(hist).concat([{ role: "user", content: q + (ctx ? ("\n\nДАННЫЕ:\n" + ctx) : "") }]);
  try {
    const r = await fetch(base + "/chat/completions", { method: "POST", headers: { "content-type": "application/json", "authorization": "Bearer " + env.AI_API_KEY, "HTTP-Referer": "https://shtab", "X-Title": "ShtabAssistant" }, body: JSON.stringify({ model: model, messages: messages, temperature: 0.3, max_tokens: 600 }) });
    const j = await r.json();
    const answer = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (!answer) return { answer: null, note: "ai_error", detail: (j && j.error && (j.error.message || j.error)) || "no_content" };
    return { answer: answer };
  } catch (e) { return { answer: null, note: "ai_network" }; }
}

function ttsTicks(){var now=BigInt(Date.now()),unixSec=now/1000n,win=(unixSec+11644473600n)*10000000n;win=win-(win%3000000000n);return win.toString();}
async function ttsSecMsGec(){var str=ttsTicks()+"6A5AA1D4EAFF4E9FB37E23D68491D6F4";var buf=new TextEncoder().encode(str);var hash=await crypto.subtle.digest("SHA-256",buf);var u8=new Uint8Array(hash),hex="";for(var i=0;i<u8.length;i++){hex+=u8[i].toString(16).padStart(2,"0");}return hex.toUpperCase();}
function ttsConfigMsg(){return "X-Timestamp:"+new Date().toString()+"\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n"+JSON.stringify({context:{synthesis:{audio:{metadataoptions:{sentenceBoundaryEnabled:"false",wordBoundaryEnabled:"false"},outputFormat:"audio-24khz-48kbitrate-mono-mp3"}}}});}
function ttsSsmlMsg(text,voice){var rid="";var g=crypto.randomUUID().replace(/-/g,"");rid=g;var esc=String(text).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");return "X-RequestId:"+rid+"\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:"+new Date().toString()+"\r\nPath:ssml\r\n\r\n<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='ru-RU'><voice name='"+voice+"'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>"+esc+"</prosody></speak>".replace("</speak>","</voice></speak>");}
function ttsConcat(arr){var len=0,i;for(i=0;i<arr.length;i++)len+=arr[i].length;var out=new Uint8Array(len),off=0;for(i=0;i<arr.length;i++){out.set(arr[i],off);off+=arr[i].length;}return out;}
async function handleTts(body){
  var text=((body&&body.text)||"").toString().slice(0,900);
  if(!text)return null;
  var voice=((body&&body.voice)||"ru-RU-SvetlanaNeural").toString().slice(0,60);
  var token=await ttsSecMsGec();
  var connId=crypto.randomUUID().replace(/-/g,"");
  var url="https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4&Sec-MS-GEC="+token+"&Sec-MS-GEC-Version=1-131.0.2903.112&ConnectionId="+connId;
  var resp;
  try{resp=await fetch(url,{headers:{"Upgrade":"websocket","Origin":"chrome-extension://jdiccldimpmdpfproefgaocafknbgmma","User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0"}});}catch(e){return null;}
  var ws=resp&&resp.webSocket;
  if(!ws)return null;
  ws.accept();
  return await new Promise(function(resolve){
    var chunks=[],done=false;
    var timer=setTimeout(function(){if(!done){done=true;try{ws.close();}catch(e){}resolve(chunks.length?ttsConcat(chunks):null);}},9000);
    ws.addEventListener("message",function(ev){
      var d=ev.data;
      if(typeof d==="string"){if(d.indexOf("Path:turn.end")>=0){if(!done){done=true;clearTimeout(timer);try{ws.close();}catch(e){}resolve(chunks.length?ttsConcat(chunks):null);}}}
      else{try{var u8=new Uint8Array(d);var hlen=(u8[0]<<8)|u8[1];if(2+hlen<=u8.length)chunks.push(u8.slice(2+hlen));}catch(e){}}
    });
    ws.addEventListener("close",function(){if(!done){done=true;clearTimeout(timer);resolve(chunks.length?ttsConcat(chunks):null);}});
    ws.addEventListener("error",function(){if(!done){done=true;clearTimeout(timer);resolve(null);}});
    try{ws.send(ttsConfigMsg());ws.send(ttsSsmlMsg(text,voice));}catch(e){if(!done){done=true;clearTimeout(timer);resolve(null);}}
  });
}
function corsHeaders(env, request) {
  const origin = request.headers.get("Origin") || "";
  const allowedRaw = env.ALLOWED_ORIGIN || "*";
  const allowed = allowedRaw.split(",").map((s) => s.trim()).filter(Boolean);
  let allow;
  if (allowed.includes("*")) {
    allow = origin || "*";
  } else {
    allow = allowed.includes(origin) ? origin : (allowed[0] || "");
  }
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Shtab-Token",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ "content-type": "application/json; charset=utf-8" }, cors || {}),
  });
}

// Ключ-пространство: 16..128 символов из латиницы, цифр, _ и -
const KEY_RE = /^[A-Za-z0-9_-]{16,128}$/;
const MAX_BYTES = 6000000; // ~6 МБ на пространство

// --- Публичная статистика соцсетей по ссылке (этапы O3/O4) ---
// Возвращает { platform, stats: {followers, views, likes, comments} | null, note }.
// stats === null с note "key_not_set" означает, что ключ для этой площадки не задан.
// Ключи задаются секретами: YT_API_KEY (YouTube), VK_TOKEN (VK), TGSTAT_TOKEN (Telegram, платно).
async function fetchJson(u) {
  const r = await fetch(u, { headers: { "accept": "application/json" } });
  if (!r.ok) return null;
  try { return await r.json(); } catch (e) { return null; }
}
async function handleSocial(target, env) {
  if (!target) return { platform: null, stats: null, note: "no_url" };
  let host = "", u;
  try { u = new URL(target); host = u.hostname.replace(/^www\./, ""); }
  catch (e) { return { platform: null, stats: null, note: "bad_url" }; }
  try {
    if (/youtube\.com$|youtube\.com|youtu\.be/.test(host)) {
      if (!env.YT_API_KEY) return { platform: "youtube", stats: null, note: "key_not_set" };
      let vid = "";
      if (host === "youtu.be") vid = u.pathname.slice(1);
      else if (u.searchParams.get("v")) vid = u.searchParams.get("v");
      if (vid) {
        const j = await fetchJson("https://www.googleapis.com/youtube/v3/videos?part=statistics&id=" + encodeURIComponent(vid) + "&key=" + env.YT_API_KEY);
        const s = j && j.items && j.items[0] && j.items[0].statistics;
        if (s) return { platform: "youtube", stats: { views: +s.viewCount || 0, likes: +s.likeCount || 0, comments: +s.commentCount || 0 } };
        return { platform: "youtube", stats: null, note: "not_found" };
      }
      const parts = u.pathname.split("/").filter(Boolean);
      let q = "";
      if (parts[0] === "channel" && parts[1]) q = "id=" + encodeURIComponent(parts[1]);
      else if (parts[0] && parts[0][0] === "@") q = "forHandle=" + encodeURIComponent(parts[0]);
      else if (parts[0] === "user" && parts[1]) q = "forUsername=" + encodeURIComponent(parts[1]);
      else if (parts[0] === "c" && parts[1]) q = "forHandle=@" + encodeURIComponent(parts[1]);
      else if (parts[0]) q = "forHandle=@" + encodeURIComponent(parts[0]);
      if (q) {
        const j = await fetchJson("https://www.googleapis.com/youtube/v3/channels?part=statistics&" + q + "&key=" + env.YT_API_KEY);
        const s = j && j.items && j.items[0] && j.items[0].statistics;
        if (s) return { platform: "youtube", stats: { followers: +s.subscriberCount || 0, views: +s.viewCount || 0 } };
      }
      return { platform: "youtube", stats: null, note: "not_found" };
    }
    if (/vk\.com|vk\.ru/.test(host)) {
      if (!env.VK_TOKEN) return { platform: "vk", stats: null, note: "key_not_set" };
      const slug = u.pathname.split("/").filter(Boolean)[0] || "";
      if (!slug) return { platform: "vk", stats: null, note: "not_found" };
      const j = await fetchJson("https://api.vk.com/method/groups.getById?group_id=" + encodeURIComponent(slug) + "&fields=members_count&access_token=" + env.VK_TOKEN + "&v=5.199");
      let g = null;
      if (j && j.response) g = Array.isArray(j.response) ? j.response[0] : (j.response.groups && j.response.groups[0]);
      if (g && g.members_count != null) return { platform: "vk", stats: { followers: +g.members_count || 0 } };
      return { platform: "vk", stats: null, note: "not_found" };
    }
    if (/t\.me|telegram\.me/.test(host)) {
      if (!env.TGSTAT_TOKEN) return { platform: "telegram", stats: null, note: "key_not_set" };
      const name = u.pathname.split("/").filter(Boolean)[0] || "";
      if (!name) return { platform: "telegram", stats: null, note: "not_found" };
      const j = await fetchJson("https://api.tgstat.ru/channels/get?token=" + env.TGSTAT_TOKEN + "&channelId=@" + encodeURIComponent(name));
      const r = j && j.response;
      if (r && r.participants_count != null) return { platform: "telegram", stats: { followers: +r.participants_count || 0 } };
      return { platform: "telegram", stats: null, note: "not_found" };
    }
    return { platform: null, stats: null, note: "unsupported_platform" };
  } catch (e) {
    return { platform: null, stats: null, note: "fetch_error" };
  }
}

// --- O5. Приватная аналитика канала через OAuth (YouTube) ---
function oauthHtmlPage(title, text) {
  const h = "<!DOCTYPE html><html lang=ru><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>" +
    title + "</title><style>body{font-family:-apple-system,system-ui,Segoe UI,sans-serif;background:#0a8a86;color:#fff;display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center;padding:24px}.card{background:#000080;border:3px solid #fff;max-width:440px;padding:24px}h1{font-size:18px;margin:0 0 12px}p{line-height:1.55;font-size:14px;margin:0}</style></head><body><div class=card><h1>" +
    title + "</h1><p>" + text + "</p></div></body></html>";
  return new Response(h, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}
function oauthYoutubeStart(url, env) {
  const space = url.searchParams.get("space") || "";
  if (!KEY_RE.test(space)) return oauthHtmlPage("Ошибка", "Неверный ключ пространства. Сначала создайте пространство в разделе Синхронизация.");
  if (!env.YT_CLIENT_ID) return oauthHtmlPage("Не настроено", "На сервере не задан YT_CLIENT_ID. Смотрите GUIDE-ANALYTICS.md.");
  const redirect = new URL(url); redirect.pathname = "/oauth/youtube/callback"; redirect.search = "";
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", env.YT_CLIENT_ID);
  auth.searchParams.set("redirect_uri", redirect.toString());
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", "https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/youtube.readonly");
  auth.searchParams.set("access_type", "offline");
  auth.searchParams.set("prompt", "consent");
  auth.searchParams.set("state", space);
  return Response.redirect(auth.toString(), 302);
}
async function oauthYoutubeCallback(url, env) {
  const code = url.searchParams.get("code") || "";
  const space = url.searchParams.get("state") || "";
  if (!code || !KEY_RE.test(space)) return oauthHtmlPage("Ошибка авторизации", "Не передан код или ключ пространства.");
  if (!env.YT_CLIENT_ID || !env.YT_CLIENT_SECRET) return oauthHtmlPage("Не настроено", "На сервере не заданы YT_CLIENT_ID и YT_CLIENT_SECRET.");
  const redirect = new URL(url); redirect.pathname = "/oauth/youtube/callback"; redirect.search = "";
  const body = new URLSearchParams({ code: code, client_id: env.YT_CLIENT_ID, client_secret: env.YT_CLIENT_SECRET, redirect_uri: redirect.toString(), grant_type: "authorization_code" });
  let tok = null;
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() });
    tok = await r.json();
  } catch (e) {}
  if (!tok || !tok.refresh_token) return oauthHtmlPage("Не удалось подключить", "Google не вернул refresh_token. Откройте доступ заново и подтвердите все запрошенные разрешения. Если повторяется, отзовите доступ приложению в настройках Google и попробуйте ещё раз.");
  if (!env.DB) return oauthHtmlPage("Ошибка базы", "База не подключена.");
  try {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS tokens (space TEXT, provider TEXT, refresh_token TEXT, updated_at INTEGER, PRIMARY KEY(space,provider))").run();
    await env.DB.prepare("INSERT INTO tokens (space,provider,refresh_token,updated_at) VALUES (?,?,?,?) ON CONFLICT(space,provider) DO UPDATE SET refresh_token=excluded.refresh_token, updated_at=excluded.updated_at").bind(space, "youtube", tok.refresh_token, Date.now()).run();
  } catch (e) { return oauthHtmlPage("Ошибка базы", "Не удалось сохранить доступ."); }
  return oauthHtmlPage("YouTube подключён", "Готово. Вернитесь в приложение Штаб, вкладка Аналитика, Канал, и нажмите Обновить аналитику. Эту вкладку можно закрыть.");
}
async function ytAccessToken(env, refreshToken) {
  const body = new URLSearchParams({ client_id: env.YT_CLIENT_ID, client_secret: env.YT_CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" });
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() });
    const j = await r.json();
    return j && j.access_token ? j.access_token : null;
  } catch (e) { return null; }
}
async function handleAnalytics(env, space) {
  if (!KEY_RE.test(space)) return { connected: false, note: "bad_space" };
  if (!env.YT_CLIENT_ID || !env.YT_CLIENT_SECRET) return { connected: false, note: "server_not_configured" };
  if (!env.DB) return { connected: false, note: "db_not_bound" };
  let row = null;
  try {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS tokens (space TEXT, provider TEXT, refresh_token TEXT, updated_at INTEGER, PRIMARY KEY(space,provider))").run();
    row = await env.DB.prepare("SELECT refresh_token FROM tokens WHERE space = ? AND provider = ?").bind(space, "youtube").first();
  } catch (e) {}
  if (!row || !row.refresh_token) return { connected: false, note: "not_connected" };
  const at = await ytAccessToken(env, row.refresh_token);
  if (!at) return { connected: false, note: "auth_failed" };
  const out = { connected: true, channel: null, last28: null };
  try {
    const cr = await fetch("https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&mine=true", { headers: { authorization: "Bearer " + at } });
    const cj = await cr.json();
    const it = cj && cj.items && cj.items[0];
    if (it) {
      const s = it.statistics || {};
      out.channel = { title: (it.snippet && it.snippet.title) || "", subscribers: +s.subscriberCount || 0, totalViews: +s.viewCount || 0, videos: +s.videoCount || 0 };
    }
  } catch (e) {}
  try {
    const end = new Date(), start = new Date(Date.now() - 28 * 864e5);
    const ymd = (d) => d.toISOString().slice(0, 10);
    const au = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
    au.searchParams.set("ids", "channel==MINE");
    au.searchParams.set("startDate", ymd(start));
    au.searchParams.set("endDate", ymd(end));
    au.searchParams.set("metrics", "views,estimatedMinutesWatched,averageViewDuration,subscribersGained,likes,comments");
    const ar = await fetch(au.toString(), { headers: { authorization: "Bearer " + at } });
    const aj = await ar.json();
    if (aj && aj.rows && aj.rows[0]) {
      const r0 = aj.rows[0];
      out.last28 = { views: r0[0], minutesWatched: r0[1], avgViewDuration: r0[2], subscribersGained: r0[3], likes: r0[4], comments: r0[5] };
    }
  } catch (e) {}
  return out;
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env, request);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, service: "shtab-sync" }, 200, cors);
    }

    // OAuth для приватной аналитики (этап O5). Это переходы из браузера, без заголовка токена.
    if (url.pathname === "/oauth/youtube/start") {
      return oauthYoutubeStart(url, env);
    }
    if (url.pathname === "/oauth/youtube/callback") {
      return await oauthYoutubeCallback(url, env);
    }

    // Необязательный общий токен доступа к самому Worker (чтобы посторонние не использовали его).
    // Задаётся как секрет APP_TOKEN. Если не задан — проверка пропускается.
    if (env.APP_TOKEN) {
      const t = request.headers.get("X-Shtab-Token");
      if (t !== env.APP_TOKEN) return json({ error: "unauthorized" }, 401, cors);
    }

    if (url.pathname === "/social") {
      const target = url.searchParams.get("url") || "";
      const out = await handleSocial(target, env);
      return json(out, 200, cors);
    }

    if (url.pathname === "/analytics") {
      const out = await handleAnalytics(env, url.searchParams.get("space") || "");
      return json(out, 200, cors);
    }

    if (url.pathname === "/oauth/disconnect") {
      const space = url.searchParams.get("space") || "";
      const provider = url.searchParams.get("provider") || "youtube";
      if (KEY_RE.test(space) && env.DB) {
        try {
          await env.DB.prepare("CREATE TABLE IF NOT EXISTS tokens (space TEXT, provider TEXT, refresh_token TEXT, updated_at INTEGER, PRIMARY KEY(space,provider))").run();
          await env.DB.prepare("DELETE FROM tokens WHERE space = ? AND provider = ?").bind(space, provider).run();
        } catch (e) {}
      }
      return json({ ok: true }, 200, cors);
    }

    if (url.pathname === "/ask" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch (e) { return json({ error: "bad_json" }, 400, cors); }
      const out = await handleAsk(body, env);
      return json(out, 200, cors);
    }

    if (url.pathname === "/tts" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch (e) { return json({ error: "bad_json" }, 400, cors); }
      const audio = await handleTts(body);
      if (!audio || !audio.length) return json({ error: "tts_failed" }, 502, cors);
      const h = corsHeaders(env, request); h["content-type"] = "audio/mpeg"; h["cache-control"] = "no-store";
      return new Response(audio, { status: 200, headers: h });
    }

    if (url.pathname !== "/state") {
      return json({ error: "not_found" }, 404, cors);
    }

    const space = url.searchParams.get("space") || "";
    if (!KEY_RE.test(space)) {
      return json({ error: "bad_space_key" }, 400, cors);
    }

    if (!env.DB) {
      return json({ error: "db_not_bound" }, 500, cors);
    }

    if (request.method === "GET") {
      const row = await env.DB
        .prepare("SELECT data, updated_at FROM spaces WHERE key = ?")
        .bind(space)
        .first();
      if (!row) return json({ data: null, updatedAt: 0 }, 200, cors);
      let data = null;
      try { data = JSON.parse(row.data); } catch (e) { data = null; }
      return json({ data: data, updatedAt: Number(row.updated_at) || 0 }, 200, cors);
    }

    if (request.method === "POST") {
      let body;
      try { body = await request.json(); } catch (e) { return json({ error: "bad_json" }, 400, cors); }
      const incoming = body && body.data !== undefined ? body.data : null;

      const existingRow = await env.DB
        .prepare("SELECT data FROM spaces WHERE key = ?")
        .bind(space)
        .first();
      let stored = null;
      if (existingRow) { try { stored = JSON.parse(existingRow.data); } catch (e) { stored = null; } }

      // Слияние по записям: чужие изменения не затираются, удаления распространяются через надгробия.
      const merged = mergeState(stored, incoming);
      const changed = normalizeState(merged) !== normalizeState(incoming);
      const dataStr = JSON.stringify(merged);
      if (dataStr.length > MAX_BYTES) return json({ error: "too_large" }, 413, cors);

      const now = Date.now();
      await env.DB
        .prepare(
          "INSERT INTO spaces (key, data, updated_at) VALUES (?, ?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
        )
        .bind(space, dataStr, now)
        .run();
      return json({ ok: true, changed: changed, data: merged, updatedAt: now }, 200, cors);
    }

    return json({ error: "method_not_allowed" }, 405, cors);
  },
};
