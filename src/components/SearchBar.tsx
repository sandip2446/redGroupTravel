import { useEffect, useRef, useState } from 'react'
import { searchPlaces } from '../lib/geocode'
import type { Place } from '../types/place'

type SearchBarProps = {
  selected: Place | null
  onSelect: (place: Place) => void
  onClearSelection: () => void
}

export function SearchBar({
  selected,
  onSelect,
  onClearSelection,
}: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<Place[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const skipSync = useRef(false)

  useEffect(() => {
    if (skipSync.current) {
      skipSync.current = false
      return
    }
    if (selected) setQuery(selected.name)
  }, [selected])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const places = await searchPlaces(q, controller.signal)
        setResults(places)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setResults([])
        setError('Could not search. Try again.')
      } finally {
        setLoading(false)
      }
    }, 250)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query])

  function choose(place: Place) {
    skipSync.current = true
    setQuery(place.name)
    setOpen(false)
    onSelect(place)
  }

  function clear() {
    setQuery('')
    setResults([])
    setOpen(false)
    onClearSelection()
  }

  const showDropdown = open && query.trim().length >= 2

  return (
    <div className={`search ${showDropdown ? 'is-open' : ''}`}>
      <div className="search__box">
        <button type="button" className="search__menu" aria-label="Menu">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path
              fill="currentColor"
              d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"
            />
          </svg>
        </button>
        <input
          className="search__input"
          type="search"
          placeholder="Search the world"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 160)
          }}
          aria-label="Search anywhere in the world"
          autoComplete="off"
          spellCheck={false}
        />
        {loading && <span className="search__spinner" aria-label="Searching" />}
        {query ? (
          <button
            type="button"
            className="search__clear"
            aria-label="Clear search"
            onClick={clear}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                fill="currentColor"
                d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
              />
            </svg>
          </button>
        ) : (
          <span className="search__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22">
              <path
                fill="currentColor"
                d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14Z"
              />
            </svg>
          </span>
        )}
      </div>

      {showDropdown && (
        <ul className="search__results" role="listbox">
          {error && <li className="search__empty">{error}</li>}
          {!error && !loading && results.length === 0 && (
            <li className="search__empty">No results found</li>
          )}
          {results.map((place) => (
            <li key={place.id}>
              <button
                type="button"
                className={`search__result ${selected?.id === place.id ? 'is-active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(place)}
              >
                <span className="search__result-pin" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="20" height="20">
                    <path
                      fill="#EA4335"
                      d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"
                    />
                  </svg>
                </span>
                <span className="search__result-text">
                  <span className="search__result-name">{place.name}</span>
                  <span className="search__result-meta">
                    {place.description}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
