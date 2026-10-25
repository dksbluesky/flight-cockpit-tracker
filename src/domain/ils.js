import { localOffsetMeters } from './camera.js';

const RAD_TO_DEG = 180 / Math.PI;
const METERS_PER_FOOT = 0.3048;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function ilsDeviation(aircraft, runway, glideslopeDegrees = 3) {
  if (!aircraft || !runway || ![aircraft.latitude, aircraft.longitude, aircraft.altitudeM, runway.latitude, runway.longitude, runway.headingDeg, runway.elevationFt, glideslopeDegrees].every(Number.isFinite)) return null;
  const offset = localOffsetMeters(runway, aircraft);
  if (!offset) return null;
  const heading = runway.headingDeg * Math.PI / 180;
  const rightOfCourseM = offset.eastM * Math.cos(heading) - offset.northM * Math.sin(heading);
  const distanceToThresholdM = -(offset.eastM * Math.sin(heading) + offset.northM * Math.cos(heading));
  if (distanceToThresholdM <= 0 || distanceToThresholdM > 10 * 1852) return null;

  const crossTrackAngle = Math.atan2(rightOfCourseM, distanceToThresholdM) * RAD_TO_DEG;
  const heightAboveThresholdM = aircraft.altitudeM - runway.elevationFt * METERS_PER_FOOT;
  const actualGlideAngle = Math.atan2(heightAboveThresholdM, distanceToThresholdM) * RAD_TO_DEG;
  const glideAngleError = actualGlideAngle - glideslopeDegrees;
  return {
    distanceNm: distanceToThresholdM / 1852,
    crossTrackM: rightOfCourseM,
    glideAngleErrorDeg: glideAngleError,
    localizerOffsetPx: clamp(-crossTrackAngle / 2.5, -1, 1) * 50,
    glideslopeOffsetPx: clamp(glideAngleError / 1.5, -1, 1) * 50
  };
}
