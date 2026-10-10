/* BreatheSafe - plain JavaScript, no frameworks */
const $ = id => document.getElementById(id);

/* ---------- 1. Data ---------- */
const CITIES = { Accra: [5.60, -0.19], Aburi: [5.85, -0.18], Kumasi: [6.69, -1.62], Takoradi: [4.90, -1.76], "Cape Coast": [5.11, -1.25], Tamale: [9.40, -0.84] };
const TRIGGERS = [["cold", "Cold air", "snow"], ["dust", "Dust", "wind"], ["smoke", "Smoke", "flame"], ["scent", "Strong scents", "flask"], ["pet", "Pet dander", "heart"], ["pollen", "Pollen", "sprout"]];
const ic = n => `<svg class="i"><use href="#i-${n}"/></svg>`;

function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; } }
function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} }

let user = load("bs_user", null);
let alerts = load("bs_alerts", []);
let reports = load("bs_reports", []);
let song = localStorage.getItem("bs_song");   // chosen song, stored as text
let prevTemp = load("bs_prev", null);
let data = { temp: null, pm25: null, code: null, time: null, live: false };   // real data
let demo = { temp: null, pm25: null, scent: false };                          // fake values for the demo lab
let room = 20;                                                                 // demo room sensor
let timer, audioCtx, sirenTimer, vibTimer, snoozeUntil = 0, currentAlert = null;

/* Values the app uses: demo values win over real ones when set */
const temp = () => demo.temp !== null ? demo.temp : data.temp;
const pm = () => demo.pm25 !== null ? demo.pm25 : data.pm25;

/* ---------- 2. Start up ---------- */
Object.keys(CITIES).forEach(c => $("city").innerHTML += `<option>${c}</option>`);
TRIGGERS.forEach(([id, label, icon]) => {
  $("triggerChips").innerHTML += `<label class="chip"><input type="checkbox" value="${id}"> ${ic(icon)}${label}</label>`;
});

if (user) start(); else $("signup").classList.remove("hidden");

$("signupForm").onsubmit = e => {
  e.preventDefault();
  const picked = [...document.querySelectorAll("#triggerChips input:checked")].map(i => i.value);
  user = {
    name: $("name").value.trim(), contact: $("contact").value.trim(), city: $("city").value,
    cold: Number($("cold").value), drop: Number($("drop").value), triggers: picked,
    sound: $("sound").value, night: $("nightOn").checked,
    interval: user ? user.interval : 5
  };
  save("bs_user", user);
  start();
};

function start() {
  $("signup").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("loc").textContent = "" + user.city;
  $("soundSet").value = user.sound === "song" ? "song" : "auto";
  setPlace(user.place || "inside");
  $("interval").value = user.interval;
  $("whoami").textContent = `${user.name} · ${user.contact} · cold limit ${user.cold}°C`;
  $("songName").textContent = song ? "A song is saved and ready." : "No song chosen yet.";
  buildLogChips(); renderAvatar(); updateBadge();
  showView("home");
  getData();
  clearInterval(timer);
  timer = setInterval(getData, user.interval * 60000);   // keeps checking while the page is open
}

/* ---------- 3. Navigation ---------- */
function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  $(id).classList.remove("hidden");
  document.querySelectorAll("nav button").forEach(b => b.classList.toggle("active", b.dataset.view === id));
  document.body.classList.toggle("night", id === "nightView");
  if (id === "alertsView") renderAlerts();
  if (id === "reportsView") renderReports();
  if (id === "nightView") renderNight();
  window.scrollTo(0, 0);
}
document.querySelectorAll("nav button").forEach(b => b.onclick = () => showView(b.dataset.view));
$("btnNight").onclick = () => showView("nightView");
$("btnSettings").onclick = () => showView("settingsView");

/* ---------- 4. Real data (Open-Meteo, free, no key) ---------- */
async function getData() {
  const [lat, lon] = CITIES[user.city];
  try {
    const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`)).json();
    data.temp = Math.round(w.current.temperature_2m * 10) / 10;
    data.code = w.current.weather_code;
    try {
      const a = await (await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm2_5`)).json();
      data.pm25 = a.current.pm2_5;
    } catch (e) { data.pm25 = null; }
    data.time = new Date();
    data.live = true;
  } catch (e) {
    data.live = false;   // offline: keep the last values and say so
  }
  render();
  checkAlerts(false);
}
$("refresh").onclick = getData;

