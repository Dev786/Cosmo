import { z } from 'zod';
import { registerTool } from '../registry';

const WMO: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 51: 'Light drizzle', 61: 'Light rain', 63: 'Rain',
  65: 'Heavy rain', 71: 'Light snow', 73: 'Snow', 80: 'Rain showers',
  95: 'Thunderstorm',
};

interface Place { lat: number; lng: number; label: string; }

// Open-Meteo's free geocoder — turns "Paris" into coordinates, so weather works
// from whatever city the user names, with no settings UI needed. We pull a few
// candidates and prefer the most populous, so "Paris" → France not Texas.
async function geocode(name: string): Promise<Place | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5&language=en&format=json`;
  const res = await fetch(url);
  const j = await res.json() as { results?: Array<{ latitude: number; longitude: number; name: string; population?: number }> };
  const results = j.results ?? [];
  if (!results.length) return null;
  const hit = results.reduce((best, r) => (r.population ?? 0) > (best.population ?? 0) ? r : best, results[0]);
  return { lat: hit.latitude, lng: hit.longitude, label: hit.name };
}

const asNum = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);

// Last-resort location when the user names no city and none is saved: approximate
// IP-based geolocation (keyless) so "what's the weather?" just works out of the box.
// This is a one-off coarse city lookup (cached 6h), not continuous tracking, and it
// reveals only the IP the network request already exposes — no app/user data is sent.
let ipPlace: Place | null = null;
let ipPlaceAt = 0;
async function ipGeolocate(): Promise<Place | null> {
  if (ipPlace && Date.now() - ipPlaceAt < 6 * 60 * 60_000) return ipPlace;
  for (const url of ['https://ipapi.co/json/', 'https://ipwho.is/']) {
    try {
      const res = await fetch(url);
      const j = await res.json() as { latitude?: unknown; longitude?: unknown; city?: unknown };
      const lat = asNum(j.latitude);
      const lng = asNum(j.longitude);
      if (lat !== null && lng !== null) {
        ipPlace = { lat, lng, label: typeof j.city === 'string' && j.city ? j.city : 'your area' };
        ipPlaceAt = Date.now();
        return ipPlace;
      }
    } catch { /* try the next source */ }
  }
  return null;
}

let cache: { key: string; at: number; result: string } | null = null;

export function registerWeatherTools(): void {
  registerTool({
    name: 'weather.today',
    description: "Get the weather. Pass `city` for a specific place (e.g. 'Gurgaon', 'Paris'); omit to use the saved location.",
    schema: z.object({
      days: z.number().min(1).max(7).default(1),
      city: z.string().optional(),
    }),
    availableOffline: false,
    async execute(args, ctx) {
      // Resolve a place: an explicit city (geocoded) wins, else the saved location.
      let place: Place | null = null;
      if (args.city && args.city.trim()) {
        place = await geocode(args.city.trim());
        if (!place) return { ok: false, error: 'geocode', userMessage: `I couldn't find a place called "${args.city}".` };
      } else if (ctx.config.location) {
        const l = ctx.config.location;
        place = { lat: l.lat, lng: l.lng, label: l.city };
      } else {
        // No city named and none saved → fall back to approximate IP location so
        // the bare "what's the weather?" works. Only ask if even that fails (offline).
        place = await ipGeolocate();
        if (!place) return { ok: false, error: 'no-location', userMessage: 'Which city should I check the weather for?' };
      }

      const key = `${place.label}|${args.days}`;
      if (cache && cache.key === key && Date.now() - cache.at < 30 * 60_000) {
        return { ok: true, summary: cache.result };
      }

      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lng}&current=temperature_2m,weathercode&daily=temperature_2m_max,temperature_2m_min&forecast_days=${args.days}&timezone=auto`;
        const res = await fetch(url);
        const d = await res.json() as { current: { temperature_2m: number; weathercode: number }; daily: { temperature_2m_max: number[]; temperature_2m_min: number[] } };
        const desc = WMO[d.current.weathercode] ?? 'Unknown';
        const temp = Math.round(d.current.temperature_2m);
        const hi = Math.round(d.daily.temperature_2m_max[0]);
        const lo = Math.round(d.daily.temperature_2m_min[0]);
        const result = `${place.label}: ${desc}, ${temp}°C. High ${hi}°, Low ${lo}°.`;
        cache = { key, at: Date.now(), result };
        return { ok: true, summary: result };
      } catch (e: unknown) {
        return { ok: false, error: (e as Error).message, userMessage: `Weather unavailable: ${(e as Error).message}` };
      }
    },
  });
}
