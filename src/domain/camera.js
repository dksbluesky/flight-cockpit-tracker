const EARTH_RADIUS_M = 6371000;
const METERS_PER_FOOT = 0.3048;

export function shouldShowSurface(altitudeM, thresholdFt = 3000) {
  return Number.isFinite(altitudeM) && altitudeM <= thresholdFt * METERS_PER_FOOT;
}

export function localOffsetMeters(origin, position) {
  if (![origin.latitude, origin.longitude, position.latitude, position.longitude].every(Number.isFinite)) return null;
  const meanLatitude = (origin.latitude + position.latitude) * Math.PI / 360;
  return {
    eastM: (position.longitude - origin.longitude) * Math.PI / 180 * EARTH_RADIUS_M * Math.cos(meanLatitude),
    northM: (position.latitude - origin.latitude) * Math.PI / 180 * EARTH_RADIUS_M
  };
}

export function destinationPoint(latitude, longitude, trackDegrees, distanceM) {
  const angularDistance = distanceM / EARTH_RADIUS_M;
  const bearing = trackDegrees * Math.PI / 180;
  const lat1 = latitude * Math.PI / 180;
  const lon1 = longitude * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1), Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2));
  return { latitude: lat2 * 180 / Math.PI, longitude: ((lon2 * 180 / Math.PI + 540) % 360) - 180 };
}

export function cockpitCamera(aircraft, lookAheadSeconds = 12) {
  if (![aircraft.latitude, aircraft.longitude, aircraft.altitudeM, aircraft.track].every(Number.isFinite)) return null;
  const speed = Number.isFinite(aircraft.groundSpeedMps) ? aircraft.groundSpeedMps : 0;
  const target = destinationPoint(aircraft.latitude, aircraft.longitude, aircraft.track, Math.max(500, speed * lookAheadSeconds));
  const climb = Number.isFinite(aircraft.verticalRateMps) ? aircraft.verticalRateMps * lookAheadSeconds : 0;
  return {
    position: { latitude: aircraft.latitude, longitude: aircraft.longitude, altitudeM: aircraft.altitudeM },
    target: { ...target, altitudeM: Math.max(0, aircraft.altitudeM + climb) },
    track: aircraft.track
  };
}
