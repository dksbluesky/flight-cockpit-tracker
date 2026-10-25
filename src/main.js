import './styles.css';
import { strings } from './i18n/strings.js';
import { createMockProvider } from './providers/mock.js';
import { createLiveProvider } from './providers/live.js';
import { createTrackingMap } from './renderers/map.js';
import { createCockpitRenderer } from './renderers/cockpit.js';
import { dataAgeSeconds, isStale } from './domain/aircraft.js';
import { ilsDeviation } from './domain/ils.js';
import { runwayEnds, runwayAirports } from './data/runways.js';

const providerName = import.meta.env.VITE_AIRCRAFT_PROVIDER === 'mock' ? 'mock' : 'live';
const mockProvider = createMockProvider();
const defaultLiveApiUrl = import.meta.env.PROD ? 'https://flight-cockpit-proxy.onrender.com/api/aircraft' : 'http://127.0.0.1:8787/api/aircraft';
const liveProvider = createLiveProvider(import.meta.env.VITE_LIVE_API_URL || defaultLiveApiUrl);
const metarApiUrl = import.meta.env.VITE_METAR_API_URL || (import.meta.env.PROD ? 'https://flight-cockpit-proxy.onrender.com/api/metar' : 'http://127.0.0.1:8787/api/metar');
const locations = [
  ['taiwan', 'Taiwan · 台灣', 23.7, 121],
  ['vhhh', 'VHHH · 香港 Hong Kong', 22.308, 113.9185],
  ['vmmc', 'VMMC · 澳門 Macau', 22.1496, 113.5915],
  ['wsss', 'WSSS · 新加坡 Singapore', 1.3644, 103.9915],
  ['rksi', 'RKSI · 首爾仁川 Incheon', 37.4602, 126.4407],
  ['rjtt', 'RJTT · 東京羽田 Haneda', 35.5494, 139.7798],
  ['kjfk', 'KJFK · 紐約 JFK', 40.6413, -73.7781],
  ['klax', 'KLAX · 洛杉磯 L.A.', 33.9416, -118.4085]
];
let activeProviderName = providerName;
let hasLiveData = false; let lastLiveError = null;
let language = localStorage.getItem('fct-language') || (navigator.language.startsWith('zh') ? 'zh-TW' : 'en');
let filter = 'all'; let aircraft = []; let selected = null; let cockpitRenderer = null; let deferredInstallPrompt = null;
let tiltPermissionGranted = false; let tiltListening = false; let tiltBaseline = null; let latestTilt = null;
let deviceTilt = { pitch: 0, roll: 0 };
let searchLocation = { key: 'taiwan', latitude: 23.7, longitude: 121, distanceNm: 250 };
let metarWind = null;
let metarRequestId = 0;
let arrivalAirport = 'RCTP';
let selectedRunway = runwayEnds.find((runway) => runway.airport === arrivalAirport && runway.runway === '05L');
let mapView = null;
const app = document.querySelector('#app');
let infoPanelOpen = true;

const value = (input, suffix = '') => Number.isFinite(input) ? `${Math.round(input).toLocaleString('en-US')}${suffix}` : strings[language].unavailable;
const classificationLabel = (item) => item.classification === 'possible-military' ? strings[language].military : item.classification === 'civilian' ? strings[language].civilian : strings[language].unknown;

