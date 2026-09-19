import { classifyAircraft } from '../domain/aircraft.js';

const BASE = [
  { id: '8990a1', callsign: 'CAL511', registration: 'B-18918', aircraftType: 'A350-900', originCountry: 'Taiwan', latitude: 25.033, longitude: 121.235, altitudeM: 6100, groundSpeedMps: 224, track: 42, verticalRateMps: 4.2 },
  { id: '8991b2', callsign: 'EVA025', registration: 'B-16736', aircraftType: 'B777-300ER', originCountry: 'Taiwan', latitude: 24.35, longitude: 120.82, altitudeM: 9850, groundSpeedMps: 242, track: 196, verticalRateMps: -2.1 },
  { id: 'ae1234', callsign: 'RCH301', registration: null, aircraftType: null, originCountry: 'United States', latitude: 22.72, longitude: 121.08, altitudeM: 7600, groundSpeedMps: 205, track: 15, verticalRateMps: 0.3 },
  { id: '71c888', callsign: null, registration: null, aircraftType: null, originCountry: 'Unknown', latitude: 23.62, longitude: 122.05, altitudeM: 4300, groundSpeedMps: 165, track: 292, verticalRateMps: 1.5 },
  { id: '899225', callsign: 'EVA225', registration: 'B-17011', aircraftType: 'A321-200', originCountry: 'Taiwan', latitude: 25.14, longitude: 121.11, altitudeM: 820, groundSpeedMps: 76, track: 52, verticalRateMps: -2.8 }
];

export function createMockProvider(clock = () => Date.now()) {
  const started = clock();
  return {
    id: 'mock',
    async getAircraft() {
      const now = clock();
      const elapsed = (now - started) / 1000;
      return BASE.map((item, index) => {
        const radians = item.track * Math.PI / 180;
        const distanceKm = item.groundSpeedMps * elapsed / 1000;
        const aircraft = {
          ...item,
          latitude: item.latitude + Math.cos(radians) * distanceKm / 111,
          longitude: item.longitude + Math.sin(radians) * distanceKm / (111 * Math.cos(item.latitude * Math.PI / 180)),
          altitudeM: Math.max(0, item.altitudeM + item.verticalRateMps * elapsed),
          lastPosition: now - 1500,
          lastContact: now - 800,
          receivedAt: now,
          source: 'Deterministic sample data'
        };
        aircraft.classification = classifyAircraft(aircraft);
        return aircraft;
      });
    }
  };
}
