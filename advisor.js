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
    const ml = Math.max(0, Number($('#manualMl')?.value) || 0);
    return {
      name: ($('#manualBrand')?.value || 'Bebida manual').trim(),
      type: ($('#manualType')?.value || 'Personalizada').trim(),
      abv: clamp(Number($('#manualAbv')?.value) || 0, 0, 80),
      ml,
      servingMl: ml,
      category,
      unit: 'servicio manual'
    };
  }

  const drinkText = $('#drink')?.selectedOptions?.[0]?.textContent || 'Bebida seleccionada';
  const servingText = $('#serving')?.selectedOptions?.[0]?.textContent || 'envase';
  const servingMl = Number($('#serving')?.value) || 0;
  const abvMatch = drinkText.match(/([0-9]+(?:[.,][0-9]+)?)%/);
  const abv = abvMatch ? Number(abvMatch[1].replace(',', '.')) : 0;
  const name = drinkText.replace(/\s·\s[0-9]+(?:[.,][0-9]+)?%/, '');
  const unit = servingText.split(':')[0] || 'envase';

  if (category === 'spirits') {
    const cap = Math.max(40, servingMl);
    const iceMl = ice * 30;
    const physicalFillMl = cap * fillRatio;
    const spiritMl = clamp(physicalFillMl - iceMl, 0, Math.max(0, cap - iceMl));
    return { name, type: 'Destilado con mezclador', abv, ml: spiritMl, servingMl: cap, category, unit };
  }

  return { name, type: category === 'wines' ? 'Vino' : 'Cerveza', abv, ml: servingMl, servingMl, category, unit };
}

function gramsForMl(ml, abv) {
  return ml * (abv / 100) * ETHANOL_DENSITY;
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

function plannedDrinks(baseDrinks, startTime, mlPerServe, drink, intervalMinutes, serves, absorption) {
  const grams = gramsForMl(mlPerServe, drink.abv);
  const future = Array.from({ length: serves }, (_, index) => ({
    id: `planned-${index + 1}`,
    time: startTime + index * intervalMinutes * 60000,
    grams,
    absorption
  }));
  return [...baseDrinks, ...future];
}

function peakForPlan(drinks, startTime, horizonMinutes, profile) {
  let peak = { minute: 0, bac: 0 };
  for (let minute = 0; minute <= horizonMinutes; minute += 5) {
    const bac = bacAt(startTime + minute * 60000, drinks, profile);
    if (bac > peak.bac) peak = { minute, bac };
  }
  return peak;
}

function servesForWindow(intervalMinutes, windowMinutes, maxServes) {
  return Math.max(1, Math.min(maxServes, Math.floor(windowMinutes / intervalMinutes) + 1));
}

function simulateServingSize({ drink, profile, baseDrinks, intervalMinutes, windowMinutes, threshold, maxServes }) {
  const startTime = Date.now();
  const absorption = absorptionMinutes(profile);
  const serves = servesForWindow(intervalMinutes, windowMinutes, maxServes);
  const horizon = Math.max(windowMinutes + 240, intervalMinutes * serves + 240);

  function peakForMl(ml) {
    const drinks = plannedDrinks(baseDrinks, startTime, ml, drink, intervalMinutes, serves, absorption);
    return peakForPlan(drinks, startTime, horizon, profile);
  }

  const selectedPeak = peakForMl(drink.ml);
  let low = 0;
  let high = drink.ml;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    const peak = peakForMl(mid);
    if (peak.bac <= threshold) low = mid;
    else high = mid;
  }

  const safeMl = Math.floor(low);
  const safePeak = peakForMl(safeMl);
  return { serves, safeMl, safePeak, selectedPeak, startTime };
}