function weatherText(c) {
  if (c === null) return "";
  if (c === 0) return "Clear sky";
  if (c <= 3) return "Partly cloudy";
  if (c <= 48) return "Foggy";
  if (c <= 67) return "Rainy";
  if (c <= 82) return "Showers";
  return "Thunderstorm";
}
const clock = d => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/* ---------- 5. Status helpers (every status has a label AND an icon) ---------- */
function tempState(t) {
  if (t === null) return ["", "Unknown", "help", "Temperature unavailable."];
  if (t < user.cold) return ["bad", "Below your limit", "x", "Wear warm clothing or move somewhere warmer."];
  if (t < user.cold + 2) return ["warn", "Approaching limit", "alert", "Keep a warm layer nearby."];
  return ["ok", "Comfortable", "check", "Within your preferred range."];
}
function dustState(p) {
  if (p === null) return ["", "Unknown", "help", "No air data right now."];
  if (p <= 12) return ["ok", "Good", "check", "Air looks clean."];
  if (p <= 35) return ["warn", "Elevated", "alert", "Reduce exposure and move to cleaner indoor air."];
  return ["bad", "Poor", "x", "Stay indoors if you can and keep windows closed."];
}
function recentOdours() { return reports.filter(r => r.type === "scent" && Date.now() - r.time < 86400000).length; }

function setCard(id, state, label, icon) {
  $(id).className = "card ind " + state;
  $(id.replace("c", "").toLowerCase() + "Tag").innerHTML = ic(icon) + " " + label;
}

/* ---------- 6. Draw the home screen ---------- */
function render() {
  const h = new Date().getHours();
  $("greet").textContent = (h < 12 ? "Good morning, " : h < 17 ? "Good afternoon, " : "Good evening, ") + user.name;
  const t = temp(), p = pm();
  $("temp").textContent = t === null ? "--°C" : t + "°C";
  const src = demo.temp !== null ? "DEMO data" : data.live ? "Live · Open-Meteo" : "Offline, showing last reading";
  $("wx").textContent = `${weatherText(data.code)} · ${src}` + (data.time ? " · updated " + clock(data.time) : "");

  const [ts, tl, ti, tt] = tempState(t);
  $("verdict").innerHTML = ic(ti) + " " + (ts === "ok" ? "Your environment looks comfortable." : tl + ".");
  $("tempVal").textContent = t === null ? "--" : t + "°C (limit " + user.cold + ")";
  $("tempTip").textContent = tt;
  setCard("cTemp", ts, tl, ti);
  $("tempBar").style.width = (t === null ? 0 : Math.max(0, Math.min(100, (t - 10) / 25 * 100))) + "%";

  const [ds, dl, di, dt] = dustState(p);
  $("dustVal").textContent = p === null ? "--" : p.toFixed(0) + " µg/m³";
  $("dustTip").textContent = dt + (demo.pm25 !== null ? " (demo)" : " PM2.5 from air-quality data.");
  setCard("cDust", ds, dl, di);
  $("dustBar").style.width = (p === null ? 0 : Math.min(100, p / 75 * 100)) + "%";

  const n = recentOdours();
  const scentState = demo.scent ? ["bad", "Strong scent", "x"] : n ? ["warn", n + " report" + (n > 1 ? "s" : ""), "alert"] : ["ok", "No recent reports", "check"];
  $("scentVal").textContent = demo.scent ? "Detected" : "Clear";
  $("scentTip").textContent = demo.scent ? "Demo sensor: strong scent. Move to fresher air." : "Not monitored by a real sensor. Based on your reports.";
  setCard("cScent", scentState[0], scentState[1], scentState[2]);

  const reco = $("reco");
  if (ts === "bad" || ts === "warn") reco.innerHTML = `<h3>What you can do</h3><p>${tt}</p>`;
  else if (ds === "bad" || ds === "warn") reco.innerHTML = `<h3>What you can do</h3><p>${dt}</p>`;
  else if (demo.scent) reco.innerHTML = `<h3>What you can do</h3><p>Move away from the strong scent.</p>`;
  else reco.innerHTML = `<p>All calm right now. Nothing to do.</p>`;

  const last = alerts[0];
  $("lastAlert").textContent = last ? `Last alert: ${last.title} at ${clock(new Date(last.time))}.` : "No alerts yet.";
}

