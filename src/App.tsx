import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { MapView } from './components/MapView'
import { SearchBar } from './components/SearchBar'
import { PlacePanel } from './components/PlacePanel'
import { DirectionsPanel } from './components/DirectionsPanel'
import { TripChat } from './components/TripChat'
import { ItineraryPanel } from './components/ItineraryPanel'
import { ApiKeyModal } from './components/ApiKeyModal'
import { reverseGeocode } from './lib/geocode'
import { getRoute, type RouteResult, type TravelMode } from './lib/routing'
import type { TripCommand, TripSnapshot } from './ai'
import type { MapStyle, Place } from './types/place'
import type { TripItinerary } from './types/itinerary'
import './App.css'

type SidebarTab = 'chat' | 'itinerary' | 'search'

const SIDEBAR_MIN = 340
const SIDEBAR_MAX = 620
const SIDEBAR_DEFAULT = 440

function App() {
  const [tab, setTab] = useState<SidebarTab>('chat')
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const [selected, setSelected] = useState<Place | null>(null)
  const [directionsOpen, setDirectionsOpen] = useState(false)
  const [directionsTo, setDirectionsTo] = useState<Place | null>(null)
  const [from, setFrom] = useState<Place | null>(null)
  const [to, setTo] = useState<Place | null>(null)
  const [stops, setStops] = useState<Place[]>([])
  const [explorePlaces, setExplorePlaces] = useState<Place[]>([])
  const [route, setRoute] = useState<RouteResult | null>(null)
  const [mode, setMode] = useState<TravelMode>('driving')
  const [mapStyle, setMapStyle] = useState<MapStyle>('street')
  const [itinerary, setItinerary] = useState<TripItinerary | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  function clampSidebar(width: number) {
    return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width))
  }

  function onResizePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = sidebarWidth
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)

    function onMove(ev: PointerEvent) {
      setSidebarWidth(clampSidebar(startWidth + (ev.clientX - startX)))
    }
    function onUp(ev: PointerEvent) {
      target.releasePointerCapture(ev.pointerId)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const trip: TripSnapshot = useMemo(
    () => ({ from, to, stops, mode, mapStyle, selected, explorePlaces, itinerary }),
    [from, to, stops, mode, mapStyle, selected, explorePlaces, itinerary],
  )

  useEffect(() => {
    if (!from || !to) {
      setRoute(null)
      return
    }
    const controller = new AbortController()
    getRoute(from, to, mode, controller.signal, stops)
      .then(setRoute)
      .catch((err: Error) => {
        if (err.name === 'AbortError') return
        setRoute(null)
      })
    return () => controller.abort()
  }, [from, to, stops, mode])

  const openDirections = useCallback(
    (destination?: Place | null) => {
      setDirectionsTo(destination ?? selected)
      if (destination) setTo(destination)
      else if (selected && !to) setTo(selected)
      setDirectionsOpen(true)
    },
    [selected, to],
  )

  const closeDirections = useCallback(() => {
    setDirectionsOpen(false)
    setDirectionsTo(null)
    setFrom(null)
    setTo(null)
    setStops([])
    setRoute(null)
  }, [])

  const useMyLocation = useCallback(async (): Promise<Place | null> => {
    if (!navigator.geolocation) return null

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const place = await reverseGeocode(
              pos.coords.latitude,
              pos.coords.longitude,
            )
            resolve(place)
          } catch {
            resolve({
              id: 'my-location',
              name: 'Your location',
              description: 'Current position',
              position: [pos.coords.latitude, pos.coords.longitude],
            })
          }
        },
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 10000 },
      )
    })
  }, [])

  const applyCommands = useCallback(
    async (commands: TripCommand[]) => {
      for (const cmd of commands) {
        switch (cmd.type) {
          case 'setFrom':
            setFrom(cmd.place)
            setExplorePlaces([])
            break
          case 'setTo':
            setTo(cmd.place)
            setExplorePlaces([])
            break
          case 'addStop':
            setStops((prev) =>
              prev.some((s) => s.id === cmd.place.id)
                ? prev
                : [...prev, cmd.place],
            )
            break
          case 'setStops':
            setStops(cmd.places)
            break
          case 'removeStop':
            setStops((prev) =>
              prev.filter(
                (s) =>
                  !s.name.toLowerCase().includes(cmd.name.toLowerCase()) &&
                  !cmd.name.toLowerCase().includes(s.name.toLowerCase()),
              ),
            )
            break
          case 'clearStops':
            setStops([])
            break
          case 'setMode':
            setMode(cmd.mode)
            break
          case 'setMapStyle':
            setMapStyle(cmd.style)
            break
          case 'select':
            setSelected(cmd.place)
            setDirectionsOpen(false)
            break
          case 'setExplorePlaces':
            setExplorePlaces(cmd.places)
            setSelected(cmd.region)
            setDirectionsOpen(false)
            break
          case 'clearExplore':
            setExplorePlaces([])
            break
          case 'clearTrip':
            setFrom(null)
            setTo(null)
            setStops([])
            setRoute(null)
            setSelected(null)
            setExplorePlaces([])
            setDirectionsOpen(false)
            setDirectionsTo(null)
            setItinerary(null)
            break
          case 'swap': {
            setFrom((prevFrom) => {
              const nextFrom = to
              setTo(prevFrom)
              return nextFrom
            })
            break
          }
          case 'openDirections':
            setDirectionsOpen(true)
            break
          case 'useMyLocationAsFrom': {
            const place = await useMyLocation()
            if (place) setFrom(place)
            break
          }
          case 'setItinerary':
            setItinerary(cmd.itinerary)
            break
          case 'clearItinerary':
            setItinerary(null)
            break
        }
      }
    },
    [to, useMyLocation],
  )

  const handleItineraryToRoute = useCallback((places: Place[]) => {
    if (!places.length) return
    if (places.length === 1) {
      setSelected(places[0])
      return
    }
    setFrom(places[0])
    setTo(places[places.length - 1])
    if (places.length > 2) {
      setStops(places.slice(1, -1))
    } else {
      setStops([])
    }
    setDirectionsOpen(true)
    setTab('search')
  }, [])

  const showRouteOnMap = directionsOpen || Boolean(from && to)

  return (
    <div
      className="app"
      style={{ gridTemplateColumns: `${sidebarWidth}px 6px 1fr` }}
    >
      <div className="app__sidebar">
        {/* Brand header */}
        <div className="app__brand-row">
          <div className="app__brand-left">
            <span className="app__logo" aria-hidden="true">
              <span className="app__logo-pin" />
            </span>
            <span className="app__wordmark">
              Red Group <span>Travel</span>
            </span>
          </div>

          <button
            type="button"
            className="app__settings-btn"
            onClick={() => setSettingsOpen(true)}
            title="Configure AI model & API keys"
          >
            ⚙️ <span className="app__settings-btn-text">Settings</span>
          </button>
        </div>

        {/* Tab navigation */}
        <div className="app__tabs" role="tablist" aria-label="Sidebar navigation">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'chat'}
            className={`app__tab ${tab === 'chat' ? 'is-active' : ''}`}
            onClick={() => setTab('chat')}
          >
            <span className="app__tab-icon">✨</span> Guide AI
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'itinerary'}
            className={`app__tab ${tab === 'itinerary' ? 'is-active' : ''}`}
            onClick={() => setTab('itinerary')}
          >
            <span className="app__tab-icon">🗓️</span> Itinerary
            {itinerary && <span className="app__tab-pill">{itinerary.durationDays}d</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'search'}
            className={`app__tab ${tab === 'search' ? 'is-active' : ''}`}
            onClick={() => setTab('search')}
          >
            <span className="app__tab-icon">🗺️</span> Map & Route
          </button>
        </div>

        {/* Panel resize width slider */}
        <label className="app__width-slider">
          <span className="app__width-slider-label">
            Panel width
            <strong>{sidebarWidth}px</strong>
          </span>
          <input
            type="range"
            min={SIDEBAR_MIN}
            max={SIDEBAR_MAX}
            step={4}
            value={sidebarWidth}
            onChange={(e) => setSidebarWidth(Number(e.target.value))}
            aria-label="Sidebar panel width"
          />
        </label>

        {/* Tab views */}
        {tab === 'chat' ? (
          <TripChat
            trip={trip}
            onCommands={applyCommands}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenItineraryTab={() => setTab('itinerary')}
          />
        ) : tab === 'itinerary' ? (
          <ItineraryPanel
            itinerary={itinerary}
            onSelectPlace={setSelected}
            onAddStopAsRoute={handleItineraryToRoute}
            onClearItinerary={() => setItinerary(null)}
            onPromptClick={() => {
              setTab('chat')
            }}
          />
        ) : directionsOpen ? (
          <DirectionsPanel
            initialTo={directionsTo}
            from={from}
            to={to}
            stops={stops}
            route={route}
            mode={mode}
            onFromChange={setFrom}
            onToChange={setTo}
            onRouteChange={setRoute}
            onModeChange={setMode}
            onClose={closeDirections}
            onUseMyLocation={useMyLocation}
          />
        ) : (
          <>
            <SearchBar
              selected={selected}
              onSelect={setSelected}
              onClearSelection={() => setSelected(null)}
            />

            <div className="app__actions">
              <button
                type="button"
                className="app__directions-btn"
                onClick={() => openDirections(null)}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  aria-hidden="true"
                >
                  <path
                    fill="currentColor"
                    d="M21.71 11.29-9-9a.996.996 0 0 0-1.41 0l-9 9a.996.996 0 0 0 0 1.41l9 9c.39.39 1.02.39 1.41 0l9-9a.996.996 0 0 0 0-1.41zM14 14.5V12h-4v3H8v-4c0-.55.45-1 1-1h5V7.5l3.5 3.5-3.5 3.5z"
                  />
                </svg>
                Directions
              </button>
            </div>

            {selected ? (
              <PlacePanel
                place={selected}
                onClose={() => setSelected(null)}
                onDirections={() => openDirections(selected)}
              />
            ) : (
              <div className="app__hints">
                <p className="app__hints-title">Search or chat to plan</p>
                <p className="app__hints-text">
                  Use the Guide tab to talk with the AI travel agent, or search
                  locations above to drop pins and calculate routes.
                </p>
              </div>
            )}
          </>
        )}
      </div>

      <div
        className="app__resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat panel"
        aria-valuemin={SIDEBAR_MIN}
        aria-valuemax={SIDEBAR_MAX}
        aria-valuenow={sidebarWidth}
        tabIndex={0}
        onPointerDown={onResizePointerDown}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') {
            setSidebarWidth((w) => clampSidebar(w - 16))
          }
          if (e.key === 'ArrowRight') {
            setSidebarWidth((w) => clampSidebar(w + 16))
          }
        }}
      />

      <main className="app__map">
        <MapView
          selected={selected}
          from={from}
          to={to}
          stops={stops}
          explorePlaces={explorePlaces}
          route={route}
          directionsMode={showRouteOnMap}
          mapStyle={mapStyle}
          onMapStyleChange={setMapStyle}
          onSelect={setSelected}
        />
      </main>

      <ApiKeyModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  )
}

export default App
