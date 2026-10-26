import {
  findPopularDestinations,
  formatDestinationList,
} from '../lib/explore'
import { searchPlaces } from '../lib/geocode'
import { findStopsAlongTrip, type StopTheme } from '../lib/pois'
import {
  formatDistance,
  formatDuration,
  getRoute,
} from '../lib/routing'
import type {
  AiAction,
  AiPlan,
  TripBotResult,
  TripCommand,
  TripSnapshot,
} from './types'
import type { Place } from '../types/place'

/** Last-resort pins when free geocoders are down. */
const KNOWN_PLACES: Array<{ match: RegExp; place: Place }> = [
  {
    match: /\bniagara(?:[-\s]?on[-\s]?the[-\s]?lake)?\b/i,
    place: {
      id: 'known-niagara-falls-on',
      name: 'Niagara Falls',
      description: 'Ontario, Canada',
      position: [43.0896, -79.0849],
      type: 'city',
    },
  },
  {
    match: /\btoronto\b/i,
    place: {
      id: 'known-toronto',
      name: 'Toronto',
      description: 'Ontario, Canada',
      position: [43.6532, -79.3832],
      type: 'city',
    },
  },
]

async function resolvePlace(query: string): Promise<Place | null> {
  const q = query.trim().replace(/^["']|["']$/g, '')
  if (q.length < 2) return null
  const variants = [
    q,
    /\bontario\b/i.test(q) ? `${q}, Canada` : null,
    /\bniagara\b/i.test(q) && !/\bfalls\b/i.test(q)
      ? 'Niagara Falls, Ontario, Canada'
      : null,
  ].filter((v, i, arr): v is string => Boolean(v) && arr.indexOf(v) === i)

  for (const variant of variants) {
    try {
      const results = await searchPlaces(variant)
      if (results[0]) return results[0]
    } catch {
      // try next / known pin
    }
  }

  const known = KNOWN_PLACES.find((k) => k.match.test(q))
  return known?.place ?? null
}

function summarizeTrip(trip: TripSnapshot): string {
  if (!trip.from && !trip.to && trip.stops.length === 0) {
    return 'No trip planned yet. Try: "travel from Niagara Ontario to Toronto".'
  }
  const parts: string[] = []
  if (trip.from) parts.push(`Start: ${trip.from.name}`)
  trip.stops.forEach((s, i) => parts.push(`Stop ${i + 1}: ${s.name}`))
  if (trip.to) parts.push(`End: ${trip.to.name}`)
  parts.push(`Mode: ${trip.mode}`)
  return parts.join('\n')
}

/** Turn LLM / local AI plan into map commands + a user-facing reply. */
export async function executeAiPlan(
  plan: AiPlan,
  trip: TripSnapshot,
): Promise<TripBotResult> {
  const commands: TripCommand[] = []
  const notes: string[] = []
  let workingStops = [...trip.stops]
  let workingFrom = trip.from
  let workingTo = trip.to

  for (const action of plan.actions) {
    const result = await runAction(action, {
      trip,
      workingFrom,
      workingTo,
      workingStops,
    })
    commands.push(...result.commands)
    if (result.note) notes.push(result.note)
    if (result.workingFrom !== undefined) workingFrom = result.workingFrom
    if (result.workingTo !== undefined) workingTo = result.workingTo
    if (result.workingStops !== undefined) workingStops = result.workingStops
  }

  // Attach timing if we have a full route after actions
  if (workingFrom && workingTo) {
    const hasRouteChange = commands.some((c) =>
      [
        'setFrom',
        'setTo',
        'addStop',
        'setStops',
        'clearStops',
        'setMode',
        'swap',
      ].includes(c.type),
    )
    if (hasRouteChange || plan.actions.some((a) => a.action === 'plan_trip')) {
      try {
        const route = await getRoute(
          workingFrom,
          workingTo,
          trip.mode,
          undefined,
          workingStops,
        )
        notes.push(
          `${formatDuration(route.durationSeconds)} · ${formatDistance(route.distanceMeters)} (${trip.mode})`,
        )
      } catch {
        // ignore timing failures
      }
    }
  }

  if (plan.itinerary) {
    commands.push({ type: 'setItinerary', itinerary: plan.itinerary })
  }

  const replyParts = [plan.reply.trim(), ...notes.filter(Boolean)]
  return {
    reply: replyParts.filter(Boolean).join('\n\n'),
    commands,
    itinerary: plan.itinerary,
  }
}

type Working = {
  trip: TripSnapshot
  workingFrom: Place | null
  workingTo: Place | null
  workingStops: Place[]
}

type ActionResult = {
  commands: TripCommand[]
  note?: string
  workingFrom?: Place | null
  workingTo?: Place | null
  workingStops?: Place[]
}

async function runAction(
  action: AiAction,
  ctx: Working,
): Promise<ActionResult> {
  switch (action.action) {
    case 'plan_trip': {
      const [fromPlace, toPlace, viaPlace] = await Promise.all([
        resolvePlace(action.from),
        resolvePlace(action.to),
        action.via ? resolvePlace(action.via) : Promise.resolve(null),
      ])
      if (!fromPlace) {
        return { commands: [], note: `Could not find start "${action.from}".` }
      }
      if (!toPlace) {
        return {
          commands: [],
          note: `Could not find destination "${action.to}".`,
        }
      }
      const stops = viaPlace ? [viaPlace] : []
      const commands: TripCommand[] = [
        { type: 'clearStops' },
        { type: 'setFrom', place: fromPlace },
        { type: 'setTo', place: toPlace },
        ...(viaPlace ? [{ type: 'addStop' as const, place: viaPlace }] : []),
        { type: 'openDirections' },
      ]
      return {
        commands,
        workingFrom: fromPlace,
        workingTo: toPlace,
        workingStops: stops,
      }
    }
    case 'set_start': {
      const place = await resolvePlace(action.place)
      if (!place) return { commands: [], note: `Could not find "${action.place}".` }
      return {
        commands: [
          { type: 'setFrom', place },
          { type: 'openDirections' },
        ],
        workingFrom: place,
      }
    }
    case 'set_destination': {
      const place = await resolvePlace(action.place)
      if (!place) return { commands: [], note: `Could not find "${action.place}".` }
      return {
        commands: [
          { type: 'setTo', place },
          { type: 'openDirections' },
        ],
        workingTo: place,
      }
    }
    case 'add_stop': {
      const place = await resolvePlace(action.place)
      if (!place) return { commands: [], note: `Could not find "${action.place}".` }
      return {
        commands: [
          { type: 'addStop', place },
          { type: 'openDirections' },
        ],
        workingStops: [...ctx.workingStops, place],
      }
    }
    case 'suggest_stops': {
      if (!ctx.workingFrom || !ctx.workingTo) {
        return {
          commands: [],
          note: 'Plan a start and destination first, then I can suggest stops.',
        }
      }
      const theme = action.theme as StopTheme
      const found = await findStopsAlongTrip(
        ctx.workingFrom,
        ctx.workingTo,
        theme,
        { limit: 3 },
      )
      if (found.length === 0) {
        return {
          commands: [],
          note: `No good ${theme} stops found along this route.`,
        }
      }
      const list = found
        .map((p, i) => `${i + 1}. ${p.name} (${p.description})`)
        .join('\n')
      const replace = action.replace !== false
      return {
        commands: replace
          ? [
              { type: 'setStops', places: found },
              { type: 'openDirections' },
            ]
          : [
              ...found.map((place) => ({ type: 'addStop' as const, place })),
              { type: 'openDirections' },
            ],
        note: `Stops:\n${list}`,
        workingStops: replace ? found : [...ctx.workingStops, ...found],
      }
    }
    case 'remove_stop':
      return {
        commands: [
          { type: 'removeStop', name: action.place },
          { type: 'openDirections' },
        ],
        workingStops: ctx.workingStops.filter(
          (s) =>
            !s.name.toLowerCase().includes(action.place.toLowerCase()),
        ),
      }
    case 'clear_stops':
      return {
        commands: [
          { type: 'clearStops' },
          { type: 'openDirections' },
        ],
        workingStops: [],
      }
    case 'clear_trip':
      return {
        commands: [{ type: 'clearTrip' }],
        workingFrom: null,
        workingTo: null,
        workingStops: [],
      }
    case 'set_mode':
      return {
        commands: [
          { type: 'setMode', mode: action.mode },
          { type: 'openDirections' },
        ],
      }
    case 'set_map_style':
      return {
        commands: [{ type: 'setMapStyle', style: action.style }],
      }
    case 'show_place': {
      const place = await resolvePlace(action.place)
      if (!place) return { commands: [], note: `Could not find "${action.place}".` }
      return { commands: [{ type: 'select', place }] }
    }
    case 'explore_region': {
      try {
        const { region, destinations } = await findPopularDestinations(
          action.region,
          { limit: 10 },
        )
        return {
          commands: [
            { type: 'setExplorePlaces', places: destinations, region },
          ],
          note: formatDestinationList(region.name, destinations),
        }
      } catch {
        return {
          commands: [],
          note: `I couldn't explore "${action.region}". Try a clearer region name.`,
        }
      }
    }
    case 'swap':
      return {
        commands: [
          { type: 'swap' },
          { type: 'openDirections' },
        ],
        workingFrom: ctx.workingTo,
        workingTo: ctx.workingFrom,
      }
    case 'use_my_location_as_start':
      return {
        commands: [
          { type: 'useMyLocationAsFrom' },
          { type: 'openDirections' },
        ],
      }
    case 'set_itinerary':
      return {
        commands: [{ type: 'setItinerary', itinerary: action.itinerary }],
      }
    case 'open_directions':
      return { commands: [{ type: 'openDirections' }] }
    case 'summarize_trip':
      return {
        commands: [{ type: 'openDirections' }],
        note: summarizeTrip({
          ...ctx.trip,
          from: ctx.workingFrom,
          to: ctx.workingTo,
          stops: ctx.workingStops,
        }),
      }
    default:
      return { commands: [] }
  }
}
