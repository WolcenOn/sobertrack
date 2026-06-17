const $ = selector => document.querySelector(selector);
const KEY = 'sobertrack-state-v1';
const VIRTUAL_GLASS_CAPACITY_ML = 300;
const ETHANOL_DENSITY = 0.789;
const ELIMINATION_PER_MINUTE = 0.0025;

const DB = {
  spirits: [
    { id: 'gin-beefeater', brand: 'Beefeater', type: 'Ginebra', abv: 40, servings: [['Chupito', 40], ['Copa', 50], ['Combinado', 250]] },
    { id: 'rum-bacardi', brand: 'Bacardi', type: 'Ron blanco', abv: 37.5, servings: [['Chupito', 40], ['Copa', 50], ['Combinado', 250]] },
    { id: 'vodka-smirnoff', brand: 'Smirnoff', type: 'Vodka', abv: 37.5, servings: [['Chupito', 40], ['Copa', 50], ['Combinado', 250]] },
    { id: 'whisky-jw', brand: 'Johnnie Walker', type: 'Whisky', abv: 40, servings: [['Chupito', 40], ['Copa', 50], ['Vaso', 60]] }
  ],
  beers: [
    { id: 'mahou', brand: 'Mahou', type: 'Lager', abv: 5.5, servings: [['Caña', 200], ['Tercio', 333], ['Pinta', 568]] },
    { id: 'estrella', brand: 'Estrella Galicia', type: 'Lager', abv: 5.5, servings: [['Caña', 200], ['Tercio', 333], ['Pinta', 568]] },
    { id: 'ipa', brand: 'IPA genérica', type: 'IPA', abv: 6.5, servings: [['Media pinta', 284], ['Pinta', 568]] }
  ],
  wines: [
    { id: 'rioja', brand: 'Rioja', type: 'Tinto', abv: 13.5, servings: [['Copa', 100], ['Copa generosa', 150], ['Botella', 750]] },
    { id: 'verdejo', brand: 'Verdejo', type: 'Blanco', abv: 12.5, servings: [['Copa', 100], ['Copa generosa', 150], ['Botella', 750]] },
    { id: 'cava', brand: 'Cava', type: 'Espumoso', abv: 11.5, servings: [['Flauta', 100], ['Copa', 150], ['Botella', 750]] }
  ]
};

const state = load() || {
  profile: { weight: 70, sex: 'male', stomach: 'empty', limit: 0.3 },
  drinks: [],
  waterBoost: false,
  reflexBase: null,
  fillRatio: 0.55,
  ice: 0
};

let deferredInstall = null;
let reflexTimer = null;
let reflexArmed = false;
let reflexStart = 0;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function catLabel(key) { return { spirits: 'Destilados', beers: 'Cervezas', wines: 'Vinos' }[key]; }
function currentCategory() { return $('#category').value; }
function currentDrink() { return DB[currentCategory()].find(drink => drink.id === $('#drink').value); }
function currentServing() { return Number($('#serving').value) || 0; }
function isSpiritMode() { return currentCategory() === 'spirits'; }

function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js');
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstall = event;
    $('#installBtn').classList.remove('hidden');
  });
  $('#installBtn').onclick = async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    deferredInstall = null;
    $('#installBtn').classList.add('hidden');
  };
  hydrateUI();
  bind();
  drawAll();
}

function hydrateUI() {
  $('#weight').value = state.profile.weight;
  $('#sex').value = state.profile.sex;
  $('#stomach').value = state.profile.stomach;
  $('#limit').value = state.profile.limit;
  $('#ice').value = state.ice;
  Object.keys(DB).forEach(key => $('#category').add(new Option(catLabel(key), key)));
  $('#category').value = 'spirits';
  fillDrinks();
}

function fillDrinks() {
  $('#drink').innerHTML = '';
  DB[currentCategory()].forEach(drink => {
    $('#drink').add(new Option(`${drink.brand} · ${drink.type} · ${drink.abv}%`, drink.id));
  });
  fillServings();
}

function fillServings() {
  const drink = currentDrink();
  $('#serving').innerHTML = '';
  drink.servings.forEach(([name, ml]) => $('#serving').add(new Option(`${name}: ${ml} ml`, ml)));
  updateGlassStats();
}

