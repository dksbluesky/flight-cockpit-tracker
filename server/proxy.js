import http from 'node:http';
import { URL } from 'node:url';

const port = Number(process.env.PORT || 8787);
const upstreamUrl = process.env.ADSB_LOL_URL || 'https://api.adsb.lol/v2/lat/23.7/lon/121/dist/250';
const allowedOrigins = new Set(['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173']);
const freshForMs = 20000;
const staleForMs = 300000;
let cache = null;

async function aircraftResponse() {
  if (cache && Date.now() - cache.savedAt < freshForMs) return { ...cache, cacheState: 'fresh' };
  try {
    const upstream = await fetch(upstreamUrl, { headers: { Accept: 'application/json', 'User-Agent': 'flight-cockpit-tracker/0.1' } });
    if (!upstream.ok) throw new Error(`adsb.lol returned ${upstream.status}`);
    cache = { body: await upstream.text(), contentType: upstream.headers.get('content-type') || 'application/json', savedAt: Date.now() };
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
    response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Accept' });
    return response.end();
  }
  if (new URL(request.url, `http://${request.headers.host}`).pathname !== '/api/aircraft') { response.writeHead(404); return response.end('Not found'); }
  try {
    const result = await aircraftResponse();
    response.writeHead(200, { 'content-type': result.contentType, 'x-aircraft-cache': result.cacheState });
    response.end(result.body);
  } catch (error) {
    response.writeHead(502, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: error.message }));
  }
});
server.listen(port, '127.0.0.1', () => console.log(`adsb.lol proxy listening on http://127.0.0.1:${port}`));