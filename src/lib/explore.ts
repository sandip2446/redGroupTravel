import { searchPlaces } from './geocode'
import type { Place } from '../types/place'

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

/**
 * Extract a region phrase from natural language explore requests.
 * e.g. "explore niagara region in Ontario canada" → "niagara region Ontario canada"
 */
export function extractRegionQuery(message: string): string | null {
  const patterns = [
    /(?:explore|visit|discover)\s+(?:the\s+)?(.+?)(?:\s+and\s+list|\s*,?\s*list|\s*$)/i,
    /(?:popular\s+destinations?(?:\s+in|\s+around)?|destinations?(?:\s+in|\s+around)|places?\s+to\s+(?:visit|see|go)\s+in)\s+(.+)$/i,
    /(?:list|show|find)\s+(?:all\s+)?(?:the\s+)?(?:popular\s+)?destinations?\s+(?:in|around|for)\s+(.+)$/i,
    /(?:what\s+(?:are|to)\s+(?:see|visit|do)\s+in)\s+(.+)$/i,
    /(?:things\s+to\s+do\s+in)\s+(.+)$/i,
  ]

  for (const re of patterns) {
    const m = message.match(re)
    if (m?.[1]) {
      return m[1]
        .replace(
          /\b(list|all|the|popular|destination|destinations|please)\b/gi,
          ' ',
        )
        .replace(/\s+/g, ' ')
        .trim()
    }
  }

  if (
    /\b(explore|destinations?|popular|things to do|places to visit)\b/i.test(
      message,
    )
  ) {
    return (
      message
        .replace(
          /\b(i want to|i'?d like to|please|can you|list|all|the|popular|destinations?|explore)\b/gi,
          ' ',
        )
        .replace(/\s+/g, ' ')
        .trim() || null
    )
  }

  return null
}

/** Well-known popular spots when free geocoding is sparse or noisy. */
const CURATED_REGIONS: Array<{
  match: RegExp
  region: Place
  destinations: Place[]
}> = [
  {
    match: /\bniagara\b/i,
    region: {
      id: 'curated-niagara-region',
      name: 'Niagara Region',
      description: 'Ontario, Canada',
      position: [43.0896, -79.0849],
      type: 'region',
    },
    destinations: [
      {
        id: 'curated-niagara-falls',
        name: 'Niagara Falls',
        description: 'Niagara Falls, Ontario, Canada',
        position: [43.0962, -79.0377],
        type: 'waterfall',
      },
      {
        id: 'curated-niagara-on-the-lake',
        name: 'Niagara-on-the-Lake',
        description: 'Ontario, Canada',
        position: [43.2557, -79.0719],
        type: 'town',
      },
      {
        id: 'curated-clifton-hill',
        name: 'Clifton Hill',
        description: 'Niagara Falls, Ontario, Canada',
        position: [43.0914, -79.0745],
        type: 'attraction',
      },
      {
        id: 'curated-journey-behind-falls',
        name: 'Journey Behind the Falls',
        description: 'Niagara Falls, Ontario, Canada',
        position: [43.0799, -79.0784],
        type: 'attraction',
      },
      {
        id: 'curated-skylons',
        name: 'Skylon Tower',
        description: 'Niagara Falls, Ontario, Canada',
        position: [43.0853, -79.0796],
        type: 'attraction',
      },
      {
        id: 'curated-floral-clock',
        name: 'Floral Clock',
        description: 'Niagara Parks, Ontario, Canada',
        position: [43.1356, -79.0511],
        type: 'attraction',
      },
      {
        id: 'curated-whirlpool',
        name: 'Niagara Whirlpool',
        description: 'Niagara Parks, Ontario, Canada',
        position: [43.1197, -79.0697],
        type: 'viewpoint',
      },
      {
        id: 'curated-butterfly',
        name: 'Niagara Parks Butterfly Conservatory',
        description: 'Niagara Falls, Ontario, Canada',
        position: [43.1406, -79.0553],
        type: 'attraction',
      },
      {
        id: 'curated-wine-route',
        name: 'Niagara Wine Route',
        description: 'Niagara Peninsula, Ontario, Canada',
        position: [43.18, -79.2],
        type: 'winery',
      },
      {
        id: 'curated-welland',
        name: 'Welland Canal',
        description: 'St. Catharines / Welland, Ontario, Canada',
        position: [43.133, -79.2],
        type: 'attraction',
      },
    ],
  },
]

function regionKeywords(query: string, region: Place): string[] {
  const bits = `${query} ${region.name} ${region.description}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(
      (w) =>
        w.length > 2 &&
        ![
          'the',
          'and',
          'region',
          'area',
          'county',
          'province',
          'state',
          'near',
          'around',
        ].includes(w),
    )
  return [...new Set(bits)].slice(0, 6)
}

function scorePlace(
  place: Place,
  region: Place,
  keywords: string[],
): number {
  const dist = haversineKm(place.position, region.position)
  if (dist > 100) return -1
  const hay = `${place.name} ${place.description}`.toLowerCase()
  const keywordHits = keywords.filter((k) => hay.includes(k)).length
  const typeBoost = place.type
    ? /attraction|viewpoint|museum|park|waterfall|beach|town|city|winery|falls/i.test(
        place.type,
      )
      ? 8
      : 0
    : 0
  return typeBoost + keywordHits * 5 - dist * 0.15
}

function curatedFor(query: string) {
  return CURATED_REGIONS.find((c) => c.match.test(query)) ?? null
}

/**
 * Find popular destinations in a region using free Photon geocoding (no API key),
 * with curated seeds for well-known regions when search is sparse.
 */
export async function findPopularDestinations(
  regionQuery: string,
  options?: { limit?: number; signal?: AbortSignal },
): Promise<{ region: Place; destinations: Place[] }> {
  const limit = options?.limit ?? 10
  const cleaned = regionQuery.replace(/\s+/g, ' ').trim()
  const curated = curatedFor(cleaned)

  // Resolve region center with a few query variants
  const mainToken =
    cleaned
      .split(/\s+/)
      .find(
        (w) =>
          w.length > 3 &&
          !/region|ontario|canada|area|county|province/i.test(w),
      ) ?? cleaned.split(/\s+/)[0]

  const variants = [
    `${mainToken} Falls Ontario`,
    `${mainToken} Ontario Canada`,
    cleaned,
    cleaned.replace(/\bregion\b/gi, '').replace(/\s+/g, ' ').trim(),
    cleaned.split(/\s+in\s+/i).pop()?.trim() ?? cleaned,
  ].filter((v, i, arr) => v.length > 2 && arr.indexOf(v) === i)

  let region: Place | null = curated?.region ?? null
  for (const v of variants) {
    try {
      const hits = await searchPlaces(v, options?.signal, { limit: 6 })
      const hit =
        hits.find((h) => /falls/i.test(h.name)) ??
        hits.find((h) =>
          /city|town|county|state|region|province|village/i.test(
            `${h.type ?? ''} ${h.name}`,
          ),
        ) ??
        hits.find(
          (h) =>
            !/headquarters|clinic|hospital|ems|police|school|office/i.test(
              h.name,
            ),
        ) ??
        hits[0] ??
        null
      if (hit) {
        region = hit
        break
      }
    } catch {
      // Photon may be rate-limited; fall through to curated
    }
  }

  if (!region) {
    throw new Error(`Could not find region "${regionQuery}"`)
  }

  const [lat, lon] = region.position
  const keywords = regionKeywords(cleaned, region)
  const core =
    keywords.slice(0, 2).join(' ') ||
    region.name.split(/\s+/).slice(0, 2).join(' ')

  const querySpecs: Array<{ q: string; osmTags?: string[] }> = [
    { q: `${core} attraction`, osmTags: ['tourism:attraction'] },
    { q: `${core} falls`, osmTags: ['tourism:attraction', 'waterway:waterfall'] },
    { q: `${core} park`, osmTags: ['leisure:park'] },
    { q: `${core} museum`, osmTags: ['tourism:museum'] },
    { q: `${core} viewpoint`, osmTags: ['tourism:viewpoint'] },
    { q: `${core} winery`, osmTags: ['craft:winery'] },
    { q: `${core} beach`, osmTags: ['natural:beach'] },
    { q: `${core} town`, osmTags: ['place:town', 'place:city'] },
    { q: core, osmTags: ['tourism:attraction'] },
  ]

  const found = new Map<string, Place>()

  // Seed curated spots first so popular landmarks always appear
  for (const place of curated?.destinations ?? []) {
    found.set(place.id, place)
  }

  await Promise.all(
    querySpecs.map(async ({ q, osmTags }) => {
      try {
        const results = await searchPlaces(q, options?.signal, {
          lat,
          lon,
          limit: 8,
          osmTags,
        })
        for (const place of results) {
          if (place.id === region!.id) continue
          if (!place.name || place.name.length < 3) continue
          if (/^(viewpoint|park|town|winery|museum|beach)$/i.test(place.name)) {
            continue
          }
          const s = scorePlace(place, region!, keywords)
          if (s < 0) continue
          const existing = found.get(place.id)
          if (!existing) {
            // Prefer not duplicating curated names
            const dup = [...found.values()].some(
              (p) => p.name.toLowerCase() === place.name.toLowerCase(),
            )
            if (!dup) found.set(place.id, place)
          }
        }
      } catch {
        // ignore
      }
    }),
  )

  const destinations = [...found.values()]
    .map((place) => ({
      place,
      score:
        scorePlace(place, region!, keywords) +
        (place.id.startsWith('curated-') ? 12 : 0),
    }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.place)

  return { region, destinations }
}

export function formatDestinationList(
  regionName: string,
  destinations: Place[],
): string {
  if (destinations.length === 0) {
    return `I found ${regionName}, but couldn't list popular spots nearby. Try a more specific area name.`
  }
  const lines = destinations.map(
    (d, i) =>
      `${i + 1}. ${d.name}${d.description ? ` — ${d.description}` : ''}`,
  )
  return `Popular destinations in/near ${regionName}:\n\n${lines.join('\n')}\n\nNext: "show ${destinations[0]?.name}", "plan a trip from A to B", or "add stop ${destinations[0]?.name}".`
}