function renderShell() {
  const t = strings[language];
  app.innerHTML = `
    <main class="shell">
      <header class="topbar"><div class="brand"><strong>${t.title}</strong><small>${t.simulated}</small></div>
        <button id="install" hidden>${t.install}</button><select id="language"><option value="en">English</option><option value="zh-TW">繁體中文</option></select></header>
      <div id="status" class="status">${providerName === 'mock' ? t.mock : t.live}</div>
      <section class="workspace"><div class="map-wrap"><div id="map"></div><nav class="filters">
        <button data-filter="all">${t.all}</button><button data-filter="civilian">${t.civilian}</button><button data-filter="possible-military">${t.military}</button>
      </nav><form id="location-picker" class="location-picker">
        <select id="location" aria-label="${t.location}">${locations.map(([key, label]) => `<option value="${key}" ${key === searchLocation.key ? 'selected' : ''}>${label}</option>`).join('')}<option value="custom" ${searchLocation.key === 'custom' ? 'selected' : ''}>${t.custom}</option></select>
        <input id="latitude" type="number" min="-90" max="90" step="any" value="${searchLocation.latitude}" aria-label="${t.latitude}" placeholder="${t.latitude}">
        <input id="longitude" type="number" min="-180" max="180" step="any" value="${searchLocation.longitude}" aria-label="${t.longitude}" placeholder="${t.longitude}">
        <button type="submit">${t.load}</button>
      </form></div><aside id="panel" class="panel"></aside></section>
    </main>
    <section id="cockpit" class="cockpit hidden" aria-label="${t.simulated}"><h1 class="cockpit-title">${t.simulated}</h1><div id="cockpit-scene"></div><div id="hud" class="hud"></div><div class="arrival-controls"><label for="arrival-airport">${t.arrival}</label><select id="arrival-airport">${runwayAirports.map((airport) => `<option value="${airport}" ${airport === arrivalAirport ? 'selected' : ''}>${airport}</option>`).join('')}</select><label for="arrival-runway">${t.ilsRunway}</label><select id="arrival-runway"></select></div><div class="tilt-controls"><button id="enable-tilt" type="button">${t.enableTilt}</button><button id="center-view" type="button" hidden>${t.centerView}</button><span id="tilt-status" aria-live="polite"></span></div><button id="return" class="action return">← ${t.return}</button></section>`;
  document.querySelector('#language').value = language;
  document.querySelector('#language').addEventListener('change', (event) => { language = event.target.value; localStorage.setItem('fct-language', language); closeCockpit(); mapView = map.getView(); map.destroy(); renderShell(); initialize(); });
  document.querySelectorAll('[data-filter]').forEach((button) => { button.classList.toggle('active', button.dataset.filter === filter); button.addEventListener('click', () => { filter = button.dataset.filter; renderAircraft(); }); });
  const locationSelect = document.querySelector('#location');
  locationSelect.addEventListener('change', () => {
    const preset = locations.find(([key]) => key === locationSelect.value);
    if (preset) { document.querySelector('#latitude').value = preset[2]; document.querySelector('#longitude').value = preset[3]; }
  });
  ['#latitude', '#longitude'].forEach((selector) => document.querySelector(selector).addEventListener('input', () => { locationSelect.value = 'custom'; }));
  document.querySelector('#location-picker').addEventListener('submit', changeLocation);
  document.querySelector('#return').addEventListener('click', closeCockpit);
  const arrivalSelect = document.querySelector('#arrival-airport');
  const runwaySelect = document.querySelector('#arrival-runway');
  const updateRunwayChoices = (preferredRunway) => {
    const previousAirport = arrivalAirport;
    arrivalAirport = arrivalSelect.value;
    const choices = runwayEnds.filter((runway) => runway.airport === arrivalAirport);
    runwaySelect.innerHTML = choices.map((runway) => `<option value="${runway.runway}">${runway.runway}</option>`).join('');
    selectedRunway = choices.find((runway) => runway.runway === preferredRunway) || choices[0] || null;
    if (selectedRunway) runwaySelect.value = selectedRunway.runway;
    if (arrivalAirport !== previousAirport) { metarWind = null; refreshMetar(arrivalAirport); }
    if (cockpitRenderer && selected) renderCockpitHud(selected);
  };
  updateRunwayChoices(selectedRunway?.runway);
  arrivalSelect.addEventListener('change', () => updateRunwayChoices());
  runwaySelect.addEventListener('change', () => {
    selectedRunway = runwayEnds.find((runway) => runway.airport === arrivalAirport && runway.runway === runwaySelect.value) || null;
    if (cockpitRenderer && selected) renderCockpitHud(selected);
  });
  document.querySelector('#enable-tilt').addEventListener('click', enableDeviceTilt);
  document.querySelector('#center-view').addEventListener('click', centerDeviceTilt);
  const install = document.querySelector('#install');
  if (deferredInstallPrompt) install.hidden = false;
  install.addEventListener('click', async () => { if (deferredInstallPrompt) { deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; install.hidden = true; } });
}

