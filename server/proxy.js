import http from 'node:http';
import { URL } from 'node:url';

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const upstreamBaseUrl = process.env.ADSB_API_URL || 'https://opendata.adsb.fi/api/v3';
const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean)
]);
const freshForMs = 30000;
const staleForMs = 300000;
const caches = new Map();
const inFlight = new Map();
let rateLimitedUntil = 0;
let rateLimitBackoffMs = 60000;

function retryAfterMs(header) {
  if (!header) return 60000;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(1000, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(1000, date - Date.now()) : 60000;
}

async function aircraftResponse(latitude, longitude, distanceNm) {
  const key = `${latitude},${longitude},${distanceNm}`;
  let cache = caches.get(key);
  if (cache && Date.now() - cache.savedAt < freshForMs) return { ...cache, cacheState: 'fresh' };
  if (Date.now() < rateLimitedUntil) {
    if (cache && Date.now() - cache.savedAt < staleForMs) return { ...cache, cacheState: 'stale' };
    const error = new Error('adsb.fi rate limit cooldown');
    error.status = 429;
    error.retryAfterSeconds = Math.ceil((rateLimitedUntil - Date.now()) / 1000);
    throw error;
  }
  if (inFlight.has(key)) {
    try { return { ...await inFlight.get(key), cacheState: 'shared' }; }
    catch (error) {
      if (cache && Date.now() - cache.savedAt < staleForMs) return { ...cache, cacheState: 'stale' };
      throw error;
    }
  }
  const request = (async () => {
    const upstreamUrl = `${upstreamBaseUrl.replace(/\/$/, '')}/lat/${latitude}/lon/${longitude}/dist/${distanceNm}`;
    const upstream = await fetch(upstreamUrl, { headers: { Accept: 'application/json', 'User-Agent': 'flight-cockpit-tracker/0.2 (+https://github.com/dksbluesky/flight-cockpit-tracker)' } });
    if (!upstream.ok) {
      if (upstream.status === 429) {
        const retryAfter = upstream.headers.get('retry-after');
        rateLimitedUntil = Date.now() + (retryAfter ? retryAfterMs(retryAfter) : rateLimitBackoffMs);
        if (!retryAfter) rateLimitBackoffMs = Math.min(rateLimitBackoffMs * 2, 600000);
      }
      const error = new Error(`adsb.fi returned ${upstream.status}`);
      error.status = upstream.status;
      error.retryAfterSeconds = upstream.status === 429 ? Math.ceil((rateLimitedUntil - Date.now()) / 1000) : undefined;
      throw error;
    }
    const result = { body: await upstream.text(), contentType: upstream.headers.get('content-type') || 'application/json', savedAt: Date.now() };
    caches.set(key, result);
    rateLimitedUntil = 0;
    rateLimitBackoffMs = 60000;
    return result;
  })();
  inFlight.set(key, request);
  try {
    cache = await request;
    return { ...cache, cacheState: 'live' };
  } catch (error) {
    if (cache && Date.now() - cache.savedAt < staleForMs) return { ...cache, cacheState: 'stale' };
    throw error;
  } finally {
    inFlight.delete(key);
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
    if (error.status === 429 && error.retryAfterSeconds) response.setHeader('Retry-After', String(error.retryAfterSeconds));
    response.writeHead(error.status === 429 ? 429 : 502, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: error.message, retryAfter: error.retryAfterSeconds }));
  }
});
server.listen(port, host, () => console.log(`adsb.fi proxy listening on http://${host}:${port}`));
