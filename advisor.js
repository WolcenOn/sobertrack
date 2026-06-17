const STORAGE_KEY = 'sobertrack-state-v1';
const ETHANOL_DENSITY = 0.789;
const ELIMINATION_PER_MINUTE = 0.0025;
const $ = selector => document.querySelector(selector);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getStoredState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { drinks: [], profile: {} };
  } catch {
    return { drinks: [], profile: {} };
  }
}

function getProfile() {
  const stored = getStoredState();
  return {
    weight: Number($('#weight')?.value) || stored.profile?.weight || 70,
    sex: $('#sex')?.value || stored.profile?.sex || 'male',
    stomach: $('#stomach')?.value || stored.profile?.stomach || 'empty',
    limit: Number($('#limit')?.value) || stored.profile?.limit || 0.3
  };
}

function getSelectedDrinkPlan() {
  const category = $('#category')?.value || 'manual';
  const stored = getStoredState();
  const fillRatio = Number(stored.fillRatio ?? 0.35);
  const ice = Number($('#ice')?.value || stored.ice || 0);

  if (category === 'manual') {
    return {
      name: ($('#manualBrand')?.value || 'Bebida manual').trim(),
      type: ($('#manualType')?.value || 'Personalizada').trim(),
      abv: clamp(Number($('#manualAbv')?.value) || 0, 0, 80),
      ml: Math.max(0, Number($('#manualMl')?.value) || 0)
    };
  }

  const drinkText = $('#drink')?.selectedOptions?.[0]?.textContent || 'Bebida seleccionada';
  const servingMl = Number($('#serving')?.value) || 0;
  const abvMatch = drinkText.match(/([0-9]+(?:[.,][0-9]+)?)%/);
  const abv = abvMatch ? Number(abvMatch[1].replace(',', '.')) : 0;
  const name = drinkText.replace(/\s·\s[0-9]+(?:[.,][0-9]+)?%/, '');

  if (category === 'spirits') {
    const cap = Math.max(40, servingMl);
    const iceMl = ice * 30;
    const physicalFillMl = cap * fillRatio;
    const spiritMl = clamp(physicalFillMl - iceMl, 0, Math.max(0, cap - iceMl));
    return { name, type: 'Destilado con mezclador', abv, ml: spiritMl };
  }

  return { name, type: category === 'wines' ? 'Vino' : 'Cerveza', abv, ml: servingMl };
}

function gramsFor(drink) {
  return drink.ml * (drink.abv / 100) * ETHANOL_DENSITY;
}

function absorptionMinutes(profile) {
  return profile.stomach === 'full' ? 90 : 30;
}

function bacAt(timestamp, drinks, profile) {
  const r = profile.sex === 'female' ? 0.55 : 0.68;
  const weight = profile.weight || 70;
  let absorbed = 0;
  for (const drink of drinks) {
    const minutes = (timestamp - drink.time) / 60000;
    if (minutes <= 0) continue;
    absorbed += drink.grams * clamp(minutes / drink.absorption, 0, 1);
  }
  const raw = absorbed / (weight * r);
  const first = drinks[0]?.time ?? timestamp;
  const elapsed = Math.max(0, (timestamp - first) / 60000);
  return Math.max(0, raw - ELIMINATION_PER_MINUTE * elapsed);
}

function buildPlanDrinks(baseDrinks, startTime, dose, cups, intervalMinutes, absorption) {
  const planned = Array.from({ length: cups }, (_, index) => ({
    id: `planned-${index + 1}`,
    time: startTime + index * intervalMinutes * 60000,
    grams: dose.grams,
    absorption
  }));
  return [...baseDrinks, ...planned];
}

function peakForPlan(drinks, startTime, horizonMinutes, profile) {
  let peak = { minute: 0, bac: 0 };
  for (let minute = 0; minute <= horizonMinutes; minute += 5) {
    const bac = bacAt(startTime + minute * 60000, drinks, profile);
    if (bac > peak.bac) peak = { minute, bac };
  }
  return peak;
}

function findMinimumInterval({ baseDrinks, startTime, dose, cups, absorption, threshold, maxInterval }) {
  const horizon = Math.max(480, maxInterval * cups + 240);
  for (let interval = 10; interval <= maxInterval; interval += 5) {
    const drinks = buildPlanDrinks(baseDrinks, startTime, dose, cups, interval, absorption);
    const peak = peakForPlan(drinks, startTime, horizon, getProfile());
    if (peak.bac <= threshold) return { interval, peak, drinks };
  }
  const fallbackDrinks = buildPlanDrinks(baseDrinks, startTime, dose, cups, maxInterval, absorption);
  return { interval: null, peak: peakForPlan(fallbackDrinks, startTime, horizon, getProfile()), drinks: fallbackDrinks };
}