let map;
async function changeLocation(event) {
  event.preventDefault();
  const latitude = Number(document.querySelector('#latitude').value);
  const longitude = Number(document.querySelector('#longitude').value);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return;
  const locationKey = document.querySelector('#location').value;
  searchLocation = { key: locationKey, latitude, longitude, distanceNm: 250 };
  selected = null; aircraft = []; map.setSelected(null); renderAircraft(); renderPanel(); map.goTo(longitude, latitude);
  await refresh();
}
function scheduleViewportRefresh() { updateAircraftStatus(); }
function initialize() { map = createTrackingMap(document.querySelector('#map'), selectAircraft, scheduleViewportRefresh, mapView || { center: [searchLocation.longitude, searchLocation.latitude], zoom: 6.25 }); renderPanel(); renderAircraft(); }
function filteredAircraft() { return filter === 'all' ? aircraft : aircraft.filter((item) => item.classification === filter); }
function updateAircraftStatus() {
  const status = document.querySelector('#status'); if (!status || !map) return;
  const shownAircraft = filteredAircraft();
  const visibleCount = map.countVisible(shownAircraft);
  const label = lastLiveError && activeProviderName === 'live' ? strings[language].delayed : activeProviderName === 'live' ? strings[language].live : lastLiveError ? strings[language].fallback : strings[language].mock;
  status.className = lastLiveError ? 'status error' : 'status';
  const sourceLink = document.createElement('a');
  sourceLink.href = 'https://adsb.fi/'; sourceLink.target = '_blank'; sourceLink.rel = 'noopener noreferrer'; sourceLink.textContent = 'adsb.fi';
  status.replaceChildren(
    document.createTextNode(`${label} · `), sourceLink,
    document.createTextNode(` · ${strings[language].visible}: ${visibleCount.toLocaleString('en-US')} / ${strings[language].total}: ${shownAircraft.length.toLocaleString('en-US')}`)
  );
}
function renderAircraft() {
  if (!map) return;
  map.update(filteredAircraft());
  document.querySelectorAll('[data-filter]').forEach((button) => button.classList.toggle('active', button.dataset.filter === filter));
  updateAircraftStatus();
}
function selectAircraft(item) {
  const sameAircraft = selected?.id === item.id;
  selected = aircraft.find((current) => current.id === item.id) || item;
  infoPanelOpen = sameAircraft ? !infoPanelOpen : true;
  map.setSelected(selected.id);
  renderPanel();
}

function renderPanel() {
  const t = strings[language]; const panel = document.querySelector('#panel'); if (!panel) return;
  document.querySelector('.workspace')?.classList.toggle('panel-retracted', !infoPanelOpen);
  if (!selected) { panel.innerHTML = `<h2>${t.map}</h2><p>${t.select}</p><p class="notice">${t.heuristic}</p><p class="notice">${t.disclaimer}</p>`; return; }
  const age = dataAgeSeconds(selected); const stale = isStale(selected);
  const details = [
    [t.callsign, selected.callsign], [t.registration, selected.registration], [t.type, selected.aircraftType], [t.altitude, value(selected.altitudeM * 3.28084, ' ft')],
    [t.speed, value(selected.groundSpeedMps * 1.94384, ' kt')], [t.track, value(selected.track, '°')], [t.vertical, value(selected.verticalRateMps * 196.85, ' ft/min')],
    [t.country, selected.originCountry], [t.classification, classificationLabel(selected)], [t.age, value(age, ' s')], [t.source, selected.source]
  ];
  panel.innerHTML = `<h2>${selected.callsign || selected.id}</h2><div class="detail-grid">${details.map(([label, content]) => `<div class="detail"><small>${label}</small><strong>${content ?? t.unavailable}</strong></div>`).join('')}</div>
    ${stale ? `<p class="notice warning">${t.stale}</p>` : ''}<button id="enter-cockpit" class="action" ${stale || !Number.isFinite(selected.track) || !Number.isFinite(selected.altitudeM) ? 'disabled' : ''}>${t.cockpit}</button><p class="notice">${t.heuristic}</p><p class="notice">${t.disclaimer}</p>`;
  document.querySelector('#enter-cockpit').addEventListener('click', openCockpit);
}