/* ---------- 7. Alerts ---------- */
function checkAlerts(force) {
  const t = temp(), p = pm();
  if (t !== null) {
    if (prevTemp !== null && prevTemp - t >= user.drop)
      raise("drop", "Temperature dropped quickly", `It fell from ${prevTemp}°C to ${t}°C. You asked to be warned about drops of ${user.drop}°C.`, "Add a warm layer or warm the room.", force);
    else if (t < user.cold)
      raise("cold", "Below your cold limit", `It is ${t}°C and your limit is ${user.cold}°C.`, "Wear warm clothing or move somewhere warmer.", force);
    prevTemp = t; save("bs_prev", t);
  }
  if (p !== null && p > 35 && user.triggers.includes("dust"))
    raise("dust", "Poor air quality", `PM2.5 is ${p.toFixed(0)} µg/m³. Dust is one of your triggers.`, "Stay indoors and keep windows closed.", force);
  if (demo.scent && user.triggers.includes("scent"))
    raise("scent", "Strong scent detected", "The demo sensor picked up a strong scent. Scents are one of your triggers.", "Move to fresher air.", force);
}

function raise(type, title, msg, action, force) {
  const last = alerts.find(a => a.type === type);
  // do not repeat the same unchanged alert within 30 minutes
  if (!force && last && last.msg === msg && Date.now() - last.time < 1800000) return;
  const a = { id: Date.now(), type, title, msg, action, time: Date.now(), ack: false };
  alerts.unshift(a);
  alerts = alerts.slice(0, 100);
  save("bs_alerts", alerts);
  renderAlerts(); render();
  if (Date.now() < snoozeUntil) return;          // snoozed: logged, but silent
  showBanner(a);
  const h = new Date().getHours();
  const quiet = (h >= 22 || h < 6) && !user.night;
  if (!quiet) playSound();
}

function showBanner(a) {
  currentAlert = a;
  $("bTitle").textContent = a.title;
  $("bMode").textContent = user.place === "outside" ? "Outside: beeping" : "Inside: ringing";
  $("bMsg").textContent = a.msg;
  $("bAct").textContent = "Suggested action: " + a.action;
  $("banner").classList.remove("hidden");
}
$("bAck").onclick = () => {
  stopSound();
  if (currentAlert) { currentAlert.ack = true; save("bs_alerts", alerts); }
  $("banner").classList.add("hidden");
  renderAlerts();
};
$("bSnooze").onclick = () => { snoozeUntil = Date.now() + 600000; stopSound(); $("banner").classList.add("hidden"); };

function renderAlerts() {
  updateBadge();
  $("alertList").innerHTML = alerts.length ? alerts.map(a => `
    <div class="card alert-item ${a.ack ? "acked" : ""}">
      <b>${a.title}</b> <span class="small">${new Date(a.time).toLocaleString()}</span>
      <p>${a.msg}</p><p class="small">Suggested action: ${a.action}</p>
      <p class="small">${a.ack ? "Acknowledged" : "Not acknowledged yet"}</p>
    </div>`).join("") : `<div class="card"><p>No alerts yet. When something changes, you'll see it here.</p></div>`;
}
$("clearAlerts").onclick = () => { alerts = []; save("bs_alerts", alerts); renderAlerts(); render(); };

