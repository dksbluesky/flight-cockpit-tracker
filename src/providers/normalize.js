import { classifyAircraft } from '../domain/aircraft.js';

const clean = (value) => typeof value === 'string' ? value.trim() || null : value ?? null;

export function normalizeOpenSkyState(state, responseTimeSeconds, nowMs = Date.now()) {
  const aircraft = {
    id: clean(state[0]),
    callsign: clean(state[1]),
    originCountry: clean(state[2]),
    lastPosition: Number.isFinite(state[3]) ? state[3] * 1000 : null,
    lastContact: Number.isFinite(state[4]) ? state[4] * 1000 : responseTimeSeconds * 1000,
    longitude: state[5] ?? null,
    latitude: state[6] ?? null,
    altitudeM: state[13] ?? state[7] ?? null,
    onGround: Boolean(state[8]),
    groundSpeedMps: state[9] ?? null,
    track: state[10] ?? null,
    heading: state[10] ?? null,
    verticalRateMps: state[11] ?? null,
    registration: null,
    aircraftType: null,
    source: 'OpenSky Network',
    receivedAt: nowMs
  };
  aircraft.classification = classifyAircraft(aircraft);
  return aircraft;
}

export function normalizeOpenSkyResponse(payload, nowMs = Date.now()) {
  if (!payload || !Array.isArray(payload.states)) throw new TypeError('Invalid OpenSky state-vector response');
  return payload.states.map((state) => normalizeOpenSkyState(state, payload.time, nowMs))
    .filter((aircraft) => Number.isFinite(aircraft.latitude) && Number.isFinite(aircraft.longitude));
}

const feetToMeters = (feet) => Number.isFinite(feet) ? feet * 0.3048 : null;
const knotsToMetersPerSecond = (knots) => Number.isFinite(knots) ? knots * 0.514444 : null;
const feetPerMinuteToMetersPerSecond = (rate) => Number.isFinite(rate) ? rate * 0.00508 : null;

export function normalizeAdsbLolAircraft(state, nowMs = Date.now()) {
  const altitudeFeet = Number.isFinite(state.alt_geom) ? state.alt_geom : Number.isFinite(state.alt_baro) ? state.alt_baro : null;
  const verticalRate = Number.isFinite(state.geom_rate) ? state.geom_rate : state.baro_rate;
  const aircraft = {
    id: clean(state.hex),
    callsign: clean(state.flight),
    originCountry: null,
    lastPosition: Number.isFinite(state.seen_pos) ? nowMs - state.seen_pos * 1000 : null,
    lastContact: Number.isFinite(state.seen) ? nowMs - state.seen * 1000 : nowMs,
    longitude: state.lon ?? null,
    latitude: state.lat ?? null,
    altitudeM: feetToMeters(altitudeFeet),
    onGround: state.alt_baro === 'ground',
    groundSpeedMps: knotsToMetersPerSecond(state.gs),
    track: state.track ?? null,
    heading: state.true_heading ?? state.mag_heading ?? state.track ?? null,
    verticalRateMps: feetPerMinuteToMetersPerSecond(verticalRate),
    registration: clean(state.r),
    aircraftType: clean(state.t),
    source: 'adsb.lol',
    receivedAt: nowMs
  };
  aircraft.classification = classifyAircraft(aircraft);
  return aircraft;
}

export function normalizeAdsbLolResponse(payload, nowMs = Date.now()) {
  if (!payload || !Array.isArray(payload.ac)) throw new TypeError('Invalid adsb.lol aircraft response');
  return payload.ac.map((state) => normalizeAdsbLolAircraft(state, nowMs))
    .filter((aircraft) => aircraft.id && Number.isFinite(aircraft.latitude) && Number.isFinite(aircraft.longitude));
}