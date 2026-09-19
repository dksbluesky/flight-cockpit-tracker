import test from 'node:test';
import assert from 'node:assert/strict';
import { cockpitCamera, destinationPoint, localOffsetMeters, shouldShowSurface } from '../src/domain/camera.js';

test('destination due north keeps longitude and raises latitude', () => {
  const point = destinationPoint(23.5, 121, 0, 1000);
  assert.ok(point.latitude > 23.5);
  assert.ok(Math.abs(point.longitude - 121) < 0.000001);
});

test('cockpit camera uses position, track, speed and climb', () => {
  const camera = cockpitCamera({ latitude: 23.5, longitude: 121, altitudeM: 5000, track: 90, groundSpeedMps: 200, verticalRateMps: 5 }, 10);
  assert.deepEqual(camera.position, { latitude: 23.5, longitude: 121, altitudeM: 5000 });
  assert.ok(camera.target.longitude > 121);
  assert.equal(camera.target.altitudeM, 5050);
});

test('cockpit camera rejects missing required flight data', () => {
  assert.equal(cockpitCamera({ latitude: 23, longitude: 121, altitudeM: null, track: 90 }), null);
});

test('local offset converts coordinate changes to east and north movement', () => {
  const offset = localOffsetMeters({ latitude: 23.5, longitude: 121 }, { latitude: 23.509, longitude: 121.0098 });
  assert.ok(offset.eastM > 990 && offset.eastM < 1010);
  assert.ok(offset.northM > 990 && offset.northM < 1010);
});
test('terrain visibility uses the 3,000 ft threshold', () => {
  assert.equal(shouldShowSurface(914.4), true);
  assert.equal(shouldShowSurface(914.5), false);
  assert.equal(shouldShowSurface(null), false);
});