function openCockpit() {
  if (!selected || isStale(selected)) return;
  document.querySelector('#cockpit').classList.remove('hidden');
  map.pause();
  cockpitRenderer = createCockpitRenderer(document.querySelector('#cockpit-scene'), renderCockpitHud);
  if (tiltPermissionGranted) {
    startTiltListening();
    document.querySelector('#enable-tilt').textContent = strings[language].tiltEnabled;
    document.querySelector('#enable-tilt').disabled = true;
    document.querySelector('#center-view').hidden = false;
    document.querySelector('#tilt-status').textContent = strings[language].tiltHint;
  }
  updateCockpit();
}
function closeCockpit() {
  const cockpit = document.querySelector('#cockpit');
  const wasOpen = cockpit && !cockpit.classList.contains('hidden');
  cockpit?.classList.add('hidden'); stopTiltListening(); cockpitRenderer?.destroy(); cockpitRenderer = null; map?.resume();
  if (wasOpen) { infoPanelOpen = false; renderPanel(); }
}
async function enableDeviceTilt() {
  const status = document.querySelector('#tilt-status');
  const t = strings[language];
  if (!window.isSecureContext || !('DeviceOrientationEvent' in window)) {
    status.textContent = t.tiltUnavailable;
    return;
  }
  try {
    if (typeof DeviceOrientationEvent.requestPermission === 'function' && !tiltPermissionGranted) {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== 'granted') { status.textContent = t.tiltDenied; return; }
    }
    tiltPermissionGranted = true;
    startTiltListening();
    document.querySelector('#enable-tilt').textContent = t.tiltEnabled;
    document.querySelector('#enable-tilt').disabled = true;
    document.querySelector('#center-view').hidden = false;
    status.textContent = t.tiltHint;
  } catch {
    status.textContent = t.tiltDenied;
  }
}
function startTiltListening() {
  if (tiltListening) return;
  window.addEventListener('deviceorientation', handleDeviceOrientation);
  window.addEventListener('orientationchange', handleScreenOrientationChange);
  tiltListening = true;
}
function stopTiltListening() {
  if (tiltListening) window.removeEventListener('deviceorientation', handleDeviceOrientation);
  if (tiltListening) window.removeEventListener('orientationchange', handleScreenOrientationChange);
  tiltListening = false;
  tiltBaseline = null;
  latestTilt = null;
  deviceTilt = { pitch: 0, roll: 0 };
}
function orientationAxes(event) {
  if (!Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return null;
  const screenAngle = Number(screen.orientation?.angle);
  const legacyAngle = Number(window.orientation);
  const landscape = window.innerWidth > window.innerHeight;
  const angle = [90, 270, -90].includes(screenAngle) ? screenAngle
    : [90, 270, -90].includes(legacyAngle) ? legacyAngle
      : landscape ? (screen.orientation?.type === 'landscape-secondary' ? 270 : 90)
        : screenAngle === 180 ? 180 : 0;
  if (angle === 90) return { pitch: event.gamma, roll: -event.beta };
  if (angle === 180 || angle === -180) return { pitch: -event.beta, roll: -event.gamma };
  if (angle === 270 || angle === -90) return { pitch: -event.gamma, roll: event.beta };
  return { pitch: event.beta, roll: event.gamma };
}
function handleScreenOrientationChange() {
  tiltBaseline = null;
  deviceTilt = { pitch: 0, roll: 0 };
  cockpitRenderer?.setDeviceTilt(deviceTilt);
}
function handleDeviceOrientation(event) {
  latestTilt = orientationAxes(event);
  if (!latestTilt) return;
  tiltBaseline ||= { ...latestTilt };
  const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));
  const pitchDelta = latestTilt.pitch - tiltBaseline.pitch;
  const pitchInput = Math.sign(pitchDelta) * Math.max(0, Math.abs(pitchDelta) - 1) * 2.5;
  deviceTilt = {
    pitch: clamp(pitchInput, 25),
    roll: clamp(latestTilt.roll - tiltBaseline.roll, 30)
  };
  cockpitRenderer?.setDeviceTilt(deviceTilt);
}
function centerDeviceTilt() {
  if (latestTilt) tiltBaseline = { ...latestTilt };
  deviceTilt = { pitch: 0, roll: 0 };
  cockpitRenderer?.setDeviceTilt(deviceTilt);
  document.querySelector('#tilt-status').textContent = strings[language].tiltHint;
}
function updateCockpit() {
  if (!cockpitRenderer || !selected) return;
  cockpitRenderer.update(selected);
  renderCockpitHud(selected);
}
async function refreshMetar(station = arrivalAirport) {
  const requestId = ++metarRequestId;
  if (!station) { metarWind = null; if (selected) renderCockpitHud(selected); return; }
  try {
    const url = new URL(metarApiUrl);
    url.searchParams.set('icao', station);
    const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`METAR request failed (${response.status})`);
    const records = await response.json();
    if (requestId !== metarRequestId) return;
    const record = Array.isArray(records) ? records[0] : null;
    if (!record) throw new Error('No recent METAR available');
    const numeric = (field) => field === null || field === undefined || field === '' ? null : Number(field);
    const direction = numeric(record.wdir);
    const speed = numeric(record.wspd);
    metarWind = {
      station,
      direction: Number.isFinite(direction) ? direction : null,
      variable: String(record.wdir).toUpperCase() === 'VRB' || /\bVRB\d{2,3}KT\b/.test(record.rawOb || ''),
      speed: Number.isFinite(speed) ? speed : null,
      gust: Number.isFinite(record.wgst) ? record.wgst : null,
      observationTime: record.obsTime || null
    };
  } catch {
    if (requestId !== metarRequestId) return;
    metarWind = { station, unavailable: true };
  }
  if (selected) renderCockpitHud(selected);
}
function renderCockpitHud(displayed) {
  if (!displayed || !cockpitRenderer) return;
  const t = strings[language];
  const speedKt = displayed.groundSpeedMps * 1.94384;
  const altitudeFt = displayed.altitudeM * 3.28084;
  const verticalFpm = displayed.verticalRateMps * 196.85;
  const track = ((displayed.track || 0) + 360) % 360;
  const pitch = Math.atan2(displayed.verticalRateMps || 0, Math.max(1, displayed.groundSpeedMps || 0)) * 180 / Math.PI;
  const fmt = (number) => Number.isFinite(number) ? Math.round(number).toLocaleString('en-US') : '---';
  const windDirection = metarWind?.variable ? 'VRB' : Number.isFinite(metarWind?.direction) ? `${String(Math.round(metarWind.direction) % 360).padStart(3, '0')}°` : '---';
  const windSpeed = Number.isFinite(metarWind?.speed) ? `${fmt(metarWind.speed)}${Number.isFinite(metarWind.gust) ? `G${fmt(metarWind.gust)}` : ''} KT` : '--- KT';
  const windToDirection = Number.isFinite(metarWind?.direction) && Number.isFinite(metarWind?.speed) && metarWind.speed > 0 ? (Math.round(metarWind.direction) + 180) % 360 : null;
  const showIlsCues = altitudeFt < 2000;
  const approach = showIlsCues && !isStale(displayed) && selectedRunway ? ilsDeviation(displayed, selectedRunway) : null;
  const speedTicks = [-40, -20, 0, 20, 40].map((offset, index) => `<g transform="translate(0 ${index * 45})"><line x1="0" x2="18"/><text x="25" y="6">${fmt(speedKt + offset)}</text></g>`).join('');
  const altitudeTicks = [400, 200, 0, -200, -400].map((offset, index) => `<g transform="translate(0 ${index * 45})"><line x1="22" x2="40"/><text x="15" y="6" text-anchor="end">${fmt(altitudeFt + offset)}</text></g>`).join('');
  const headingTicks = [-20, -10, 0, 10, 20].map((offset, index) => {
    const heading = (Math.round(track / 10) * 10 + offset + 360) % 360;
    const label = heading === 0 ? 'N' : heading === 90 ? 'E' : heading === 180 ? 'S' : heading === 270 ? 'W' : String(heading / 10).padStart(2, '0');
    return `<g transform="translate(${index * 70} 0)"><line y2="12"/><text y="32" text-anchor="middle">${label}</text></g>`;
  }).join('');
  const pitchOffset = Math.max(-70, Math.min(70, pitch * 10 + deviceTilt.pitch * 4));
  const markerX = 500 + deviceTilt.roll * 4;
  const markerY = 300 + deviceTilt.pitch * 4;
  document.querySelector('#hud').innerHTML = `
    <svg class="hud-svg" viewBox="0 0 1000 600" role="img" aria-label="${t.simulated}">
      <g class="hud-glow">
        <text class="hud-mode" x="500" y="30" text-anchor="middle">SIMULATED COCKPIT VIEW · ${displayed.callsign || displayed.id}</text>
        <g class="wind-compass" transform="translate(56 52)">
          <circle r="25"/><text x="0" y="-29" text-anchor="middle">N</text><text x="30" y="4" text-anchor="middle">E</text><text x="0" y="35" text-anchor="middle">S</text><text x="-30" y="4" text-anchor="middle">W</text>
          ${windToDirection === null ? '' : `<g class="wind-arrow" transform="rotate(${windToDirection})"><path d="M0 -17 L-5 3 L0 0 L5 3 Z"/></g>`}
        </g>
        <text class="wind-station" x="92" y="38">WIND ${metarWind?.station || '—'}</text>
        <text class="wind-readout" x="92" y="57">${windDirection} / ${windSpeed}</text>
        <g class="bank-scale" transform="translate(500 80) rotate(${deviceTilt.roll})">
          <path d="M-125 25 A128 128 0 0 1 125 25"/>
          <line x1="-112" y1="-8" x2="-101" y2="1"/><line x1="-82" y1="-35" x2="-73" y2="-23"/><line x1="-43" y1="-51" x2="-38" y2="-36"/>
          <line x1="0" y1="-58" x2="0" y2="-40"/><line x1="43" y1="-51" x2="38" y2="-36"/><line x1="82" y1="-35" x2="73" y2="-23"/><line x1="112" y1="-8" x2="101" y2="1"/>
          <path class="bank-pointer" d="M-9 -30 L0 -13 L9 -30 Z"/>
        </g>
        <g class="heading-scale" transform="translate(360 105)">${headingTicks}<path class="heading-caret" d="M131 45 L140 57 L149 45"/></g>
        <g class="speed-scale" transform="translate(115 190)"><text class="tape-title" x="0" y="-24">GS KT</text>${speedTicks}<path class="tape-box" d="M-20 77 H78 V106 H-20 L-34 92 Z"/><text class="tape-value" x="28" y="99" text-anchor="middle">${fmt(speedKt)}</text></g>
        <g class="altitude-scale" transform="translate(825 190)"><text class="tape-title" x="40" y="-24" text-anchor="end">ALT FT</text>${altitudeTicks}<path class="tape-box" d="M-38 77 H60 V106 H-38 Z"/><text class="tape-value" x="12" y="99" text-anchor="middle">${fmt(altitudeFt)}</text></g>
        <g class="pitch-ladder-svg" transform="translate(500 ${300 + pitchOffset}) rotate(${deviceTilt.roll})">
          <g transform="translate(0 -85)"><text x="-128" y="5">+10</text><line x1="-95" x2="-28"/><line x1="28" x2="95"/><text x="108" y="5">+10</text></g>
          <g transform="translate(0 -43)"><text x="-120" y="5">+5</text><line x1="-82" x2="-28"/><line x1="28" x2="82"/><text x="103" y="5">+5</text></g>
          <g class="horizon"><line x1="-260" x2="-55"/><line x1="55" x2="260"/><circle r="5"/></g>
          <g transform="translate(0 43)"><text x="-116" y="5">−5</text><line class="dash" x1="-82" x2="-28"/><line class="dash" x1="28" x2="82"/><text x="103" y="5">−5</text></g>
          <g transform="translate(0 85)"><text x="-124" y="5">−10</text><line class="dash" x1="-95" x2="-28"/><line class="dash" x1="28" x2="95"/><text x="108" y="5">−10</text></g>
        </g>
        <g class="flight-path-marker" transform="translate(${markerX} ${markerY})"><circle r="13"/><line x1="-58" x2="-13"/><line x1="13" x2="58"/><line x1="-58" y1="0" x2="-58" y2="15"/><line x1="58" y1="0" x2="58" y2="15"/><line y1="-22" y2="-13"/></g>
        ${showIlsCues ? `
          <g class="ils-glideslope" transform="translate(775 325)">
            <text x="0" y="-75" text-anchor="middle">G/S</text><line y1="-58" y2="58"/><line x1="-8" x2="8" y1="-58"/><line x1="-8" x2="8" y1="58"/><line x1="-5" x2="5"/>
            ${approach ? `<g class="ils-glideslope-marker" transform="translate(0 ${Math.max(-50, Math.min(50, approach.glideslopeOffsetPx - deviceTilt.pitch * 2))})"><path d="M-7 0 L0 -7 L7 0 L0 7 Z"/></g>` : ''}
          </g>
          <g class="ils-localizer" transform="translate(500 450)">
            <text x="0" y="-24" text-anchor="middle">LOC</text><line x1="-58" x2="58"/><line y1="-8" y2="8"/><line x1="-58" x2="-58" y1="-8" y2="8"/><line x1="58" x2="58" y1="-8" y2="8"/>
            ${approach ? `<g class="ils-localizer-marker" transform="translate(${Math.max(-50, Math.min(50, approach.localizerOffsetPx - deviceTilt.roll * 2))} 0)"><path d="M0 -7 L7 0 L0 7 L-7 0 Z"/></g>` : ''}
          </g>
          <text class="ils-runway-label" x="500" y="410" text-anchor="middle">ILS SIM · ${selectedRunway ? `${selectedRunway.airport} ${selectedRunway.runway} · ${approach ? `${fmt(approach.distanceNm)} NM` : 'NO APPROACH DATA'}` : 'NO RUNWAY SELECTED'}</text>` : ''}
        <text class="vertical-rate-text" x="865" y="430" text-anchor="middle">V/S ${verticalFpm >= 0 ? '+' : '−'}${fmt(Math.abs(verticalFpm))} FPM</text>
        <g class="nav-arc" transform="translate(500 570)"><path d="M-110 15 A112 112 0 0 1 110 15"/><line x1="-94" y1="-43" x2="-82" y2="-35"/><line x1="-55" y1="-80" x2="-47" y2="-67"/><line y1="-94" y2="-77"/><line x1="55" y1="-80" x2="47" y2="-67"/><line x1="94" y1="-43" x2="82" y2="-35"/><path d="M-8 -70 L0 -84 L8 -70"/><text x="0" y="-44" text-anchor="middle">TRK ${fmt(track)}°</text></g>
        <text class="hud-age" x="25" y="575">DATA ${fmt(dataAgeSeconds(displayed))}s · ${displayed.source}</text>
      </g>
    </svg>`;
}
async function refresh() {
  const status = document.querySelector('#status'); if (!status) return;
  try {
    let liveError = null;
    if (providerName === 'live' && navigator.onLine) {
      try { aircraft = await liveProvider.getAircraft(searchLocation); activeProviderName = 'live'; hasLiveData = true; }
      catch (error) {
        liveError = error;
        if (!hasLiveData) { aircraft = await mockProvider.getAircraft(); activeProviderName = 'mock'; }
      }
    } else if (providerName === 'live') {
      liveError = new Error(strings[language].offline); aircraft = await mockProvider.getAircraft(); activeProviderName = 'mock';
    } else {
      aircraft = await mockProvider.getAircraft(); activeProviderName = 'mock';
    }
    if (selected) selected = aircraft.find((item) => item.id === selected.id) || null;
    map.setSelected(selected?.id || null);
    lastLiveError = liveError;
    renderAircraft(); renderPanel(); updateCockpit();
  } catch (error) { status.className = 'status error'; status.textContent = navigator.onLine ? error.message : strings[language].offline; }
}

window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); deferredInstallPrompt = event; const install = document.querySelector('#install'); if (install) install.hidden = false; });
window.addEventListener('online', refresh); window.addEventListener('offline', refresh);
renderShell(); initialize(); refresh(); refreshMetar(); setInterval(refresh, 30000); setInterval(() => refreshMetar(), 300000);
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    if (import.meta.env.PROD) {
      await navigator.serviceWorker.register('./sw.js');
      return;
    }
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    if ('caches' in window) await Promise.all((await caches.keys()).filter((key) => key.startsWith('flight-cockpit-')).map((key) => caches.delete(key)));
  });
}