function bind() {
  $('#category').onchange = () => { fillDrinks(); drawAll(); };
  $('#drink').onchange = () => { fillServings(); drawAll(); };
  $('#serving').onchange = drawAll;
  $('#ice').oninput = () => {
    state.ice = clamp(Number($('#ice').value) || 0, 0, 8);
    $('#ice').value = state.ice;
    save();
    drawAll();
  };
  $('#saveProfile').onclick = () => {
    state.profile = {
      weight: Number($('#weight').value) || 70,
      sex: $('#sex').value,
      stomach: $('#stomach').value,
      limit: Number($('#limit').value) || 0.3
    };
    save();
    drawAll();
  };
  $('#addDrink').onclick = addDrink;
  $('#waterBtn').onclick = () => { state.waterBoost = true; save(); drawAll(); };
  $('#resetBtn').onclick = () => { if (confirm('¿Borrar sesión local?')) { localStorage.removeItem(KEY); location.reload(); } };
  $('#exportBtn').onclick = exportData;
  $('#reflexBtn').onclick = reflex;
  const glass = $('#glass');
  ['pointerdown', 'pointermove'].forEach(eventName => glass.addEventListener(eventName, event => {
    if (eventName === 'pointerdown') glass.setPointerCapture?.(event.pointerId);
    if (event.buttons || eventName === 'pointerdown') setFill(event);
  }));
}

function glassMetrics() {
  return { x: 55, y: 45, w: 150, h: 330, cap: VIRTUAL_GLASS_CAPACITY_ML };
}

function setFill(event) {
  const rect = $('#glass').getBoundingClientRect();
  const metrics = glassMetrics();
  const scale = $('#glass').width / rect.width;
  const pointerY = (event.clientY - rect.top) * scale;
  state.fillRatio = clamp(1 - ((pointerY - metrics.y) / metrics.h), 0, 1);
  save();
  drawAll();
}

function volumes() {
  const selectedServingMl = currentServing();
  const iceMl = isSpiritMode() ? (Number($('#ice').value) || 0) * 30 : 0;
  const physicalFillMl = isSpiritMode() ? VIRTUAL_GLASS_CAPACITY_ML * state.fillRatio : selectedServingMl;
  const liquidUnderMarkedLevel = clamp(physicalFillMl - iceMl, 0, VIRTUAL_GLASS_CAPACITY_ML - iceMl);
  const spirit = isSpiritMode() ? liquidUnderMarkedLevel : 0;
  const totalDrinkTarget = isSpiritMode() ? Math.max(selectedServingMl, spirit) : selectedServingMl;
  const mixer = isSpiritMode() ? clamp(totalDrinkTarget - iceMl - spirit, 0, totalDrinkTarget) : 0;
  return { selectedServingMl, iceMl, spirit, mixer, physicalFillMl };
}

function drawGlass() {
  const canvas = $('#glass');
  const ctx = canvas.getContext('2d');
  const metrics = glassMetrics();
  const v = volumes();
  const base = metrics.y + metrics.h;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(229,242,255,.85)';
  ctx.fillStyle = 'rgba(255,255,255,.03)';
  ctx.beginPath();
  ctx.moveTo(metrics.x, metrics.y);
  ctx.lineTo(metrics.x + metrics.w, metrics.y);
  ctx.lineTo(metrics.x + metrics.w - 25, base);
  ctx.lineTo(metrics.x + 25, base);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const iceCount = isSpiritMode() ? Number($('#ice').value) || 0 : 0;
  const iceH = metrics.h * (v.iceMl / metrics.cap);
  const fillH = isSpiritMode() ? metrics.h * state.fillRatio : metrics.h * 0.75;
  const spiritH = metrics.h * (v.spirit / metrics.cap);

  ctx.fillStyle = 'rgba(56,189,248,.30)';
  ctx.fillRect(metrics.x + 25, base - fillH, metrics.w - 50, fillH);
  ctx.fillStyle = 'rgba(34,197,94,.55)';
  ctx.fillRect(metrics.x + 25, base - iceH - spiritH, metrics.w - 50, spiritH);
  ctx.fillStyle = 'rgba(191,219,254,.78)';
  for (let i = 0; i < iceCount; i++) {
    const row = Math.floor(i / 3);
    const col = i % 3;
    ctx.save();
    ctx.translate(metrics.x + 47 + col * 33, base - 18 - row * 30);
    ctx.rotate((i % 2 ? -1 : 1) * 0.15);
    ctx.fillRect(-12, -10, 24, 20);
    ctx.restore();
  }
  ctx.strokeStyle = 'rgba(255,255,255,.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  const markY = base - fillH;
  ctx.moveTo(metrics.x + 18, markY);
  ctx.lineTo(metrics.x + metrics.w - 18, markY);
  ctx.stroke();
  ctx.fillStyle = '#e5f2ff';
  ctx.font = '15px system-ui';
  ctx.fillText(isSpiritMode() ? 'Arrastra el nivel' : 'Volumen por envase', 58, 405);
  updateGlassStats();
}

function updateGlassStats() {
  const drink = currentDrink();
  const v = volumes();
  $('#spiritMl').textContent = isSpiritMode() ? `${Math.round(v.spirit)} ml` : `${currentServing()} ml`;
  $('#mixerMl').textContent = isSpiritMode() ? `${Math.round(v.mixer)} ml` : '0 ml';
  $('#abvText').textContent = `${drink.abv}%`;
}

