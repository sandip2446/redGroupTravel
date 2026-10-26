import type { Place } from '../types/place'

type PlacePanelProps = {
  place: Place
  onClose: () => void
  onDirections: () => void
}

export function PlacePanel({ place, onClose, onDirections }: PlacePanelProps) {
  const [lat, lng] = place.position

  return (
    <aside className="place-panel" aria-live="polite">
      <div className="place-panel__hero">
        <div className="place-panel__hero-shade" />
        <button
          type="button"
          className="place-panel__close"
          aria-label="Close"
          onClick={onClose}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              fill="currentColor"
              d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
            />
          </svg>
        </button>
        <p className="place-panel__hero-label">Destination</p>
      </div>

      <div className="place-panel__body">
        <h2 className="place-panel__name">{place.name}</h2>
        {place.type && (
          <p className="place-panel__type">{place.type.replace(/_/g, ' ')}</p>
        )}
        <p className="place-panel__desc">{place.description}</p>
        <p className="place-panel__coords">
          {lat.toFixed(4)}° N, {Math.abs(lng).toFixed(4)}°{' '}
          {lng >= 0 ? 'E' : 'W'}
        </p>

        <div className="place-panel__actions">
          <button
            type="button"
            className="place-panel__action place-panel__action--primary"
            onClick={onDirections}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                fill="currentColor"
                d="M21.71 11.29-9-9a.996.996 0 0 0-1.41 0l-9 9a.996.996 0 0 0 0 1.41l9 9c.39.39 1.02.39 1.41 0l9-9a.996.996 0 0 0 0-1.41zM14 14.5V12h-4v3H8v-4c0-.55.45-1 1-1h5V7.5l3.5 3.5-3.5 3.5z"
              />
            </svg>
            Directions
          </button>
          <button type="button" className="place-panel__action">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                fill="currentColor"
                d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"
              />
            </svg>
            Share
          </button>
          <button type="button" className="place-panel__action">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                fill="currentColor"
                d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"
              />
            </svg>
            Save
          </button>
        </div>
      </div>
    </aside>
  )
}
