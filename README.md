# Flight Cockpit Tracker

A bilingual, installable aircraft-tracking PWA centered on Taiwan. Its central path uses live public aircraft data around Taiwan: live aircraft → select an aircraft → enter **Simulated Cockpit View** → return to the map. Deterministic samples appear only when the live source is unavailable.

The cockpit is a calculated visualization, not cockpit video. Position, altitude, ground speed, ground track, and vertical rate can come from ADS-B state vectors. Ground track is not necessarily aircraft heading, pitch is not measured, identity/classification can be incomplete, and no position should be treated as perfectly accurate.

## Architecture

- Vite and browser-native JavaScript keep the app small.
- MapLibre GL renders the OpenStreetMap-backed Taiwan map.
- Three.js renders the forward-facing procedural terrain, horizon, and cockpit camera.
- Provider adapters keep mock and live sources separate from rendering.
- Domain modules own normalization, stale-data rules, classification, interpolation, and camera calculations.
- A minimal optional Node proxy keeps credentials out of browser code and works around provider CORS.
- The service worker caches the application shell only. API requests are never cached.

## Start with live Taiwan traffic

Requires Node.js 20 or later. Run the local proxy and Vite in separate terminals:

```powershell
npm install
npm run proxy
```

```powershell
npm run dev
```

Open the URL printed by Vite. The status bar shows the live source and current aircraft count when the feed is available. If the proxy or live source fails, the app clearly switches to five deterministic sample aircraft.

## Published PWA

The production build is configured for `https://dksbluesky.github.io/flight-cockpit-tracker/` and uses the Render HTTPS proxy. GitHub Actions builds and publishes `dist` after changes reach `main`. The free Render service may sleep while unused, so the first live-data request after inactivity can take longer.
## Live data provider

The live adapter uses the public `adsb.fi` v3 API, queried within 250 nautical miles of central Taiwan. Its public endpoint permits personal, non-commercial use, limits requests to one per second, and requires visible attribution with a link. The browser cannot call the endpoint directly because the verified response did not include an `Access-Control-Allow-Origin` header, so `server/proxy.js` performs the request. Production uses the HTTPS Render service at `https://flight-cockpit-proxy.onrender.com`; local development uses `http://127.0.0.1:8787`. The public endpoint returned data without a token during verification on 2026-10-25.

HUD wind uses the selected arrival airport's METAR from the official AviationWeather.gov API, fetched through the proxy because the API does not allow browser CORS requests. Taiwan defaults to RCTP. METAR is cached for five minutes; selecting another arrival airport also changes the wind station.

Below 2,000 ft and within 10 NM of the threshold, the cockpit can show simulated localizer and 3-degree glideslope cues for a selected airport/runway. Needle position uses ADS-B coordinates and altitude relative to the runway threshold, with device tilt acting as a simulated control input. Runway threshold coordinates and true headings come from the public OurAirports dataset; this is a simplified visual aid, not certified ILS guidance, and ADS-B/airport data may be incomplete or stale.

Official references: [AviationWeather.gov Data API](https://aviationweather.gov/data/api/), [OurAirports public data](https://ourairports.com/data/).

Verified provider facts on 2026-10-25:

- The public v3 radius endpoint returns aircraft within up to 250 nautical miles and uses an `ac` aircraft array.
- Public requests are rate limited to 1 request per second; this app polls every 30 seconds and the proxy caches responses.
- The provider terms allow personal, non-commercial use only and require a visible link attribution.
- A Taiwan radius request succeeded without an API token. Its response did not include `Access-Control-Allow-Origin`, so browser requests go through the proxy.
- Coverage and metadata can be incomplete. Publicly visible aircraft are not the same as every aircraft in the airspace.

Optional local overrides use names only in `.env.example`:

```text
VITE_AIRCRAFT_PROVIDER=mock
VITE_LIVE_API_URL=http://127.0.0.1:8787/api/aircraft
ADSB_API_URL=https://opendata.adsb.fi/api/v3
PORT=8787
```

Official references:

- [adsb.fi open data API documentation and terms](https://github.com/adsbfi/opendata/blob/main/README.md)
- [adsb.fi](https://adsb.fi/)
- [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
- [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
- [OurAirports runway dataset](https://github.com/davidmegginson/ourairports-data/blob/main/runways.csv)
## Classification and safety

“Possible military” is only a conservative callsign-prefix heuristic. It does not confirm operator, mission, aircraft ownership, or military identity. Aircraft without a recognized prefix are not proven civilian; missing callsigns are classified as unknown. Stale data (over 30 seconds since last contact) disables cockpit entry.

## Commands

```powershell
npm test
npm run build
npm run preview
```

The PWA shell works offline after a successful online load. Live aircraft data correctly becomes unavailable offline. Map tiles and live data are not bulk cached.

## Current limitations

- Default mode is deterministic sample data; live use is gated pending provider permission.
- The cockpit terrain is deterministic procedural terrain, not real-world elevation data.
- Smooth marker transitions use MapLibre marker updates and CSS rotation; more advanced dead reckoning can be added later.
- SVG icons satisfy manifest wiring but PNG fallbacks should be added before broad device-install acceptance testing.
- Installability is source/build verified locally; actual Windows, Android, and iOS installation must be tested on those browsers/devices.
- OpenStreetMap's public tile service is suitable for development/light use only; a production deployment must review the current tile policy and choose an appropriate provider if traffic grows.

## Attribution

Map data © OpenStreetMap contributors. Live aircraft data are provided by [adsb.fi](https://adsb.fi/) under its personal, non-commercial API terms.
