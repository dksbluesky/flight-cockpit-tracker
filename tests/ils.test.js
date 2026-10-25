import test from 'node:test';
import assert from 'node:assert/strict';
import { ilsDeviation } from '../src/domain/ils.js';

const runway = { latitude: 25, longitude: 121, elevationFt: 0, headingDeg: 0 };
const fromRunway = (eastM, northM, altitudeFt) => ({
  latitude: runway.latitude + northM / 111195,
  longitude: runway.longitude + eastM / (111195 * Math.cos(runway.latitude * Math.PI / 180)),
  altitudeM: altitudeFt * 0.3048
});

test('runway-aligned aircraft on a three-degree path has centered cues', () => {
  const distanceM = 10000;
  const result = ilsDeviation(fromRunway(0, -distanceM, Math.tan(3 * Math.PI / 180) * distanceM / 0.3048), runway);
  assert.ok(result);
  assert.ok(Math.abs(result.localizerOffsetPx) < 0.1);
  assert.ok(Math.abs(result.glideslopeOffsetPx) < 0.1);
});

test('localizer guides toward the runway centerline from either side', () => {
  const east = ilsDeviation(fromRunway(500, -10000, 1600), runway);
  const west = ilsDeviation(fromRunway(-500, -10000, 1600), runway);
  assert.ok(east.localizerOffsetPx < 0);
  assert.ok(west.localizerOffsetPx > 0);
});

test('glideslope cue moves down when above and up when below path', () => {
  const onPathFt = Math.tan(3 * Math.PI / 180) * 10000 / 0.3048;
  const above = ilsDeviation(fromRunway(0, -10000, onPathFt + 500), runway);
  const below = ilsDeviation(fromRunway(0, -10000, onPathFt - 500), runway);
  assert.ok(above.glideslopeOffsetPx > 0);
  assert.ok(below.glideslopeOffsetPx < 0);
});

test('runway guidance is unavailable beyond the threshold or for incomplete data', () => {
  assert.equal(ilsDeviation(fromRunway(0, 100, 500), runway), null);
  assert.equal(ilsDeviation(fromRunway(0, -20000, 500), runway), null);
  assert.equal(ilsDeviation({ latitude: 25 }, runway), null);
});