function addDrink() {
  const drink = currentDrink();
  const v = volumes();
  const ml = isSpiritMode() ? v.spirit : currentServing();
  if (ml <= 0) return alert('Marca un volumen mayor que cero. Si hay hielo, sube el nivel por encima de los cubitos.');
  const absorption = ($('#stomach').value === 'full' ? 90 : 30) * (state.waterBoost ? 1.1 : 1);
  state.drinks.push({
    id: crypto.randomUUID(),
    time: Date.now(),
    brand: drink.brand,
    type: drink.type,
    abv: drink.abv,
    ml,
    grams: ml * (drink.abv / 100) * ETHANOL_DENSITY,
    absorption
  });
  state.waterBoost = false;
  save();
  drawAll();
}

function bacAt(timestamp) {
  const r = state.profile.sex === 'female' ? 0.55 : 0.68;
  const weight = state.profile.weight || 70;
  let absorbed = 0;
  for (const drink of state.drinks) {
    const minutes = (timestamp - drink.time) / 60000;
    if (minutes <= 0) continue;
    absorbed += drink.grams * clamp(minutes / drink.absorption, 0, 1);
  }
  const rawBac = absorbed / (weight * r);
  const firstDrinkTime = state.drinks[0]?.time ?? timestamp;
  const elapsedSinceFirst = Math.max(0, (timestamp - firstDrinkTime) / 60000);
  return Math.max(0, rawBac - ELIMINATION_PER_MINUTE * elapsedSinceFirst);
}

function curve(durationMinutes = 240, stepMinutes = 5) {
  const now = Date.now();
  const points = [];
  for (let minute = 0; minute <= durationMinutes; minute += stepMinutes) {
    points.push({ min: minute, bac: bacAt(now + minute * 60000) });
  }
  return points;
}

function drawRiskBand(ctx, chart, from, to, color, label) {
  const y1 = chart.yFor(Math.min(to, chart.max));
  const y2 = chart.yFor(Math.max(from, 0));
  if (y2 < chart.top || y1 > chart.bottom) return;
  ctx.fillStyle = color;
  ctx.fillRect(chart.left, Math.max(chart.top, y1), chart.width, Math.min(chart.bottom, y2) - Math.max(chart.top, y1));
  ctx.fillStyle = 'rgba(229,242,255,.72)';
  ctx.font = '12px system-ui';
  ctx.fillText(label, chart.left + 8, Math.max(chart.top + 15, y1 + 15));
}

