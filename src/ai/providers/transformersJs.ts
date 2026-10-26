import { extractRegionQuery } from '../../lib/explore'
import { getIntentClassifier } from '../modelLoader'
import type { AiAction, AiPlan, TripSnapshot } from '../types'

/**
 * Candidate intents for Transformers.js zero-shot classification.
 * Labels are natural English so MobileBERT-MNLI can score them well.
 */
const INTENT_LABELS = [
  'plan a trip from one place to another',
  'set the starting point of the trip',
  'set the destination of the trip',
  'add a specific named stop on the route',
  'suggest nature or outdoor stops along the route',
  'suggest food or restaurant stops along the route',
  'suggest cultural or historic stops along the route',
  'suggest towns or cities along the route',
  'suggest scenic viewpoint stops along the route',
  'remove a stop from the trip',
  'clear all stops',
  'clear the whole trip',
  'switch travel mode to driving a car',
  'switch travel mode to walking',
  'switch travel mode to bicycle',
  'switch map to satellite view',
  'switch map to terrain view',
  'switch map to street map view',
  'show a place on the map',
  'explore a region and list popular destinations',
  'swap start and destination',
  'use my current location as start',
  'ask for a summary of the current planned route',
  'ask for help',
  'greet the assistant',
] as const

type IntentLabel = (typeof INTENT_LABELS)[number]

function cleanPlace(raw: string): string {
  return raw
    .trim()
    .replace(/[?.!,;]+$/g, '')
    .replace(/^(the|a|an)\s+/i, '')
    .trim()
}

const MODE_WORDS =
  /^(drive|driving|walk|walking|bike|biking|cycling|car|satellite|terrain|street)$/i

function extractFromTo(text: string): {
  from?: string
  to?: string
  via?: string
} {
  const plan = text.match(
    /(?:want\s+to\s+)?(?:travel|go|drive|fly|get)\s+from\s+(.+?)\s+to\s+(.+?)(?:\s+(?:via|through|with\s+stop(?:s)?\s+(?:at|in)?)\s+(.+))?$/i,
  ) ||
    text.match(
      /(?:plan\s+(?:a\s+)?(?:trip|route|journey)\s+)?from\s+(.+?)\s+to\s+(.+?)(?:\s+(?:via|through|with\s+stop(?:s)?\s+(?:at|in)?)\s+(.+))?$/i,
    )
  if (plan) {
    const from = cleanPlace(plan[1])
    const to = cleanPlace(plan[2])
    if (from.length >= 2 && to.length >= 2 && !MODE_WORDS.test(to)) {
      return {
        from,
        to,
        via: plan[3] ? cleanPlace(plan[3]) : undefined,
      }
    }
  }
  const simple = text.match(/^(.+?)\s+to\s+(.+)$/i)
  if (simple) {
    const from = cleanPlace(simple[1])
    const to = cleanPlace(simple[2])
    if (
      from.length >= 2 &&
      to.length >= 2 &&
      !MODE_WORDS.test(to) &&
      !/\b(i want|please|can you|help)\b/i.test(from)
    ) {
      return { from, to }
    }
  }
  return {}
}

