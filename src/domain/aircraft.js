const MILITARY_CALLSIGN_PREFIXES = ['RCH', 'USAF', 'NAVY', 'ARMY', 'ROCAF', 'CNV', 'EVAC'];

export function classifyAircraft(aircraft) {
  const callsign = (aircraft.callsign || '').toUpperCase().replace(/\s/g, '');
  const possible = MILITARY_CALLSIGN_PREFIXES.some((prefix) => callsign.startsWith(prefix));
  return possible ? 'possible-military' : callsign ? 'civilian' : 'unknown';
}

export function dataAgeSeconds(aircraft, nowMs = Date.now()) {
  if (!Number.isFinite(aircraft.lastContact)) return Infinity;
  return Math.max(0, (nowMs - aircraft.lastContact) / 1000);
}

export function isStale(aircraft, nowMs = Date.now(), thresholdSeconds = 30) {
  return dataAgeSeconds(aircraft, nowMs) > thresholdSeconds;
}

export function interpolateAircraft(previous, next, fraction) {
  const t = Math.min(1, Math.max(0, fraction));
  const lerp = (a, b) => Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * t : (b ?? a ?? null);
  const shortestTrackDelta = ((next.track - previous.track + 540) % 360) - 180;
  return {
    ...previous,
    ...next,
    latitude: lerp(previous.latitude, next.latitude),
    longitude: lerp(previous.longitude, next.longitude),
    altitudeM: lerp(previous.altitudeM, next.altitudeM),
    track: Number.isFinite(previous.track) && Number.isFinite(next.track)
      ? (previous.track + shortestTrackDelta * t + 360) % 360
      : next.track ?? previous.track ?? null
  };
}

export function isPossibleApproach(aircraft) {
  const altitudeFt = Number.isFinite(aircraft.altitudeM) ? aircraft.altitudeM * 3.28084 : Infinity;
  const speedKt = Number.isFinite(aircraft.groundSpeedMps) ? aircraft.groundSpeedMps * 1.94384 : Infinity;
  return !aircraft.onGround && altitudeFt <= 5000 && speedKt <= 250 && Number.isFinite(aircraft.verticalRateMps) && aircraft.verticalRateMps < 0;
}