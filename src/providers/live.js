import { normalizeAdsbLolResponse } from './normalize.js';

export function createLiveProvider(endpoint = 'http://127.0.0.1:8787/api/aircraft') {
  return {
    id: 'adsb-lol',
    async getAircraft(location) {
      const url = new URL(endpoint);
      if (location) {
        url.searchParams.set('lat', location.latitude);
        url.searchParams.set('lon', location.longitude);
        url.searchParams.set('dist', location.distanceNm || 250);
      }
      const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) throw new Error(`Live data unavailable (${response.status})`);
      return normalizeAdsbLolResponse(await response.json());
    }
  };
}
