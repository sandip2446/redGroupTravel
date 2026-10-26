import { useEffect, useState } from 'react'
import { PlaceInput } from './PlaceInput'
import {
  formatDistance,
  formatDuration,
  getAllModeTimes,
  getRoute,
  type ModeTimes,
  type RouteResult,
  type TravelMode,
} from '../lib/routing'
import type { Place } from '../types/place'

const MODE_META: Array<{ id: TravelMode; label: string; path: string }> = [
  {
    id: 'driving',
    label: 'Drive',
    path: 'M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z',
  },
  {
    id: 'walking',
    label: 'Walk',
    path: 'M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7',
  },
  {
    id: 'cycling',
    label: 'Bike',
    path: 'M15.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM5 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5zm5.8-10-2.1-.9.8-2.2L12 9.5l2-2.5 2.5 1.5-1.5 2.5H19v2h-5.2l-2.1 2.5 1.9 4.5H11l-1.5-3.5-2.4 1.2.9 1.8-1.8.9L5 15.5l3.2-1.6L10.8 10.5zM19 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5z',
  },
]

type DirectionsPanelProps = {
  initialTo?: Place | null
  from: Place | null
  to: Place | null
  stops: Place[]
  route: RouteResult | null
  mode: TravelMode
  onFromChange: (place: Place | null) => void
  onToChange: (place: Place | null) => void
  onRouteChange: (route: RouteResult | null) => void
  onModeChange: (mode: TravelMode) => void
  onClose: () => void
  onUseMyLocation: () => Promise<Place | null>
}

export function DirectionsPanel({
  initialTo,
  from,
  to,
  stops,
  route,
  mode,
  onFromChange,
  onToChange,
  onRouteChange,
  onModeChange,
  onClose,
  onUseMyLocation,
}: DirectionsPanelProps) {
  const [fromQuery, setFromQuery] = useState(from?.name ?? '')
  const [toQuery, setToQuery] = useState(to?.name ?? initialTo?.name ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const [modeTimes, setModeTimes] = useState<ModeTimes>({})

  useEffect(() => {
    if (from) setFromQuery(from.name)
  }, [from])

  useEffect(() => {
    if (to) setToQuery(to.name)
  }, [to])

  useEffect(() => {
    if (initialTo && !to) {
      onToChange(initialTo)
      setToQuery(initialTo.name)
    }
  }, [initialTo, to, onToChange])

  useEffect(() => {
    if (!from || !to) {
      onRouteChange(null)
      setModeTimes({})
      setError(null)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    Promise.all([
      getRoute(from, to, mode, controller.signal, stops),
      getAllModeTimes(from, to, controller.signal, stops),
    ])
      .then(([result, times]) => {
        onRouteChange(result)
        setModeTimes(times)
      })
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return
        onRouteChange(null)
        setModeTimes({})
        setError('No route found between these places.')
      })
      .finally(() => setLoading(false))

    return () => controller.abort()
  }, [from, to, stops, mode, onRouteChange])

  function swap() {
    const nextFrom = to
    const nextTo = from
    const nextFromQuery = toQuery
    const nextToQuery = fromQuery
    onFromChange(nextFrom)
    onToChange(nextTo)
    setFromQuery(nextFromQuery)
    setToQuery(nextToQuery)
  }

  async function useMyLocation() {
    setLocating(true)
    try {
      const place = await onUseMyLocation()
      if (place) {
        onFromChange(place)
        setFromQuery(place.name)
      }
    } finally {
      setLocating(false)
    }
  }

  const activeTime = modeTimes[mode]
  const displayDuration = route?.durationSeconds ?? activeTime?.durationSeconds
  const displayDistance = route?.distanceMeters ?? activeTime?.distanceMeters

  return (
    <div className="directions">
      <div className="directions__header">
        <button
          type="button"
          className="directions__back"
          aria-label="Close directions"
          onClick={onClose}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path
              fill="currentColor"
              d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"
            />
          </svg>
        </button>
        <span className="directions__title">Directions</span>
      </div>

      <div className="directions__modes" role="tablist" aria-label="Travel mode">
        {MODE_META.map(({ id, label, path }) => {
          const time = modeTimes[id]
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              className={`directions__mode ${mode === id ? 'is-active' : ''}`}
              onClick={() => onModeChange(id)}
              title={label}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <path fill="currentColor" d={path} />
              </svg>
              <span>{label}</span>
              <span className="directions__mode-time">
                {time ? formatDuration(time.durationSeconds) : '—'}
              </span>
            </button>
          )
        })}
      </div>

      <div className="directions__fields">
        <div className="directions__rail" aria-hidden="true">
          <span className="directions__dot directions__dot--from" />
          <span className="directions__line" />
          <span className="directions__dot directions__dot--to" />
        </div>

        <div className="directions__inputs">
          <PlaceInput
            label="From"
            placeholder="Choose starting point"
            value={from}
            query={fromQuery}
            onQueryChange={(q) => {
              setFromQuery(q)
              if (from) onFromChange(null)
            }}
            onSelect={(place) => {
              onFromChange(place)
              setFromQuery(place.name)
            }}
            onClear={() => {
              onFromChange(null)
              setFromQuery('')
            }}
            autoFocus={!from}
          />
          <PlaceInput
            label="To"
            placeholder="Choose destination"
            value={to}
            query={toQuery}
            onQueryChange={(q) => {
              setToQuery(q)
              if (to) onToChange(null)
            }}
            onSelect={(place) => {
              onToChange(place)
              setToQuery(place.name)
            }}
            onClear={() => {
              onToChange(null)
              setToQuery('')
            }}
          />
        </div>

        <button
          type="button"
          className="directions__swap"
          aria-label="Swap start and destination"
          onClick={swap}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              fill="currentColor"
              d="M16 17.01V10h-2v7.01h-3L15 21l4-3.99h-3zM9 3 5 6.99h3V14h2V6.99h3L9 3z"
            />
          </svg>
        </button>
      </div>

      {stops.length > 0 && (
        <ul className="directions__stops">
          {stops.map((stop, index) => (
            <li key={stop.id}>
              <span className="directions__stop-index">{index + 1}</span>
              <span>{stop.name}</span>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="directions__locate"
        onClick={useMyLocation}
        disabled={locating}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"
          />
        </svg>
        {locating ? 'Locating…' : 'Your location'}
      </button>

      <div className="directions__summary">
        {loading && <p className="directions__status">Finding the best route…</p>}
        {error && <p className="directions__error">{error}</p>}
        {!loading && !error && displayDuration != null && displayDistance != null && from && to && (
          <div className="directions__result">
            <p className="directions__time">{formatDuration(displayDuration)}</p>
            <p className="directions__distance">
              {formatDistance(displayDistance)} ·{' '}
              {mode === 'driving' ? 'driving' : mode === 'walking' ? 'walking' : 'cycling'}
            </p>
            <p className="directions__via">
              {from.name} → {to.name}
            </p>
          </div>
        )}
        {!loading && !error && displayDuration == null && (
          <p className="directions__status">
            Enter a start and destination to get directions.
          </p>
        )}
      </div>
    </div>
  )
}
