import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAircraft, dataAgeSeconds, interpolateAircraft, isPossibleApproach, isStale } from '../src/domain/aircraft.js';

test('military classification is conservative and heuristic', () => {
  assert.equal(classifyAircraft({ callsign: 'RCH301' }), 'possible-military');
  assert.equal(classifyAircraft({ callsign: 'CAL511' }), 'civilian');
  assert.equal(classifyAircraft({ callsign: null }), 'unknown');
});

test('data age and stale threshold use last contact', () => {
  const now = 1_000_000;
  assert.equal(dataAgeSeconds({ lastContact: now - 12_000 }, now), 12);
  assert.equal(isStale({ lastContact: now - 31_000 }, now), true);
  assert.equal(isStale({ lastContact: now - 30_000 }, now), false);
});

test('interpolation clamps time and crosses north via shortest track path', () => {
  const previous = { latitude: 23, longitude: 121, altitudeM: 1000, track: 350 };
  const next = { latitude: 25, longitude: 123, altitudeM: 3000, track: 10 };
  const middle = interpolateAircraft(previous, next, 0.5);
  assert.deepEqual([middle.latitude, middle.longitude, middle.altitudeM], [24, 122, 2000]);
  assert.equal(middle.track, 0);
  assert.equal(interpolateAircraft(previous, next, 2).latitude, 25);
});

test('possible approach heuristic requires low descending flight', () => {
  assert.equal(isPossibleApproach({ altitudeM: 500, groundSpeedMps: 80, verticalRateMps: -3, onGround: false }), true);
  assert.equal(isPossibleApproach({ altitudeM: 3000, groundSpeedMps: 80, verticalRateMps: -3, onGround: false }), false);
  assert.equal(isPossibleApproach({ altitudeM: 500, groundSpeedMps: 80, verticalRateMps: 2, onGround: false }), false);
});