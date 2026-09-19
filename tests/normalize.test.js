import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAdsbLolResponse, normalizeOpenSkyResponse } from '../src/providers/normalize.js';

test('normalizes state-vector units and removes states without position', () => {
  const payload = { time: 100, states: [
    ['8990a1', ' CAL511 ', 'Taiwan', 99, 100, 121.2, 25.1, 3000, false, 200, 45, 2, null, 3100, null, false, 0, 6],
    ['bad', null, null, null, 100, null, null, null, false, null, null, null]
  ] };
  const [aircraft] = normalizeOpenSkyResponse(payload, 101000);
  assert.equal(aircraft.callsign, 'CAL511');
  assert.equal(aircraft.altitudeM, 3100);
  assert.equal(aircraft.groundSpeedMps, 200);
  assert.equal(aircraft.lastContact, 100000);
  assert.equal(aircraft.classification, 'civilian');
});

test('rejects malformed provider response', () => {
  assert.throws(() => normalizeOpenSkyResponse({}), /Invalid OpenSky/);
});

test('normalizes adsb.lol aircraft units and metadata', () => {
  const payload = { ac: [{ hex: '7892a2', flight: ' CRK231 ', r: 'B-LPU', t: 'A320', alt_geom: 38700, gs: 448.7, track: 220.93, geom_rate: 32, true_heading: 217.59, mag_heading: 222.54, lat: 25.44, lon: 120.25, seen: 1.5, seen_pos: 2 }] };
  const [aircraft] = normalizeAdsbLolResponse(payload, 100000);
  assert.equal(aircraft.callsign, 'CRK231');
  assert.equal(aircraft.registration, 'B-LPU');
  assert.equal(aircraft.aircraftType, 'A320');
  assert.ok(Math.abs(aircraft.altitudeM - 11795.76) < 0.01);
  assert.ok(Math.abs(aircraft.groundSpeedMps - 230.83) < 0.1);
  assert.equal(aircraft.lastContact, 98500);
  assert.equal(aircraft.heading, 217.59);
  assert.equal(aircraft.source, 'adsb.lol');
});

test('rejects malformed adsb.lol response', () => {
  assert.throws(() => normalizeAdsbLolResponse({}), /Invalid adsb.lol/);
});