/* ---------- 8. Sounds (Web Audio API makes the beep and alarm) ---------- */
function tone(freq, delay, length, type, vol) {
  const o = audioCtx.createOscillator(), g = audioCtx.createGain(), now = audioCtx.currentTime + delay;
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, now);
  g.gain.setValueAtTime(vol, now + length * 0.8);          // hold the volume, then fade out
  g.gain.exponentialRampToValueAtTime(0.001, now + length);
  o.connect(g); g.connect(audioCtx.destination);
  o.start(now); o.stop(now + length);
}
function ensureAudio() {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
}
/* Outside = fast loud beeps. Inside = phone ring. Both repeat until stopSound() runs. */
function playSound() {
  stopSound();
  if (user.sound === "song" && song) {
    $("audio").src = song; $("audio").loop = true; $("audio").play().catch(() => {});
    return;
  }
  ensureAudio();
  const outside = user.place === "outside";
  const pattern = outside
    ? () => { for (let i = 0; i < 3; i++) tone(1400, i * 0.18, 0.1, "square", 0.3); }
    : () => { for (let i = 0; i < 2; i++) { tone(440, i * 0.55, 0.45, "triangle", 0.4); tone(480, i * 0.55, 0.45, "triangle", 0.4); } };
  const gap = outside ? 900 : 2400;
  pattern();
  sirenTimer = setInterval(pattern, gap);
  if (navigator.vibrate) {                                   // phones also buzz
    const buzz = () => navigator.vibrate(outside ? [100, 80, 100, 80, 100] : [600, 300, 600]);
    buzz(); vibTimer = setInterval(buzz, gap);
  }
}
function stopSound() {
  clearInterval(sirenTimer); clearInterval(vibTimer);
  if (navigator.vibrate) navigator.vibrate(0);
  $("audio").pause();
}

$("soundSet").onchange = () => { user.sound = $("soundSet").value; save("bs_user", user); };
$("playTest").onclick = () => { playSound(); setTimeout(stopSound, 6000); };
$("songFile").onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    song = reader.result;
    try { localStorage.setItem("bs_song", song); $("songName").textContent = "Saved: " + file.name; }
    catch (err) { $("songName").textContent = file.name + " (too big to save, works until you close the page)"; }
    user.sound = "song"; $("soundSet").value = "song"; save("bs_user", user);
  };
  reader.readAsDataURL(file);
};
$("interval").onchange = () => { user.interval = Number($("interval").value); save("bs_user", user); start(); };

/* ---------- 9. Logging triggers + odour reports ---------- */
function buildLogChips() {
  $("logChips").innerHTML = TRIGGERS.map(([id, label, icon]) => `<button class="chip" data-t="${id}">${ic(icon)}${label}</button>`).join("");
  document.querySelectorAll("#logChips .chip").forEach(b => b.onclick = () => {
    logReport(b.dataset.t); b.classList.add("on");
    setTimeout(() => b.classList.remove("on"), 800);
  });
}
function logReport(type) {
  reports.push({ type, time: Date.now() });
  save("bs_reports", reports);
  render();
}
$("reportOdour").onclick = () => { logReport("scent"); alert("Odour reported. Thank you!"); };

/* ---------- 10. Weekly report ---------- */
function renderReports() {
  const days = Number($("range").value), since = Date.now() - days * 86400000;
  const myAlerts = alerts.filter(a => a.time > since && a.type !== "test");
  const myReports = reports.filter(r => r.time > since);
  if (!myAlerts.length && !myReports.length) {
    $("summary").textContent = "Nothing recorded yet. Alerts and the triggers you log will show up here.";
    $("bars").innerHTML = ""; $("topTriggers").textContent = "No triggers logged."; return;
  }
  $("summary").textContent = `You had ${myAlerts.length} alert(s) and logged ${myReports.length} trigger event(s) in the last ${days} days.`;
  const counts = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const start = d.getTime(), end = start + 86400000;
    const n = [...myAlerts, ...myReports].filter(x => x.time >= start && x.time < end).length;
    counts.push([d.toLocaleDateString([], { weekday: "narrow" }), n]);
  }
  const max = Math.max(...counts.map(c => c[1]), 1);
  $("bars").innerHTML = counts.map(c => `<div class="bar">${c[1]}<i style="height:${(c[1] / max) * 80}%"></i>${c[0]}</div>`).join("");
  const tally = {};
  myReports.forEach(r => tally[r.type] = (tally[r.type] || 0) + 1);
  const rows = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  $("topTriggers").innerHTML = rows.length ? rows.map(([id, n]) => `<p>${TRIGGERS.find(t => t[0] === id)[1]}: ${n}</p>`).join("") : "No triggers logged.";
}
$("range").onchange = renderReports;
function renderAll() { render(); renderAlerts(); renderReports(); }