function drawChart() {
  const canvas = $('#chart');
  const ctx = canvas.getContext('2d');
  const points = curve();
  const width = canvas.width;
  const height = canvas.height;
  const chart = {
    left: 42,
    right: width - 24,
    top: 26,
    bottom: height - 36,
    max: Math.max(4, ...points.map(point => point.bac), state.profile.limit * 1.3)
  };
  chart.width = chart.right - chart.left;
  chart.height = chart.bottom - chart.top;
  chart.xFor = minute => chart.left + (minute / 240) * chart.width;
  chart.yFor = bac => chart.bottom - (bac / chart.max) * chart.height;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#08111f';
  ctx.fillRect(0, 0, width, height);

  drawRiskBand(ctx, chart, 0, 0.5, 'rgba(34,197,94,.10)', '0–0.5: afectación baja');
  drawRiskBand(ctx, chart, 0.5, 0.8, 'rgba(245,158,11,.12)', '0.5–0.8: atención');
  drawRiskBand(ctx, chart, 0.8, 1.5, 'rgba(249,115,22,.14)', '0.8–1.5: borracho');
  drawRiskBand(ctx, chart, 1.5, 3, 'rgba(239,68,68,.15)', '1.5–3: muy borracho');
  drawRiskBand(ctx, chart, 3, 4, 'rgba(127,29,29,.35)', '3+: posible coma etílico');

  ctx.strokeStyle = 'rgba(159,176,200,.25)';
  ctx.lineWidth = 1;
  ctx.fillStyle = 'rgba(229,242,255,.7)';
  ctx.font = '11px system-ui';
  [0, 0.5, 0.8, 1.5, 3, 4].forEach(level => {
    const y = chart.yFor(level);
    ctx.beginPath();
    ctx.moveTo(chart.left, y);
    ctx.lineTo(chart.right, y);
    ctx.stroke();
    ctx.fillText(level.toFixed(level % 1 ? 1 : 0), 8, y + 4);
  });

  const limitY = chart.yFor(state.profile.limit);
  ctx.strokeStyle = '#f59e0b';
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.moveTo(chart.left, limitY);
  ctx.lineTo(chart.right, limitY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 4;
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = chart.xFor(point.min);
    const y = chart.yFor(point.bac);
    index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = '#e5f2ff';
  ctx.font = '18px system-ui';
  ctx.fillText('BAC g/L · franjas orientativas', chart.left, 20);
  ctx.font = '11px system-ui';
  ctx.fillText('0 min', chart.left, height - 10);
  ctx.fillText('4 h', chart.right - 20, height - 10);

  const now = bacAt(Date.now());
  const peak = points.reduce((best, point) => point.bac > best.bac ? point : best, points[0]);
  $('#bacNow').textContent = `${now.toFixed(2)} g/L`;
  $('#bacPeak').textContent = `${peak.bac.toFixed(2)} g/L`;
  $('#peakTime').textContent = peak.min ? `en ${peak.min} min` : 'ahora';
  renderLimitAlert(points);
  renderNextAdvice(now, peak);
}

function renderLimitAlert(points) {
  const over = points.find(point => point.bac > state.profile.limit);
  const box = $('#alert');
  if (over) {
    box.className = 'alert bad';
    box.textContent = `¡Alto! El alcohol ingerido subirá en ${over.min} minutos y superarás tu límite de ${state.profile.limit} g/L.`;
  } else {
    box.className = 'alert ok';
    box.textContent = 'Sin riesgo proyectado por encima de tu límite.';
  }
}

function renderNextAdvice(now, peak) {
  const box = $('#nextAdvice');
  if (!state.drinks.length) {
    box.className = 'alert ok';
    box.textContent = 'Registra una copa para calcular una recomendación de espera antes de la siguiente.';
    return;
  }
  const extended = curve(480, 5);
  const limit = state.profile.limit || 0.3;
  const target = Math.min(limit, 0.5);
  const afterPeakUnderTarget = extended.find(point => point.min >= peak.min && point.bac <= target);
  const nextPossible = afterPeakUnderTarget?.min ?? 480;
  if (peak.bac > limit) {
    box.className = 'alert bad';
    box.textContent = `Recomendación: no tomes otra copa. Espera al menos ${nextPossible} minutos para volver por debajo de ${target.toFixed(2)} g/L según esta estimación.`;
  } else if (peak.min > 0) {
    box.className = 'alert ok';
    box.textContent = `Recomendación: espera como mínimo ${Math.max(30, peak.min + 20)} minutos. Tu BAC aún está subiendo por el efecto retraso.`;
  } else if (now > target) {
    box.className = 'alert bad';
    box.textContent = `Recomendación: espera al menos ${nextPossible} minutos antes de otra copa. Ahora estás por encima del objetivo preventivo de ${target.toFixed(2)} g/L.`;
  } else {
    box.className = 'alert ok';
    box.textContent = 'Recomendación: si decides beber otra, espera al menos 30 minutos, alterna con agua y mantente por debajo de tu límite.';
  }
}

function renderHistory() {
  const ul = $('#history');
  ul.innerHTML = '';
  state.drinks.slice().reverse().forEach(drink => {
    const li = document.createElement('li');
    li.textContent = `${new Date(drink.time).toLocaleTimeString()} · ${drink.brand} ${drink.type} · ${Math.round(drink.ml)} ml · ${drink.grams.toFixed(1)} g alcohol`;
    ul.append(li);
  });
  $('#waterState').textContent = state.waterBoost ? 'Bonus activo: la siguiente copa se absorberá un 10% más lenta.' : 'Sin bonus de hidratación activo.';
}

function reflex() {
  const button = $('#reflexBtn');
  const out = $('#reflexResult');
  if (reflexArmed) {
    const ms = performance.now() - reflexStart;
    reflexArmed = false;
    button.classList.remove('ready');
    button.textContent = 'Empezar de nuevo';
    if (!state.reflexBase) state.reflexBase = ms;
    const deviation = ((ms - state.reflexBase) / state.reflexBase) * 100;
    out.textContent = `Tiempo: ${Math.round(ms)} ms. Base: ${Math.round(state.reflexBase)} ms. Desviación: ${Math.round(deviation)}%. ${deviation > 25 ? 'Mejor pasa a bebidas sin alcohol y vuelve acompañado/a.' : 'Dentro de tu referencia de la noche.'}`;
    save();
    return;
  }
  button.textContent = 'Espera...';
  out.textContent = 'Pulsa solo cuando se ponga verde.';
  clearTimeout(reflexTimer);
  reflexTimer = setTimeout(() => {
    reflexArmed = true;
    reflexStart = performance.now();
    button.classList.add('ready');
    button.textContent = '¡Pulsa ahora!';
  }, 900 + Math.random() * 2200);
}

function exportData() {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
  link.download = `sobertrack-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function drawAll() {
  drawGlass();
  drawChart();
  renderHistory();
}

init();
