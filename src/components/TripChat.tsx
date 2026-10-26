import { useEffect, useRef, useState } from 'react'
import {
  getAiEngineLabel,
  processTripMessage,
  subscribeModelProgress,
  type ChatMessage,
  type ModelLoadProgress,
  type TripCommand,
  type TripSnapshot,
} from '../ai'
import { MarkdownView } from './MarkdownView'
import { searchPlaces } from '../lib/geocode'

type SuggestionCategory = {
  label: string
  prompts: string[]
}

const CATEGORIZED_SUGGESTIONS: SuggestionCategory[] = [
  {
    label: '✨ Plan Trip',
    prompts: [
      'Plan a 3-day trip to Tokyo with cultural spots, sushi, and anime',
      'Plan a 3-day trip to Niagara Falls and Toronto with nature & wineries',
      'Plan a 4-day romantic getaway to Paris with art and fine dining',
    ],
  },
  {
    label: '❓ Travel Advice',
    prompts: [
      'What should I know before visiting Niagara Falls?',
      'Best time of year to visit Toronto and what to pack?',
      'What food is Niagara known for?',
    ],
  },
  {
    label: '🛣️ Routes & Map',
    prompts: [
      'I want to travel from Niagara Ontario to Toronto',
      'Add major stops where I can enjoy nature',
      'Switch to satellite view',
    ],
  },
]

type TripChatProps = {
  trip: TripSnapshot
  onCommands: (commands: TripCommand[]) => void | Promise<void>
  onOpenSettings?: () => void
  onOpenItineraryTab?: () => void
}

