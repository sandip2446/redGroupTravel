import type { Place } from '../types/place'

type PhotonProps = {
  name?: string
  street?: string
  housenumber?: string
  city?: string
  town?: string
  village?: string
  county?: string
  state?: string
  country?: string
  postcode?: string
  osm_id?: number
  osm_type?: string
  osm_key?: string
  osm_value?: string
  type?: string
}

type PhotonFeature = {
  geometry: { coordinates: [number, number] }
  properties: PhotonProps
}

type PhotonResponse = {
  features: PhotonFeature[]
}

type NominatimResult = {
  place_id: number
  lat: string
  lon: string
  display_name: string
  name?: string
  type?: string
  class?: string
  address?: {
    city?: string
    town?: string
    village?: string
    state?: string
    country?: string
  }
}

function label(props: PhotonProps): { name: string; description: string } {
  const locality =
    props.city || props.town || props.village || props.county || ''
  const name =
    props.name ||
    [props.housenumber, props.street].filter(Boolean).join(' ') ||
    locality ||
    props.state ||
    props.country ||
    'Selected location'

  const parts = [
    props.name && props.street
      ? [props.housenumber, props.street].filter(Boolean).join(' ')
      : props.street,
    locality,
    props.state,
    props.country,
  ].filter((part, i, arr) => part && arr.indexOf(part) === i && part !== name)

  return {
    name,
    description: parts.join(', ') || props.type || 'Worldwide location',
  }
}

function toPlace(feature: PhotonFeature, index = 0): Place {
  const [lng, lat] = feature.geometry.coordinates
  const { name, description } = label(feature.properties)
  const osm = feature.properties.osm_id
  const osmType = feature.properties.osm_type ?? 'n'

  return {
    id: osm
      ? `${osmType}-${osm}`
      : `geo-${lat.toFixed(5)}-${lng.toFixed(5)}-${index}`,
    name,
    description,
    position: [lat, lng],
    type: feature.properties.osm_value || feature.properties.type,
  }
}

function nominatimToPlace(item: NominatimResult, index: number): Place {
  const lat = Number(item.lat)
  const lon = Number(item.lon)
  const parts = item.display_name.split(',').map((p) => p.trim())
  const name = item.name || parts[0] || 'Selected location'
  const description =
    parts
      .slice(1)
      .filter((p) => p && p !== name)
      .slice(0, 3)
      .join(', ') ||
    item.type ||
    'Worldwide location'

  return {
    id: `nom-${item.place_id || `${lat.toFixed(5)}-${lon.toFixed(5)}-${index}`}`,
    name,
    description,
    position: [lat, lon],
    type: item.type || item.class,
  }
}

async function searchPhoton(
  query: string,
  signal?: AbortSignal,
  near?: {
    lat?: number
    lon?: number
    limit?: number
    osmTags?: string[]
  },
): Promise<Place[]> {
  const url = new URL('https://photon.komoot.io/api/')
  url.searchParams.set('q', query)
  url.searchParams.set('limit', String(near?.limit ?? 8))
  url.searchParams.set('lang', 'en')
  if (near?.lat != null && near?.lon != null) {
    url.searchParams.set('lat', String(near.lat))
    url.searchParams.set('lon', String(near.lon))
  }
  for (const tag of near?.osmTags ?? []) {
    url.searchParams.append('osm_tag', tag)
  }

  const res = await fetch(url, { signal })
  if (!res.ok) return []
  const data = (await res.json()) as PhotonResponse
  return (data.features ?? []).map(toPlace)
}

async function searchNominatim(
  query: string,
  signal?: AbortSignal,
  near?: { lat?: number; lon?: number; limit?: number },
): Promise<Place[]> {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'json')
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('limit', String(near?.limit ?? 8))
  if (near?.lat != null && near?.lon != null) {
    url.searchParams.set('viewbox', `${near.lon - 1},${near.lat + 1},${near.lon + 1},${near.lat - 1}`)
    url.searchParams.set('bounded', '0')
  }

  const res = await fetch(url, {
    signal,
    headers: {
      Accept: 'application/json',
    },
  })
  if (!res.ok) return []
  const data = (await res.json()) as NominatimResult[]
  return (data ?? []).map(nominatimToPlace)
}

export async function searchPlaces(
  query: string,
  signal?: AbortSignal,
  near?: {
    lat?: number
    lon?: number
    limit?: number
    osmTags?: string[]
  },
): Promise<Place[]> {
  const q = query.trim()
  if (q.length < 2) return []

  try {
    const photon = await searchPhoton(q, signal, near)
    if (photon.length > 0) return photon
  } catch {
    // Photon down / blocked — fall through
  }

  try {
    return await searchNominatim(q, signal, near)
  } catch {
    return []
  }
}

export async function reverseGeocode(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<Place> {
  try {
    const url = new URL('https://photon.komoot.io/reverse')
    url.searchParams.set('lat', String(lat))
    url.searchParams.set('lon', String(lng))

    const res = await fetch(url, { signal })
    if (res.ok) {
      const data = (await res.json()) as PhotonResponse
      const feature = data.features?.[0]
      if (feature) return toPlace(feature)
    }
  } catch {
    // fall through
  }

  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse')
    url.searchParams.set('lat', String(lat))
    url.searchParams.set('lon', String(lng))
    url.searchParams.set('format', 'json')
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
    if (res.ok) {
      const data = (await res.json()) as NominatimResult & {
        display_name?: string
        address?: NominatimResult['address']
      }
      if (data?.lat && data?.lon) {
        return nominatimToPlace(
          {
            place_id: data.place_id ?? 0,
            lat: data.lat,
            lon: data.lon,
            display_name: data.display_name ?? `${lat}, ${lng}`,
            name: data.name,
            type: data.type,
            address: data.address,
          },
          0,
        )
      }
    }
  } catch {
    // fall through
  }

  return {
    id: `geo-${lat.toFixed(5)}-${lng.toFixed(5)}`,
    name: 'Dropped pin',
    description: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    position: [lat, lng],
  }
}
