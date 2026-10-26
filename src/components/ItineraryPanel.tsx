import { useState } from 'react'
import type { TripItinerary } from '../types/itinerary'
import type { Place } from '../types/place'
import { searchPlaces } from '../lib/geocode'

type ItineraryPanelProps = {
  itinerary: TripItinerary | null
  onSelectPlace?: (place: Place) => void
  onAddStopAsRoute?: (places: Place[]) => void
  onClearItinerary?: () => void
  onPromptClick?: (promptText: string) => void
}

export function ItineraryPanel({
  itinerary,
  onSelectPlace,
  onAddStopAsRoute,
  onClearItinerary,
  onPromptClick,
}: ItineraryPanelProps) {
  const [activeDay, setActiveDay] = useState<number>(1)
  const [copied, setCopied] = useState(false)
  const [converting, setConverting] = useState(false)

  if (!itinerary || !itinerary.days?.length) {
    return (
      <div className="itinerary-empty">
        <div className="itinerary-empty__icon" aria-hidden="true">
          🗓️
        </div>
        <h3 className="itinerary-empty__title">No Active Itinerary Yet</h3>
        <p className="itinerary-empty__text">
          Ask your AI Travel Agent in the chat to craft a complete vacation plan. Try one of these:
        </p>
        <div className="itinerary-empty__suggestions">
          <button
            type="button"
            className="itinerary-empty__chip"
            onClick={() => onPromptClick?.('Plan a 3-day trip to Tokyo with cultural temples, ramen, and shopping')}
          >
            🇯🇵 Plan a 3-day trip to Tokyo
          </button>
          <button
            type="button"
            className="itinerary-empty__chip"
            onClick={() => onPromptClick?.('Plan a 3-day trip to Niagara Falls and Toronto with nature & wineries')}
          >
            🌊 Plan 3 days in Niagara & Toronto
          </button>
          <button
            type="button"
            className="itinerary-empty__chip"
            onClick={() => onPromptClick?.('Plan a 4-day romantic itinerary for Paris with art and fine dining')}
          >
            🥐 Plan a 4-day romantic trip to Paris
          </button>
        </div>
      </div>
    )
  }

  async function handleFocusLocation(locationName?: string) {
    if (!locationName || !onSelectPlace) return
    try {
      const places = await searchPlaces(locationName)
      if (places[0]) onSelectPlace(places[0])
    } catch {
      // ignore
    }
  }

  async function handlePlotRouteOnMap() {
    if (!onAddStopAsRoute) return
    setConverting(true)
    try {
      const placeNames: string[] = []
      itinerary?.days.forEach((d) => {
        d.activities.forEach((a) => {
          if (a.locationName) placeNames.push(a.locationName)
        })
      })

      // Resolve unique places
      const uniqueNames = Array.from(new Set(placeNames)).slice(0, 5)
      const places: Place[] = []
      for (const name of uniqueNames) {
        const found = await searchPlaces(name).then((r) => r[0] ?? null)
        if (found) places.push(found)
      }

      if (places.length > 0) {
        onAddStopAsRoute(places)
      }
    } finally {
      setConverting(false)
    }
  }

  function handleCopyItinerary() {
    if (!itinerary) return
    let text = `${itinerary.title}\nDestination: ${itinerary.destination}\nDuration: ${itinerary.durationDays} Days\n\n${itinerary.summary}\n\n`
    itinerary.days.forEach((day) => {
      text += `--- Day ${day.dayNumber}: ${day.theme} ---\n`
      day.activities.forEach((act) => {
        text += `• [${act.timeOfDay.toUpperCase()}] ${act.title}: ${act.description}\n`
        if (act.tips) text += `  Tip: ${act.tips}\n`
      })
      if (day.mealsToTry?.length) {
        text += `  Meals to try: ${day.mealsToTry.join(', ')}\n`
      }
      text += '\n'
    })

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  const currentDayData = itinerary.days.find((d) => d.dayNumber === activeDay) || itinerary.days[0]

  return (
    <div className="itinerary-panel">
      {/* Header Banner */}
      <div className="itinerary-panel__header">
        <div className="itinerary-panel__title-box">
          <span className="itinerary-panel__badge">
            {itinerary.durationDays} {itinerary.durationDays === 1 ? 'Day' : 'Days'}
          </span>
          {itinerary.vibe && (
            <span className="itinerary-panel__badge itinerary-panel__badge--vibe">
              {itinerary.vibe}
            </span>
          )}
          <h2 className="itinerary-panel__title">{itinerary.title}</h2>
          <p className="itinerary-panel__summary">{itinerary.summary}</p>
        </div>

        {/* Toolbar */}
        <div className="itinerary-panel__toolbar">
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={handlePlotRouteOnMap}
            disabled={converting}
            title="Add itinerary locations to map directions"
          >
            {converting ? 'Plotting Route…' : '🗺️ Draw on Map'}
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={handleCopyItinerary}
          >
            {copied ? '✅ Copied!' : '📋 Copy Plan'}
          </button>
          {onClearItinerary && (
            <button
              type="button"
              className="btn-text btn-sm"
              onClick={onClearItinerary}
              title="Clear current itinerary"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Day Selector Tabs */}
      <div className="itinerary-days-nav" role="tablist">
        {itinerary.days.map((day) => (
          <button
            key={day.dayNumber}
            type="button"
            role="tab"
            aria-selected={activeDay === day.dayNumber}
            className={`itinerary-days-nav__tab ${activeDay === day.dayNumber ? 'is-active' : ''}`}
            onClick={() => setActiveDay(day.dayNumber)}
          >
            <span className="itinerary-days-nav__num">Day {day.dayNumber}</span>
            <span className="itinerary-days-nav__label" title={day.theme}>
              {day.theme.slice(0, 18)}
              {day.theme.length > 18 ? '…' : ''}
            </span>
          </button>
        ))}
      </div>

      {/* Day Content */}
      {currentDayData && (
        <div className="itinerary-day-content">
          <div className="itinerary-day-content__header">
            <h3 className="itinerary-day-content__title">
              Day {currentDayData.dayNumber}: {currentDayData.theme}
            </h3>
          </div>

          <div className="itinerary-timeline">
            {currentDayData.activities.map((act, index) => (
              <div key={index} className="itinerary-activity-card">
                <div className="itinerary-activity-card__time">
                  <span className={`itinerary-time-tag itinerary-time-tag--${act.timeOfDay}`}>
                    {act.timeOfDay === 'morning' ? '🌅 Morning' : act.timeOfDay === 'afternoon' ? '☀️ Afternoon' : '🌙 Evening'}
                  </span>
                  {act.costEstimate && (
                    <span className="itinerary-activity-card__cost">{act.costEstimate}</span>
                  )}
                </div>

                <div className="itinerary-activity-card__body">
                  <h4 className="itinerary-activity-card__title">{act.title}</h4>
                  <p className="itinerary-activity-card__desc">{act.description}</p>

                  {act.locationName && (
                    <div className="itinerary-activity-card__location-row">
                      <button
                        type="button"
                        className="itinerary-loc-btn"
                        onClick={() => handleFocusLocation(act.locationName)}
                        title="Locate on map"
                      >
                        📍 {act.locationName}
                      </button>
                    </div>
                  )}

                  {act.tips && (
                    <div className="itinerary-activity-card__tip">
                      <strong>Insider Tip:</strong> {act.tips}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {currentDayData.mealsToTry?.length ? (
            <div className="itinerary-meals-box">
              <span className="itinerary-meals-box__label">🍴 Recommended Eats for Day {currentDayData.dayNumber}:</span>
              <div className="itinerary-meals-box__tags">
                {currentDayData.mealsToTry.map((meal, mIdx) => (
                  <span key={mIdx} className="itinerary-meal-tag">
                    {meal}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Extra Highlights & Tips */}
      {(itinerary.packingHighlights?.length || itinerary.essentialTips?.length) && (
        <div className="itinerary-extras">
          {itinerary.packingHighlights?.length ? (
            <div className="itinerary-extra-card">
              <h4 className="itinerary-extra-card__title">🎒 What to Pack</h4>
              <ul>
                {itinerary.packingHighlights.map((item, pIdx) => (
                  <li key={pIdx}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {itinerary.essentialTips?.length ? (
            <div className="itinerary-extra-card">
              <h4 className="itinerary-extra-card__title">💡 Essential Tips</h4>
              <ul>
                {itinerary.essentialTips.map((tip, tIdx) => (
                  <li key={tIdx}>{tip}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
