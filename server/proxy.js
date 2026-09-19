import http from 'node:http';
import { URL } from 'node:url';

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const upstreamBaseUrl = process.env.ADSB_LOL_URL || 'https://api.adsb.lol/v2';
const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean)
]);
const freshForMs = 10000;
const staleForMs = 300000;
const caches = new Map();

async function aircraftResponse(latitude, longitude, distanceNm) {
  const key = `${latitude},${longitude},${distanceNm}`;
  let cache = caches.get(key);
  if (cache && Date.now() - cache.savedAt < freshForMs) return { ...cache, cacheState: 'fresh' };
  try {
    const upstreamUrl = `${upstreamBaseUrl.replace(/\/$/, '')}/lat/${latitude}/lon/${longitude}/dist/${distanceNm}`;
    const upstream = await fetch(upstreamUrl, { headers: { Accept: 'application/json', 'User-Agent': 'flight-cockpit-tracker/0.1' } });
    if (!upstream.ok) throw new Error(`adsb.lol returned ${upstream.status}`);
    cache = { body: await upstream.text(), contentType: upstream.headers.get('content-type') || 'application/json', savedAt: Date.now() };
    caches.set(key, cache);
    return { ...cache, cacheState: 'live' };
  } catch (error) {
    if (cache && Date.now() - cache.savedAt < staleForMs) return { ...cache, cacheState: 'stale' };
    throw error;
  }
}

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Cache-Control', 'no-store');
  if (request.method === 'OPTIONS') {
    if (origin && !allowedOrigins.has(origin)) { response.writeHead(403); return response.end(); }
    response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Accept' });
    return response.end();
  }
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const pathname = requestUrl.pathname;
  if (pathname === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    return response.end(JSON.stringify({ ok: true }));
  }
  if (request.method !== 'GET' || pathname !== '/api/aircraft') { response.writeHead(404); return response.end('Not found'); }
  if (origin && !allowedOrigins.has(origin)) { response.writeHead(403); return response.end('Origin not allowed'); }
  try {
    const latitude = Number(requestUrl.searchParams.get('lat') ?? 23.7);
    const longitude = Number(requestUrl.searchParams.get('lon') ?? 121);
    const distanceNm = Math.round(Number(requestUrl.searchParams.get('dist') ?? 250));
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Number.isFinite(distanceNm) || distanceNm < 1 || distanceNm > 250) {
      response.writeHead(400, { 'content-type': 'application/json' });
      return response.end(JSON.stringify({ error: 'Invalid location or distance' }));
    }
    const result = await aircraftResponse(latitude, longitude, distanceNm);
    response.writeHead(200, { 'content-type': result.contentType, 'x-aircraft-cache': result.cacheState });
    response.end(result.body);
  } catch (error) {
    response.writeHead(502, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: error.message }));
  }
});
server.listen(port, host, () => console.log(`adsb.lol proxy listening on http://${host}:${port}`));
