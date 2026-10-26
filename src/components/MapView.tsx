import { useEffect, useState } from 'react'
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMap,
  useMapEvents,
  ZoomControl,
} from 'react-leaflet'
import L from 'leaflet'
import { reverseGeocode } from '../lib/geocode'
import type { RouteResult } from '../lib/routing'
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  type MapStyle,
  type Place,
} from '../types/place'
import 'leaflet/dist/leaflet.css'

export type { MapStyle }

const LAYERS: Record<
  MapStyle,
  { url: string; attribution: string; maxZoom: number; labels?: boolean }
> = {
  street: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution:
      'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
    labels: true,
  },
  terrain: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution:
      'Map data: &copy; OpenStreetMap, SRTM | Style: &copy; OpenTopoMap',
    maxZoom: 17,
  },
}

const LABEL_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'

const STYLE_META: Record<
  MapStyle,
  { label: string; preview: string; swatch: string }
> = {
  street: {
    label: 'Map',
    preview: 'https://tile.openstreetmap.org/4/8/5.png',
    swatch: 'linear-gradient(135deg, #e8f5e9 0%, #bbdefb 45%, #fff 100%)',
  },
  satellite: {
    label: 'Satellite',
    preview:
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/4/5/8',
    swatch: 'linear-gradient(135deg, #1a3a1a 0%, #3d6b3d 40%, #8b7355 100%)',
  },
  terrain: {
    label: 'Terrain',
    preview: 'https://a.tile.opentopomap.org/4/8/5.png',
    swatch: 'linear-gradient(135deg, #c8e6c9 0%, #81c784 40%, #5d4037 100%)',
  },
}

const pinIcon = L.divIcon({
  className: 'map-pin',
  html: `<span class="map-pin__dot"></span>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
  popupAnchor: [0, -28],
})

const fromIcon = L.divIcon({
  className: 'map-pin map-pin--from',
  html: `<span class="map-pin__badge map-pin__badge--from">A</span>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  popupAnchor: [0, -14],
})

const toIcon = L.divIcon({
  className: 'map-pin map-pin--to',
  html: `<span class="map-pin__badge map-pin__badge--to">B</span>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  popupAnchor: [0, -14],
})

function stopIcon(index: number) {
  return L.divIcon({
    className: 'map-pin map-pin--stop',
    html: `<span class="map-pin__badge map-pin__badge--stop">${index + 1}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -13],
  })
}

function FitRoute({
  route,
  from,
  to,
  stops,
  explorePlaces,
}: {
  route: RouteResult | null
  from: Place | null
  to: Place | null
  stops: Place[]
  explorePlaces: Place[]
}) {
  const map = useMap()

  useEffect(() => {
    if (route && route.coordinates.length > 1) {
      map.fitBounds(L.latLngBounds(route.coordinates), {
        padding: [48, 48],
        maxZoom: 15,
        animate: true,
      })
      return
    }
    if (!from && !to && explorePlaces.length > 0) {
      map.fitBounds(
        L.latLngBounds(explorePlaces.map((p) => p.position)),
        { padding: [48, 48], maxZoom: 11, animate: true },
      )
      return
    }
    const points = [
      ...(from ? [from.position] : []),
      ...stops.map((s) => s.position),
      ...(to ? [to.position] : []),
    ]
    if (points.length >= 2) {
      map.fitBounds(L.latLngBounds(points), {
        padding: [64, 64],
        maxZoom: 14,
      })
    }
  }, [route, from, to, stops, explorePlaces, map])

  return null
}