function maxCupsInWindow({ baseDrinks, startTime, dose, absorption, threshold, windowMinutes }) {
  let safe = 0;
  let lastPeak = { minute: 0, bac: 0 };
  for (let cups = 1; cups <= 20; cups++) {
    const interval = cups === 1 ? 0 : windowMinutes / (cups - 1);
    const drinks = buildPlanDrinks(baseDrinks, startTime, dose, cups, interval, absorption);
    const peak = peakForPlan(drinks, startTime, windowMinutes + 240, getProfile());
    if (peak.bac <= threshold) {
      safe = cups;
      lastPeak = peak;
    } else {
      break;
    }
  }
  return { safe, peak: lastPeak };
}

function formatTimeFromNow(minutes) {
  const date = new Date(Date.now() + minutes * 60000);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderSchedule(interval, cups) {
  const list = $('#planSchedule');
  list.innerHTML = '';
  if (interval == null) return;
  for (let index = 0; index < cups; index++) {
    const li = document.createElement('li');
    const minutes = index * interval;
    li.textContent = `Copa ${index + 1}: ${minutes === 0 ? 'ahora' : `en ${minutes} min`} · ${formatTimeFromNow(minutes)}`;
    list.append(li);
  }
}

function calculatePlan() {
  const state = getStoredState();
  const profile = getProfile();
  const selected = getSelectedDrinkPlan();
  const cups = clamp(Number($('#planCups')?.value) || 1, 1, 12);
  const windowHours = clamp(Number($('#planHours')?.value) || 4, 1, 12);
  const maxInterval = clamp(Number($('#planMaxInterval')?.value) || 180, 30, 240);
  const margin = Number($('#planMargin')?.value) || 0.9;
  const threshold = Math.max(0.05, profile.limit * margin);
  const grams = gramsFor(selected);
  const result = $('#planResult');

  if (!selected.ml || !selected.abv || grams <= 0) {
    result.className = 'plan-result bad';
    result.textContent = 'No puedo calcular el ritmo: selecciona una bebida con volumen y graduación mayores que cero.';
    $('#planSchedule').innerHTML = '';
    return;
  }

  const now = Date.now();
  const baseDrinks = (state.drinks || []).map(drink => ({ ...drink, absorption: drink.absorption || absorptionMinutes(profile) }));
  const dose = { grams };
  const absorption = absorptionMinutes(profile);
  const intervalPlan = findMinimumInterval({ baseDrinks, startTime: now, dose, cups, absorption, threshold, maxInterval });
  const maxSafe = maxCupsInWindow({ baseDrinks, startTime: now, dose, absorption, threshold, windowMinutes: windowHours * 60 });

  const drinkLabel = `${Math.round(selected.ml)} ml de ${selected.name} (${selected.abv}%): ${grams.toFixed(1)} g de alcohol`;

  if (intervalPlan.interval == null) {
    result.className = 'plan-result bad';
    result.innerHTML = `<strong>Plan no recomendado.</strong><br>${drinkLabel}. Incluso separando ${cups} copas hasta ${maxInterval} min, el pico estimado sería ${intervalPlan.peak.bac.toFixed(2)} g/L, por encima del objetivo preventivo ${threshold.toFixed(2)} g/L. En ${windowHours} h, el máximo orientativo sería ${maxSafe.safe} copa(s).`;
    $('#planSchedule').innerHTML = '';
    return;
  }

  const totalMinutes = intervalPlan.interval * Math.max(0, cups - 1);
  const fitsWindow = totalMinutes <= windowHours * 60;
  result.className = fitsWindow ? 'plan-result ok' : 'plan-result warn';
  result.innerHTML = `<strong>${fitsWindow ? 'Ritmo estimado compatible.' : 'Ritmo seguro, pero no cabe en tu ventana.'}</strong><br>${drinkLabel}. Para ${cups} copa(s), espera al menos <strong>${intervalPlan.interval} minutos</strong> entre copas. Pico estimado: ${intervalPlan.peak.bac.toFixed(2)} g/L. Objetivo usado: ${threshold.toFixed(2)} g/L. En ${windowHours} h, máximo orientativo: ${maxSafe.safe} copa(s).`;
  renderSchedule(intervalPlan.interval, cups);
}

function bindAdvisor() {
  $('#planBtn')?.addEventListener('click', calculatePlan);
  ['planCups', 'planHours', 'planMargin', 'planMaxInterval', 'category', 'drink', 'serving', 'ice', 'manualAbv', 'manualMl', 'weight', 'sex', 'stomach', 'limit'].forEach(id => {
    const element = $(`#${id}`);
    if (element) element.addEventListener('change', () => $('#planResult').textContent = 'Pulsa calcular para actualizar el ritmo con los datos actuales.');
  });
}

bindAdvisor();
