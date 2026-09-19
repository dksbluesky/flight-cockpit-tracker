import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { isPossibleApproach } from '../domain/aircraft.js';

export function createTrackingMap(container, onSelect, onViewportChange = () => {}, initialView = {}) {
  const entries = new Map();
  let selectedId = null;
  let animationFrame;
  let paused = false;
  let trailReady = false;

  const map = new maplibregl.Map({
    container,
    center: initialView.center || [120.96, 23.7],
    zoom: initialView.zoom ?? 6.25,
    style: {
      version: 8,
      sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
    }
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
  map.on('moveend', onViewportChange);

  function trailData() {
    return {
      type: 'FeatureCollection',
      features: [...entries.values()].filter((entry) => entry.trail.length > 1).map((entry) => ({
        type: 'Feature', properties: { approach: entry.approach ? 1 : 0 }, geometry: { type: 'LineString', coordinates: entry.trail }
      }))
    };
  }

  function updateTrails() {
    if (trailReady) map.getSource('aircraft-trails').setData(trailData());
  }

  map.on('load', () => {
    map.addSource('aircraft-trails', { type: 'geojson', data: trailData() });
    map.addLayer({ id: 'aircraft-trails', type: 'line', source: 'aircraft-trails', paint: {
      'line-color': ['case', ['==', ['get', 'approach'], 1], '#ff7657', '#20bcae'],
      'line-width': ['case', ['==', ['get', 'approach'], 1], 3, 2],
      'line-opacity': 0.72
    } });
    trailReady = true;
    updateTrails();
  });

  function createMarker(aircraft, coordinate) {
    const root = document.createElement('div');
    root.style.width = '34px';
    root.style.height = '34px';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'aircraft-marker';
    const icon = document.createElement('span');
    icon.className = 'marker-icon';
    icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5c-1 0-1.55 1.05-1.55 2.2v5.05L3.2 13.1v2.25l7.25-2.15v4.65l-2.15 1.5v1.65L12 20l3.7 1v-1.65l-2.15-1.5V13.2l7.25 2.15V13.1l-7.25-4.35V3.7C13.55 2.55 13 1.5 12 1.5Z"/></svg>';
    const label = document.createElement('span');
    label.className = 'marker-label';
    button.append(icon, label);
    root.append(button);
    const marker = new maplibregl.Marker({ element: root, anchor: 'center' }).setLngLat(coordinate).addTo(map);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      selectedId = aircraft.id;
      updateMarkerStyles();
      onSelect(entries.get(aircraft.id)?.aircraft || aircraft);
    });
    return { marker, button, label, current: coordinate, from: coordinate, target: coordinate, startedAt: performance.now(), trail: [coordinate], approach: false, aircraft };
  }

  function updateMarkerStyles() {
    for (const entry of entries.values()) {
      const { aircraft, button, label } = entry;
      button.className = `aircraft-marker ${aircraft.classification || 'unknown'}${entry.approach ? ' possible-approach' : ''}${aircraft.id === selectedId ? ' selected' : ''}`;
      button.style.setProperty('--heading', `${aircraft.track ?? aircraft.heading ?? 0}deg`);
      label.textContent = aircraft.callsign || aircraft.registration || aircraft.id.toUpperCase();
    }
  }

  function animate(time) {
    if (paused) return;
    let trailsChanged = false;
    for (const entry of entries.values()) {
      const progress = Math.min(1, (time - entry.startedAt) / 2800);
      const eased = progress * progress * (3 - 2 * progress);
      const next = [entry.from[0] + (entry.target[0] - entry.from[0]) * eased, entry.from[1] + (entry.target[1] - entry.from[1]) * eased];
      if (next[0] !== entry.current[0] || next[1] !== entry.current[1]) {
        entry.current = next;
        entry.marker.setLngLat(next);
        trailsChanged = true;
      }
    }
    if (trailsChanged) updateTrails();
    animationFrame = requestAnimationFrame(animate);
  }
  animationFrame = requestAnimationFrame(animate);

  return {
    update(aircraftList) {
      const ids = new Set(aircraftList.map((item) => item.id));
      for (const [id, entry] of entries) {
        if (!ids.has(id)) { entry.marker.remove(); entries.delete(id); }
      }
      for (const aircraft of aircraftList) {
        const coordinate = [aircraft.longitude, aircraft.latitude];
        let entry = entries.get(aircraft.id);
        if (!entry) {
          entry = createMarker(aircraft, coordinate);
          entries.set(aircraft.id, entry);
        }
        const previousPoint = entry.trail.at(-1);
        if (!previousPoint || Math.abs(previousPoint[0] - coordinate[0]) > 0.00005 || Math.abs(previousPoint[1] - coordinate[1]) > 0.00005) entry.trail.push(coordinate);
        entry.trail = entry.trail.slice(-10);
        entry.aircraft = aircraft;
        entry.approach = isPossibleApproach(aircraft);
        entry.from = entry.current;
        entry.target = coordinate;
        entry.startedAt = performance.now();
      }
      updateMarkerStyles();
      updateTrails();
    },
    setSelected(id) { selectedId = id || null; updateMarkerStyles(); },
    countVisible(aircraftList) {
      const bounds = map.getBounds();
      return aircraftList.filter((aircraft) => bounds.contains([aircraft.longitude, aircraft.latitude])).length;
    },
    goTo: (longitude, latitude) => map.flyTo({ center: [longitude, latitude], zoom: 6.25, essential: true }),
    getView: () => ({ center: map.getCenter().toArray(), zoom: map.getZoom() }),
    resize: () => map.resize(),
    pause: () => { paused = true; cancelAnimationFrame(animationFrame); },
    resume: () => { if (!paused) return; paused = false; animationFrame = requestAnimationFrame(animate); map.resize(); },
    destroy: () => {
      cancelAnimationFrame(animationFrame);
      for (const entry of entries.values()) entry.marker.remove();
      map.remove();
    }
  };
}