/* ---------- 11. Night monitor ---------- */
function renderNight() {
  $("roomTemp").textContent = room + "°C";
  $("roomMsg").textContent = room < user.cold
    ? `Below your minimum of ${user.cold}°C. Consider covering up or putting on warmer clothing.`
    : `Your preferred minimum is ${user.cold}°C. All good.`;
  $("nightStatus").textContent = $("nightToggle").checked ? "Monitoring is on. Keep this page open." : "Monitoring is off.";
}
$("roomSlider").oninput = () => {
  room = Number($("roomSlider").value); renderNight();
  if ($("nightToggle").checked && room < user.cold)
    raise("room", "Room is getting cold", `Room temperature is ${room}°C, below your ${user.cold}°C minimum.`, "Cover up or warm the room.", false);
};
$("nightToggle").onchange = renderNight;
$("nightTest").onclick = () => { stopSound(); audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); tone(660, 0, 0.4, "sine", 0.2); };

/* ---------- 12. Settings: demo lab, edit, reset ---------- */
document.querySelectorAll("[data-demo]").forEach(b => b.onclick = () => {
  const k = b.dataset.demo;
  if (k === "cold") demo.temp = Math.round(((data.temp || 27) - 8) * 10) / 10;
  if (k === "dust") demo.pm25 = 80;
  if (k === "scent") demo.scent = true;
  if (k === "reset") { demo = { temp: null, pm25: null, scent: false }; prevTemp = data.temp; }
  render(); checkAlerts(true);
  showView("home");
});

$("editProfile").onclick = () => {
  $("name").value = user.name; $("contact").value = user.contact; $("city").value = user.city;
  $("cold").value = user.cold; $("drop").value = user.drop; $("sound").value = user.sound === "song" ? "song" : "auto";
  $("nightOn").checked = user.night;
  document.querySelectorAll("#triggerChips input").forEach(i => i.checked = user.triggers.includes(i.value));
  $("signupBtn").textContent = "Save changes";
  $("app").classList.add("hidden"); $("signup").classList.remove("hidden");
};

$("resetAll").onclick = () => {
  if (confirm("Delete your details and history?")) { localStorage.clear(); location.reload(); }
};

/* ---------- 13. Inside / Outside ---------- */
function setPlace(p) {
  user.place = p; save("bs_user", user);
  $("placeIn").classList.toggle("on", p === "inside");
  $("placeOut").classList.toggle("on", p === "outside");
  $("placeHint").textContent = p === "inside" ? "Inside: alerts ring like a phone until you answer." : "Outside: alerts beep loudly until you answer.";
}
$("placeIn").onclick = () => setPlace("inside");
$("placeOut").onclick = () => setPlace("outside");
document.querySelectorAll("[data-test]").forEach(b => b.onclick = () => {
  setPlace(b.dataset.test);
  raise("test", "Test alert", "This is how your alert sounds " + (b.dataset.test === "outside" ? "outside." : "inside."), "Tap Acknowledge to stop it.", true);
});

/* ---------- 14. Notification badge + profile picture ---------- */
function updateBadge() {
  const n = alerts.filter(a => !a.ack).length;
  ["badgeTop", "badgeNav"].forEach(id => { $(id).textContent = n > 9 ? "9+" : n; $(id).classList.toggle("hidden", n === 0); });
}
$("btnBell").onclick = () => showView("alertsView");
$("markRead").onclick = () => { alerts.forEach(a => a.ack = true); save("bs_alerts", alerts); renderAlerts(); };

function renderAvatar() {
  const pic = localStorage.getItem("bs_pic");
  const html = pic ? `<img src="${pic}" alt="">` : user.name.charAt(0).toUpperCase();
  $("avatarMini").innerHTML = html; $("avatarBig").innerHTML = html;
  $("pName").textContent = user.name; $("pContact").textContent = user.contact;
}
$("picFile").onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {                       // crop to a square and shrink so it fits in localStorage
    const c = document.createElement("canvas"); c.width = c.height = 200;
    const s = Math.min(img.width, img.height);
    c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 200, 200);
    try { localStorage.setItem("bs_pic", c.toDataURL("image/jpeg", 0.85)); } catch (err) {}
    renderAvatar();
  };
  img.src = URL.createObjectURL(file);
};