function simulateMaxContainers({ drink, profile, baseDrinks, intervalMinutes, windowMinutes, threshold, maxServes }) {
  const startTime = Date.now();
  const absorption = absorptionMinutes(profile);
  const possibleSlots = servesForWindow(intervalMinutes, windowMinutes, maxServes);
  const horizon = Math.max(windowMinutes + 240, intervalMinutes * possibleSlots + 240);
  const servingMl = Math.max(1, drink.servingMl || drink.ml);

  function buildForUnits(units) {
    const full = Math.floor(units);
    const fraction = units - full;
    const plan = [];
    for (let i = 0; i < full; i++) {
      plan.push({ id: `planned-${i + 1}`, time: startTime + i * intervalMinutes * 60000, grams: gramsForMl(servingMl, drink.abv), absorption });
    }
    if (fraction > 0.001 && full < possibleSlots) {
      plan.push({ id: `planned-${full + 1}`, time: startTime + full * intervalMinutes * 60000, grams: gramsForMl(servingMl * fraction, drink.abv), absorption });
    }
    return [...baseDrinks, ...plan];
  }

  function peakForUnits(units) {
    return peakForPlan(buildForUnits(units), startTime, horizon, profile);
  }

  const selectedUnits = possibleSlots;
  const selectedPeak = peakForUnits(selectedUnits);
  let low = 0;
  let high = possibleSlots;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    const peak = peakForUnits(mid);
    if (peak.bac <= threshold) low = mid;
    else high = mid;
  }

  const safeUnits = Math.max(0, low);
  const fullUnits = Math.floor(safeUnits);
  const partialFraction = safeUnits - fullUnits;
  const partialMl = Math.floor(partialFraction * servingMl);
  const safePeak = peakForUnits(safeUnits);
  return { possibleSlots, safeUnits, fullUnits, partialFraction, partialMl, safePeak, selectedPeak, servingMl };
}

