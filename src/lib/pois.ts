import { searchPlaces } from './geocode'
import type { Place } from '../types/place'

export type StopTheme = 'nature' | 'food' | 'culture' | 'cities' | 'scenic'

type ThemeQuery = { q: string; osmTags?: string[] }

const THEME_QUERIES: Record<StopTheme, ThemeQuery[]> = {
  nature: [
    { q: 'national park', osmTags: ['boundary:national_park', 'leisure:nature_reserve'] },
    { q: 'nature reserve', osmTags: ['leisure:nature_reserve'] },
    { q: 'viewpoint', osmTags: ['tourism:viewpoint'] },
    { q: 'waterfall', osmTags: ['waterway:waterfall'] },
    { q: 'lake', osmTags: ['natural:water'] },
    { q: 'park', osmTags: ['leisure:park'] },
  ],
  scenic: [
    { q: 'viewpoint', osmTags: ['tourism:viewpoint'] },
    { q: 'peak', osmTags: ['natural:peak'] },
    { q: 'lake', osmTags: ['natural:water'] },
    { q: 'attraction', osmTags: ['tourism:attraction'] },
  ],
  food: [
    { q: 'restaurant', osmTags: ['amenity:restaurant'] },
    { q: 'cafe', osmTags: ['amenity:cafe'] },
    { q: 'picnic', osmTags: ['tourism:picnic_site'] },
  ],
  culture: [
    { q: 'museum', osmTags: ['tourism:museum'] },
    { q: 'temple', osmTags: ['amenity:place_of_worship'] },
    { q: 'palace', osmTags: ['historic:castle', 'historic:palace'] },
    { q: 'monument', osmTags: ['historic:monument'] },
  ],
  cities: [
    { q: 'town', osmTags: ['place:town', 'place:city'] },
    { q: 'city', osmTags: ['place:city', 'place:town'] },
    { q: 'village', osmTags: ['place:village', 'place:town'] },
  ],
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 6371
  const dLat = toRad(b[0] - a[0])
  const dLon = toRad(b[1] - a[1])
  const lat1 = toRad(a[0])
  const lat2 = toRad(b[0])
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function progressAlong(
  from: [number, number],
  to: [number, number],
  point: [number, number],
): number {
  const dx = to[1] - from[1]
  const dy = to[0] - from[0]
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return 0
  const t =
    ((point[1] - from[1]) * dx + (point[0] - from[0]) * dy) / len2
  return Math.min(1, Math.max(0, t))
}

function distanceToSegmentKm(
  from: [number, number],
  to: [number, number],
  point: [number, number],
): number {
  const t = progressAlong(from, to, point)
  const proj: [number, number] = [
    from[0] + t * (to[0] - from[0]),
    from[1] + t * (to[1] - from[1]),
  ]
  return haversineKm(point, proj)
}

function pointAlong(
  from: [number, number],
  to: [number, number],
  t: number,
): { lat: number; lon: number } {
  return {
    lat: from[0] + (to[0] - from[0]) * t,
    lon: from[1] + (to[1] - from[1]) * t,
  }
}

/**
 * Find notable places along a trip using free Photon geocoding (no API key).
 */
export async function findStopsAlongTrip(
  from: Place,
  to: Place,
  theme: StopTheme,
  options?: { limit?: number; signal?: AbortSignal },
): Promise<Place[]> {
  const limit = options?.limit ?? 3
  const samples = [0.28, 0.5, 0.72]
  const queries = THEME_QUERIES[theme]
  const tripKm = haversineKm(from.position, to.position)
  const maxDetour = Math.max(35, Math.min(80, tripKm * 0.35))

  const found = new Map<string, Place & { progress: number; detour: number }>()

  await Promise.all(
    samples.flatMap((t, sampleIndex) => {
      const near = pointAlong(from.position, to.position, t)
      const primary = queries[sampleIndex % queries.length]
      const extra = queries[(sampleIndex + 2) % queries.length]
      return [primary, extra].map(async (query) => {
        try {
          const results = await searchPlaces(query.q, options?.signal, {
            lat: near.lat,
            lon: near.lon,
            limit: 6,
            osmTags: query.osmTags,
          })
          for (const place of results) {
            if (
              haversineKm(place.position, from.position) < 12 ||
              haversineKm(place.position, to.position) < 12
            ) {
              continue
            }
            const detour = distanceToSegmentKm(
              from.position,
              to.position,
              place.position,
            )
            if (detour > maxDetour) continue

            const progress = progressAlong(
              from.position,
              to.position,
              place.position,
            )
            const existing = found.get(place.id)
            if (!existing || detour < existing.detour) {
              found.set(place.id, { ...place, progress, detour })
            }
          }
        } catch {
          // ignore individual query failures
        }
      })
    }),
  )

  const candidates = [...found.values()].sort(
    (a, b) => a.detour - b.detour || a.progress - b.progress,
  )

  const picked: Place[] = []
  const minGap = 1 / (limit + 1)

  for (const c of candidates) {
    if (picked.length >= limit) break
    if (c.progress < 0.1 || c.progress > 0.9) continue
    const tooClose = picked.some((p) => {
      const pProg = progressAlong(from.position, to.position, p.position)
      return (
        Math.abs(pProg - c.progress) < minGap * 0.55 ||
        haversineKm(p.position, c.position) < 18
      )
    })
    if (tooClose) continue
    picked.push({
      id: c.id,
      name: c.name,
      description: c.description,
      position: c.position,
      type: c.type ?? theme,
    })
  }

  if (picked.length < limit) {
    for (const c of candidates) {
      if (picked.length >= limit) break
      if (picked.some((p) => p.id === c.id)) continue
      if (picked.some((p) => haversineKm(p.position, c.position) < 18)) continue
      picked.push({
        id: c.id,
        name: c.name,
        description: c.description,
        position: c.position,
        type: c.type ?? theme,
      })
    }
  }

  picked.sort(
    (a, b) =>
      progressAlong(from.position, to.position, a.position) -
      progressAlong(from.position, to.position, b.position),
  )

  return picked
}

export function detectStopTheme(message: string): StopTheme | null {
  const m = message.toLowerCase()

  if (
    /\bnature\b|\boutdoors?\b|\bhike\b|\bhiking\b|\bpark\b|\bforest\b|\blake\b|\bmountain\b|\bwaterfall\b|\bwildlife\b|\bcamp|\benjoy nature\b/.test(
      m,
    )
  ) {
    return 'nature'
  }
  if (
    /\bfood\b|\beat\b|\brestaurant\b|\bcafe\b|\bcoffee\b|\blunch\b|\bdinner\b/.test(
      m,
    )
  ) {
    return 'food'
  }
  if (
    /\bcultur\b|\bmuseum\b|\bhistoric\b|\btemple\b|\bheritage\b|\bmonument\b/.test(
      m,
    )
  ) {
    return 'culture'
  }
  if (/\bcit(y|ies)\b|\btown\b|\bvillage\b|\burban\b/.test(m)) {
    return 'cities'
  }
  if (/\bscenic\b|\bview\b|\bphoto\b|\bsightsee/.test(m)) {
    return 'scenic'
  }

  if (
    /\b(major|best|interesting|cool|nice|good)\s+stops?\b|\bstops?\s+(along|on|en\s+route|on\s+the\s+way)\b|\badd\s+stops?\b|\bsuggest\s+stops?\b|\brecommend\s+stops?\b|\bwhere i can\b/.test(
      m,
    )
  ) {
    return 'scenic'
  }

  return null
}
