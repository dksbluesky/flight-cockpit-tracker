import './styles.css';
import { strings } from './i18n/strings.js';
import { createMockProvider } from './providers/mock.js';
import { createLiveProvider } from './providers/live.js';
import { createTrackingMap } from './renderers/map.js';
import { createCockpitRenderer } from './renderers/cockpit.js';
import { dataAgeSeconds, isStale } from './domain/aircraft.js';

const providerName = import.meta.env.VITE_AIRCRAFT_PROVIDER === 'mock' ? 'mock' : 'live';
const mockProvider = createMockProvider();
const liveProvider = createLiveProvider(import.meta.env.VITE_LIVE_API_URL || 'http://127.0.0.1:8787/api/aircraft');
let activeProviderName = providerName;
let hasLiveData = false; let lastLiveError = null;
let language = localStorage.getItem('fct-language') || (navigator.language.startsWith('zh') ? 'zh-TW' : 'en');
let filter = 'all'; let aircraft = []; let selected = null; let cockpitRenderer = null; let deferredInstallPrompt = null;
const app = document.querySelector('#app');

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
      </nav></div><aside id="panel" class="panel"></aside></section>
    </main>
    <section id="cockpit" class="cockpit hidden" aria-label="${t.simulated}"><h1 class="cockpit-title">${t.simulated}</h1><div id="cockpit-scene"></div><div id="hud" class="hud"></div><button id="return" class="action return">← ${t.return}</button></section>`;
  document.querySelector('#language').value = language;
  document.querySelector('#language').addEventListener('change', (event) => { language = event.target.value; localStorage.setItem('fct-language', language); map.destroy(); closeCockpit(); renderShell(); initialize(); });
  document.querySelectorAll('[data-filter]').forEach((button) => { button.classList.toggle('active', button.dataset.filter === filter); button.addEventListener('click', () => { filter = button.dataset.filter; renderAircraft(); }); });
  document.querySelector('#return').addEventListener('click', closeCockpit);
  const install = document.querySelector('#install');
  if (deferredInstallPrompt) install.hidden = false;
  install.addEventListener('click', async () => { if (deferredInstallPrompt) { deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; install.hidden = true; } });
}

let map;
function scheduleViewportRefresh() { updateAircraftStatus(); }
function initialize() { map = createTrackingMap(document.querySelector('#map'), selectAircraft, scheduleViewportRefresh); renderPanel(); renderAircraft(); }
function filteredAircraft() { return filter === 'all' ? aircraft : aircraft.filter((item) => item.classification === filter); }
function updateAircraftStatus() {
  const status = document.querySelector('#status'); if (!status || !map) return;
  const shownAircraft = filteredAircraft();
  const visibleCount = map.countVisible(shownAircraft);
  const label = lastLiveError && activeProviderName === 'live' ? strings[language].delayed : activeProviderName === 'live' ? strings[language].live : lastLiveError ? strings[language].fallback : strings[language].mock;
  status.className = lastLiveError ? 'status error' : 'status';
  status.textContent = `${label} · ${strings[language].visible}: ${visibleCount.toLocaleString('en-US')} / ${strings[language].total}: ${shownAircraft.length.toLocaleString('en-US')}`;
}
function renderAircraft() {
  if (!map) return;
  map.update(filteredAircraft());
  document.querySelectorAll('[data-filter]').forEach((button) => button.classList.toggle('active', button.dataset.filter === filter));
  updateAircraftStatus();
}
function selectAircraft(item) {
  selected = aircraft.find((current) => current.id === item.id) || item;
  map.setSelected(selected.id);
  renderPanel();
}

function renderPanel() {
  const t = strings[language]; const panel = document.querySelector('#panel'); if (!panel) return;
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
  cockpitRenderer = createCockpitRenderer(document.querySelector('#cockpit-scene'));
  updateCockpit();
}
function closeCockpit() { document.querySelector('#cockpit')?.classList.add('hidden'); cockpitRenderer?.destroy(); cockpitRenderer = null; }
function updateCockpit() {
  if (!cockpitRenderer || !selected) return;
  cockpitRenderer.update(selected); const t = strings[language];
  const speedKt = selected.groundSpeedMps * 1.94384;
  const altitudeFt = selected.altitudeM * 3.28084;
  const verticalFpm = selected.verticalRateMps * 196.85;
  const track = ((selected.track || 0) + 360) % 360;
  const pitch = Math.atan2(selected.verticalRateMps || 0, Math.max(1, selected.groundSpeedMps || 0)) * 180 / Math.PI;
  const fmt = (number) => Number.isFinite(number) ? Math.round(number).toLocaleString('en-US') : '---';
  const speedTicks = [-40, -20, 0, 20, 40].map((offset, index) => `<g transform="translate(0 ${index * 45})"><line x1="0" x2="18"/><text x="25" y="6">${fmt(speedKt + offset)}</text></g>`).join('');
  const altitudeTicks = [400, 200, 0, -200, -400].map((offset, index) => `<g transform="translate(0 ${index * 45})"><line x1="22" x2="40"/><text x="15" y="6" text-anchor="end">${fmt(altitudeFt + offset)}</text></g>`).join('');
  const headingTicks = [-20, -10, 0, 10, 20].map((offset, index) => {
    const heading = (Math.round(track / 10) * 10 + offset + 360) % 360;
    const label = heading === 0 ? 'N' : heading === 90 ? 'E' : heading === 180 ? 'S' : heading === 270 ? 'W' : String(heading / 10).padStart(2, '0');
    return `<g transform="translate(${index * 70} 0)"><line y2="12"/><text y="32" text-anchor="middle">${label}</text></g>`;
  }).join('');
  const pitchOffset = Math.max(-70, Math.min(70, pitch * 10));
  document.querySelector('#hud').innerHTML = `
    <svg class="hud-svg" viewBox="0 0 1000 600" role="img" aria-label="${t.simulated}">
      <g class="hud-glow">
        <text class="hud-mode" x="500" y="30" text-anchor="middle">SIMULATED COCKPIT VIEW · ${selected.callsign || selected.id}</text>
        <g class="bank-scale" transform="translate(500 80)">
          <path d="M-125 25 A128 128 0 0 1 125 25"/>
          <line x1="-112" y1="-8" x2="-101" y2="1"/><line x1="-82" y1="-35" x2="-73" y2="-23"/><line x1="-43" y1="-51" x2="-38" y2="-36"/>
          <line x1="0" y1="-58" x2="0" y2="-40"/><line x1="43" y1="-51" x2="38" y2="-36"/><line x1="82" y1="-35" x2="73" y2="-23"/><line x1="112" y1="-8" x2="101" y2="1"/>
          <path class="bank-pointer" d="M-9 -30 L0 -13 L9 -30 Z"/>
        </g>
        <g class="heading-scale" transform="translate(360 105)">${headingTicks}<path class="heading-caret" d="M131 45 L140 57 L149 45"/></g>
        <g class="speed-scale" transform="translate(115 190)"><text class="tape-title" x="0" y="-24">GS KT</text>${speedTicks}<path class="tape-box" d="M-20 77 H78 V106 H-20 L-34 92 Z"/><text class="tape-value" x="28" y="99" text-anchor="middle">${fmt(speedKt)}</text></g>
        <g class="altitude-scale" transform="translate(825 190)"><text class="tape-title" x="40" y="-24" text-anchor="end">ALT FT</text>${altitudeTicks}<path class="tape-box" d="M-38 77 H60 L74 92 L60 106 H-38 Z"/><text class="tape-value" x="12" y="99" text-anchor="middle">${fmt(altitudeFt)}</text></g>
        <g class="pitch-ladder-svg" transform="translate(500 ${300 + pitchOffset})">
          <g transform="translate(0 -85)"><text x="-128" y="5">+10</text><line x1="-95" x2="-28"/><line x1="28" x2="95"/><text x="108" y="5">+10</text></g>
          <g transform="translate(0 -43)"><text x="-120" y="5">+5</text><line x1="-82" x2="-28"/><line x1="28" x2="82"/><text x="103" y="5">+5</text></g>
          <g class="horizon"><line x1="-260" x2="-55"/><line x1="55" x2="260"/><circle r="5"/></g>
          <g transform="translate(0 43)"><text x="-116" y="5">−5</text><line class="dash" x1="-82" x2="-28"/><line class="dash" x1="28" x2="82"/><text x="103" y="5">−5</text></g>
          <g transform="translate(0 85)"><text x="-124" y="5">−10</text><line class="dash" x1="-95" x2="-28"/><line class="dash" x1="28" x2="95"/><text x="108" y="5">−10</text></g>
        </g>
        <g class="flight-path-marker" transform="translate(500 300)"><circle r="13"/><line x1="-58" x2="-13"/><line x1="13" x2="58"/><line x1="-58" y1="0" x2="-58" y2="15"/><line x1="58" y1="0" x2="58" y2="15"/><line y1="-22" y2="-13"/></g>
        <text class="vertical-rate-text" x="865" y="430" text-anchor="middle">V/S ${verticalFpm >= 0 ? '+' : '−'}${fmt(Math.abs(verticalFpm))} FPM</text>
        <g class="nav-arc" transform="translate(500 570)"><path d="M-110 15 A112 112 0 0 1 110 15"/><line x1="-94" y1="-43" x2="-82" y2="-35"/><line x1="-55" y1="-80" x2="-47" y2="-67"/><line y1="-94" y2="-77"/><line x1="55" y1="-80" x2="47" y2="-67"/><line x1="94" y1="-43" x2="82" y2="-35"/><path d="M-8 -70 L0 -84 L8 -70"/><text x="0" y="-44" text-anchor="middle">TRK ${fmt(track)}°</text></g>
        <text class="hud-age" x="25" y="575">DATA ${fmt(dataAgeSeconds(selected))}s · ${selected.source}</text>
      </g>
    </svg>`;
}
async function refresh() {
  const status = document.querySelector('#status'); if (!status) return;
  try {
    let liveError = null;
    if (providerName === 'live' && navigator.onLine) {
      try { aircraft = await liveProvider.getAircraft(); activeProviderName = 'live'; hasLiveData = true; }
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
renderShell(); initialize(); refresh(); setInterval(refresh, 10000);
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
