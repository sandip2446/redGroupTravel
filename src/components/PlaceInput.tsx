import { useEffect, useId, useState } from 'react'
import { searchPlaces } from '../lib/geocode'
import type { Place } from '../types/place'

type PlaceInputProps = {
  label: string
  placeholder: string
  value: Place | null
  query: string
  onQueryChange: (query: string) => void
  onSelect: (place: Place) => void
  onClear: () => void
  autoFocus?: boolean
}

export function PlaceInput({
  label,
  placeholder,
  value,
  query,
  onQueryChange,
  onSelect,
  onClear,
  autoFocus,
}: PlaceInputProps) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<Place[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2 || (value && value.name === query)) {
      setResults([])
      setLoading(false)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const places = await searchPlaces(q, controller.signal)
        setResults(places)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 250)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query, value])

  const showDropdown = open && query.trim().length >= 2 && !(value && value.name === query)

  return (
    <div className={`place-input ${showDropdown ? 'is-open' : ''}`}>
      <label className="place-input__label" htmlFor={listId}>
        {label}
      </label>
      <div className="place-input__field">
        <input
          id={listId}
          className="place-input__control"
          type="search"
          placeholder={placeholder}
          value={query}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            onQueryChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 160)
          }}
        />
        {loading && <span className="search__spinner" aria-hidden="true" />}
        {query && (
          <button
            type="button"
            className="place-input__clear"
            aria-label={`Clear ${label}`}
            onClick={onClear}
          >
            ×
          </button>
        )}
      </div>

      {showDropdown && (
        <ul className="place-input__results" role="listbox">
          {!loading && results.length === 0 && (
            <li className="search__empty">No results</li>
          )}
          {results.map((place) => (
            <li key={place.id}>
              <button
                type="button"
                className="search__result"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect(place)
                  setOpen(false)
                }}
              >
                <span className="search__result-pin" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18">
                    <path
                      fill="#EA4335"
                      d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"
                    />
                  </svg>
                </span>
                <span className="search__result-text">
                  <span className="search__result-name">{place.name}</span>
                  <span className="search__result-meta">{place.description}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