function formatTimeFromNow(minutes) {
  const date = new Date(Date.now() + minutes * 60000);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderSpiritSchedule(interval, serves, ml, drink) {
  const list = $('#planSchedule');
  list.innerHTML = '';
  if (!ml) return;
  for (let index = 0; index < serves; index++) {
    const minutes = index * interval;
    const li = document.createElement('li');
    li.textContent = `${minutes === 0 ? 'Ahora' : `En ${minutes} min`} · ${formatTimeFromNow(minutes)} · máximo ${ml} ml de base alcohólica (${drink.name})`;
    list.append(li);
  }
}

function renderContainerSchedule(interval, simulation, drink) {
  const list = $('#planSchedule');
  list.innerHTML = '';
  for (let index = 0; index < simulation.fullUnits; index++) {
    const minutes = index * interval;
    const li = document.createElement('li');
    li.textContent = `${minutes === 0 ? 'Ahora' : `En ${minutes} min`} · ${formatTimeFromNow(minutes)} · 1 ${drink.unit} completo (${Math.round(simulation.servingMl)} ml)`;
    list.append(li);
  }
  if (simulation.partialMl > 0 && simulation.fullUnits < simulation.possibleSlots) {
    const minutes = simulation.fullUnits * interval;
    const li = document.createElement('li');
    li.textContent = `${minutes === 0 ? 'Ahora' : `En ${minutes} min`} · ${formatTimeFromNow(minutes)} · ${simulation.partialMl} ml de ${drink.unit} (${Math.round(simulation.partialFraction * 100)}% del envase)`;
    list.append(li);
  }
}

function calculatePlan() {
  const state = getStoredState();
  const profile = getProfile();
  const drink = getSelectedDrinkPlan();
  const intervalMinutes = clamp(Number($('#planInterval')?.value) || 30, 10, 180);
  const windowHours = clamp(Number($('#planHours')?.value) || 4, 1, 12);
  const windowMinutes = windowHours * 60;
  const maxServes = clamp(Number($('#planMaxServes')?.value) || 12, 1, 24);
  const margin = Number($('#planMargin')?.value) || 0.9;
  const threshold = Math.max(0.05, profile.limit * margin);
  const result = $('#planResult');
  const baseDrinks = (state.drinks || []).map(drink => ({ ...drink, absorption: drink.absorption || absorptionMinutes(profile) }));

  if (!drink.ml || !drink.abv || gramsForMl(drink.ml, drink.abv) <= 0) {
    result.className = 'plan-result bad';
    result.textContent = 'No puedo calcular el reparto: selecciona una bebida con volumen y graduación mayores que cero.';
    $('#planSchedule').innerHTML = '';
    return;
  }

  if (drink.category === 'spirits' || drink.category === 'manual') {
    const simulation = simulateServingSize({ drink, profile, baseDrinks, intervalMinutes, windowMinutes, threshold, maxServes });
    const selectedGrams = gramsForMl(drink.ml, drink.abv);
    const safeGrams = gramsForMl(simulation.safeMl, drink.abv);
    const percent = drink.ml > 0 ? Math.round((simulation.safeMl / drink.ml) * 100) : 0;
    const selectedIsSafe = simulation.selectedPeak.bac <= threshold;
    const servingWord = simulation.serves === 1 ? 'servicio' : 'servicios';

    if (simulation.safeMl <= 0) {
      result.className = 'plan-result bad';
      result.innerHTML = `<strong>No hay reparto seguro con esos datos.</strong><br>Con las bebidas ya registradas y tu objetivo ${threshold.toFixed(2)} g/L, no conviene añadir alcohol en intervalos de ${intervalMinutes} min durante ${windowHours} h.`;
      $('#planSchedule').innerHTML = '';
      return;
    }

    result.className = selectedIsSafe ? 'plan-result ok' : 'plan-result warn';
    result.innerHTML = `<strong>${selectedIsSafe ? 'Tu medida actual cabe en ese reparto.' : 'Reduce la medida por servicio.'}</strong><br>Con ${drink.name} (${drink.abv}%), cada ${intervalMinutes} min durante ${windowHours} h salen ${simulation.serves} ${servingWord}. Tu medida actual es ${Math.round(drink.ml)} ml (${selectedGrams.toFixed(1)} g de alcohol) y alcanzaría un pico de ${simulation.selectedPeak.bac.toFixed(2)} g/L. Para no superar ${threshold.toFixed(2)} g/L, sirve como máximo <strong>${simulation.safeMl} ml</strong> por intervalo (${safeGrams.toFixed(1)} g de alcohol), aproximadamente el ${percent}% de tu medida actual. Pico estimado con ese reparto: ${simulation.safePeak.bac.toFixed(2)} g/L.`;
    renderSpiritSchedule(intervalMinutes, simulation.serves, simulation.safeMl, drink);
    return;
  }

  const simulation = simulateMaxContainers({ drink, profile, baseDrinks, intervalMinutes, windowMinutes, threshold, maxServes });
  const unitAlcohol = gramsForMl(simulation.servingMl, drink.abv);
  const totalSafeMl = Math.round(simulation.safeUnits * simulation.servingMl);
  const totalSafeAlcohol = gramsForMl(totalSafeMl, drink.abv);
  const selectedIsSafe = simulation.selectedPeak.bac <= threshold;
  const fullText = simulation.fullUnits === 1 ? `1 ${drink.unit}` : `${simulation.fullUnits} ${drink.unit}s`;
  const partialText = simulation.partialMl > 0 ? ` + ${simulation.partialMl} ml (${Math.round(simulation.partialFraction * 100)}% de otro ${drink.unit})` : '';

  if (simulation.safeUnits <= 0.01) {
    result.className = 'plan-result bad';
    result.innerHTML = `<strong>No añadas más alcohol con esos datos.</strong><br>Con lo ya registrado y tu objetivo ${threshold.toFixed(2)} g/L, incluso una fracción pequeña de ${drink.name} podría superar el margen preventivo.`;
    $('#planSchedule').innerHTML = '';
    return;
  }

  result.className = selectedIsSafe ? 'plan-result ok' : 'plan-result warn';
  result.innerHTML = `<strong>${selectedIsSafe ? 'El reparto por envases completos cabe en tu umbral.' : 'No caben todos los envases posibles: reduce cantidad.'}</strong><br>Para ${drink.name} (${drink.abv}%), el envase seleccionado es ${drink.unit} de ${Math.round(simulation.servingMl)} ml (${unitAlcohol.toFixed(1)} g de alcohol). En ${windowHours} h, bebiendo cada ${intervalMinutes} min, hay ${simulation.possibleSlots} huecos posibles. Para no superar ${threshold.toFixed(2)} g/L, puedes tomar como máximo <strong>${fullText}${partialText}</strong>, en total ${totalSafeMl} ml (${totalSafeAlcohol.toFixed(1)} g de alcohol). Pico estimado: ${simulation.safePeak.bac.toFixed(2)} g/L.`;
  renderContainerSchedule(intervalMinutes, simulation, drink);
}

function bindAdvisor() {
  $('#planBtn')?.addEventListener('click', calculatePlan);
  ['planInterval', 'planHours', 'planMargin', 'planMaxServes', 'category', 'drink', 'serving', 'ice', 'manualAbv', 'manualMl', 'weight', 'sex', 'stomach', 'limit'].forEach(id => {
    const element = $(`#${id}`);
    if (element) element.addEventListener('change', () => {
      $('#planResult').textContent = 'Pulsa calcular para actualizar el reparto con los datos actuales.';
      $('#planSchedule').innerHTML = '';
    });
  });
}

bindAdvisor();