const exploreIcon = (index: number) =>
  L.divIcon({
    className: 'map-pin map-pin--explore',
    html: `<span class="map-pin__badge map-pin__badge--explore">${index + 1}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -13],
  })

function FlyTo({ place, enabled }: { place: Place | null; enabled: boolean }) {
  const map = useMap()

  useEffect(() => {
    if (!enabled || !place) return
    map.flyTo(place.position, Math.max(map.getZoom(), 12), {
      duration: 0.65,
    })
  }, [place, map, enabled])

  return null
}

function MapClick({
  enabled,
  onSelect,
  onLoading,
}: {
  enabled: boolean
  onSelect: (place: Place) => void
  onLoading: (loading: boolean) => void
}) {
  useMapEvents({
    click: async (e) => {
      if (!enabled) return
      const { lat, lng } = e.latlng
      onLoading(true)
      try {
        const place = await reverseGeocode(lat, lng)
        onSelect(place)
      } catch {
        onSelect({
          id: `geo-${lat.toFixed(5)}-${lng.toFixed(5)}`,
          name: 'Dropped pin',
          description: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          position: [lat, lng],
        })
      } finally {
        onLoading(false)
      }
    },
  })

  return null
}

function MapBridge({ onMap }: { onMap: (map: L.Map) => void }) {
  const map = useMap()
  useEffect(() => {
    onMap(map)
  }, [map, onMap])
  return null
}

type MapViewProps = {
  selected: Place | null
  from: Place | null
  to: Place | null
  stops: Place[]
  explorePlaces: Place[]
  route: RouteResult | null
  directionsMode: boolean
  mapStyle: MapStyle
  onMapStyleChange: (style: MapStyle) => void
  onSelect: (place: Place) => void
}

export function MapView({
  selected,
  from,
  to,
  stops,
  explorePlaces,
  route,
  directionsMode,
  mapStyle,
  onMapStyleChange,
  onSelect,
}: MapViewProps) {
  const [ready, setReady] = useState(false)
  const [layersOpen, setLayersOpen] = useState(false)
  const [map, setMap] = useState<L.Map | null>(null)
  const [clickLoading, setClickLoading] = useState(false)
  const layer = LAYERS[mapStyle]

  return (
    <div className={`map-shell ${ready ? 'map-shell--ready' : ''}`}>
      {clickLoading && (
        <div className="map-loading" role="status">
          Finding place…
        </div>
      )}

      <div className={`layers ${layersOpen ? 'is-open' : ''}`}>
        {layersOpen && (
          <div className="layers__menu" role="menu">
            {(Object.keys(STYLE_META) as MapStyle[]).map((id) => (
              <button
                key={id}
                type="button"
                role="menuitemradio"
                aria-checked={mapStyle === id}
                className={`layers__option ${mapStyle === id ? 'is-active' : ''}`}
                onClick={() => {
                  onMapStyleChange(id)
                  setLayersOpen(false)
                }}
              >
                <span
                  className="layers__thumb"
                  style={{
                    backgroundImage: `url(${STYLE_META[id].preview}), ${STYLE_META[id].swatch}`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                />
                <span className="layers__label">{STYLE_META[id].label}</span>
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className="layers__trigger"
          aria-expanded={layersOpen}
          aria-label="Layers"
          onClick={() => setLayersOpen((v) => !v)}
        >
          <span
            className="layers__trigger-thumb"
            style={{
              backgroundImage: `url(${STYLE_META[mapStyle].preview}), ${STYLE_META[mapStyle].swatch}`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
          <span className="layers__trigger-text">Layers</span>
        </button>
      </div>

      <button
        type="button"
        className="map-locate"
        aria-label="Show your location"
        title="Your location"
        onClick={() => map?.locate({ setView: true, maxZoom: 14 })}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"
          />
        </svg>
      </button>

      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        className="map-canvas"
        zoomControl={false}
        preferCanvas
        whenReady={() => setReady(true)}
      >
        <TileLayer
          key={mapStyle}
          attribution={layer.attribution}
          url={layer.url}
          maxZoom={layer.maxZoom}
          updateWhenIdle
          keepBuffer={2}
        />
        {layer.labels && (
          <TileLayer
            key={`${mapStyle}-labels`}
            url={LABEL_URL}
            attribution=""
            maxZoom={19}
            pane="overlayPane"
            updateWhenIdle
          />
        )}
        <ZoomControl position="bottomright" />
        <MapBridge onMap={setMap} />
        <MapClick
          enabled={!directionsMode}
          onSelect={onSelect}
          onLoading={setClickLoading}
        />
        <FlyTo
          place={selected}
          enabled={!directionsMode && explorePlaces.length === 0}
        />
        <FitRoute
          route={route}
          from={from}
          to={to}
          stops={stops}
          explorePlaces={explorePlaces}
        />

        {route && (
          <Polyline
            positions={route.coordinates}
            pathOptions={{
              color: '#1a73e8',
              weight: 6,
              opacity: 0.9,
              lineJoin: 'round',
              lineCap: 'round',
            }}
          />
        )}

        {directionsMode && from && (
          <Marker position={from.position} icon={fromIcon}>
            <Popup>
              <strong>From</strong>
              <p>{from.name}</p>
            </Popup>
          </Marker>
        )}

        {directionsMode &&
          stops.map((stop, index) => (
            <Marker key={stop.id} position={stop.position} icon={stopIcon(index)}>
              <Popup>
                <strong>Stop {index + 1}</strong>
                <p>{stop.name}</p>
              </Popup>
            </Marker>
          ))}

        {directionsMode && to && (
          <Marker position={to.position} icon={toIcon}>
            <Popup>
              <strong>To</strong>
              <p>{to.name}</p>
            </Popup>
          </Marker>
        )}

        {!directionsMode &&
          explorePlaces.map((place, index) => (
            <Marker
              key={place.id}
              position={place.position}
              icon={exploreIcon(index)}
              eventHandlers={{ click: () => onSelect(place) }}
            >
              <Popup>
                <strong>
                  {index + 1}. {place.name}
                </strong>
                <p>{place.description}</p>
              </Popup>
            </Marker>
          ))}

        {!directionsMode && explorePlaces.length === 0 && selected && (
          <Marker position={selected.position} icon={pinIcon}>
            <Popup>
              <strong>{selected.name}</strong>
              <p>{selected.description}</p>
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  )
}
