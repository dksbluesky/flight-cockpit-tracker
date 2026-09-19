import { normalizeAdsbLolResponse } from './normalize.js';

export function createLiveProvider(endpoint = 'http://127.0.0.1:8787/api/aircraft') {
  return {
    id: 'adsb-lol',
    async getAircraft() {
      const response = await fetch(endpoint, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) throw new Error(`Live data unavailable (${response.status})`);
      return normalizeAdsbLolResponse(await response.json());
    }
  };
}