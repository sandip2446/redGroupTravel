import type { Place } from '../types/place'

export type TravelMode = 'driving' | 'walking' | 'cycling'

export type RouteResult = {
  mode: TravelMode
  coordinates: [number, number][]
  distanceMeters: number
  durationSeconds: number
}

export type ModeTimes = Partial<
  Record<TravelMode, { durationSeconds: number; distanceMeters: number }>
>

type OsrmResponse = {
  code: string
  message?: string
  routes?: Array<{
    distance: number
    duration: number
    geometry?: {
      coordinates: [number, number][]
    }
  }>
}

/** FOSSGIS free routers — separate car / foot / bike graphs (no API key). */
const ROUTERS: Record<TravelMode, string> = {
  driving: 'https://routing.openstreetmap.de/routed-car/route/v1/driving',
  walking: 'https://routing.openstreetmap.de/routed-foot/route/v1/driving',
  cycling: 'https://routing.openstreetmap.de/routed-bike/route/v1/driving',
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`
  const km = meters / 1000
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`
}

export function formatDuration(seconds: number): string {
  const total = Math.max(1, Math.round(seconds / 60))
  if (total < 60) return `${total} min`
  const hours = Math.floor(total / 60)
  const mins = total % 60
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const remHours = hours % 24
    return remHours === 0
      ? `${days} day${days > 1 ? 's' : ''}`
      : `${days}d ${remHours} hr`
  }
  return mins === 0 ? `${hours} hr` : `${hours} hr ${mins} min`
}

function buildUrl(
  mode: TravelMode,
  places: Place[],
  fullGeometry: boolean,
): string {
  const path = places
    .map((p) => {
      const [lat, lng] = p.position
      return `${lng},${lat}`
    })
    .join(';')
  const overview = fullGeometry ? 'full' : 'false'
  const geometry = fullGeometry ? '&geometries=geojson' : ''
  return `${ROUTERS[mode]}/${path}?overview=${overview}${geometry}`
}

export async function getRoute(
  from: Place,
  to: Place,
  mode: TravelMode = 'driving',
  signal?: AbortSignal,
  stops: Place[] = [],
): Promise<RouteResult> {
  const places = [from, ...stops, to]
  const res = await fetch(buildUrl(mode, places, true), { signal })
  if (!res.ok) throw new Error('Routing failed')

  const data = (await res.json()) as OsrmResponse
  const route = data.routes?.[0]
  if (!route || data.code !== 'Ok') {
    throw new Error(data.message || 'No route found')
  }

  const coordinates = (route.geometry?.coordinates ?? []).map(
    ([lng, lat]) => [lat, lng] as [number, number],
  )

  return {
    mode,
    coordinates,
    distanceMeters: route.distance,
    durationSeconds: route.duration,
  }
}

/** Fetch duration/distance for all travel modes in parallel. */
export async function getAllModeTimes(
  from: Place,
  to: Place,
  signal?: AbortSignal,
  stops: Place[] = [],
): Promise<ModeTimes> {
  const modes: TravelMode[] = ['driving', 'walking', 'cycling']
  const places = [from, ...stops, to]
  const results = await Promise.all(
    modes.map(async (mode) => {
      try {
        const res = await fetch(buildUrl(mode, places, false), { signal })
        if (!res.ok) return [mode, null] as const
        const data = (await res.json()) as OsrmResponse
        const route = data.routes?.[0]
        if (!route || data.code !== 'Ok') return [mode, null] as const
        return [
          mode,
          {
            durationSeconds: route.duration,
            distanceMeters: route.distance,
          },
        ] as const
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw err
        return [mode, null] as const
      }
    }),
  )

  const times: ModeTimes = {}
  for (const [mode, value] of results) {
    if (value) times[mode] = value
  }
  return times
}