export function TripChat({
  trip,
  onCommands,
  onOpenSettings,
  onOpenItineraryTab,
}: TripChatProps) {
  const engine = getAiEngineLabel()
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text:
        `## 👋 Welcome to Red Group Travel AI!\n\nI am your **AI Travel Agent & Map Navigator**. I can plan complete day-by-day itineraries, answer any travel questions, and control your interactive map.\n\n### 🌟 Try asking:\n• *"Plan a 3-day trip to Tokyo with cultural spots, sushi, and anime"*\n• *"What should I know before visiting Niagara Falls?"*\n• *"I want to travel from Niagara Ontario to Toronto"*\n• *"Best time of year to visit Toronto and what to pack?"*\n• *"Add major stops where I can enjoy nature"*`,
    },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [activeCategory, setActiveCategory] = useState<number>(0)
  const [model, setModel] = useState<ModelLoadProgress>({
    status: 'idle',
    progress: 0,
    message: '',
  })
  const listRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => subscribeModelProgress(setModel), [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, busy, model.status])

  async function handlePlaceTagClick(placeName: string) {
    try {
      const places = await searchPlaces(placeName)
      if (places[0]) {
        await onCommands([{ type: 'select', place: places[0] }])
      }
    } catch {
      // ignore
    }
  }

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || busy) return

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: trimmed,
    }
    const history = [...messages, userMsg]
    setMessages(history)
    setInput('')
    setBusy(true)

    try {
      const result = await processTripMessage(trimmed, trip, history)
      await onCommands(result.commands)

      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: result.reply,
          itinerary: result.itinerary,
        },
      ])
    } catch (err) {
      console.warn('[trip-chat]', err)
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text:
            'I encountered a slight snag processing that. Please try asking again, or explore a route like *"from Niagara Falls to Toronto"*.',
        },
      ])
    } finally {
      setBusy(false)
    }
  }

  const routeLabel =
    trip.from && trip.to
      ? `${trip.from.name} → ${trip.to.name}${
          trip.stops.length
            ? ` · ${trip.stops.length} stop${trip.stops.length > 1 ? 's' : ''}`
            : ''
        }`
      : null

  const engineLabel =
    engine === 'gemini'
      ? 'Gemini 2.0 AI'
      : engine === 'webllm'
        ? 'WebLLM Local'
        : 'Smart Travel AI'

  return (
    <section className="trip-chat" aria-label="Travel guide chat">
      {/* Header bar */}
      <div className="trip-chat__head">
        <span className="trip-chat__avatar" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path
              fill="currentColor"
              d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"
            />
          </svg>
        </span>
        <div className="trip-chat__head-text">
          <p className="trip-chat__title">Red Group Travel AI</p>
          <p className="trip-chat__subtitle">
            {engine === 'gemini'
              ? 'Gemini 2.0 Flash · Cloud AI Agent'
              : 'Smart Travel Engine · Instant Natural Language Agent'}
          </p>
        </div>
        <button
          type="button"
          className="trip-chat__badge trip-chat__badge--clickable"
          onClick={onOpenSettings}
          title="Click to configure AI Engine & API Key"
        >
          <span className="trip-chat__badge-dot" />
          {engineLabel}
          <span className="trip-chat__badge-gear">⚙️</span>
        </button>
      </div>

      {model.status === 'loading' && (
        <div className="trip-chat__model" role="status">
          <div className="trip-chat__model-top">
            <span>{model.message || 'Loading on-device model…'}</span>
            <strong>{model.progress}%</strong>
          </div>
          <div className="trip-chat__model-track">
            <div
              className="trip-chat__model-fill"
              style={{ width: `${model.progress}%` }}
            />
          </div>
        </div>
      )}

      {routeLabel && (
        <div className="trip-chat__route" title={routeLabel}>
          <span className="trip-chat__route-dot" aria-hidden="true" />
          <span className="trip-chat__route-text">{routeLabel}</span>
          <span className="trip-chat__route-mode">({trip.mode})</span>
        </div>
      )}

      {/* Messages list */}
      <div className="trip-chat__messages" ref={listRef}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`trip-chat__row trip-chat__row--${msg.role}`}
          >
            {msg.role === 'assistant' && (
              <span className="trip-chat__mini-avatar" aria-hidden="true">
                ✨
              </span>
            )}
            <div className={`trip-chat__bubble trip-chat__bubble--${msg.role}`}>
              {msg.role === 'assistant' ? (
                <>
                  <MarkdownView
                    content={msg.text}
                    onPlaceClick={handlePlaceTagClick}
                  />
                  {msg.itinerary && (
                    <div className="chat-itinerary-banner">
                      <div className="chat-itinerary-banner__text">
                        <strong>🗓️ {msg.itinerary.title}</strong>
                        <span>
                          {msg.itinerary.durationDays} Days · {msg.itinerary.days.length} Day Plans Created
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn-primary btn-sm chat-itinerary-banner__btn"
                        onClick={onOpenItineraryTab}
                      >
                        Open Itinerary Tab →
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <p>{msg.text}</p>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="trip-chat__row trip-chat__row--assistant">
            <span className="trip-chat__mini-avatar" aria-hidden="true">
              ✨
            </span>
            <div className="trip-chat__bubble trip-chat__bubble--assistant trip-chat__typing">
              <span className="trip-chat__typing-label">Planning your trip…</span>
              <span className="trip-chat__dots" aria-label="Thinking">
                <i />
                <i />
                <i />
              </span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Footer & input */}
      <div className="trip-chat__footer">
        {/* Suggestion Category Tabs */}
        <div className="trip-chat__cat-tabs">
          {CATEGORIZED_SUGGESTIONS.map((cat, idx) => (
            <button
              key={cat.label}
              type="button"
              className={`trip-chat__cat-btn ${activeCategory === idx ? 'is-active' : ''}`}
              onClick={() => setActiveCategory(idx)}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Suggestion Chips */}
        <div className="trip-chat__suggestions" role="list">
          {CATEGORIZED_SUGGESTIONS[activeCategory].prompts.map((s) => (
            <button
              key={s}
              type="button"
              className="trip-chat__chip"
              disabled={busy}
              onClick={() => send(s)}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Quick action bar */}
        <div className="trip-chat__quick-actions">
          <button
            type="button"
            className="quick-action-pill"
            onClick={() => send('Switch to driving')}
            disabled={busy}
            title="Set mode to driving"
          >
            🚗 Drive
          </button>
          <button
            type="button"
            className="quick-action-pill"
            onClick={() => send('Switch to walking')}
            disabled={busy}
            title="Set mode to walking"
          >
            🚶 Walk
          </button>
          <button
            type="button"
            className="quick-action-pill"
            onClick={() => send('Switch to bicycle')}
            disabled={busy}
            title="Set mode to bicycle"
          >
            🚲 Bike
          </button>
          <button
            type="button"
            className="quick-action-pill"
            onClick={() => send('Switch to satellite view')}
            disabled={busy}
            title="Switch map to satellite view"
          >
            🛰️ Satellite
          </button>
          <button
            type="button"
            className="quick-action-pill"
            onClick={() => send('Add major stops where I can enjoy nature')}
            disabled={busy}
            title="Find nature stops"
          >
            🌿 Nature Stops
          </button>
        </div>

        {/* Composer input */}
        <form
          className="trip-chat__composer"
          onSubmit={(e) => {
            e.preventDefault()
            void send(input)
          }}
        >
          <textarea
            className="trip-chat__input"
            placeholder="Ask any travel question or say 'Plan a 3-day trip to Tokyo'…"
            value={input}
            disabled={busy}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send(input)
              }
            }}
            aria-label="Chat message"
          />
          <button
            type="submit"
            className="trip-chat__send"
            disabled={busy || !input.trim()}
            aria-label="Send message"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path fill="currentColor" d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </form>
      </div>
    </section>
  )
}
