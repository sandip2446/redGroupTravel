import {
  extractRegionQuery,
  findPopularDestinations,
  formatDestinationList,
} from '../../lib/explore'
import { searchPlaces } from '../../lib/geocode'
import { detectStopTheme, findStopsAlongTrip } from '../../lib/pois'
import {
  formatDistance,
  formatDuration,
  getRoute,
} from '../../lib/routing'
import type { Place } from '../../types/place'
import type { TripBotResult, TripCommand, TripSnapshot } from '../types'

async function resolvePlace(query: string): Promise<Place | null> {
  const q = query.trim().replace(/^["']|["']$/g, '')
  if (q.length < 2) return null
  const results = await searchPlaces(q)
  return results[0] ?? null
}

function cleanPlaceQuery(raw: string): string {
  return raw
    .trim()
    .replace(/[?.!,;]+$/g, '')
    .replace(/^(the|a|an)\s+/i, '')
    .trim()
}

function cmd<T extends TripCommand>(c: T): T {
  return c
}

function tripSummary(trip: TripSnapshot): string {
  if (!trip.from && !trip.to && trip.stops.length === 0) {
    return 'No trip planned yet. Tell me a start and destination, e.g. "Plan a trip from Kathmandu to Pokhara".'
  }
  const parts: string[] = []
  if (trip.from) parts.push(`Start: ${trip.from.name}`)
  trip.stops.forEach((s, i) => parts.push(`Stop ${i + 1}: ${s.name}`))
  if (trip.to) parts.push(`End: ${trip.to.name}`)
  parts.push(`Mode: ${trip.mode}`)
  return parts.join('\n')
}

const HELP = `I understand natural requests. Examples:

• "Explore Niagara region in Ontario Canada and list popular destinations"
• "Plan a trip from Kathmandu to Pokhara"
• "Add major stops where I can enjoy nature"
• "Suggest food stops along the way"
• "Add cultural stops" / "Add towns along the route"
• "Add stop in Bandipur"
• "Drive" / "Walk" / "Bike"
• "Satellite view"
• "What's my trip?"
• "Clear trip"`

const THEME_LABEL: Record<string, string> = {
  nature: 'nature & outdoors',
  scenic: 'scenic viewpoints',
  food: 'food & cafes',
  culture: 'culture & history',
  cities: 'towns & cities',
}

async function suggestThemedStops(
  trip: TripSnapshot,
  theme: NonNullable<ReturnType<typeof detectStopTheme>>,
  replaceExisting: boolean,
): Promise<TripBotResult> {
  if (!trip.from || !trip.to) {
    return {
      reply:
        'Plan a trip first (start and destination), then I can suggest stops along the way.',
      commands: [],
    }
  }

  try {
    const found = await findStopsAlongTrip(trip.from, trip.to, theme, {
      limit: 3,
    })

    if (found.length === 0) {
      return {
        reply: `I couldn't find good ${THEME_LABEL[theme]} stops along this corridor. Try a different theme or add a place by name.`,
        commands: [cmd({ type: 'openDirections' })],
      }
    }

    const list = found.map((p, i) => `${i + 1}. ${p.name} (${p.description})`).join('\n')
    const commands: TripCommand[] = replaceExisting
      ? [cmd({ type: 'setStops', places: found })]
      : found.map((place) => cmd({ type: 'addStop', place }))
    commands.push(cmd({ type: 'openDirections' }))

    let timing = ''
    try {
      const route = await getRoute(
        trip.from,
        trip.to,
        trip.mode,
        undefined,
        replaceExisting ? found : [...trip.stops, ...found],
      )
      timing = `\n\nUpdated route: ${formatDuration(route.durationSeconds)} · ${formatDistance(route.distanceMeters)}`
    } catch {
      timing = '\n\nStops are on the map — routing will refresh shortly.'
    }

    return {
      reply: `Added ${found.length} ${THEME_LABEL[theme]} stop${found.length > 1 ? 's' : ''} along ${trip.from.name} → ${trip.to.name}:\n\n${list}${timing}`,
      commands,
    }
  } catch {
    return {
      reply:
        'I had trouble looking up places along your route. Please try again in a moment.',
      commands: [],
    }
  }
}

export async function handleLocalMessage(
  message: string,
  trip: TripSnapshot,
): Promise<TripBotResult> {
  const text = message.trim()
  const lower = text.toLowerCase()

  if (!text) {
    return { reply: 'Tell me where you want to go.', commands: [] }
  }

  if (/^(help|what can you do|commands)\b/i.test(lower)) {
    return { reply: HELP, commands: [] }
  }

  if (/^(hi|hello|hey)\b/i.test(lower)) {
    return {
      reply:
        'Hi! Try "Explore Niagara region in Ontario and list popular destinations", or plan a route and ask for nature stops.',
      commands: [],
    }
  }

  // Explore a region / list popular destinations
  if (
    /\b(explore|popular destinations?|things to do|places to visit|list.+destinations?)\b/i.test(
      lower,
    )
  ) {
    const region = extractRegionQuery(text)
    if (region) {
      try {
        const { region: regionPlace, destinations } =
          await findPopularDestinations(region, { limit: 10 })
        return {
          reply: formatDestinationList(regionPlace.name, destinations),
          commands: [
            cmd({
              type: 'setExplorePlaces',
              places: destinations,
              region: regionPlace,
            }),
          ],
        }
      } catch {
        return {
          reply: `I couldn't explore "${region}". Try a clearer region name.`,
          commands: [],
        }
      }
    }
  }

  if (
    /what('?s| is) my (trip|route|plan)|trip summary|show (my )?trip/i.test(
      lower,
    )
  ) {
    return {
      reply: tripSummary(trip),
      commands: [cmd({ type: 'openDirections' })],
    }
  }

  if (/^(clear|reset) (trip|route|all|everything)|^start over$/i.test(lower)) {
    return {
      reply: 'Cleared the trip and map pins.',
      commands: [cmd({ type: 'clearTrip' })],
    }
  }

  if (/clear stops?|remove all stops?/i.test(lower)) {
    return {
      reply: 'Removed all stops.',
      commands: [
        cmd({ type: 'clearStops' }),
        cmd({ type: 'openDirections' }),
      ],
    }
  }

  if (/swap|reverse (the )?(route|trip|directions)/i.test(lower)) {
    if (!trip.from && !trip.to) {
      return { reply: 'Set a start and destination first.', commands: [] }
    }
    return {
      reply: 'Swapped start and destination.',
      commands: [cmd({ type: 'swap' }), cmd({ type: 'openDirections' })],
    }
  }

  if (
    /use my location|my location as (start|from)|start (from )?my location|from my location/i.test(
      lower,
    )
  ) {
    return {
      reply: 'Using your current location as the start point…',
      commands: [
        cmd({ type: 'useMyLocationAsFrom' }),
        cmd({ type: 'openDirections' }),
      ],
    }
  }

  // Smart themed stops (nature / food / culture / cities) — BEFORE generic "add stop"
  const theme = detectStopTheme(text)
  const asksForStops =
    /\b(add|suggest|recommend|find|show|include|put)\b/.test(lower) ||
    /\bstops?\b/.test(lower) ||
    /\balong (the )?(way|route|trip)\b/.test(lower) ||
    /\ben\s+route\b/.test(lower) ||
    /\bwhere i can\b/.test(lower) ||
    /\bplaces? (to|for)\b/.test(lower)

  if (theme && asksForStops) {
    const replace =
      /\breplace\b|\binstead\b|\bmajor stops\b|\bbest stops\b/.test(lower) ||
      trip.stops.length === 0
    return suggestThemedStops(trip, theme, replace)
  }

  // Map style
  if (/\b(satellite|aerial)\b/i.test(lower) && !/\bto\b/i.test(lower)) {
    return {
      reply: 'Switched to satellite view.',
      commands: [cmd({ type: 'setMapStyle', style: 'satellite' })],
    }
  }
  if (/\bterrain\b|\btopo\b/i.test(lower)) {
    return {
      reply: 'Switched to terrain view.',
      commands: [cmd({ type: 'setMapStyle', style: 'terrain' })],
    }
  }
  if (/\b(street map|map view|default map)\b/i.test(lower)) {
    return {
      reply: 'Switched to street map.',
      commands: [cmd({ type: 'setMapStyle', style: 'street' })],
    }
  }

  // Travel mode
  if (
    /^(drive|driving|car|by car)\b/i.test(lower) ||
    /\b(switch to|set) (drive|driving|car)\b/i.test(lower)
  ) {
    return {
      reply: 'Travel mode set to driving.',
      commands: [
        cmd({ type: 'setMode', mode: 'driving' }),
        cmd({ type: 'openDirections' }),
      ],
    }
  }
  if (
    /^(walk|walking|on foot|by foot)\b/i.test(lower) ||
    /\b(switch to|set) (walk|walking)\b/i.test(lower)
  ) {
    return {
      reply: 'Travel mode set to walking.',
      commands: [
        cmd({ type: 'setMode', mode: 'walking' }),
        cmd({ type: 'openDirections' }),
      ],
    }
  }
  if (
    /^(bike|biking|cycle|cycling|by bike)\b/i.test(lower) ||
    /\b(switch to|set) (bike|cycling)\b/i.test(lower)
  ) {
    return {
      reply: 'Travel mode set to cycling.',
      commands: [
        cmd({ type: 'setMode', mode: 'cycling' }),
        cmd({ type: 'openDirections' }),
      ],
    }
  }

  // Remove stop by name
  const removeStop = lower.match(
    /(?:remove|delete|drop)\s+stop\s+(?:at\s+|in\s+|of\s+)?(.+)$/i,
  )
  if (removeStop) {
    const name = cleanPlaceQuery(removeStop[1])
    return {
      reply: `Removing stop matching "${name}".`,
      commands: [
        cmd({ type: 'removeStop', name }),
        cmd({ type: 'openDirections' }),
      ],
    }
  }

  // Add a named stop (not themed)
  const addStop = text.match(
    /(?:add\s+(?:a\s+)?stop|stop\s+at|stop\s+in|via|through)\s+(.+)$/i,
  )
  if (
    addStop &&
    !/\bfrom\b.+\bto\b/i.test(text) &&
    !detectStopTheme(addStop[1])
  ) {
    const query = cleanPlaceQuery(addStop[1])
    // Skip if this looks like a theme phrase rather than a place name
    if (
      !/nature|food|culture|cities|scenic|major|enjoy|along/i.test(query)
    ) {
      const place = await resolvePlace(query)
      if (!place) {
        return {
          reply: `I couldn't find "${query}". Try a clearer place name, or say "add nature stops".`,
          commands: [],
        }
      }
      return {
        reply: `Added stop: ${place.name}${place.description ? ` (${place.description})` : ''}.`,
        commands: [
          cmd({ type: 'addStop', place }),
          cmd({ type: 'openDirections' }),
        ],
      }
    }
  }

  // Set start
  const setStart = text.match(
    /(?:set\s+)?(?:start|from|origin|starting\s+point)\s+(?:to\s+|at\s+|in\s+)?(.+)$/i,
  )
  if (
    setStart &&
    !/\bto\b/i.test(setStart[1]) &&
    !/\bfrom\b.+\bto\b/i.test(text)
  ) {
    const query = cleanPlaceQuery(setStart[1])
    const place = await resolvePlace(query)
    if (!place) {
      return { reply: `I couldn't find "${query}".`, commands: [] }
    }
    return {
      reply: `Start set to ${place.name}.`,
      commands: [
        cmd({ type: 'setFrom', place }),
        cmd({ type: 'openDirections' }),
      ],
    }
  }

  // Set destination
  const setEnd = text.match(
    /(?:set\s+)?(?:destination|end|finish|ending\s+point)\s+(?:to\s+|at\s+|in\s+)?(.+)$/i,
  )
  if (setEnd && !/^from\s+/i.test(text) && !/\bfrom\b.+\bto\b/i.test(text)) {
    const query = cleanPlaceQuery(setEnd[1])
    const place = await resolvePlace(query)
    if (!place) {
      return { reply: `I couldn't find "${query}".`, commands: [] }
    }
    return {
      reply: `Destination set to ${place.name}.`,
      commands: [
        cmd({ type: 'setTo', place }),
        cmd({ type: 'openDirections' }),
      ],
    }
  }

  // Plan trip: from X to Y via Z (incl. "I want to travel from…")
  const plan =
    text.match(
      /(?:want\s+to\s+)?(?:travel|go|drive|fly|get)\s+from\s+(.+?)\s+to\s+(.+?)(?:\s+(?:via|through|with\s+stop\s+(?:at|in))\s+(.+))?$/i,
    ) ||
    text.match(
      /(?:plan\s+(?:a\s+)?(?:trip|route|journey)\s+)?(?:from\s+)(.+?)\s+to\s+(.+?)(?:\s+(?:via|through|with\s+stop\s+(?:at|in))\s+(.+))?$/i,
    ) ||
    text.match(/^(.+?)\s+to\s+(.+?)(?:\s+(?:via|through)\s+(.+))?$/i)

  if (plan) {
    const fromQuery = cleanPlaceQuery(plan[1])
    const toQuery = cleanPlaceQuery(plan[2])
    const viaQuery = plan[3] ? cleanPlaceQuery(plan[3]) : null

    if (
      !/^(drive|driving|walk|walking|bike|cycling|car|satellite|terrain)$/i.test(
        toQuery,
      )
    ) {
      const [fromPlace, toPlace, viaPlace] = await Promise.all([
        resolvePlace(fromQuery),
        resolvePlace(toQuery),
        viaQuery ? resolvePlace(viaQuery) : Promise.resolve(null),
      ])

      if (!fromPlace) {
        return {
          reply: `I couldn't find start "${fromQuery}".`,
          commands: [],
        }
      }
      if (!toPlace) {
        return {
          reply: `I couldn't find destination "${toQuery}".`,
          commands: [],
        }
      }
      if (viaQuery && !viaPlace) {
        return {
          reply: `I couldn't find stop "${viaQuery}".`,
          commands: [],
        }
      }

      const commands: TripCommand[] = [
        cmd({ type: 'clearStops' }),
        cmd({ type: 'setFrom', place: fromPlace }),
        cmd({ type: 'setTo', place: toPlace }),
      ]
      if (viaPlace) commands.push(cmd({ type: 'addStop', place: viaPlace }))
      commands.push(cmd({ type: 'openDirections' }))

      let timing = ''
      try {
        const route = await getRoute(
          fromPlace,
          toPlace,
          trip.mode,
          undefined,
          viaPlace ? [viaPlace] : [],
        )
        timing = `\n\n${formatDuration(route.durationSeconds)} · ${formatDistance(route.distanceMeters)} (${trip.mode})\n\nTip: say "add nature stops" or "suggest food along the way".`
      } catch {
        timing =
          '\n\nRoute is drawing on the map.\n\nTip: say "add nature stops" for scenic breaks.'
      }

      const viaText = viaPlace ? ` via ${viaPlace.name}` : ''
      return {
        reply: `Trip planned: ${fromPlace.name} →${viaText ? `${viaText} →` : ' '}${toPlace.name}.${timing}`,
        commands,
      }
    }
  }

  // Go to / show place
  const goTo = text.match(
    /(?:go to|show|fly to|find|search|locate|zoom to|take me to)\s+(.+)$/i,
  )
  if (goTo) {
    const query = cleanPlaceQuery(goTo[1])
    const place = await resolvePlace(query)
    if (!place) {
      return { reply: `I couldn't find "${query}".`, commands: [] }
    }
    return {
      reply: `Showing ${place.name}${place.description ? ` — ${place.description}` : ''}.`,
      commands: [cmd({ type: 'select', place })],
    }
  }

  // If theme detected but phrasing was odd, still try when trip exists
  if (theme && trip.from && trip.to) {
    return suggestThemedStops(trip, theme, trip.stops.length === 0)
  }

  // Fallback place search
  const place = await resolvePlace(text)
  if (place) {
    return {
      reply: `Found ${place.name}. You can say "set start to ${place.name}", "set destination to ${place.name}", or "add stop ${place.name}".`,
      commands: [cmd({ type: 'select', place })],
    }
  }

  return {
    reply: `I'm not sure what you mean. With a trip planned, try:\n• "add major stops where I can enjoy nature"\n• "suggest food stops"\n• "add stop in Bandipur"\n\nOr type "help".`,
    commands: [],
  }
}
