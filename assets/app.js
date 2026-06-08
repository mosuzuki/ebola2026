const files = {
  origins: 'data/outbreak_zones.csv',
  destinations: 'data/destinations.csv',
  flows: 'data/monthly_flows.csv',
  scenarios: 'data/scenarios.csv',
  population: 'data/population_by_hz.csv',
  boundaries: 'data/health_zones.geojson',
  ugandaProfile: 'data/uganda_projection_profile.csv',
  cases: 'data/cases_by_hz.csv',
  airAdjustment: 'data/air_adjustment.csv'
};

let origins = [], destinations = [], flows = [], scenarios = [], population = [], ugandaProfile = [], cases = [], airAdjustment = [];
let healthZoneBoundaries = null;
let mapMode = 'movement';
let map, layerGroup;
let choroLegend = null;
let monthsCache = [];

const fmt = new Intl.NumberFormat('en-US');
const pct = (x) => `${(x * 100).toFixed(1)}%`;

function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function bearingDegrees(from, to) {
  const lat1 = from[0] * Math.PI / 180;
  const lat2 = to[0] * Math.PI / 180;
  const dLon = (to[1] - from[1]) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function midpoint(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function pointAlong(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function bentLinePoints(from, to, bend = 0.16) {
  // Leaflet does not need a plugin here: a 3-point line gives the long-distance corridor
  // a visible arc-like bend, making direction easier to read on a country-scale map.
  const mid = midpoint(from, to);
  const dx = to[1] - from[1];
  const dy = to[0] - from[0];
  const control = [mid[0] - dx * bend, mid[1] + dy * bend];
  return [from, control, to];
}

function addArrow(from, to, color, movement, options = {}) {
  const pos = pointAlong(from, to, options.at ?? 0.72);
  const angle = bearingDegrees(from, to);
  const size = options.size || Math.max(20, Math.min(42, 20 + Math.sqrt(Math.max(movement, 1)) / 8));
  const icon = L.divIcon({
    className: 'flow-arrow-icon',
    html: `<div style="transform: rotate(${angle}deg); color:${color}; font-size:${size}px;">➤</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
  L.marker(pos, { icon, interactive: false }).addTo(layerGroup);
}

function addFlowLabel(latlng, html, className = 'flow-label') {
  L.marker(latlng, {
    icon: L.divIcon({
      className,
      html: `<span>${html}</span>`,
      iconSize: [180, 28],
      iconAnchor: [90, 14]
    }),
    interactive: false
  }).addTo(layerGroup);
}

function destinationColor(d) {
  if (d?.is_kinshasa === 1) return '#1f5d8c';
  if (d?.is_uganda_border === 1) return '#b54708';
  return '#475467';
}


async function loadCsv(path) {
  const res = await fetch(path);
  const text = await res.text();
  return Papa.parse(text, { header: true, dynamicTyping: true, skipEmptyLines: true }).data;
}

async function loadCsvOptional(path) {
  try {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) return [];
    const text = await res.text();
    return Papa.parse(text, { header: true, dynamicTyping: true, skipEmptyLines: true }).data;
  } catch (e) {
    console.warn(`Optional file not loaded: ${path}`, e);
    return [];
  }
}

async function loadGeoJsonOptional(path) {
  try {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || !Array.isArray(json.features) || !json.features.length) return null;
    return json;
  } catch (e) {
    console.warn(`Optional GeoJSON not loaded: ${path}`, e);
    return null;
  }
}

function hasBoundaries() {
  return !!(healthZoneBoundaries && Array.isArray(healthZoneBoundaries.features) && healthZoneBoundaries.features.length);
}

function normalizedString(x) {
  return String(x ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function pickProp(props, names) {
  for (const n of names) {
    if (props && props[n] !== undefined && props[n] !== null && String(props[n]).trim() !== '') return props[n];
  }
  return '';
}

function featureZoneId(feature) {
  const p = feature.properties || {};
  return String(pickProp(p, ['zone_id', 'hz_id', 'HZ_ID', 'health_zone_id', 'healthzone_id', 'id', 'ID', 'dhis2_id', 'DHIS2_ID']));
}

function featureZoneName(feature) {
  const p = feature.properties || {};
  return String(pickProp(p, ['zone_name', 'hz_name', 'hz_name_short', 'HZ_NAME', 'health_zone', 'health_zone_name', 'name', 'NAME', 'nom', 'NOM']));
}

function featureProvince(feature) {
  const p = feature.properties || {};
  return String(pickProp(p, ['province', 'province_name', 'province_name_short', 'PROVINCE', 'prov_name', 'name_province']));
}

function getFeatureAreaKm2(feature) {
  const p = feature.properties || {};
  const fromProp = toNumber(p.area_km2 || p.AREA_KM2 || p.area_sqkm || p.Shape_Area_KM2);
  if (fromProp > 0) return fromProp;
  if (typeof turf !== 'undefined' && turf.area) return turf.area(feature) / 1e6;
  return 0;
}

function populationLookupForMonth(month) {
  const byId = new Map();
  const byName = new Map();
  for (const r of population.filter(x => x.month === month)) {
    byId.set(String(r.zone_id), r);
    byName.set(normalizedString(r.zone_name), r);
  }
  return { byId, byName };
}

function populationRowForFeature(feature, month) {
  const lookup = populationLookupForMonth(month);
  const id = featureZoneId(feature);
  const name = featureZoneName(feature);
  return lookup.byId.get(id) || lookup.byName.get(normalizedString(name)) || null;
}

function choroplethColor(value, breaks) {
  if (!Number.isFinite(value) || value <= 0) return '#f2f4f7';
  if (value <= breaks[0]) return '#d1e9ff';
  if (value <= breaks[1]) return '#84caff';
  if (value <= breaks[2]) return '#2e90fa';
  if (value <= breaks[3]) return '#175cd3';
  return '#102a56';
}

function riskColor(value, breaks) {
  if (!Number.isFinite(value) || value <= 0) return '#fff5f5';
  if (value <= breaks[0]) return '#fee4e2';
  if (value <= breaks[1]) return '#fecdca';
  if (value <= breaks[2]) return '#f97066';
  if (value <= breaks[3]) return '#d92d20';
  return '#7a271a';
}

function addRiskLegend(breaks) {
  const labels = ['No/very low', `≤ ${fmt.format(Math.round(breaks[0]))}`, `≤ ${fmt.format(Math.round(breaks[1]))}`, `≤ ${fmt.format(Math.round(breaks[2]))}`, `≤ ${fmt.format(Math.round(breaks[3]))}`, `> ${fmt.format(Math.round(breaks[3]))}`];
  const colors = ['#fff5f5', '#fee4e2', '#fecdca', '#f97066', '#d92d20', '#7a271a'];
  if (choroLegend) { map.removeControl(choroLegend); choroLegend = null; }
  choroLegend = L.control({ position: 'bottomright' });
  choroLegend.onAdd = function() {
    const div = L.DomUtil.create('div', 'choro-legend');
    div.innerHTML = `<strong>Spread risk<br><small>estimated arrivals from outbreak zones</small></strong>` + colors.map((c, i) => `<div><i style="background:${c}"></i>${labels[i]}</div>`).join('');
    return div;
  };
  choroLegend.addTo(map);
}

function riskRowsForMonth(month) {
  const f = currentFilters();
  const rows = flows.filter(r => r.month === month && (f.origin === 'ALL' || r.origin_id === f.origin));
  const byDest = new Map();
  for (const r of rows) byDest.set(String(r.destination_id), (byDest.get(String(r.destination_id)) || 0) + toNumber(r.movement));
  const popById = new Map(population.filter(r => r.month === month).map(r => [String(r.zone_id), r]));
  const destIds = new Set([...byDest.keys(), ...destinations.map(d => String(d.zone_id))]);
  return [...destIds].map(id => {
    const d = destinations.find(x => String(x.zone_id) === String(id)) || {};
    const pop = popById.get(String(id));
    const incoming = byDest.get(String(id)) || 0;
    const populationValue = pop ? toNumber(pop.population) : getZonePopulation(id, month);
    const risk = incoming;
    return {
      ...d,
      zone_id: id,
      zone_name: d.zone_name || pop?.zone_name || id,
      province: d.province || pop?.province || '',
      lat: toNumber(d.lat) || toNumber(pop?.lat),
      lon: toNumber(d.lon) || toNumber(pop?.lon),
      incoming,
      population: populationValue,
      risk,
      is_outbreak: origins.some(o => String(o.zone_id) === String(id) || normalizedString(o.zone_name) === normalizedString(d.zone_name || pop?.zone_name))
    };
  }).filter(r => r.incoming > 0 || r.population > 0 || r.zone_name);
}

function quantile(values, q) {
  const arr = values.filter(v => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!arr.length) return 0;
  const pos = (arr.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return arr[base + 1] !== undefined ? arr[base] + rest * (arr[base + 1] - arr[base]) : arr[base];
}

function boundaryMetricRows(month, metric) {
  if (!hasBoundaries() || !hasPopulationData()) return [];
  return healthZoneBoundaries.features.map(feature => {
    const pop = populationRowForFeature(feature, month);
    const populationValue = pop ? toNumber(pop.population) : 0;
    const areaKm2 = getFeatureAreaKm2(feature);
    const density = areaKm2 > 0 ? populationValue / areaKm2 : 0;
    const id = featureZoneId(feature) || (pop ? pop.zone_id : '');
    const name = featureZoneName(feature) || (pop ? pop.zone_name : 'Unknown health zone');
    const destination = destinations.find(d => String(d.zone_id) === String(id) || normalizedString(d.zone_name) === normalizedString(name)) || {};
    return {
      feature, zone_id: id, zone_name: name, province: featureProvince(feature) || pop?.province || destination.province || '',
      population: populationValue, area_km2: areaKm2, density, value: metric === 'density' ? density : populationValue,
      is_outbreak: origins.some(o => String(o.zone_id) === String(id) || normalizedString(o.zone_name) === normalizedString(name)),
      category: destination.category || '', is_kinshasa: destination.is_kinshasa === 1, is_uganda_border: destination.is_uganda_border === 1
    };
  }).filter(r => r.population > 0 || r.value > 0);
}

function addBoundaryLegend(metric, breaks) {
  const title = metric === 'density' ? 'Population density (people/km²)' : 'Population';
  const labels = ['No data', `≤ ${fmt.format(Math.round(breaks[0]))}`, `≤ ${fmt.format(Math.round(breaks[1]))}`, `≤ ${fmt.format(Math.round(breaks[2]))}`, `≤ ${fmt.format(Math.round(breaks[3]))}`, `> ${fmt.format(Math.round(breaks[3]))}`];
  const colors = ['#f2f4f7', '#d1e9ff', '#84caff', '#2e90fa', '#175cd3', '#102a56'];
  if (choroLegend) { map.removeControl(choroLegend); choroLegend = null; }
  choroLegend = L.control({ position: 'bottomright' });
  choroLegend.onAdd = function() {
    const div = L.DomUtil.create('div', 'choro-legend');
    div.innerHTML = `<strong>${title}</strong>` + colors.map((c, i) => `<div><i style="background:${c}"></i>${labels[i]}</div>`).join('');
    return div;
  };
  choroLegend.addTo(map);
}

function initMap() {
  map = L.map('map', { zoomControl: true }).setView([0.7, 29.6], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  layerGroup = L.layerGroup().addTo(map);
}

function populateControls() {
  const originSelect = document.getElementById('originSelect');
  originSelect.innerHTML = '<option value="ALL">All outbreak zones</option>' + origins.map(o => `<option value="${o.zone_id}">${o.zone_name}</option>`).join('');

  monthsCache = [...new Set(flows.map(d => d.month))].sort();
  const monthSelect = document.getElementById('monthSelect');
  monthSelect.innerHTML = monthsCache.map(m => `<option value="${m}">${m}</option>`).join('');
  monthSelect.value = monthsCache[monthsCache.length - 1];

  const monthSlider = document.getElementById('monthSlider');
  monthSlider.min = 0;
  monthSlider.max = monthsCache.length - 1;
  monthSlider.value = monthsCache.length - 1;
  document.getElementById('monthSliderLabel').textContent = monthsCache[monthsCache.length - 1];
  document.getElementById('monthStartLabel').textContent = monthsCache[0] || '—';
  document.getElementById('monthEndLabel').textContent = monthsCache[monthsCache.length - 1] || '—';

  const tickStep = Math.max(1, Math.floor(monthsCache.length / 8));
  document.getElementById('monthTicks').innerHTML = monthsCache
    .map((m, i) => (i % tickStep === 0 || i === monthsCache.length - 1) ? `<option value="${i}" label="${m}"></option>` : '')
    .join('');

  document.getElementById('scenarioSelect').innerHTML = scenarios.map(s => `<option value="${s.scenario_id}">${s.scenario_name}</option>`).join('');
  document.getElementById('scenarioSelect').value = 'medium';

  for (const id of ['originSelect', 'monthSelect', 'scenarioSelect', 'topN']) {
    document.getElementById(id).addEventListener('change', updateDashboard);
    document.getElementById(id).addEventListener('input', updateDashboard);
  }

  document.getElementById('modeMovement').addEventListener('click', () => setMapMode('movement'));
  document.getElementById('modeCases').addEventListener('click', () => setMapMode('cases'));
  document.getElementById('modeRisk').addEventListener('click', () => setMapMode('risk'));
  document.getElementById('modeWeighted').addEventListener('click', () => setMapMode('weighted'));
  document.getElementById('modeForecast').addEventListener('click', () => setMapMode('forecast'));
  document.getElementById('modeAir').addEventListener('click', () => setMapMode('air'));
  document.getElementById('modeUganda').addEventListener('click', () => setMapMode('uganda'));
  document.getElementById('modePopulation').addEventListener('click', () => setMapMode('population'));
  document.getElementById('modeDensity').addEventListener('click', () => setMapMode('density'));

  monthSlider.addEventListener('input', () => {
    const m = monthsCache[Number(monthSlider.value)];
    if (m) monthSelect.value = m;
    updateDashboard();
  });
  monthSelect.addEventListener('change', () => {
    const idx = monthsCache.indexOf(monthSelect.value);
    if (idx >= 0) monthSlider.value = idx;
    updateDashboard();
  });

  document.getElementById('fitMap').addEventListener('click', () => fitMapToData());
}


function setMapMode(mode) {
  mapMode = mode;
  const ids = ['movement','cases','risk','weighted','forecast','air','uganda','population','density'];
  ids.forEach(m => {
    const el = document.getElementById('mode' + (m === 'uganda' ? 'Uganda' : m === 'air' ? 'Air' : m.charAt(0).toUpperCase() + m.slice(1)));
    if (el) el.classList.toggle('active', mode === m);
  });
  const labels = { movement:'Movement', cases:'Cases', risk:'Spread risk', weighted:'Weighted risk', forecast:'Forecast', air:'Air-adjusted risk', uganda:'Uganda projection', population:'Population', density:'Density' };
  const activeLayerLabel = document.getElementById('activeLayerLabel');
  if (activeLayerLabel) activeLayerLabel.textContent = labels[mode] || 'Movement';
  updateDashboard();
}

function selectedPopulationRows() {
  const f = currentFilters();
  return population.filter(r => r.month === f.month);
}

function getZonePopulation(zoneId, month) {
  const row = population.find(r => r.month === month && r.zone_id === zoneId);
  return row ? toNumber(row.population) : 0;
}

function hasPopulationData() {
  return population.some(r => toNumber(r.population) > 0);
}

function enrichPopulationRows(rows) {
  return rows.map(r => {
    const d = destinations.find(x => x.zone_id === r.zone_id) || {};
    return {
      ...d,
      ...r,
      lat: toNumber(r.lat) || toNumber(d.lat),
      lon: toNumber(r.lon) || toNumber(d.lon),
      population: toNumber(r.population)
    };
  }).filter(r => r.zone_id && Number.isFinite(r.lat) && Number.isFinite(r.lon));
}

function currentFilters() {
  return {
    origin: document.getElementById('originSelect').value,
    month: document.getElementById('monthSelect').value,
    scenario: scenarios.find(s => s.scenario_id === document.getElementById('scenarioSelect').value),
    topN: Number(document.getElementById('topN').value)
  };
}

function selectedFlows() {
  const f = currentFilters();
  return flows.filter(r => r.month === f.month && (f.origin === 'ALL' || r.origin_id === f.origin));
}

function groupByDestination(rows) {
  const out = new Map();
  for (const r of rows) out.set(r.destination_id, (out.get(r.destination_id) || 0) + Number(r.movement || 0));
  return [...out.entries()].map(([destination_id, movement]) => {
    const d = destinations.find(x => x.zone_id === destination_id);
    return { ...d, movement };
  }).sort((a, b) => b.movement - a.movement);
}

function groupByMonth(origin) {
  const months = [...new Set(flows.map(d => d.month))].sort();
  return months.map(month => {
    const rows = flows.filter(r => r.month === month && (origin === 'ALL' || r.origin_id === origin));
    let kinshasa = 0, border = 0, total = 0;
    for (const r of rows) {
      const d = destinations.find(x => x.zone_id === r.destination_id);
      const m = Number(r.movement || 0);
      total += m;
      if (d?.is_kinshasa === 1) kinshasa += m;
      if (d?.is_uganda_border === 1) border += m;
    }
    return { month, total, kinshasa, border };
  });
}

function aggregateCategoryRows(rows, category) {
  const byOrigin = new Map();
  for (const r of rows) {
    const d = destinations.find(x => x.zone_id === r.destination_id);
    if (!d || d.category !== category) continue;
    const o = origins.find(x => x.zone_id === r.origin_id);
    if (!o) continue;
    const movement = toNumber(r.movement);
    if (!byOrigin.has(o.zone_id)) {
      byOrigin.set(o.zone_id, { origin: o, movement: 0, weightedLat: 0, weightedLon: 0, n: 0 });
    }
    const item = byOrigin.get(o.zone_id);
    item.movement += movement;
    item.weightedLat += toNumber(d.lat) * movement;
    item.weightedLon += toNumber(d.lon) * movement;
    item.n += 1;
  }
  return [...byOrigin.values()].filter(x => x.movement > 0).map(x => ({
    ...x,
    targetLat: x.weightedLat / x.movement,
    targetLon: x.weightedLon / x.movement
  }));
}

function drawStrategicCorridors(rows) {
  const kinColor = '#155eef';
  const borderColor = '#dc6803';
  const kinHub = { zone_name: 'Kinshasa', lat: -4.325, lon: 15.322, province: 'Kinshasa' };
  const kinRows = aggregateCategoryRows(rows, 'kinshasa');
  const borderRows = aggregateCategoryRows(rows, 'uganda_border');
  const maxStrategic = Math.max(
    ...kinRows.map(x => x.movement),
    ...borderRows.map(x => x.movement),
    1
  );

  // Kinshasa is a long-distance corridor. Aggregate all Kinshasa health zones into one hub
  // so small flows do not disappear from the top-N local ranking.
  kinRows.forEach(x => {
    const from = [toNumber(x.origin.lat), toNumber(x.origin.lon)];
    const to = [kinHub.lat, kinHub.lon];
    const points = bentLinePoints(from, to, 0.12);
    const weight = 3 + 10 * Math.sqrt(x.movement / maxStrategic);
    L.polyline(points, { color: kinColor, weight, opacity: 0.78, dashArray: '12 8' })
      .bindPopup(`${x.origin.zone_name} → Kinshasa<br>${fmt.format(Math.round(x.movement))} estimated movements`)
      .addTo(layerGroup);
    addArrow(from, to, kinColor, x.movement, { at: 0.78 });
    addFlowLabel(pointAlong(from, to, 0.55), `Kinshasa ${fmt.format(Math.round(x.movement))}`, 'flow-label kinshasa-label');
  });

  // Uganda-border proxy corridors are shown as aggregated movement pressure toward the
  // weighted centroid of Uganda-border health-zone destinations.
  borderRows.forEach(x => {
    const from = [toNumber(x.origin.lat), toNumber(x.origin.lon)];
    const to = [x.targetLat, x.targetLon];
    const points = bentLinePoints(from, to, 0.10);
    const weight = 3 + 10 * Math.sqrt(x.movement / maxStrategic);
    L.polyline(points, { color: borderColor, weight, opacity: 0.84 })
      .bindPopup(`${x.origin.zone_name} → Uganda-border proxy zones<br>${fmt.format(Math.round(x.movement))} estimated movements`)
      .addTo(layerGroup);
    addArrow(from, to, borderColor, x.movement, { at: 0.72 });
    addFlowLabel(pointAlong(from, to, 0.62), `Uganda-border ${fmt.format(Math.round(x.movement))}`, 'flow-label border-label');
  });

  // Destination hubs, always shown even when their component health zones are not in top-N.
  const kinTotal = kinRows.reduce((a, b) => a + b.movement, 0);
  if (kinTotal > 0) {
    L.circleMarker([kinHub.lat, kinHub.lon], {
      radius: 14, color: '#0b4a6f', weight: 3, fillColor: kinColor, fillOpacity: 0.80
    }).bindPopup(`<strong>Kinshasa hub</strong><br>All Kinshasa health zones<br>${fmt.format(Math.round(kinTotal))} estimated movements`).addTo(layerGroup);
    addFlowLabel([kinHub.lat + 0.55, kinHub.lon], 'Kinshasa', 'hub-label kinshasa-label');
  }

  const borderTotal = borderRows.reduce((a, b) => a + b.movement, 0);
  if (borderTotal > 0) {
    const lat = borderRows.reduce((a, b) => a + b.targetLat * b.movement, 0) / borderTotal;
    const lon = borderRows.reduce((a, b) => a + b.targetLon * b.movement, 0) / borderTotal;
    L.circleMarker([lat, lon], {
      radius: 14, color: '#93370d', weight: 3, fillColor: borderColor, fillOpacity: 0.82
    }).bindPopup(`<strong>Uganda-border proxy hub</strong><br>Weighted centroid of Uganda-border destination health zones<br>${fmt.format(Math.round(borderTotal))} estimated movements`).addTo(layerGroup);
    addFlowLabel([lat + 0.18, lon + 0.12], 'Uganda-border proxy', 'hub-label border-label');
  }
}


function ugandaProfileRows() {
  const rows = ugandaProfile
    .map(r => ({
      uganda_id: String(r.uganda_id || ''),
      uganda_name: String(r.uganda_name || ''),
      type: String(r.type || ''),
      district: String(r.district || ''),
      lat: toNumber(r.lat),
      lon: toNumber(r.lon),
      weight: toNumber(r.weight),
      source_basis: String(r.source_basis || '')
    }))
    .filter(r => r.uganda_name && r.weight > 0 && Number.isFinite(r.lat) && Number.isFinite(r.lon));
  const totalWeight = rows.reduce((a, b) => a + b.weight, 0) || 1;
  return rows.map(r => ({ ...r, weight: r.weight / totalWeight }));
}

function borderPressureForMonth(month, origin = null) {
  const rows = flows.filter(r => r.month === month && (!origin || origin === 'ALL' || r.origin_id === origin));
  let border = 0;
  let weightedLat = 0, weightedLon = 0;
  for (const r of rows) {
    const d = destinations.find(x => x.zone_id === r.destination_id);
    if (!d || !(d.is_uganda_border === 1 || d.category === 'uganda_border')) continue;
    const m = toNumber(r.movement);
    border += m;
    weightedLat += toNumber(d.lat) * m;
    weightedLon += toNumber(d.lon) * m;
  }
  const hub = border > 0 ? { lat: weightedLat / border, lon: weightedLon / border } : { lat: 0.55, lon: 30.15 };
  return { border, hub };
}

function ugandaProjectionRows(month = null) {
  const f = currentFilters();
  const m = month || f.month;
  const scenarioFraction = Number(f.scenario?.cross_border_fraction || 0);
  const { border, hub } = borderPressureForMonth(m, f.origin);
  const totalProjected = border * scenarioFraction;
  return ugandaProfileRows().map(r => ({
    ...r,
    month: m,
    border_pressure: border,
    scenario_fraction: scenarioFraction,
    projected: totalProjected * r.weight,
    hubLat: hub.lat,
    hubLon: hub.lon
  })).sort((a, b) => b.projected - a.projected);
}

function addUgandaProjectionLegend() {
  if (choroLegend) { map.removeControl(choroLegend); choroLegend = null; }
  choroLegend = L.control({ position: 'bottomright' });
  choroLegend.onAdd = function() {
    const div = L.DomUtil.create('div', 'choro-legend');
    div.innerHTML = `<strong>Uganda projection<br><small>scenario-based, not observed</small></strong>` +
      `<div><i style="background:#dc6803"></i>DRC border proxy hub</div>` +
      `<div><i style="background:#7c3aed"></i>Projected Uganda-side destination</div>` +
      `<div><i style="background:#155eef"></i>Kampala share from historical FMP profile</div>`;
    return div;
  };
  choroLegend.addTo(map);
}

function updateUgandaProjectionMap() {
  if (choroLegend) { map.removeControl(choroLegend); choroLegend = null; }
  layerGroup.clearLayers();
  const f = currentFilters();
  const rows = ugandaProjectionRows(f.month);
  const notice = document.getElementById('populationNotice');
  const selectedOrigins = f.origin === 'ALL' ? origins : origins.filter(o => o.zone_id === f.origin);
  const { border, hub } = borderPressureForMonth(f.month, f.origin);
  const scenarioFraction = Number(f.scenario?.cross_border_fraction || 0);
  const totalProjected = border * scenarioFraction;

  document.getElementById('mapTitle').textContent = 'Projected Uganda-side movement pressure';
  document.getElementById('mapDescription').textContent = 'Scenario-based projection of potential Uganda-side destinations. It combines DRC-side movement toward Uganda-border proxy health zones with historical IOM DTM Uganda–DRC border FMP destination profiles from Jan–Mar 2020.';
  document.getElementById('rankingTitle').textContent = 'Uganda-side projected destination ranking';
  document.getElementById('rankingDescription').textContent = 'Projected Uganda-side destinations. These are not observed 2026 cross-border movements.';
  notice.style.display = 'block';
  notice.className = 'uganda-warning';
  notice.innerHTML = `Uganda projection is a <strong>scenario-based estimate</strong>: Flowminder DRC border-proxy movement (${fmt.format(Math.round(border))}) × selected crossing fraction (${pct(scenarioFraction)}) × historical IOM DTM Jan–Mar 2020 destination profile. It is not observed cross-border movement and not a transmission probability.`;

  // DRC outbreak origins and corridors toward the DRC border proxy hub.
  selectedOrigins.forEach(o => {
    const from = [toNumber(o.lat), toNumber(o.lon)];
    if (!Number.isFinite(from[0]) || !Number.isFinite(from[1])) return;
    L.circleMarker(from, { radius: 18, color: '#7a271a', weight: 2, fillColor: '#f04438', fillOpacity: 0.18 }).addTo(layerGroup);
    L.circleMarker(from, { radius: 8, color: '#7a271a', weight: 2, fillColor: '#d92d20', fillOpacity: 0.95 })
      .bindPopup(`<strong>${o.zone_name}</strong><br>${o.province}<br>Current outbreak health zone`).addTo(layerGroup);
    L.marker(from, { icon: L.divIcon({ className: 'origin-label', html: `<span>${o.zone_name}</span>`, iconSize: [100, 22], iconAnchor: [-8, 28] }), interactive: false }).addTo(layerGroup);
  });

  if (border > 0) {
    L.circleMarker([hub.lat, hub.lon], { radius: 17, color: '#9a3412', weight: 3, fillColor: '#dc6803', fillOpacity: 0.85 })
      .bindPopup(`<strong>DRC Uganda-border proxy hub</strong><br>Movement toward border-proxy health zones: ${fmt.format(Math.round(border))}<br>Scenario-estimated onward Uganda movement: ${fmt.format(Math.round(totalProjected))}`).addTo(layerGroup);
    addFlowLabel([hub.lat + 0.15, hub.lon + 0.08], 'DRC border proxy', 'hub-label border-label');
  }

  // Draw projected onward corridors within Uganda.
  const maxProjected = Math.max(...rows.map(r => toNumber(r.projected)), 1);
  rows.forEach(r => {
    if (r.projected <= 0) return;
    const from = [r.hubLat, r.hubLon];
    const to = [r.lat, r.lon];
    const color = r.uganda_id === 'UGA_KAMPALA' ? '#155eef' : '#7c3aed';
    const points = bentLinePoints(from, to, 0.10);
    const weight = 2 + 10 * Math.sqrt(r.projected / maxProjected);
    L.polyline(points, { color, weight, opacity: 0.78, dashArray: '9 7' })
      .bindPopup(`<strong>Projected Uganda-side movement</strong><br>DRC border proxy → ${r.uganda_name}<br>${fmt.format(Math.round(r.projected))} projected movements<br>Allocation weight: ${pct(r.weight)}<br><em>Scenario-based estimate, not observed movement</em>`)
      .addTo(layerGroup);
    addArrow(from, to, color, r.projected, { at: 0.70, size: 24 });
  });

  // Destination circles.
  rows.forEach(r => {
    if (r.projected <= 0) return;
    const color = r.uganda_id === 'UGA_KAMPALA' ? '#155eef' : '#7c3aed';
    const radius = 6 + 23 * Math.sqrt(r.projected / maxProjected);
    L.circleMarker([r.lat, r.lon], { radius, color: '#3b0764', weight: 2, fillColor: color, fillOpacity: 0.62 })
      .bindPopup(`<strong>${r.uganda_name}</strong><br>${r.type}; ${r.district}<br>Projected movements: ${fmt.format(Math.round(r.projected))}<br>Share of projection: ${pct(r.weight)}<br><small>${r.source_basis}</small>`).addTo(layerGroup);
    addFlowLabel([r.lat + 0.08, r.lon + 0.04], `${r.uganda_name} ${fmt.format(Math.round(r.projected))}`, 'flow-label uganda-label');
  });

  addUgandaProjectionLegend();
}


function latestCaseDate() {
  const dates = cases.map(r => String(r.date || '')).filter(Boolean).sort();
  return dates[dates.length - 1] || '';
}

function caseRowsLatest() {
  const latest = latestCaseDate();
  return cases.filter(r => !latest || String(r.date) === latest).map(r => ({
    ...r,
    zone_id: String(r.zone_id || ''),
    health_zone: String(r.health_zone || r.zone_name || ''),
    province: String(r.province || ''),
    confirmed_cases: toNumber(r.confirmed_cases),
    confirmed_deaths: toNumber(r.confirmed_deaths),
    lat: toNumber(r.lat),
    lon: toNumber(r.lon)
  }));
}

function casesLookup() {
  const byId = new Map();
  const byName = new Map();
  for (const r of caseRowsLatest()) {
    if (r.zone_id) byId.set(String(r.zone_id), r);
    byName.set(normalizedString(r.health_zone), r);
  }
  return { byId, byName };
}

function caseForZone(zoneId, zoneName) {
  const lookup = casesLookup();
  return lookup.byId.get(String(zoneId || '')) || lookup.byName.get(normalizedString(zoneName || '')) || null;
}

function caseRowsForMap() {
  return caseRowsLatest().map(r => {
    const d = destinations.find(x => String(x.zone_id) === String(r.zone_id) || normalizedString(x.zone_name) === normalizedString(r.health_zone)) || {};
    return {
      ...d,
      ...r,
      zone_name: r.health_zone || d.zone_name,
      lat: toNumber(r.lat) || toNumber(d.lat),
      lon: toNumber(r.lon) || toNumber(d.lon),
      cases: toNumber(r.confirmed_cases),
      deaths: toNumber(r.confirmed_deaths)
    };
  });
}


function featureCentroidLatLon(feature) {
  try {
    if (typeof turf !== 'undefined' && turf.centroid) {
      const c = turf.centroid(feature);
      if (c && c.geometry && Array.isArray(c.geometry.coordinates)) {
        return { lat: c.geometry.coordinates[1], lon: c.geometry.coordinates[0] };
      }
    }
  } catch (e) {}
  return { lat: NaN, lon: NaN };
}

function boundaryCentroidLookup() {
  const byId = new Map();
  const byName = new Map();
  if (!hasBoundaries()) return { byId, byName };
  for (const f of healthZoneBoundaries.features) {
    const id = featureZoneId(f);
    const name = featureZoneName(f);
    const province = featureProvince(f);
    const c = featureCentroidLatLon(f);
    const row = { zone_id: id, zone_name: name, province, lat: c.lat, lon: c.lon, feature: f };
    if (id) byId.set(String(id), row);
    if (name) byName.set(normalizedString(name), row);
  }
  return { byId, byName };
}

function addCaseBubbleLegend(maxCases) {
  if (choroLegend) { map.removeControl(choroLegend); choroLegend = null; }
  const large = Math.max(1, Math.round(maxCases));
  const mid = Math.max(1, Math.round(maxCases / 2));
  const small = Math.max(1, Math.round(maxCases / 10));
  const items = [
    { label: fmt.format(large), size: 28 },
    { label: fmt.format(mid), size: 20 },
    { label: fmt.format(small), size: 11 }
  ];
  choroLegend = L.control({ position: 'bottomright' });
  choroLegend.onAdd = function() {
    const div = L.DomUtil.create('div', 'choro-legend case-bubble-legend');
    div.innerHTML = `<strong>Confirmed cases<br><small>bubble size, cumulative</small></strong>` + items.map(d => `<div class="bubble-row"><span class="bubble-symbol" style="width:${d.size}px;height:${d.size}px"></span>${d.label} cases</div>`).join('');
    return div;
  };
  choroLegend.addTo(map);
}

function updateCasesMap() {
  if (choroLegend) { map.removeControl(choroLegend); choroLegend = null; }
  layerGroup.clearLayers();
  const notice = document.getElementById('populationNotice');
  const centroidLookup = boundaryCentroidLookup();
  const rows = caseRowsForMap().map(r => {
    const b = centroidLookup.byId.get(String(r.zone_id)) || centroidLookup.byName.get(normalizedString(r.zone_name));
    return {
      ...r,
      lat: Number.isFinite(toNumber(r.lat)) && toNumber(r.lat) !== 0 ? toNumber(r.lat) : toNumber(b?.lat),
      lon: Number.isFinite(toNumber(r.lon)) && toNumber(r.lon) !== 0 ? toNumber(r.lon) : toNumber(b?.lon),
      province: r.province || b?.province || ''
    };
  });
  const mappedRows = rows.filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon) && toNumber(r.cases) > 0);
  const maxCases = Math.max(...rows.map(r => toNumber(r.cases)), 1);

  document.getElementById('mapTitle').textContent = 'Confirmed Ebola cases by health zone';
  document.getElementById('mapDescription').textContent = 'Cumulative confirmed cases are shown as proportional red bubbles at health-zone centroids. Boundary outlines are hidden in this layer to keep the case bubbles readable.';
  document.getElementById('rankingTitle').textContent = 'Case-count ranking';
  document.getElementById('rankingDescription').textContent = 'Cumulative confirmed cases and deaths by health zone from SitRep N23.';
  notice.style.display = 'block';
  notice.className = 'population-notice';
  notice.innerHTML = 'Case layer: bubble size represents cumulative confirmed cases by health zone from SitRep N23/MVB_06/06/2026, reporting date 06 June 2026. The Ituri unventilated category (94 cases, 10 deaths) is not shown because it cannot be assigned to a specific health zone.';

  // Do not draw health-zone polygon outlines in the Cases layer.
  // The proportional case bubbles are the primary visual encoding here;
  // polygon outlines made the map visually busy and could be mistaken for a choropleth.

  mappedRows.forEach(r => {
    const radius = 5 + 31 * Math.sqrt(toNumber(r.cases) / maxCases);
    L.circleMarker([r.lat, r.lon], {
      radius,
      color: '#7a271a',
      weight: 2,
      fillColor: '#d92d20',
      fillOpacity: 0.54,
      opacity: 0.95
    })
      .bindPopup(`<strong>${r.zone_name}</strong><br>${r.province}<br>Confirmed cases: ${fmt.format(Math.round(r.cases))}<br>Confirmed deaths: ${fmt.format(Math.round(r.deaths))}<br>Source date: ${latestCaseDate() || '—'}`)
      .addTo(layerGroup);

    if (toNumber(r.cases) >= Math.max(10, maxCases * 0.12)) {
      addFlowLabel([r.lat, r.lon], `${r.zone_name}: ${fmt.format(Math.round(r.cases))}`, 'case-bubble-label');
    }
  });

  addCaseBubbleLegend(maxCases);
}

function forecastMobilityMonths(selectedMonth) {
  const months = [...new Set(flows.map(d => d.month))].sort();
  const idx = months.indexOf(selectedMonth);
  if (idx >= 0 && idx < months.length - 1) return { months: [months[idx + 1]], label: `next available month: ${months[idx + 1]}` };
  const last3 = months.slice(Math.max(0, months.length - 3));
  return { months: last3, label: `average of latest ${last3.length} mobility months (${last3.join(', ')})` };
}

function weightedRiskRowsForMonth(month, forecast = false) {
  const f = currentFilters();
  const basis = forecast ? forecastMobilityMonths(month) : { months: [month], label: month };
  const rows = flows.filter(r => basis.months.includes(r.month) && (f.origin === 'ALL' || r.origin_id === f.origin));
  const denom = Math.max(basis.months.length, 1);
  const byDest = new Map();
  const byDestMove = new Map();
  for (const r of rows) {
    const o = origins.find(x => String(x.zone_id) === String(r.origin_id)) || destinations.find(x => String(x.zone_id) === String(r.origin_id)) || {};
    const c = caseForZone(r.origin_id, o.zone_name);
    const caseWeight = c ? toNumber(c.confirmed_cases) : 0;
    const movement = toNumber(r.movement) / denom;
    if (caseWeight <= 0 || movement <= 0) continue;
    const id = String(r.destination_id);
    byDest.set(id, (byDest.get(id) || 0) + caseWeight * movement);
    byDestMove.set(id, (byDestMove.get(id) || 0) + movement);
  }
  const destIds = new Set([...byDest.keys(), ...destinations.map(d => String(d.zone_id))]);
  const popById = new Map(population.filter(r => r.month === month).map(r => [String(r.zone_id), r]));
  return [...destIds].map(id => {
    const d = destinations.find(x => String(x.zone_id) === String(id)) || {};
    const pop = popById.get(String(id));
    return { ...d, zone_id: id, zone_name: d.zone_name || pop?.zone_name || id, province: d.province || pop?.province || '', lat: toNumber(d.lat) || toNumber(pop?.lat), lon: toNumber(d.lon) || toNumber(pop?.lon), weighted: byDest.get(id) || 0, incoming: byDestMove.get(id) || 0, forecast_basis: basis.label };
  }).filter(r => r.weighted > 0 || r.zone_name);
}


function airAdjustmentFactorForDestination(dest) {
  if (!dest) return 1;
  let factor = 1;
  const destName = normalizedString(dest.zone_name || dest.health_zone || '');
  const destCategory = normalizedString(dest.category || '');
  for (const row of airAdjustment) {
    const mt = normalizedString(row.match_type);
    const mv = normalizedString(row.match_value);
    const f = toNumber(row.air_factor);
    if (!f && f !== 0) continue;
    if (mt === 'category' && destCategory === mv) factor = Math.min(factor, f);
    if (mt === 'zone_name' && destName === mv) factor = Math.min(factor, f);
  }
  return factor;
}

function isAirAdjustedDestination(dest) {
  return airAdjustmentFactorForDestination(dest) < 0.999;
}

function airAdjustedRiskRowsForMonth(month, forecast = false) {
  return weightedRiskRowsForMonth(month, forecast).map(r => {
    const factor = airAdjustmentFactorForDestination(r);
    return {
      ...r,
      air_factor: factor,
      air_adjusted: toNumber(r.weighted) * factor,
      suppressed_amount: toNumber(r.weighted) * (1 - factor),
      is_air_adjusted: factor < 0.999
    };
  });
}

function addAirRiskLegend(breaks) {
  const labels = ['No/very low', `≤ ${fmt.format(Math.round(breaks[0]))}`, `≤ ${fmt.format(Math.round(breaks[1]))}`, `≤ ${fmt.format(Math.round(breaks[2]))}`, `≤ ${fmt.format(Math.round(breaks[3]))}`, `> ${fmt.format(Math.round(breaks[3]))}`];
  const colors = ['#f5f3ff', '#ede9fe', '#ddd6fe', '#a78bfa', '#7c3aed', '#3b0764'];
  if (choroLegend) { map.removeControl(choroLegend); choroLegend = null; }
  choroLegend = L.control({ position: 'bottomright' });
  choroLegend.onAdd = function() {
    const div = L.DomUtil.create('div', 'choro-legend');
    div.innerHTML = `<strong>Air-adjusted risk<br><small>case-weighted score after flight suppression</small></strong>` + colors.map((c, i) => `<div><i style="background:${c}"></i>${labels[i]}</div>`).join('') + `<div><span style="display:inline-block;width:18px;height:0;border-top:3px dashed #7c3aed;margin-right:7px;vertical-align:middle"></span>Suppressed air-plausible corridor</div>`;
    return div;
  };
  choroLegend.addTo(map);
}

function airRiskColor(value, breaks) {
  if (!Number.isFinite(value) || value <= 0) return '#f5f3ff';
  if (value <= breaks[0]) return '#ede9fe';
  if (value <= breaks[1]) return '#ddd6fe';
  if (value <= breaks[2]) return '#a78bfa';
  if (value <= breaks[3]) return '#7c3aed';
  return '#3b0764';
}

function updateAirAdjustedRiskMap() {
  if (choroLegend) { map.removeControl(choroLegend); choroLegend = null; }
  layerGroup.clearLayers();
  const f = currentFilters();
  const notice = document.getElementById('populationNotice');
  const rows = airAdjustedRiskRowsForMonth(f.month, false).filter(r => toNumber(r.weighted) > 0 || toNumber(r.air_adjusted) > 0);
  const values = rows.map(r => toNumber(r.air_adjusted)).filter(v => v > 0);
  const breaks = [0.2, 0.4, 0.6, 0.8].map(q => quantile(values, q));

  document.getElementById('mapTitle').textContent = 'Air-adjusted case-weighted risk';
  document.getElementById('mapDescription').textContent = 'Scenario-based layer: long-distance air-plausible destinations are down-weighted to reflect suspension/reopening of Bunia passenger flights under screening measures. Local/road-dominant movement is not reduced.';
  document.getElementById('rankingTitle').textContent = 'Air-adjusted risk ranking';
  document.getElementById('rankingDescription').textContent = 'Top health zones by case-weighted movement score after applying the air-travel suppression scenario.';
  notice.style.display = 'block';
  notice.className = 'air-warning';
  notice.innerHTML = 'Air-adjusted risk is a <strong>scenario indicator</strong>, not observed passenger OD and not transmission probability. It reduces long-distance, air-plausible risk to Kinshasa and selected air hubs using <code>data/air_adjustment.csv</code>. Case data are from SitRep N23/MVB_06/06/2026; unventilated Ituri cases are not mapped to any health-zone bubble.';

  const byId = new Map(rows.map(r => [String(r.zone_id), r]));
  const byName = new Map(rows.map(r => [normalizedString(r.zone_name), r]));
  if (hasBoundaries()) {
    L.geoJSON(healthZoneBoundaries, {
      style: feature => {
        const id = featureZoneId(feature);
        const name = featureZoneName(feature);
        const r = byId.get(String(id)) || byName.get(normalizedString(name)) || { air_adjusted: 0, is_air_adjusted: false };
        return {
          color: r.is_air_adjusted ? '#5b21b6' : '#ffffff',
          weight: r.is_air_adjusted ? 2.0 : 0.45,
          fillColor: airRiskColor(toNumber(r.air_adjusted), breaks),
          fillOpacity: toNumber(r.air_adjusted) > 0 ? 0.70 : 0.10,
          opacity: 1
        };
      },
      onEachFeature: (feature, layer) => {
        const id = featureZoneId(feature);
        const name = featureZoneName(feature);
        const r = byId.get(String(id)) || byName.get(normalizedString(name)) || {};
        layer.bindPopup(`<strong>${r.zone_name || name || 'Health zone'}</strong><br>${r.province || featureProvince(feature) || ''}<br>Weighted risk: ${fmt.format(Math.round(toNumber(r.weighted)))}<br>Air-adjusted risk: ${fmt.format(Math.round(toNumber(r.air_adjusted)))}<br>Suppression factor: ${r.air_factor !== undefined ? r.air_factor : 1}<br>${f.month}`);
      }
    }).addTo(layerGroup);
    addAirRiskLegend(breaks);
  }

  // Outbreak origins and key airports/corridors. These are visual annotations for the scenario.
  const airportNodes = [
    { code: 'BUX', name: 'Bunia Airport', lat: 1.5657, lon: 30.2208, status: 'reopened under screening' },
    { code: 'FIH', name: "Kinshasa N'djili", lat: -4.3858, lon: 15.4446, status: 'national hub' },
    { code: 'GOM', name: 'Goma Airport', lat: -1.6708, lon: 29.2385, status: 'regional hub' },
    { code: 'FKI', name: 'Kisangani Bangoka', lat: 0.4816, lon: 25.3379, status: 'regional hub' },
    { code: 'BNC', name: 'Beni Airport', lat: 0.575, lon: 29.473, status: 'regional airport' }
  ];
  const bux = airportNodes[0];
  const maxAdjusted = Math.max(...values, 1);
  airportNodes.forEach(a => {
    L.circleMarker([a.lat, a.lon], { radius: a.code === 'BUX' ? 9 : 7, color: '#3b0764', weight: 2, fillColor: '#7c3aed', fillOpacity: 0.84 })
      .bindPopup(`<strong>${a.name}</strong><br>${a.code}<br>${a.status}<br><em>Air-adjusted scenario annotation</em>`).addTo(layerGroup);
    addFlowLabel([a.lat + 0.12, a.lon + 0.10], a.code, 'airport-label');
  });
  for (const a of airportNodes.slice(1)) {
    const destRow = rows.find(r => normalizedString(r.zone_name).includes(normalizedString(a.name.split(' ')[0])) || (a.code === 'FIH' && (r.is_kinshasa === 1 || r.category === 'kinshasa')));
    const val = destRow ? toNumber(destRow.weighted) : maxAdjusted * 0.15;
    const color = '#7c3aed';
    const pts = bentLinePoints([bux.lat, bux.lon], [a.lat, a.lon], 0.12);
    L.polyline(pts, { color, weight: 2 + 7 * Math.sqrt(Math.min(val, maxAdjusted) / maxAdjusted), opacity: 0.60, dashArray: '10 8' })
      .bindPopup(`<strong>Air-plausible corridor</strong><br>Bunia Airport → ${a.name}<br>Shown for scenario context; not observed passenger flow.`).addTo(layerGroup);
    addArrow([bux.lat, bux.lon], [a.lat, a.lon], color, val, { at: 0.66, size: 22 });
  }

  const selectedOrigins = f.origin === 'ALL' ? origins : origins.filter(o => o.zone_id === f.origin);
  selectedOrigins.forEach(o => {
    const latlng = [toNumber(o.lat), toNumber(o.lon)];
    if (!Number.isFinite(latlng[0]) || !Number.isFinite(latlng[1])) return;
    L.circleMarker(latlng, { radius: 16, color: '#7a271a', weight: 2, fillColor: '#f04438', fillOpacity: 0.18 }).addTo(layerGroup);
    L.circleMarker(latlng, { radius: 7, color: '#7a271a', weight: 2, fillColor: '#d92d20', fillOpacity: 0.95 })
      .bindPopup(`<strong>${o.zone_name}</strong><br>${o.province}<br>Current outbreak health zone`).addTo(layerGroup);
    L.marker(latlng, { icon: L.divIcon({ className: 'origin-label', html: `<span>${o.zone_name}</span>`, iconSize: [100, 22], iconAnchor: [-8, 28] }), interactive: false }).addTo(layerGroup);
  });
}

function updateWeightedRiskMap(forecast = false) {
  if (choroLegend) { map.removeControl(choroLegend); choroLegend = null; }
  layerGroup.clearLayers();
  const f = currentFilters();
  const notice = document.getElementById('populationNotice');
  const rows = weightedRiskRowsForMonth(f.month, forecast).filter(r => r.weighted > 0);
  const values = rows.map(r => toNumber(r.weighted)).filter(v => v > 0);
  const breaks = [0.2, 0.4, 0.6, 0.8].map(q => quantile(values, q));
  const title = forecast ? 'Forecast case-weighted spread risk' : 'Case-weighted spread risk';
  document.getElementById('mapTitle').textContent = title;
  document.getElementById('mapDescription').textContent = forecast ? 'Forecast layer uses latest health-zone case counts and the next available or latest-average mobility pattern to estimate future case-weighted movement pressure.' : 'Health zones are colored by case-weighted incoming movement: sum over outbreak origins of confirmed cases × estimated movement to the destination.';
  document.getElementById('rankingTitle').textContent = forecast ? 'Forecast-risk ranking' : 'Weighted-risk ranking';
  document.getElementById('rankingDescription').textContent = forecast ? 'Top health zones by forecast case-weighted movement pressure.' : 'Top health zones by confirmed-case-weighted movement pressure.';
  const basis = rows[0]?.forecast_basis || (forecast ? forecastMobilityMonths(f.month).label : f.month);
  notice.style.display = 'block';
  notice.className = 'population-notice';
  notice.innerHTML = `${title}: score = Σ confirmed_cases(origin) × estimated movement(origin→destination). ${forecast ? 'Forecast mobility basis: ' + basis + '.' : 'Mobility basis: selected month ' + f.month + '.'} This is a relative prioritization score, not a transmission probability.`;
  const byId = new Map(rows.map(r => [String(r.zone_id), r]));
  const byName = new Map(rows.map(r => [normalizedString(r.zone_name), r]));
  if (hasBoundaries()) {
    L.geoJSON(healthZoneBoundaries, {
      style: feature => {
        const id = featureZoneId(feature); const name = featureZoneName(feature);
        const r = byId.get(String(id)) || byName.get(normalizedString(name)) || { weighted: 0 };
        return { color: '#ffffff', weight: 0.6, fillColor: riskColor(toNumber(r.weighted), breaks), fillOpacity: toNumber(r.weighted) > 0 ? 0.74 : 0.10, opacity: 1 };
      },
      onEachFeature: (feature, layer) => {
        const id = featureZoneId(feature); const name = featureZoneName(feature);
        const r = byId.get(String(id)) || byName.get(normalizedString(name)) || {};
        layer.bindPopup(`<strong>${r.zone_name || name || 'Health zone'}</strong><br>${r.province || featureProvince(feature) || ''}<br>${title} score: ${fmt.format(Math.round(toNumber(r.weighted)))}<br>Estimated incoming movement basis: ${fmt.format(Math.round(toNumber(r.incoming)))}<br>${forecast ? 'Forecast basis: ' + basis : 'Mobility month: ' + f.month}`);
      }
    }).addTo(layerGroup);
  } else {
    const maxScore = Math.max(...rows.map(r => toNumber(r.weighted)), 1);
    rows.filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon) && toNumber(r.weighted) > 0).forEach(r => {
      const radius = 5 + 24 * Math.sqrt(toNumber(r.weighted) / maxScore);
      L.circleMarker([r.lat, r.lon], { radius, color: '#7a271a', weight: 1.5, fillColor: '#d92d20', fillOpacity: 0.56 })
        .bindPopup(`<strong>${r.zone_name}</strong><br>${r.province}<br>${title} score: ${fmt.format(Math.round(r.weighted))}<br>Incoming movement basis: ${fmt.format(Math.round(r.incoming))}`).addTo(layerGroup);
    });
  }
  addCaseLegend(breaks, forecast ? 'Forecast risk' : 'Weighted risk', 'case × movement score');
}

function updateKpis(destRows) {
  const f = currentFilters();

  if (mapMode === 'cases') {
    const rows = caseRowsLatest();
    const totalCases = rows.reduce((a,b)=>a+toNumber(b.confirmed_cases),0);
    const totalDeaths = rows.reduce((a,b)=>a+toNumber(b.confirmed_deaths),0);
    const mapped = rows.filter(r => r.zone_id).length;
    const top = rows.slice().sort((a,b)=>toNumber(b.confirmed_cases)-toNumber(a.confirmed_cases))[0];
    document.getElementById('kpiTotal').textContent = fmt.format(Math.round(totalCases));
    document.getElementById('kpiKinshasa').textContent = fmt.format(Math.round(totalDeaths));
    document.getElementById('kpiKinshasaShare').textContent = `${pct(totalDeaths / Math.max(totalCases,1))} CFR among confirmed`;
    document.getElementById('kpiBorder').textContent = fmt.format(rows.filter(r => toNumber(r.confirmed_cases)>0 && r.zone_id).length);
    document.getElementById('kpiBorderShare').textContent = `${mapped} rows with mappable zone ID`;
    document.getElementById('kpiUganda').textContent = top ? top.health_zone : '—';
    document.getElementById('kpiScenario').textContent = top ? `${fmt.format(Math.round(top.confirmed_cases))} confirmed cases; source ${latestCaseDate()}` : 'No case data';
    document.getElementById('scenarioText').innerHTML = `<strong>Case-count layer</strong><br>Confirmed cases and deaths are taken from SitRep N23/MVB_06/06/2026, reporting date 06 June 2026. The Ituri unventilated category (94 cases, 10 deaths) is intentionally not shown on the case-bubble map because it cannot be assigned to a specific health zone.`;
    return;
  }

  if (mapMode === 'weighted' || mapMode === 'forecast' || mapMode === 'air') {
    const forecast = mapMode === 'forecast';
    const isAir = mapMode === 'air';
    const rows = (isAir ? airAdjustedRiskRowsForMonth(f.month, false) : weightedRiskRowsForMonth(f.month, forecast)).filter(r => toNumber(isAir ? r.air_adjusted : r.weighted)>0);
    const metricKey = isAir ? 'air_adjusted' : 'weighted';
    const totalScore = rows.reduce((a,b)=>a+toNumber(b[metricKey]),0);
    const totalIncoming = rows.reduce((a,b)=>a+toNumber(b.incoming),0);
    const top = rows.slice().sort((a,b)=>toNumber(b[metricKey])-toNumber(a[metricKey]))[0];
    const basis = top?.forecast_basis || (forecast ? forecastMobilityMonths(f.month).label : f.month);
    const suppressed = isAir ? rows.reduce((a,b)=>a+toNumber(b.suppressed_amount),0) : 0;
    document.getElementById('kpiTotal').textContent = fmt.format(Math.round(totalScore));
    document.getElementById('kpiKinshasa').textContent = isAir ? fmt.format(Math.round(suppressed)) : fmt.format(Math.round(totalIncoming));
    document.getElementById('kpiKinshasaShare').textContent = isAir ? 'Suppressed case-weighted score from air-plausible destinations' : (forecast ? `Forecast mobility basis: ${basis}` : `Movement basis: ${f.month}`);
    document.getElementById('kpiBorder').textContent = top ? top.zone_name : '—';
    document.getElementById('kpiBorderShare').textContent = top ? `${fmt.format(Math.round(top[metricKey]))} top score` : 'No weighted risk';
    document.getElementById('kpiUganda').textContent = latestCaseDate() || '—';
    document.getElementById('kpiScenario').textContent = isAir ? 'Case source date; air suppression scenario' : 'Case source date';
    document.getElementById('scenarioText').innerHTML = isAir
      ? `<strong>Air-adjusted case-weighted risk</strong><br>Air-adjusted risk = case-weighted risk × air-travel suppression factor for long-distance, air-plausible destinations. The default scenario down-weights Kinshasa-bound risk to 25% of the pre-outbreak baseline, reflecting Bunia passenger-flight suspension and subsequent reopening under screening measures. This is a scenario-based prioritization indicator, not observed airline passenger OD and not transmission probability.`
      : `<strong>${forecast ? 'Forecast case-weighted risk' : 'Case-weighted spread risk'}</strong><br>Score = Σ confirmed_cases(origin health zone) × estimated movement(origin→destination). ${forecast ? 'Forecast uses ' + basis + ' as the mobility basis.' : 'Weighted risk uses the selected month mobility matrix.'} This score is for prioritization and should not be interpreted as a probability of transmission.`;
    return;
  }

  if (mapMode === 'uganda') {
    const rows = ugandaProjectionRows(f.month);
    const border = rows[0]?.border_pressure || 0;
    const totalProjected = rows.reduce((a,b)=>a+toNumber(b.projected),0);
    const kampala = rows.find(r => r.uganda_id === 'UGA_KAMPALA')?.projected || 0;
    const top = rows[0];
    document.getElementById('kpiTotal').textContent = fmt.format(Math.round(border));
    document.getElementById('kpiKinshasa').textContent = top ? top.uganda_name : '—';
    document.getElementById('kpiKinshasaShare').textContent = top ? `${fmt.format(Math.round(top.projected))} projected; top Uganda destination` : 'No projection';
    document.getElementById('kpiBorder').textContent = fmt.format(Math.round(totalProjected));
    document.getElementById('kpiBorderShare').textContent = `${f.scenario.scenario_name}; ${pct(Number(f.scenario.cross_border_fraction || 0))} crossing assumption`;
    document.getElementById('kpiUganda').textContent = fmt.format(Math.round(kampala));
    document.getElementById('kpiScenario').textContent = 'Projected Kampala component';
    document.getElementById('scenarioText').innerHTML = `
      <strong>Uganda projection: scenario-based estimate</strong><br>
      This layer estimates possible Uganda-side destinations by combining DRC-side movement toward Uganda-border proxy health zones with a historical IOM DTM Uganda–DRC border FMP destination profile from Jan–Mar 2020. It should be interpreted as <strong>projected movement pressure</strong>, not observed 2026 cross-border movement and not Ebola transmission probability.<br><br>
      For the selected month, DRC-side border-proxy movement is <strong>${fmt.format(Math.round(border))}</strong>. Under <strong>${f.scenario.scenario_name}</strong>, the projected Uganda-side total is <strong>${fmt.format(Math.round(totalProjected))}</strong>.
    `;
    return;
  }

  if (mapMode === 'risk') {
    const rows = riskRowsForMonth(f.month).filter(r => r.incoming > 0);
    const totalIncoming = rows.reduce((a, b) => a + toNumber(b.incoming), 0);
    const kin = rows.filter(r => r.is_kinshasa === 1 || r.category === 'kinshasa').reduce((a, b) => a + toNumber(b.incoming), 0);
    const border = rows.filter(r => r.is_uganda_border === 1 || r.category === 'uganda_border').reduce((a, b) => a + toNumber(b.incoming), 0);
    const top = rows.slice().sort((a,b)=>toNumber(b.risk)-toNumber(a.risk))[0];
    const uganda = Math.round(border * Number(f.scenario.cross_border_fraction || 0));
    document.getElementById('kpiTotal').textContent = fmt.format(Math.round(totalIncoming));
    document.getElementById('kpiKinshasa').textContent = fmt.format(Math.round(kin));
    document.getElementById('kpiKinshasaShare').textContent = `${pct(kin / Math.max(totalIncoming, 1))} of mobility pressure`;
    document.getElementById('kpiBorder').textContent = fmt.format(Math.round(border));
    document.getElementById('kpiBorderShare').textContent = `${pct(border / Math.max(totalIncoming, 1))} of mobility pressure`;
    document.getElementById('kpiUganda').textContent = top ? `${top.zone_name}` : '—';
    document.getElementById('kpiScenario').textContent = top ? `${fmt.format(Math.round(top.incoming))} arrivals; highest inflow` : 'No incoming movement';
    document.getElementById('scenarioText').innerHTML = `
      <strong>Mobility-based spread-risk layer</strong><br>
      Risk index = estimated monthly arrivals from selected outbreak health zone(s) to each destination health zone. The index is not divided by destination population. This is a relative mobility-pressure indicator for surveillance and preparedness, not an Ebola transmission probability. Uganda crossing remains scenario-based: ${fmt.format(uganda)} onward movements under the selected scenario.
    `;
    return;
  }

  if (mapMode === 'population' || mapMode === 'density') {
    const popRows = enrichPopulationRows(selectedPopulationRows()).filter(r => r.population > 0);
    const totalPop = popRows.reduce((a, b) => a + b.population, 0);
    const outbreakIds = new Set(origins.map(o => o.zone_id));
    const outbreakPop = popRows.filter(r => outbreakIds.has(r.zone_id)).reduce((a, b) => a + b.population, 0);
    const kinPop = popRows.filter(r => r.is_kinshasa === 1 || r.category === 'kinshasa').reduce((a, b) => a + b.population, 0);
    const borderPop = popRows.filter(r => r.is_uganda_border === 1 || r.category === 'uganda_border').reduce((a, b) => a + b.population, 0);

    document.getElementById('kpiTotal').textContent = totalPop ? fmt.format(Math.round(totalPop)) : '—';
    document.getElementById('kpiKinshasa').textContent = kinPop ? fmt.format(Math.round(kinPop)) : '—';
    document.getElementById('kpiKinshasaShare').textContent = totalPop ? `${pct(kinPop / Math.max(totalPop, 1))} of displayed population` : 'Population file not loaded';
    document.getElementById('kpiBorder').textContent = borderPop ? fmt.format(Math.round(borderPop)) : '—';
    document.getElementById('kpiBorderShare').textContent = totalPop ? `${pct(borderPop / Math.max(totalPop, 1))} of displayed population` : 'Population file not loaded';
    document.getElementById('kpiUganda').textContent = outbreakPop ? fmt.format(Math.round(outbreakPop)) : '—';
    document.getElementById('kpiScenario').textContent = totalPop ? (mapMode === 'density' ? 'Outbreak-zone population; density map' : 'Population in outbreak zones') : 'Add data/population_by_hz.csv';
    document.getElementById('scenarioText').innerHTML = totalPop ? `
      <strong>${mapMode === 'density' ? 'Population density layer' : 'Population layer'}</strong><br>
      ${mapMode === 'density'
        ? 'This layer colors health-zone polygons by estimated population density. It requires data/health_zones.geojson so that polygon area can be calculated. If boundaries are absent, the dashboard falls back to population bubbles.'
        : 'This layer displays estimated health-zone population for the selected month. With data/health_zones.geojson, health zones are colored as polygons; otherwise the dashboard uses proportional bubbles.'}
    ` : `
      <strong>Population data not loaded</strong><br>
      The uploaded relocation file contains health-zone-to-health-zone movement estimates, but not resident population estimates. Add a Flowminder population extract as <code>data/population_by_hz.csv</code> with columns <code>month, zone_id, zone_name, province, lat, lon, population</code> to activate this layer.
    `;
    return;
  }

  const total = destRows.reduce((a, b) => a + b.movement, 0);
  const kinshasa = destRows.filter(d => d.is_kinshasa === 1).reduce((a, b) => a + b.movement, 0);
  const border = destRows.filter(d => d.is_uganda_border === 1).reduce((a, b) => a + b.movement, 0);
  const uganda = Math.round(border * Number(f.scenario.cross_border_fraction || 0));

  document.getElementById('kpiTotal').textContent = fmt.format(total);
  document.getElementById('kpiKinshasa').textContent = fmt.format(kinshasa);
  document.getElementById('kpiKinshasaShare').textContent = `${pct(kinshasa / Math.max(total, 1))} of outbound movement`;
  document.getElementById('kpiBorder').textContent = fmt.format(border);
  document.getElementById('kpiBorderShare').textContent = `${pct(border / Math.max(total, 1))} of outbound movement`;
  document.getElementById('kpiUganda').textContent = fmt.format(uganda);
  document.getElementById('kpiScenario').textContent = `${f.scenario.scenario_name}; proxy estimate`;

  document.getElementById('scenarioText').innerHTML = `
    <strong>${f.scenario.scenario_name}</strong><br>
    ${f.scenario.description}<br><br>
    For the selected month, movement toward Uganda-border proxy zones is <strong>${fmt.format(border)}</strong>. Under this scenario, estimated onward movement into Uganda is <strong>${fmt.format(uganda)}</strong>. This is not observed cross-border movement; it is a scenario-based proxy until UNHCR, IOM DTM, or border-monitoring data are added.
  `;
}

function updatePopulationMap() {
  if (choroLegend) { map.removeControl(choroLegend); choroLegend = null; }
  layerGroup.clearLayers();
  const f = currentFilters();
  const notice = document.getElementById('populationNotice');
  const metric = mapMode === 'density' ? 'density' : 'population';

  document.getElementById('mapTitle').textContent = metric === 'density' ? 'Population density map' : 'Population map';
  document.getElementById('mapDescription').textContent = metric === 'density'
    ? 'Health-zone polygons are colored by estimated population density for the selected month. Outbreak health zones are outlined in red.'
    : 'Health-zone polygons are colored by estimated population for the selected month when boundaries are available. If boundaries are absent, bubbles are used.';
  document.getElementById('rankingTitle').textContent = metric === 'density' ? 'Population density ranking' : 'Population ranking';
  document.getElementById('rankingDescription').textContent = metric === 'density'
    ? 'Top health zones by estimated population density for the selected month.'
    : 'Top health zones by estimated population for the selected month.';

  if (hasBoundaries() && hasPopulationData()) {
    const metricRows = boundaryMetricRows(f.month, metric);
    const values = metricRows.map(r => r.value).filter(v => Number.isFinite(v) && v > 0);
    const breaks = [0.2, 0.4, 0.6, 0.8].map(q => quantile(values, q));
    const byFeature = new Map(metricRows.map(r => [r.feature, r]));

    notice.style.display = 'block';
    notice.innerHTML = metric === 'density'
      ? 'Polygon layer: color shows estimated population density calculated as population divided by health-zone polygon area.'
      : 'Polygon layer: color shows estimated health-zone population. Use Density to normalize by polygon area.';

    L.geoJSON(healthZoneBoundaries, {
      style: feature => {
        const r = byFeature.get(feature) || { value: 0, is_outbreak: false };
        const fill = choroplethColor(r.value, breaks);
        return {
          color: r.is_outbreak ? '#7a271a' : '#ffffff',
          weight: r.is_outbreak ? 3 : 0.6,
          fillColor: fill,
          fillOpacity: r.value > 0 ? 0.72 : 0.18,
          opacity: 1
        };
      },
      onEachFeature: (feature, layer) => {
        const r = byFeature.get(feature) || {};
        const valueLabel = metric === 'density'
          ? `${fmt.format(Math.round(toNumber(r.density)))} people/km²`
          : `${fmt.format(Math.round(toNumber(r.population)))} people`;
        layer.bindPopup(`<strong>${r.zone_name || featureZoneName(feature) || 'Health zone'}</strong><br>${r.province || featureProvince(feature) || ''}<br>${metric === 'density' ? 'Density' : 'Population'}: ${valueLabel}<br>Area: ${r.area_km2 ? fmt.format(Math.round(r.area_km2)) + ' km²' : '—'}<br>${f.month}`);
      }
    }).addTo(layerGroup);
    addBoundaryLegend(metric, breaks);

    // Outbreak labels stay visible above polygons.
    origins.forEach(o => {
      const latlng = [toNumber(o.lat), toNumber(o.lon)];
      if (!Number.isFinite(latlng[0]) || !Number.isFinite(latlng[1])) return;
      L.circleMarker(latlng, { radius: 7, color: '#7a271a', weight: 2, fillColor: '#d92d20', fillOpacity: 0.95 })
        .bindPopup(`<strong>${o.zone_name}</strong><br>${o.province}<br>Current outbreak health zone`).addTo(layerGroup);
      L.marker(latlng, { icon: L.divIcon({ className: 'origin-label', html: `<span>${o.zone_name}</span>`, iconSize: [100, 22], iconAnchor: [-8, 28] }), interactive: false }).addTo(layerGroup);
    });
    return;
  }

  // Fallback: bubble map if polygon boundaries have not yet been added.
  const rows = enrichPopulationRows(selectedPopulationRows()).filter(r => r.population > 0);
  const maxPop = Math.max(...rows.map(r => r.population), 1);
  if (!rows.length) {
    notice.style.display = 'block';
    notice.innerHTML = 'Population data are not available. Add <code>data/population_by_hz.csv</code>. For polygon choropleths, also add <code>data/health_zones.geojson</code>.';
    return;
  }
  notice.style.display = 'block';
  notice.innerHTML = metric === 'density'
    ? 'Density requires health-zone boundary polygons to calculate area. Add <code>data/health_zones.geojson</code>. Showing population bubbles instead.'
    : 'Boundary polygons are not loaded. Showing population bubbles. Add <code>data/health_zones.geojson</code> for a choropleth map.';
  rows.forEach(r => {
    const isOutbreak = origins.some(o => o.zone_id === r.zone_id);
    const radius = 4 + 24 * Math.sqrt(r.population / maxPop);
    let color = '#667085';
    if (r.is_kinshasa === 1 || r.category === 'kinshasa') color = '#1f5d8c';
    if (r.is_uganda_border === 1 || r.category === 'uganda_border') color = '#b54708';
    if (isOutbreak) color = '#d92d20';
    L.circleMarker([r.lat, r.lon], { radius, color: isOutbreak ? '#7a271a' : color, weight: isOutbreak ? 3 : 1.5, fillColor: color, fillOpacity: isOutbreak ? 0.82 : 0.44 })
      .bindPopup(`<strong>${r.zone_name}</strong><br>${r.province}<br>Estimated population: ${fmt.format(Math.round(r.population))}<br>${f.month}`).addTo(layerGroup);
  });
}


function updateRiskMap() {
  if (choroLegend) { map.removeControl(choroLegend); choroLegend = null; }
  layerGroup.clearLayers();
  const f = currentFilters();
  const notice = document.getElementById('populationNotice');
  const selectedOrigins = f.origin === 'ALL' ? origins : origins.filter(o => o.zone_id === f.origin);
  const riskRows = riskRowsForMonth(f.month).filter(r => r.incoming > 0 || r.is_outbreak);
  const values = riskRows.map(r => r.risk).filter(v => Number.isFinite(v) && v > 0);
  const breaks = [0.2, 0.4, 0.6, 0.8].map(q => quantile(values, q));

  document.getElementById('mapTitle').textContent = 'Mobility-based Ebola spread risk';
  document.getElementById('mapDescription').textContent = 'Health zones are colored by estimated monthly arrivals from selected outbreak health zone(s). This is a mobility-pressure indicator, not a predicted probability of transmission.';
  document.getElementById('rankingTitle').textContent = 'Spread-risk ranking';
  document.getElementById('rankingDescription').textContent = 'Top destination health zones by mobility-based spread pressure for the selected month.';
  notice.style.display = 'block';

  if (hasBoundaries()) {
    const byId = new Map(riskRows.map(r => [String(r.zone_id), r]));
    const byName = new Map(riskRows.map(r => [normalizedString(r.zone_name), r]));
    notice.innerHTML = 'Risk layer: color shows estimated incoming movement from selected outbreak zone(s). Values are not normalized by population. Red outlines indicate current outbreak health zones.';
    L.geoJSON(healthZoneBoundaries, {
      style: feature => {
        const id = featureZoneId(feature);
        const name = featureZoneName(feature);
        const r = byId.get(String(id)) || byName.get(normalizedString(name)) || { risk: 0, is_outbreak: false };
        return {
          color: r.is_outbreak ? '#7a271a' : '#ffffff',
          weight: r.is_outbreak ? 3 : 0.6,
          fillColor: riskColor(toNumber(r.risk), breaks),
          fillOpacity: toNumber(r.risk) > 0 ? 0.74 : 0.12,
          opacity: 1
        };
      },
      onEachFeature: (feature, layer) => {
        const id = featureZoneId(feature);
        const name = featureZoneName(feature);
        const r = byId.get(String(id)) || byName.get(normalizedString(name)) || {};
        layer.bindPopup(`<strong>${r.zone_name || name || 'Health zone'}</strong><br>${r.province || featureProvince(feature) || ''}<br>Incoming from outbreak zone(s): ${fmt.format(Math.round(toNumber(r.incoming)))}<br>Population: ${r.population ? fmt.format(Math.round(r.population)) : '—'}<br>Spread-risk inflow: ${fmt.format(Math.round(toNumber(r.risk)))} estimated arrivals<br>${f.month}`);
      }
    }).addTo(layerGroup);
    addRiskLegend(breaks);
  } else {
    notice.innerHTML = 'Boundary polygons are not loaded. Showing risk bubbles. Add <code>data/health_zones.geojson</code> for health-zone choropleth risk polygons.';
    const maxRisk = Math.max(...riskRows.map(r => toNumber(r.risk)), 1);
    riskRows.filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon) && r.incoming > 0).forEach(r => {
      const radius = 5 + 24 * Math.sqrt(toNumber(r.risk) / maxRisk);
      L.circleMarker([r.lat, r.lon], { radius, color: '#7a271a', weight: 1.5, fillColor: '#d92d20', fillOpacity: 0.54 })
        .bindPopup(`<strong>${r.zone_name}</strong><br>${r.province}<br>Incoming from outbreak zone(s): ${fmt.format(Math.round(r.incoming))}<br>Population: ${r.population ? fmt.format(Math.round(r.population)) : '—'}<br>Spread-risk inflow: ${fmt.format(Math.round(r.risk))} estimated arrivals<br>${f.month}`).addTo(layerGroup);
    });
  }

  // In Spread risk mode, show the choropleth only; do not overlay movement arrows.

  selectedOrigins.forEach(o => {
    const latlng = [toNumber(o.lat), toNumber(o.lon)];
    if (!Number.isFinite(latlng[0]) || !Number.isFinite(latlng[1])) return;
    L.circleMarker(latlng, { radius: 18, color: '#7a271a', weight: 2, fillColor: '#f04438', fillOpacity: 0.18 }).addTo(layerGroup);
    L.circleMarker(latlng, { radius: 8, color: '#7a271a', weight: 2, fillColor: '#d92d20', fillOpacity: 0.95 })
      .bindPopup(`<strong>${o.zone_name}</strong><br>${o.province}<br>Current outbreak health zone`).addTo(layerGroup);
    L.marker(latlng, { icon: L.divIcon({ className: 'origin-label', html: `<span>${o.zone_name}</span>`, iconSize: [100, 22], iconAnchor: [-8, 28] }), interactive: false }).addTo(layerGroup);
  });
}

function updateMap(destRows) {
  if (choroLegend) { map.removeControl(choroLegend); choroLegend = null; }
  layerGroup.clearLayers();
  document.getElementById('populationNotice').style.display = 'none';
  document.getElementById('mapTitle').textContent = 'Flow map';
  document.getElementById('mapDescription').textContent = 'Directed lines show monthly movement from outbreak health zones. Outbreak origins are highlighted in red, Kinshasa destinations in blue, and Uganda-border proxy zones in orange.';
  document.getElementById('rankingTitle').textContent = 'Destination ranking';
  document.getElementById('rankingDescription').textContent = 'Top destination health zones by estimated monthly movement.';
  const f = currentFilters();
  const selectedOrigins = f.origin === 'ALL' ? origins : origins.filter(o => o.zone_id === f.origin);
  const rowsForMonth = selectedFlows();
  const maxMove = Math.max(...destRows.map(d => toNumber(d.movement)), 1);

  // First draw the local top-N flows lightly. Strategic Kinshasa and Uganda-border corridors
  // are drawn afterward, so they remain visible even when their component HZs are not top-N.
  destRows.slice(0, f.topN).forEach(d => {
    const color = destinationColor(d);
    selectedOrigins.forEach(o => {
      const row = flows.find(r => r.month === f.month && r.origin_id === o.zone_id && r.destination_id === d.zone_id);
      if (!row) return;
      const movement = toNumber(row.movement);
      if (movement <= 0) return;
      const from = [toNumber(o.lat), toNumber(o.lon)];
      const to = [toNumber(d.lat), toNumber(d.lon)];
      const weight = 1 + 6 * Math.sqrt(movement / maxMove);
      const opacity = d.is_kinshasa === 1 || d.is_uganda_border === 1 ? 0.48 : 0.22;
      L.polyline([from, to], {
        color,
        weight,
        opacity,
        smoothFactor: 1,
        dashArray: d.is_kinshasa === 1 || d.is_uganda_border === 1 ? null : '5 7'
      }).bindPopup(`${o.zone_name} → ${d.zone_name}<br>${fmt.format(Math.round(movement))} movements<br>${f.month}`).addTo(layerGroup);
      if (d.is_kinshasa === 1 || d.is_uganda_border === 1) addArrow(from, to, color, movement, { size: 20 });
    });
  });

  drawStrategicCorridors(rowsForMonth);

  // Destination bubbles.
  destRows.slice(0, f.topN).forEach(d => {
    const radius = 5 + 17 * Math.sqrt(toNumber(d.movement) / maxMove);
    const color = destinationColor(d);
    L.circleMarker([toNumber(d.lat), toNumber(d.lon)], {
      radius,
      color,
      weight: 2,
      fillColor: color,
      fillOpacity: d.is_kinshasa === 1 || d.is_uganda_border === 1 ? 0.72 : 0.50
    }).bindPopup(`<strong>${d.zone_name}</strong><br>${d.province}<br>${d.category}<br>Movement: ${fmt.format(Math.round(d.movement))}<br>${f.month}`).addTo(layerGroup);
  });

  // Outbreak origins with a clear halo and label.
  selectedOrigins.forEach(o => {
    const latlng = [toNumber(o.lat), toNumber(o.lon)];
    L.circleMarker(latlng, {
      radius: 18,
      color: '#7a271a',
      weight: 2,
      fillColor: '#f04438',
      fillOpacity: 0.18
    }).addTo(layerGroup);
    L.circleMarker(latlng, {
      radius: 8,
      color: '#7a271a',
      weight: 2,
      fillColor: '#d92d20',
      fillOpacity: 0.95
    }).bindPopup(`<strong>${o.zone_name}</strong><br>${o.province}<br>Current outbreak health zone`).addTo(layerGroup);
    L.marker(latlng, {
      icon: L.divIcon({
        className: 'origin-label',
        html: `<span>${o.zone_name}</span>`,
        iconSize: [100, 22],
        iconAnchor: [-8, 28]
      }),
      interactive: false
    }).addTo(layerGroup);
  });
}
function fitMapToData() {
  const layers = [];
  layerGroup.eachLayer(l => layers.push(l));
  const group = L.featureGroup(layers);
  if (layers.length) map.fitBounds(group.getBounds().pad(0.16));
}

function updateBarChart(destRows) {
  const f = currentFilters();

  if (mapMode === 'cases') {
    const rows = caseRowsLatest().filter(r => toNumber(r.confirmed_cases)>0).sort((a,b)=>toNumber(b.confirmed_cases)-toNumber(a.confirmed_cases)).slice(0, f.topN).reverse();
    Plotly.newPlot('barChart', [{ type:'bar', orientation:'h', x: rows.map(d=>d.confirmed_cases), y: rows.map(d=>`${d.health_zone} (${d.province})`), hovertemplate: '%{y}<br>Confirmed cases: %{x:,.0f}<extra></extra>' }], { margin:{l:155,r:20,t:18,b:40}, xaxis:{title:'Confirmed cases', gridcolor:'#e7eef7'}, yaxis:{automargin:true}, paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'rgba(0,0,0,0)'}, {responsive:true, displayModeBar:false});
    return;
  }

  if (mapMode === 'weighted' || mapMode === 'forecast' || mapMode === 'air') {
    const forecast = mapMode === 'forecast';
    const isAir = mapMode === 'air';
    const sourceRows = isAir ? airAdjustedRiskRowsForMonth(f.month, false) : weightedRiskRowsForMonth(f.month, forecast);
    const metricKey = isAir ? 'air_adjusted' : 'weighted';
    const rows = sourceRows.filter(r => toNumber(r[metricKey])>0).sort((a,b)=>toNumber(b[metricKey])-toNumber(a[metricKey])).slice(0, f.topN).reverse();
    Plotly.newPlot('barChart', [{ type:'bar', orientation:'h', x: rows.map(d=>d[metricKey]), y: rows.map(d=>`${d.zone_name} (${d.province})`), hovertemplate: `%{y}<br>${isAir ? 'Air-adjusted score' : 'Case-weighted score'}: %{x:,.0f}<extra></extra>` }], { margin:{l:155,r:20,t:18,b:40}, xaxis:{title: isAir ? 'Air-adjusted case-weighted score' : (forecast ? 'Forecast case-weighted movement score' : 'Case-weighted movement score'), gridcolor:'#e7eef7'}, yaxis:{automargin:true}, paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'rgba(0,0,0,0)', annotations: rows.length ? [] : [{text:'No case-weighted risk for selected settings', x:0.5, y:0.5, xref:'paper', yref:'paper', showarrow:false, font:{size:14, color:'#667085'}}]}, {responsive:true, displayModeBar:false});
    return;
  }

  if (mapMode === 'uganda') {
    const rows = ugandaProjectionRows(f.month).filter(r => r.projected > 0).slice(0, f.topN).reverse();
    Plotly.newPlot('barChart', [{
      type: 'bar', orientation: 'h',
      x: rows.map(d => d.projected), y: rows.map(d => `${d.uganda_name} (${d.district})`),
      hovertemplate: '%{y}<br>Projected movements: %{x:,.0f}<extra></extra>'
    }], {
      margin: { l: 150, r: 20, t: 18, b: 40 },
      xaxis: { title: 'Scenario-projected Uganda-side movement', gridcolor: '#e7eef7' },
      yaxis: { automargin: true },
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
      annotations: rows.length ? [] : [{ text: 'No Uganda-side projection for selected month/scenario', x: 0.5, y: 0.5, xref: 'paper', yref: 'paper', showarrow: false, font: { size: 14, color: '#667085' } }]
    }, { responsive: true, displayModeBar: false });
    return;
  }

  if (mapMode === 'risk') {
    const rows = riskRowsForMonth(f.month).filter(r => r.incoming > 0)
      .sort((a, b) => toNumber(b.risk) - toNumber(a.risk)).slice(0, f.topN).reverse();
    Plotly.newPlot('barChart', [{
      type: 'bar', orientation: 'h', x: rows.map(d => d.risk), y: rows.map(d => `${d.zone_name} (${d.province})`),
      hovertemplate: '%{y}<br>Estimated arrivals from outbreak zones: %{x:,.0f}<extra></extra>'
    }], {
      margin: { l: 145, r: 20, t: 18, b: 40 },
      xaxis: { title: 'Estimated monthly arrivals from outbreak zones', gridcolor: '#e7eef7' },
      yaxis: { automargin: true },
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
      annotations: rows.length ? [] : [{ text: 'No incoming movement from selected outbreak zone(s)', x: 0.5, y: 0.5, xref: 'paper', yref: 'paper', showarrow: false, font: { size: 14, color: '#667085' } }]
    }, { responsive: true, displayModeBar: false });
    return;
  }

  if (mapMode === 'population' || mapMode === 'density') {
    let rows = [];
    if (mapMode === 'density' && hasBoundaries()) {
      rows = boundaryMetricRows(f.month, 'density').filter(r => r.density > 0)
        .sort((a, b) => b.density - a.density).slice(0, f.topN).reverse();
      Plotly.newPlot('barChart', [{
        type: 'bar', orientation: 'h', x: rows.map(d => d.density), y: rows.map(d => `${d.zone_name} (${d.province})`),
        hovertemplate: '%{y}<br>Density: %{x:,.0f} people/km²<extra></extra>'
      }], {
        margin: { l: 145, r: 20, t: 18, b: 40 },
        xaxis: { title: 'Estimated population density (people/km²)', gridcolor: '#e7eef7' },
        yaxis: { automargin: true },
        paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
        annotations: rows.length ? [] : [{ text: 'Add data/health_zones.geojson to show density ranking', x: 0.5, y: 0.5, xref: 'paper', yref: 'paper', showarrow: false, font: { size: 14, color: '#667085' } }]
      }, { responsive: true, displayModeBar: false });
      return;
    }

    rows = enrichPopulationRows(selectedPopulationRows()).filter(r => r.population > 0)
      .sort((a, b) => b.population - a.population).slice(0, f.topN).reverse();
    Plotly.newPlot('barChart', [{
      type: 'bar', orientation: 'h', x: rows.map(d => d.population), y: rows.map(d => `${d.zone_name} (${d.province})`),
      hovertemplate: '%{y}<br>Population: %{x:,}<extra></extra>'
    }], {
      margin: { l: 145, r: 20, t: 18, b: 40 },
      xaxis: { title: 'Estimated population', gridcolor: '#e7eef7' },
      yaxis: { automargin: true },
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
      annotations: rows.length ? [] : [{ text: 'Add data/population_by_hz.csv to show population ranking', x: 0.5, y: 0.5, xref: 'paper', yref: 'paper', showarrow: false, font: { size: 14, color: '#667085' } }]
    }, { responsive: true, displayModeBar: false });
    return;
  }

  const rows = destRows.slice(0, f.topN).reverse();
  const labels = rows.map(d => `${d.zone_name} (${d.province})`);
  const values = rows.map(d => d.movement);
  Plotly.newPlot('barChart', [{
    type: 'bar', orientation: 'h', x: values, y: labels,
    hovertemplate: '%{y}<br>Movement: %{x:,}<extra></extra>'
  }], {
    margin: { l: 145, r: 20, t: 18, b: 40 },
    xaxis: { title: 'Estimated monthly movement', gridcolor: '#e7eef7' },
    yaxis: { automargin: true },
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)'
  }, { responsive: true, displayModeBar: false });
}

function updateTrendChart() {
  const f = currentFilters();

  if (mapMode === 'cases') {
    const rows = caseRowsLatest().filter(r => toNumber(r.confirmed_cases)>0).sort((a,b)=>toNumber(b.confirmed_cases)-toNumber(a.confirmed_cases)).slice(0, 12).reverse();
    Plotly.newPlot('trendChart', [{ type:'bar', orientation:'h', name:'Confirmed cases', x: rows.map(r=>r.confirmed_cases), y: rows.map(r=>`${r.health_zone} (${r.province})`), hovertemplate:'%{y}<br>Cases: %{x:,.0f}<extra></extra>'}], { margin:{l:155,r:20,t:18,b:40}, xaxis:{title:'Confirmed cases', gridcolor:'#e7eef7'}, yaxis:{automargin:true}, paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'rgba(0,0,0,0)'}, {responsive:true, displayModeBar:false});
    return;
  }

  if (mapMode === 'weighted' || mapMode === 'forecast' || mapMode === 'air') {
    const forecast = mapMode === 'forecast';
    const isAir = mapMode === 'air';
    const months = [...new Set(flows.map(d => d.month))].sort();
    const rows = months.map(month => { const rr = (isAir ? airAdjustedRiskRowsForMonth(month, false) : weightedRiskRowsForMonth(month, forecast)).filter(r=>toNumber(isAir ? r.air_adjusted : r.weighted)>0); return { month, total: rr.reduce((a,b)=>a+toNumber(isAir ? b.air_adjusted : b.weighted),0), top: rr.length ? Math.max(...rr.map(r=>toNumber(isAir ? r.air_adjusted : r.weighted))) : 0 }; });
    Plotly.newPlot('trendChart', [
      { type:'scatter', mode:'lines+markers', name: isAir ? 'Total air-adjusted score' : 'Total weighted score', x: rows.map(r=>r.month), y: rows.map(r=>r.total), hovertemplate:'%{x}<br>Total score: %{y:,.0f}<extra></extra>'},
      { type:'scatter', mode:'lines+markers', name:'Top destination score', x: rows.map(r=>r.month), y: rows.map(r=>r.top), hovertemplate:'%{x}<br>Top score: %{y:,.0f}<extra></extra>'}
    ], { margin:{l:58,r:20,t:18,b:46}, yaxis:{title: isAir ? 'Air-adjusted case-weighted score' : (forecast ? 'Forecast case-weighted score' : 'Case-weighted score'), gridcolor:'#e7eef7'}, xaxis:{title:'Mobility month'}, legend:{orientation:'h', y:-0.25}, paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'rgba(0,0,0,0)'}, {responsive:true, displayModeBar:false});
    return;
  }

  if (mapMode === 'uganda') {
    const months = [...new Set(flows.map(d => d.month))].sort();
    const rows = months.map(month => {
      const projectedRows = ugandaProjectionRows(month);
      return {
        month,
        total: projectedRows.reduce((a,b)=>a+toNumber(b.projected),0),
        top: projectedRows[0]?.projected || 0,
        kampala: projectedRows.find(r => r.uganda_id === 'UGA_KAMPALA')?.projected || 0
      };
    });
    Plotly.newPlot('trendChart', [
      { type: 'scatter', mode: 'lines+markers', name: 'Projected Uganda-side total', x: rows.map(r => r.month), y: rows.map(r => r.total), hovertemplate: '%{x}<br>Total projection: %{y:,.0f}<extra></extra>' },
      { type: 'scatter', mode: 'lines+markers', name: 'Top Uganda destination', x: rows.map(r => r.month), y: rows.map(r => r.top), hovertemplate: '%{x}<br>Top destination: %{y:,.0f}<extra></extra>' },
      { type: 'scatter', mode: 'lines+markers', name: 'Kampala component', x: rows.map(r => r.month), y: rows.map(r => r.kampala), hovertemplate: '%{x}<br>Kampala: %{y:,.0f}<extra></extra>' }
    ], {
      margin: { l: 58, r: 20, t: 18, b: 46 },
      yaxis: { title: 'Scenario-projected movements', gridcolor: '#e7eef7' },
      xaxis: { title: 'Month' },
      legend: { orientation: 'h', y: -0.25 },
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)'
    }, { responsive: true, displayModeBar: false });
    return;
  }

  if (mapMode === 'risk') {
    const rows = [...new Set(flows.map(d => d.month))].sort().map(month => {
      const rrows = riskRowsForMonth(month).filter(r => r.incoming > 0);
      const total = rrows.reduce((a,b)=>a+toNumber(b.incoming),0);
      const kin = rrows.filter(r => r.is_kinshasa === 1 || r.category === 'kinshasa').reduce((a,b)=>a+toNumber(b.incoming),0);
      const border = rrows.filter(r => r.is_uganda_border === 1 || r.category === 'uganda_border').reduce((a,b)=>a+toNumber(b.incoming),0);
      return { month, total, kinshasa: kin, border };
    });
    Plotly.newPlot('trendChart', [
      { type: 'scatter', mode: 'lines+markers', name: 'All destinations', x: rows.map(r => r.month), y: rows.map(r => r.total), hovertemplate: '%{x}<br>Total incoming from outbreak zones: %{y:,}<extra></extra>' },
      { type: 'scatter', mode: 'lines+markers', name: 'Kinshasa', x: rows.map(r => r.month), y: rows.map(r => r.kinshasa), hovertemplate: '%{x}<br>Kinshasa: %{y:,}<extra></extra>' },
      { type: 'scatter', mode: 'lines+markers', name: 'Uganda-border proxy zones', x: rows.map(r => r.month), y: rows.map(r => r.border), hovertemplate: '%{x}<br>Uganda-border proxy: %{y:,}<extra></extra>' }
    ], {
      margin: { l: 58, r: 20, t: 18, b: 46 },
      yaxis: { title: 'Monthly incoming movements from outbreak zones', gridcolor: '#e7eef7' },
      xaxis: { title: 'Month' },
      legend: { orientation: 'h', y: -0.25 },
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)'
    }, { responsive: true, displayModeBar: false });
    return;
  }

  if (mapMode === 'population' || mapMode === 'density') {
    const months = [...new Set(population.map(d => d.month))].sort();
    const outbreakIds = new Set(origins.map(o => o.zone_id));
    const rows = months.map(month => {
      const popRows = enrichPopulationRows(population.filter(r => r.month === month));
      if (mapMode === 'density' && hasBoundaries()) {
        const drows = boundaryMetricRows(month, 'density');
        const outbreak = drows.filter(r => outbreakIds.has(r.zone_id) || r.is_outbreak);
        const kin = drows.filter(r => r.is_kinshasa || r.category === 'kinshasa');
        const border = drows.filter(r => r.is_uganda_border || r.category === 'uganda_border');
        const weightedDensity = arr => { const area = arr.reduce((a,b)=>a+toNumber(b.area_km2),0); const pop = arr.reduce((a,b)=>a+toNumber(b.population),0); return area > 0 ? pop / area : 0; };
        return { month, outbreak: weightedDensity(outbreak), kinshasa: weightedDensity(kin), border: weightedDensity(border) };
      }
      return {
        month,
        outbreak: popRows.filter(r => outbreakIds.has(r.zone_id)).reduce((a, b) => a + toNumber(b.population), 0),
        kinshasa: popRows.filter(r => r.is_kinshasa === 1 || r.category === 'kinshasa').reduce((a, b) => a + toNumber(b.population), 0),
        border: popRows.filter(r => r.is_uganda_border === 1 || r.category === 'uganda_border').reduce((a, b) => a + toNumber(b.population), 0)
      };
    }).filter(r => r.outbreak || r.kinshasa || r.border);
    Plotly.newPlot('trendChart', [
      { type: 'scatter', mode: 'lines+markers', name: 'Outbreak zones', x: rows.map(r => r.month), y: rows.map(r => r.outbreak), hovertemplate: '%{x}<br>Outbreak zones: %{y:,}<extra></extra>' },
      { type: 'scatter', mode: 'lines+markers', name: 'Kinshasa zones', x: rows.map(r => r.month), y: rows.map(r => r.kinshasa), hovertemplate: '%{x}<br>Kinshasa: %{y:,}<extra></extra>' },
      { type: 'scatter', mode: 'lines+markers', name: 'Uganda-border proxy zones', x: rows.map(r => r.month), y: rows.map(r => r.border), hovertemplate: '%{x}<br>Uganda-border proxy: %{y:,}<extra></extra>' }
    ], {
      margin: { l: 58, r: 20, t: 18, b: 46 },
      yaxis: { title: mapMode === 'density' ? 'Estimated population density (people/km²)' : 'Estimated population', gridcolor: '#e7eef7' },
      xaxis: { title: 'Month' },
      legend: { orientation: 'h', y: -0.25 },
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
      annotations: rows.length ? [] : [{ text: mapMode === 'density' ? 'Density time series will appear after adding data/health_zones.geojson' : 'Population time series will appear after adding data/population_by_hz.csv', x: 0.5, y: 0.5, xref: 'paper', yref: 'paper', showarrow: false, font: { size: 14, color: '#667085' } }]
    }, { responsive: true, displayModeBar: false });
    return;
  }

  const rows = groupByMonth(f.origin);
  Plotly.newPlot('trendChart', [
    { type: 'scatter', mode: 'lines+markers', name: 'Kinshasa', x: rows.map(r => r.month), y: rows.map(r => r.kinshasa), hovertemplate: '%{x}<br>Kinshasa: %{y:,}<extra></extra>' },
    { type: 'scatter', mode: 'lines+markers', name: 'Uganda-border proxy zones', x: rows.map(r => r.month), y: rows.map(r => r.border), hovertemplate: '%{x}<br>Uganda-border proxy: %{y:,}<extra></extra>' }
  ], {
    margin: { l: 58, r: 20, t: 18, b: 46 },
    yaxis: { title: 'Estimated monthly movement', gridcolor: '#e7eef7' },
    xaxis: { title: 'Month' },
    legend: { orientation: 'h', y: -0.25 },
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)'
  }, { responsive: true, displayModeBar: false });
}

function updateDashboard() {
  document.getElementById('topNValue').textContent = document.getElementById('topN').value;
  const month = document.getElementById('monthSelect').value;
  const idx = monthsCache.indexOf(month);
  if (idx >= 0) document.getElementById('monthSlider').value = idx;
  document.getElementById('monthSliderLabel').textContent = month;
  const destRows = groupByDestination(selectedFlows());
  updateKpis(destRows);
  if (mapMode === 'cases') updateCasesMap();
  else if (mapMode === 'risk') updateRiskMap();
  else if (mapMode === 'weighted') updateWeightedRiskMap(false);
  else if (mapMode === 'forecast') updateWeightedRiskMap(true);
  else if (mapMode === 'air') updateAirAdjustedRiskMap();
  else if (mapMode === 'uganda') updateUgandaProjectionMap();
  else if (mapMode === 'population' || mapMode === 'density') updatePopulationMap();
  else updateMap(destRows);
  updateBarChart(destRows);
  updateTrendChart();
}

async function main() {
  [origins, destinations, flows, scenarios, population, healthZoneBoundaries, ugandaProfile, cases, airAdjustment] = await Promise.all([
    loadCsv(files.origins), loadCsv(files.destinations), loadCsv(files.flows), loadCsv(files.scenarios), loadCsvOptional(files.population), loadGeoJsonOptional(files.boundaries), loadCsvOptional(files.ugandaProfile), loadCsvOptional(files.cases), loadCsvOptional(files.airAdjustment)
  ]);
  initMap();
  populateControls();
  document.getElementById('dataStatus').textContent = 'Flowminder / HDX-formatted data';
  const popMsg = hasPopulationData() ? `; population rows: ${population.length}` : '; population file not loaded';
  const boundaryMsg = hasBoundaries() ? `; health-zone polygons: ${healthZoneBoundaries.features.length}` : '; polygon boundaries not loaded';
  const caseMsg = cases.length ? `; case rows: ${cases.length} (source date ${latestCaseDate()})` : '; case file not loaded';
  document.getElementById('lastUpdated').textContent = `Loaded ${flows.length} OD rows through ${monthsCache[monthsCache.length - 1] || 'latest month'}${popMsg}${boundaryMsg}${caseMsg}`;
  updateDashboard();
  setTimeout(fitMapToData, 300);
}

main().catch(err => {
  console.error(err);
  document.body.insertAdjacentHTML('afterbegin', `<div style="background:#fee4e2;color:#912018;padding:12px 20px;font-weight:700">Dashboard failed to load: ${err.message}</div>`);
});