function looksLikeTripPlan(message: string): {
  from: string
  to: string
  via?: string
} | null {
  if (/\b(what'?s|what is|summary|summarize|show my trip)\b/i.test(message)) {
    return null
  }
  if (!/\bfrom\b.+\bto\b/i.test(message)) return null
  const { from, to, via } = extractFromTo(message)
  if (!from || !to) return null
  return { from, to, via }
}

function extractPlaceAfter(
  text: string,
  patterns: RegExp[],
): string | undefined {
  for (const re of patterns) {
    const m = text.match(re)
    if (m?.[1]) return cleanPlace(m[1])
  }
  return undefined
}

function intentToActions(
  intent: IntentLabel,
  message: string,
  trip: TripSnapshot,
): { actions: AiAction[]; reply: string } {
  switch (intent) {
    case 'plan a trip from one place to another': {
      const { from, to, via } = extractFromTo(message)
      if (from && to) {
        return {
          actions: [{ action: 'plan_trip', from, to, via }],
          reply: via
            ? `Planning ${from} → ${via} → ${to}.`
            : `Planning ${from} → ${to}.`,
        }
      }
      return {
        actions: [],
        reply:
          'Tell me the start and end, for example: "Plan a trip from Kathmandu to Pokhara".',
      }
    }
    case 'set the starting point of the trip': {
      const place =
        extractPlaceAfter(message, [
          /(?:start|from|origin)\s+(?:to\s+|at\s+|in\s+)?(.+)$/i,
        ]) ?? extractFromTo(message).from
      if (!place) {
        return { actions: [], reply: 'Which place should be the start?' }
      }
      return {
        actions: [{ action: 'set_start', place }],
        reply: `Setting start to ${place}.`,
      }
    }
    case 'set the destination of the trip': {
      const place =
        extractPlaceAfter(message, [
          /(?:destination|end|finish)\s+(?:to\s+|at\s+|in\s+)?(.+)$/i,
          /^to\s+(.+)$/i,
        ]) ?? extractFromTo(message).to
      if (!place) {
        return { actions: [], reply: 'Which place should be the destination?' }
      }
      return {
        actions: [{ action: 'set_destination', place }],
        reply: `Setting destination to ${place}.`,
      }
    }
    case 'add a specific named stop on the route': {
      const place = extractPlaceAfter(message, [
        /(?:add\s+(?:a\s+)?stop|stop\s+at|stop\s+in|via)\s+(.+)$/i,
      ])
      if (!place || /nature|food|culture|scenic|major|enjoy/i.test(place)) {
        return {
          actions: [
            {
              action: 'suggest_stops',
              theme: 'scenic',
              replace: trip.stops.length === 0,
            },
          ],
          reply: 'Looking for good stops along your route…',
        }
      }
      return {
        actions: [{ action: 'add_stop', place }],
        reply: `Adding stop: ${place}.`,
      }
    }
    case 'suggest nature or outdoor stops along the route':
      return {
        actions: [{ action: 'suggest_stops', theme: 'nature', replace: true }],
        reply: 'Finding nature stops along your route…',
      }
    case 'suggest food or restaurant stops along the route':
      return {
        actions: [{ action: 'suggest_stops', theme: 'food', replace: true }],
        reply: 'Finding food stops along your route…',
      }
    case 'suggest cultural or historic stops along the route':
      return {
        actions: [{ action: 'suggest_stops', theme: 'culture', replace: true }],
        reply: 'Finding cultural stops along your route…',
      }
    case 'suggest towns or cities along the route':
      return {
        actions: [{ action: 'suggest_stops', theme: 'cities', replace: true }],
        reply: 'Finding towns along your route…',
      }
    case 'suggest scenic viewpoint stops along the route':
      return {
        actions: [{ action: 'suggest_stops', theme: 'scenic', replace: true }],
        reply: 'Finding scenic stops along your route…',
      }
    case 'remove a stop from the trip': {
      const place = extractPlaceAfter(message, [
        /(?:remove|delete|drop)\s+stop\s+(?:at\s+|in\s+)?(.+)$/i,
      ])
      if (!place) {
        return { actions: [], reply: 'Which stop should I remove?' }
      }
      return {
        actions: [{ action: 'remove_stop', place }],
        reply: `Removing stop matching "${place}".`,
      }
    }
    case 'clear all stops':
      return {
        actions: [{ action: 'clear_stops' }],
        reply: 'Clearing all stops.',
      }
    case 'clear the whole trip':
      return {
        actions: [{ action: 'clear_trip' }],
        reply: 'Clearing the trip.',
      }
    case 'switch travel mode to driving a car':
      return {
        actions: [{ action: 'set_mode', mode: 'driving' }],
        reply: 'Switching to driving.',
      }
    case 'switch travel mode to walking':
      return {
        actions: [{ action: 'set_mode', mode: 'walking' }],
        reply: 'Switching to walking.',
      }
    case 'switch travel mode to bicycle':
      return {
        actions: [{ action: 'set_mode', mode: 'cycling' }],
        reply: 'Switching to cycling.',
      }
    case 'switch map to satellite view':
      return {
        actions: [{ action: 'set_map_style', style: 'satellite' }],
        reply: 'Switching to satellite view.',
      }
    case 'switch map to terrain view':
      return {
        actions: [{ action: 'set_map_style', style: 'terrain' }],
        reply: 'Switching to terrain view.',
      }
    case 'switch map to street map view':
      return {
        actions: [{ action: 'set_map_style', style: 'street' }],
        reply: 'Switching to street map.',
      }
    case 'show a place on the map': {
      const place =
        extractPlaceAfter(message, [
          /(?:go to|show|fly to|find|search|locate|take me to)\s+(.+)$/i,
        ]) ?? cleanPlace(message)
      return {
        actions: [{ action: 'show_place', place }],
        reply: `Showing ${place} on the map.`,
      }
    }
    case 'explore a region and list popular destinations': {
      const region =
        extractRegionQuery(message) ||
        extractPlaceAfter(message, [
          /(?:in|around|near)\s+(.+)$/i,
        ]) ||
        cleanPlace(message)
      return {
        actions: [{ action: 'explore_region', region }],
        reply: `Exploring popular destinations in ${region}…`,
      }
    }
    case 'swap start and destination':
      return {
        actions: [{ action: 'swap' }],
        reply: 'Swapping start and destination.',
      }
    case 'use my current location as start':
      return {
        actions: [{ action: 'use_my_location_as_start' }],
        reply: 'Using your current location as the start.',
      }
    case 'ask for a summary of the current planned route':
      return {
        actions: [{ action: 'summarize_trip' }],
        reply: trip.from || trip.to ? 'Here is your trip summary.' : '',
      }
    case 'ask for help':
      return {
        actions: [],
        reply:
          'I can plan trips, add nature/food/culture stops, change drive/walk/bike, and control the map. Try: "Plan a trip from Paris to Rome" then "add nature stops".',
      }
    case 'greet the assistant':
      return {
        actions: [],
        reply:
          'Hi! I run on Hugging Face Transformers.js in your browser — no API key needed. Where should we go?',
      }
    default:
      return {
        actions: [],
        reply: 'I am not sure what you mean. Try planning a trip or asking for nature stops.',
      }
  }
}

/**
 * Understand a message with Transformers.js (on-device, free, no API key).
 */
export async function planWithTransformers(
  message: string,
  trip: TripSnapshot,
): Promise<AiPlan> {
  // Strong explore phrasing should win even if classifier is unsure
  if (
    /\b(explore|popular destinations?|things to do|places to visit|list.+destinations?)\b/i.test(
      message,
    )
  ) {
    const region = extractRegionQuery(message)
    if (region) {
      return {
        reply: `Exploring popular destinations in ${region}…`,
        actions: [{ action: 'explore_region', region }],
      }
    }
  }

  // "travel/go from A to B" must plan a trip — never fall through to summarize
  const planned = looksLikeTripPlan(message)
  if (planned) {
    return {
      reply: planned.via
        ? `Planning ${planned.from} → ${planned.via} → ${planned.to}.`
        : `Planning ${planned.from} → ${planned.to}.`,
      actions: [
        {
          action: 'plan_trip',
          from: planned.from,
          to: planned.to,
          via: planned.via,
        },
        { action: 'open_directions' },
      ],
    }
  }

  const classifier = await getIntentClassifier()
  const result = await classifier(message, [...INTENT_LABELS], {
    multi_label: false,
    hypothesis_template: 'This travel request is about {}.',
  })

  const topLabel = (result.labels[0] ?? INTENT_LABELS[0]) as IntentLabel
  const topScore = result.scores[0] ?? 0

  // Low confidence → try slot-friendly fallbacks before giving up
  if (topScore < 0.18) {
    const { from, to, via } = extractFromTo(message)
    if (from && to) {
      return {
        reply: via
          ? `Planning ${from} → ${via} → ${to}.`
          : `Planning ${from} → ${to}.`,
        actions: [
          { action: 'plan_trip', from, to, via },
          { action: 'open_directions' },
        ],
      }
    }
    if (/nature|outdoor|hike|park|forest|lake/i.test(message)) {
      return {
        reply: 'Finding nature stops along your route…',
        actions: [{ action: 'suggest_stops', theme: 'nature', replace: true }],
      }
    }
  }

  const mapped = intentToActions(topLabel, message, trip)

  // Always open directions when mutating the route
  const needsDirections = mapped.actions.some((a) =>
    [
      'plan_trip',
      'set_start',
      'set_destination',
      'add_stop',
      'suggest_stops',
      'remove_stop',
      'clear_stops',
      'set_mode',
      'swap',
      'use_my_location_as_start',
      'summarize_trip',
    ].includes(a.action),
  )

  const actions = needsDirections
    ? [...mapped.actions, { action: 'open_directions' as const }]
    : mapped.actions

  return {
    reply: mapped.reply,
    actions,
  }
}
