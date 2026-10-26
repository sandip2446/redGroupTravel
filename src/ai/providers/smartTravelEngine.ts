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
import type { ItineraryDay, TripItinerary } from '../../types/itinerary'
import type { TripBotResult, TripCommand, TripSnapshot } from '../types'

/** Helper to clean query text */
function cleanQuery(raw: string): string {
  return raw
    .trim()
    .replace(/[?.!,;]+$/g, '')
    .replace(/^(the|a|an)\s+/i, '')
    .trim()
}

/** Fetch live summary from Wikipedia REST API */
async function fetchWikiInfo(topic: string): Promise<{ title: string; extract: string } | null> {
  const cleaned = topic.replace(/\b(region|area|city|country|state|province)\b/gi, '').trim()
  const candidates = [topic, cleaned, `${cleaned} (city)`, `${cleaned} (country)`]

  for (const c of candidates) {
    if (!c || c.length < 2) continue
    try {
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(c)}`
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!res.ok) continue
      const data = (await res.json()) as { type?: string; title?: string; extract?: string }
      if (data.type === 'disambiguation') continue
      if (data.extract && data.extract.length > 30) {
        return {
          title: data.title ?? c,
          extract: data.extract,
        }
      }
    } catch {
      // try next candidate
    }
  }
  return null
}

/** Extract number of days from natural language like "3-day", "5 days", "one week" */
function extractTripDuration(text: string): number {
  const mDays = text.match(/(\d+)\s*[- ]*(?:day|days)/i)
  if (mDays) return Math.min(14, Math.max(1, parseInt(mDays[1], 10)))

  if (/\bweekend\b/i.test(text)) return 2
  if (/\b(?:a|1)\s*week\b/i.test(text)) return 7
  if (/\b2\s*weeks\b/i.test(text)) return 14
  return 3 // sensible default
}

/** Curated rich travel knowledge for high-frequency destinations and common advice */
const DESTINATION_INSIGHTS: Record<
  string,
  {
    vibe: string
    bestTime: string
    foods: string[]
    highlights: string[]
    packing: string[]
    tips: string[]
    days: Array<{
      theme: string
      morning: { title: string; desc: string; loc?: string }
      afternoon: { title: string; desc: string; loc?: string }
      evening: { title: string; desc: string; loc?: string }
    }>
  }
> = {
  niagara: {
    vibe: 'Scenic Natural Wonder & Wine Country',
    bestTime: 'June through August for peak attractions; September-October for wineries and autumn colors.',
    foods: ['Niagara Icewine', 'Peach Pie & Butter Tarts', 'Lake Erie Pickerel', 'Farm-to-Table Dining in Wine Country'],
    highlights: ['Horseshoe Falls', 'Journey Behind the Falls', 'Niagara-on-the-Lake', 'White Water Walk', 'Skylon Tower'],
    packing: ['Waterproof hooded poncho / rain jacket', 'Sturdy non-slip walking shoes', 'Passport for US/Canada border crossing', 'Waterproof phone pouch'],
    tips: ['Book Hornblower / Maid of the Mist early morning to avoid lines.', 'Visit Niagara-on-the-Lake for historic charm away from tourist strips.', 'Watch the nightly falls illumination and seasonal fireworks.'],
    days: [
      {
        theme: 'The Iconic Falls & Maid of the Mist',
        morning: {
          title: 'Journey Behind the Falls & Table Rock',
          desc: 'Stand directly at the brink of the thundering Canadian Horseshoe Falls and explore historic bedrock tunnels.',
          loc: 'Table Rock Welcome Centre, Niagara Falls',
        },
        afternoon: {
          title: 'Hornblower / Niagara City Boat Cruise',
          desc: 'Sail into the mist of the Great Gorge and feel the awe-inspiring power of the cascading water up close.',
          loc: 'Niagara Falls Boat Tour, Niagara Falls',
        },
        evening: {
          title: 'Skylon Tower & Falls Illumination',
          desc: 'Elevator ride up 775 feet for panoramic twilight views, followed by the multi-colored evening illumination.',
          loc: 'Skylon Tower, Niagara Falls',
        },
      },
      {
        theme: 'Wine Country & Historic Charm',
        morning: {
          title: 'Niagara-on-the-Lake Heritage District',
          desc: 'Wander 19th-century Queen Street with horse-drawn carriages, boutique chocolatiers, and artisan bakeries.',
          loc: 'Niagara-on-the-Lake',
        },
        afternoon: {
          title: 'Winery Tour & Icewine Tasting',
          desc: 'Visit award-winning vineyards (Peller Estates, Inniskillin) and sample world-famous Canadian icewines.',
          loc: 'Inniskillin Winery, Niagara-on-the-Lake',
        },
        evening: {
          title: 'Fort George & Waterfront Sunset',
          desc: 'Explore the War of 1812 stronghold and watch the sun dip across Lake Ontario over sunset dining.',
          loc: 'Fort George National Historic Site',
        },
      },
      {
        theme: 'Gorge Adventure & Scenic Parkway',
        morning: {
          title: 'White Water Walk & Whirlpool Aero Car',
          desc: 'Board a vintage cable car suspended above Class 6 rapids, followed by a boardwalk hike along the river.',
          loc: 'Whirlpool Aero Car, Niagara Falls',
        },
        afternoon: {
          title: 'Niagara Glen Nature Reserve Hike',
          desc: 'Hike through Carolinian forest bouldering trails down to the turquoise Niagara River whirlpool.',
          loc: 'Niagara Glen Nature Centre',
        },
        evening: {
          title: 'Clifton Hill Fun & Casual Fare',
          desc: 'Experience the bustling neon entertainment district, giant Ferris Wheel, and festive Canadian poutine.',
          loc: 'Clifton Hill, Niagara Falls',
        },
      },
    ],
  },
  toronto: {
    vibe: 'Cosmopolitan, Culturally Diverse & Vibrant',
    bestTime: 'May to October for warm patio season, lake breezes, and TIFF film festival.',
    foods: ['Peameal Bacon Sandwich at St. Lawrence', 'Kensington Market Tacos & Dumplings', 'Butter Tarts', 'Multicultural Food Crawl in Chinatown & Little Italy'],
    highlights: ['CN Tower', 'Royal Ontario Museum (ROM)', 'Toronto Islands', 'Distillery Historic District', 'St. Lawrence Market'],
    packing: ['Comfortable sneakers for walking', 'Layered clothing', 'Presto card for subways/streetcars'],
    tips: ['Take the ferry or water taxi to Centre Island for the best skyline sunset view.', 'Rent a bike along the Waterfront Trail.'],
    days: [
      {
        theme: 'Icons & Historic Cobblestone',
        morning: {
          title: 'St. Lawrence Market & Breakfast',
          desc: 'Start with the legendary Carousel Bakery peameal bacon sandwich and explore artisan food stalls.',
          loc: 'St. Lawrence Market, Toronto',
        },
        afternoon: {
          title: 'CN Tower & Ripley’s Aquarium',
          desc: 'Ascend to the glass floor observation deck for sweeping lake vistas, then walk through shark lagoons.',
          loc: 'CN Tower, Toronto',
        },
        evening: {
          title: 'Distillery Historic District Dinner',
          desc: 'Dine in preserved Victorian industrial red-brick courtyards featuring craft breweries and indie bistros.',
          loc: 'Distillery District, Toronto',
        },
      },
      {
        theme: 'Culture & Island Escapes',
        morning: {
          title: 'Royal Ontario Museum (ROM)',
          desc: 'Discover world-class dinosaur fossils, indigenous heritage, and architectural wonders.',
          loc: 'Royal Ontario Museum, Toronto',
        },
        afternoon: {
          title: 'Kensington Market & Chinatown',
          desc: 'Explore vintage shops, bohemian cafes, street art murals, and artisanal empanadas.',
          loc: 'Kensington Market, Toronto',
        },
        evening: {
          title: 'Toronto Islands Sunset Ferry',
          desc: 'Cruise across Lake Ontario for bike rides along the boardwalk and the classic skyline postcard view.',
          loc: 'Toronto Islands, Toronto',
        },
      },
      {
        theme: 'Arts, Waterfront & Entertainment',
        morning: {
          title: 'Art Gallery of Ontario (AGO)',
          desc: 'Admire Frank Gehry’s spiraling wood architecture and masterworks from the Group of Seven.',
          loc: 'Art Gallery of Ontario, Toronto',
        },
        afternoon: {
          title: 'Harbourfront & Queen West Shopping',
          desc: 'Stroll along the marina promenade, followed by shopping in Toronto’s trendsetting fashion corridor.',
          loc: 'Harbourfront Centre, Toronto',
        },
        evening: {
          title: 'Entertainment District & Rooftop Dining',
          desc: 'Catch a theater performance on King Street and enjoy craft cocktails overlooking city lights.',
          loc: 'Entertainment District, Toronto',
        },
      },
    ],
  },
  tokyo: {
    vibe: 'Futuristic Innovation meets Ancient Traditions',
    bestTime: 'Late March-April (Cherry Blossoms) or October-November (Autumn foliage).',
    foods: ['Tonkotsu Ramen', 'Tsukiji Fresh Sushi', 'Yakitori in Omoide Yokocho', 'Matcha Soft Serve', 'Okonomiyaki'],
    highlights: ['Senso-ji Temple in Asakusa', 'Shibuya Crossing & Hachiko', 'Shinjuku Gyoen National Garden', 'Akihabara', 'Meiji Jingu'],
    packing: ['Easy slip-on walking shoes', 'IC Transit Card (Suica/Pasmo)', 'Small coin purse', 'Pocket Wi-Fi'],
    tips: ['Convenience stores (7-Eleven, Lawson) have incredible quality on-the-go food.', 'Carry cash as small ramen bars only take paper yen.'],
    days: [
      {
        theme: 'Historic Asakusa & Modern Shibuya',
        morning: {
          title: 'Senso-ji Temple & Nakamise Dori',
          desc: 'Pass through the Thunder Gate to Tokyo’s oldest temple and sample warm melonpan pastries.',
          loc: 'Senso-ji Temple, Tokyo',
        },
        afternoon: {
          title: 'Meiji Shrine & Harajuku Takeshita Street',
          desc: 'Walk through towering cedar forests to the grand Shinto shrine, then dive into colorful youth fashion.',
          loc: 'Meiji Jingu, Tokyo',
        },
        evening: {
          title: 'Shibuya Scramble & Shibuya Sky',
          desc: 'Watch the world’s busiest pedestrian crossing and gaze at glittering neon from a 360-degree rooftop deck.',
          loc: 'Shibuya Crossing, Tokyo',
        },
      },
      {
        theme: 'Tech, Anime & Traditional Gardens',
        morning: {
          title: 'Tsukiji Outer Market Breakfast',
          desc: 'Feast on fresh sashimi bowls, tamagoyaki egg skewers, and grilled oysters from heritage vendors.',
          loc: 'Tsukiji Outer Market, Tokyo',
        },
        afternoon: {
          title: 'Akihabara Electric Town',
          desc: 'Browse multi-story retro gaming emporiums, anime collectibles, and futuristic concept cafes.',
          loc: 'Akihabara, Tokyo',
        },
        evening: {
          title: 'Shinjuku Golden Gai & Omoide Yokocho',
          desc: 'Sample grilled yakitori skewers in atmospheric post-war alleyways with neon-lit izakayas.',
          loc: 'Omoide Yokocho, Shinjuku, Tokyo',
        },
      },
      {
        theme: 'Futuristic Bay & Art Experience',
        morning: {
          title: 'teamLab Planets Digital Art Museum',
          desc: 'Walk barefoot through mesmerizing crystal universes and floating digital koi ponds.',
          loc: 'teamLab Planets, Toyosu, Tokyo',
        },
        afternoon: {
          title: 'Odaiba Seaside & Gundam Statue',
          desc: 'Stroll the bayside boardwalk with sweeping views of the Rainbow Bridge and the Statue of Liberty replica.',
          loc: 'Odaiba, Tokyo',
        },
        evening: {
          title: 'Roppongi Hills Sunset Skyline View',
          desc: 'Take in the luminous panorama including Tokyo Tower glowing orange against the metropolis.',
          loc: 'Roppongi Hills, Tokyo',
        },
      },
    ],
  },
  paris: {
    vibe: 'Timeless Romance, Art, Architecture & Haute Cuisine',
    bestTime: 'April to June or September to October for pleasant weather and sidewalk cafes.',
    foods: ['Fresh Butter Croissants', 'Duck Confit', 'Steak Frites', 'Macarons from Ladurée', 'Artisan Cheese & Baguette'],
    highlights: ['Eiffel Tower', 'Louvre Museum', 'Musée d’Orsay', 'Montmartre & Sacré-Cœur', 'Seine River Cruise'],
    packing: ['Smart casual attire', 'Comfortable stylish walking shoes', 'Crossbody anti-theft bag', 'Universal power adapter (Type C/E)'],
    tips: ['Book Louvre and Eiffel Tower summit tickets at least 3 weeks ahead.', 'Say "Bonjour" when entering any boutique or boulangerie.'],
    days: [
      {
        theme: 'Parisian Icons & The Seine',
        morning: {
          title: 'Trocadéro & Eiffel Tower Ascent',
          desc: 'Marvel at sunrise angles from Trocadéro before heading to the summit for breathtaking city views.',
          loc: 'Eiffel Tower, Paris',
        },
        afternoon: {
          title: 'Musée d’Orsay & Tuileries Garden',
          desc: 'Admire Monet, Van Gogh, and Renoir inside a stunning Beaux-Arts railway station, then stroll sculpted gardens.',
          loc: 'Musée d’Orsay, Paris',
        },
        evening: {
          title: 'Seine River Sunset Cruise',
          desc: 'Drift past illuminated bridges and Notre-Dame cathedral with a glass of champagne.',
          loc: 'Seine River Cruise, Paris',
        },
      },
      {
        theme: 'Bohemian Artists & Panoramic Heights',
        morning: {
          title: 'Louvre Museum Masterpieces',
          desc: 'See the Mona Lisa, Winged Victory, and Venus de Milo in the world’s grandest palace museum.',
          loc: 'Louvre Museum, Paris',
        },
        afternoon: {
          title: 'Montmartre & Place du Tertre',
          desc: 'Climb cobblestone hills where Picasso painted, watch street portrait artists, and visit Sacré-Cœur basilica.',
          loc: 'Sacré-Cœur, Montmartre, Paris',
        },
        evening: {
          title: 'Le Marais Dinner & Wine Bar',
          desc: 'Savor traditional beef bourguignon in historic medieval mansions turned chic bistros.',
          loc: 'Le Marais, Paris',
        },
      },
      {
        theme: 'Latin Quarter & Royal Heritage',
        morning: {
          title: 'Notre-Dame & Sainte-Chapelle',
          desc: 'Gaze in awe at the 13th-century radiant stained glass jewel of Sainte-Chapelle.',
          loc: 'Sainte-Chapelle, Paris',
        },
        afternoon: {
          title: 'Luxembourg Gardens & Latin Quarter',
          desc: 'Relax beside the Medici Fountain and browse historic bookshops like Shakespeare & Company.',
          loc: 'Jardin du Luxembourg, Paris',
        },
        evening: {
          title: 'Saint-Germain-des-Prés Cafe Evening',
          desc: 'Sip espresso at legendary literary haunts like Café de Flore or Les Deux Magots.',
          loc: 'Saint-Germain-des-Prés, Paris',
        },
      },
    ],
  },
}

/** Match known destination keys */
function findMatchingDestination(text: string): { key: string; name: string } | null {
  const lower = text.toLowerCase()
  if (lower.includes('niagara')) return { key: 'niagara', name: 'Niagara Falls & Region, Ontario' }
  if (lower.includes('toronto')) return { key: 'toronto', name: 'Toronto, Ontario, Canada' }
  if (lower.includes('tokyo')) return { key: 'tokyo', name: 'Tokyo, Japan' }
  if (lower.includes('paris')) return { key: 'paris', name: 'Paris, France' }
  return null
}

/** Extract primary place query from a question or prompt */
function extractPlaceFromMessage(message: string): string {
  const cleaned = message.trim().replace(/[?.!,;]+$/g, '')

  // "Plan a trip to X"
  const mTo = cleaned.match(/(?:trip|travel|go|visit|holiday|vacation)\s+(?:to|in|around)\s+([A-Za-z][A-Za-z\s\-']{1,45})/i)
  if (mTo?.[1]) return cleanQuery(mTo[1])

  // "visiting X", "about X", "before visiting X"
  const mAbout = cleaned.match(/(?:visiting|visit|before visiting|about|in|near)\s+([A-Za-z][A-Za-z\s\-']{1,45})$/i)
  if (mAbout?.[1]) return cleanQuery(mAbout[1])

  // "best time to visit X", "food in X", "what to pack for X"
  const mPattern = cleaned.match(/(?:visit|food in|weather in|pack for|visas? for|travel to)\s+([A-Za-z][A-Za-z\s\-']{1,45})/i)
  if (mPattern?.[1]) return cleanQuery(mPattern[1])

  return ''
}

/**
 * Intelligent Smart Travel Engine that handles any natural language prompt
 * and generates realistic, rich itineraries + answers any travel question.
 */
export async function executeSmartTravelMessage(
  message: string,
  trip: TripSnapshot,
): Promise<TripBotResult> {
  const text = message.trim()
  const lower = text.toLowerCase()

  // 1. Check for Map View / Style controls
  if (/\b(satellite|aerial)\b/i.test(lower) && !/\bto\b/i.test(lower)) {
    return {
      reply: '🛰️ Switched to **Satellite imagery** view. You can now see realistic terrain and aerial details.',
      commands: [{ type: 'setMapStyle', style: 'satellite' }],
      engine: 'smart',
    }
  }
  if (/\b(terrain|topography|topo)\b/i.test(lower)) {
    return {
      reply: '🏔️ Switched to **Topographic Terrain** view. Contour lines and elevations are now highlighted.',
      commands: [{ type: 'setMapStyle', style: 'terrain' }],
      engine: 'smart',
    }
  }
  if (/\b(street map|map view|standard map|default map)\b/i.test(lower)) {
    return {
      reply: '🗺️ Switched to **Street Map** view with clear road networks and transit lines.',
      commands: [{ type: 'setMapStyle', style: 'street' }],
      engine: 'smart',
    }
  }

  // 2. Check for Travel Mode changes
  if (/^(drive|driving|car|by car)\b/i.test(lower) || /\b(switch to|set) (drive|driving|car)\b/i.test(lower)) {
    return {
      reply: '🚗 Travel mode set to **Driving**. Route recalculates highway road speeds.',
      commands: [{ type: 'setMode', mode: 'driving' }, { type: 'openDirections' }],
      engine: 'smart',
    }
  }
  if (/^(walk|walking|on foot)\b/i.test(lower) || /\b(switch to|set) (walk|walking)\b/i.test(lower)) {
    return {
      reply: '🚶 Travel mode set to **Walking**. Route prioritizes pedestrian sidewalks and footpaths.',
      commands: [{ type: 'setMode', mode: 'walking' }, { type: 'openDirections' }],
      engine: 'smart',
    }
  }
  if (/^(bike|biking|cycle|cycling|bicycle)\b/i.test(lower) || /\b(switch to|set) (bike|cycling)\b/i.test(lower)) {
    return {
      reply: '🚲 Travel mode set to **Cycling**. Route prefers dedicated bike lanes and greenways.',
      commands: [{ type: 'setMode', mode: 'cycling' }, { type: 'openDirections' }],
      engine: 'smart',
    }
  }

  // 3. Clear / Reset commands
  if (/^(clear|reset) (trip|route|all|everything)|^start over$/i.test(lower)) {
    return {
      reply: '✨ Cleared the entire trip, route line, and map markers. Where would you like to travel next?',
      commands: [{ type: 'clearTrip' }, { type: 'clearItinerary' }],
      engine: 'smart',
    }
  }
  if (/clear stops?|remove all stops?/i.test(lower)) {
    return {
      reply: '🧹 Cleared all intermediate stops along your route.',
      commands: [{ type: 'clearStops' }, { type: 'openDirections' }],
      engine: 'smart',
    }
  }

  // 4. Reverse / Swap route
  if (/swap|reverse (the )?(route|trip|directions)/i.test(lower)) {
    if (!trip.from && !trip.to) {
      return {
        reply: 'Please set a starting point and destination first before reversing.',
        commands: [],
        engine: 'smart',
      }
    }
    return {
      reply: '🔄 Swapped start and destination. Recalculating return route directions.',
      commands: [{ type: 'swap' }, { type: 'openDirections' }],
      engine: 'smart',
    }
  }

  // 5. Themed stops along the corridor (Nature, Food, Culture, etc.)
  const theme = detectStopTheme(lower)
  const asksForStops =
    /\b(add|suggest|recommend|find|show|include|put|give me)\b/.test(lower) ||
    /\bstops?\b/.test(lower) ||
    /\balong (the )?(way|route|corridor|trip)\b/.test(lower)

  if (theme && asksForStops && trip.from && trip.to) {
    const found = await findStopsAlongTrip(trip.from, trip.to, theme, { limit: 3 })
    if (found.length > 0) {
      const list = found
        .map((p, i) => `**${i + 1}. ${p.name}**\n   *${p.description}*`)
        .join('\n\n')

      let routeStats = ''
      try {
        const route = await getRoute(trip.from, trip.to, trip.mode, undefined, found)
        routeStats = `\n\n⏱️ **Updated corridor:** ${formatDuration(route.durationSeconds)} · ${formatDistance(route.distanceMeters)} (${trip.mode})`
      } catch {
        // ignore
      }

      return {
        reply: `🌿 Added **${found.length} curated ${theme} stops** along your route from **${trip.from.name}** to **${trip.to.name}**:\n\n${list}${routeStats}\n\n*All stops are plotted on your map!*`,
        commands: [
          { type: 'setStops', places: found },
          { type: 'openDirections' },
        ],
        engine: 'smart',
      }
    }
  }

  // 6. Point A to Point B Route Planning (e.g. "I want to travel from Niagara Ontario to Toronto")
  const routeMatch =
    text.match(
      /(?:want\s+to\s+)?(?:travel|go|drive|fly|get|head|plan(?:\s+a)?\s+(?:trip|route)?)\s+from\s+(.+?)\s+to\s+(.+?)(?:\s+(?:via|through|with\s+stop\s+(?:at|in))\s+(.+))?$/i,
    ) ||
    text.match(/^from\s+(.+?)\s+to\s+(.+?)(?:\s+(?:via|through)\s+(.+))?$/i)

  if (routeMatch) {
    const fromQ = cleanQuery(routeMatch[1])
    const toQ = cleanQuery(routeMatch[2])
    const viaQ = routeMatch[3] ? cleanQuery(routeMatch[3]) : null

    const [fromPlace, toPlace, viaPlace] = await Promise.all([
      searchPlaces(fromQ).then((r) => r[0] ?? null),
      searchPlaces(toQ).then((r) => r[0] ?? null),
      viaQ ? searchPlaces(viaQ).then((r) => r[0] ?? null) : Promise.resolve(null),
    ])

    if (fromPlace && toPlace) {
      const commands: TripCommand[] = [
        { type: 'clearStops' },
        { type: 'setFrom', place: fromPlace },
        { type: 'setTo', place: toPlace },
      ]
      if (viaPlace) commands.push({ type: 'addStop', place: viaPlace })
      commands.push({ type: 'openDirections' })

      let timingInfo = ''
      try {
        const route = await getRoute(
          fromPlace,
          toPlace,
          trip.mode,
          undefined,
          viaPlace ? [viaPlace] : [],
        )
        timingInfo = `\n\n🛣️ **Journey Overview:** ${formatDuration(route.durationSeconds)} · ${formatDistance(route.distanceMeters)} via ${trip.mode}`
      } catch {
        timingInfo = '\n\n🛣️ Route has been drawn directly on the interactive map.'
      }

      const viaStr = viaPlace ? ` via **${viaPlace.name}**` : ''
      return {
        reply: `🗺️ **Trip Planned:** **${fromPlace.name}** →${viaStr ? `${viaStr} →` : ' '}**${toPlace.name}**${timingInfo}\n\n💡 **Travel Agent Tips:**\n• Say *"Add major stops where I can enjoy nature"* to discover parks along this road.\n• Say *"Suggest food stops"* to find local eateries en route.\n• Say *"Satellite view"* to see aerial terrain.`,
        commands,
        engine: 'smart',
      }
    }
  }

  // 7. Full Multi-day Trip Itinerary Planning (e.g. "Plan a 3-day trip to Tokyo", "Plan a trip to Niagara Falls")
  const isTripPlanRequest =
    /\b(plan(?:\s+a)?\s+(?:trip|itinerary|vacation|holiday|getaway|weekend)|days?\s+(?:in|to|trip)|itinerary\s+for)\b/i.test(
      lower,
    ) || (lower.includes('trip') && lower.includes('to'))

  if (isTripPlanRequest) {
    const destinationQuery = extractPlaceFromMessage(text) || cleanQuery(text.replace(/plan\s+(?:a\s+)?trip(?:\s+to)?/i, ''))
    const daysCount = extractTripDuration(text)

    // Check if we have curated data or search via geocoder & Wikipedia
    const matched = findMatchingDestination(destinationQuery)

    let destinationPlace: Place | null = null
    try {
      const results = await searchPlaces(destinationQuery || (matched ? matched.name : ''))
      destinationPlace = results[0] ?? null
    } catch {
      // ignore
    }

    if (matched && DESTINATION_INSIGHTS[matched.key]) {
      const data = DESTINATION_INSIGHTS[matched.key]
      const chosenDays = data.days.slice(0, daysCount)

      const structuredItinerary: TripItinerary = {
        title: `${daysCount}-Day Perfect Getaway to ${matched.name}`,
        destination: matched.name,
        durationDays: daysCount,
        summary: `A personalized ${daysCount}-day itinerary blending ${data.vibe.toLowerCase()} with top sights and authentic local food.`,
        vibe: data.vibe,
        days: chosenDays.map((d, idx) => ({
          dayNumber: idx + 1,
          theme: d.theme,
          activities: [
            {
              timeOfDay: 'morning',
              title: d.morning.title,
              description: d.morning.desc,
              locationName: d.morning.loc,
              tips: 'Best visited early to enjoy calm ambiance.',
            },
            {
              timeOfDay: 'afternoon',
              title: d.afternoon.title,
              description: d.afternoon.desc,
              locationName: d.afternoon.loc,
              tips: 'Great spot for photography and local lunch.',
            },
            {
              timeOfDay: 'evening',
              title: d.evening.title,
              description: d.evening.desc,
              locationName: d.evening.loc,
              tips: 'Ideal for sunset views and authentic dinner.',
            },
          ],
          mealsToTry: data.foods.slice(0, 3),
        })),
        budgetLevel: 'moderate',
        packingHighlights: data.packing,
        essentialTips: data.tips,
      }

      // Build rich markdown reply
      const daysMarkdown = chosenDays
        .map(
          (d, idx) =>
            `### 🗓️ Day ${idx + 1}: ${d.theme}\n` +
            `• **Morning — ${d.morning.title}:** ${d.morning.desc}\n` +
            `• **Afternoon — ${d.afternoon.title}:** ${d.afternoon.desc}\n` +
            `• **Evening — ${d.evening.title}:** ${d.evening.desc}\n`,
        )
        .join('\n')

      const reply = `## ✈️ ${daysCount}-Day Itinerary: ${matched.name}\n\n` +
        `> **Vibe:** ${data.vibe}\n` +
        `> **Best Season:** ${data.bestTime}\n\n` +
        `${daysMarkdown}\n` +
        `### 🍴 Must-Try Local Delicacies\n` +
        data.foods.map((f) => `• **${f}**`).join('\n') +
        `\n\n### 🎒 Essential Packing & Tips\n` +
        data.packing.slice(0, 3).map((p) => `• ${p}`).join('\n') +
        `\n\n*Check the new **Itinerary tab** in the sidebar to review day details or adjust your route!*`

      const commands: TripCommand[] = [
        { type: 'setItinerary', itinerary: structuredItinerary },
      ]
      if (destinationPlace) {
        commands.push({ type: 'select', place: destinationPlace })
      }

      return {
        reply,
        commands,
        itinerary: structuredItinerary,
        engine: 'smart',
      }
    }

    // Dynamic Itinerary for any worldwide place using Wikipedia + Geocoding!
    const wiki = await fetchWikiInfo(destinationQuery)
    const placeResolved = destinationPlace || (await searchPlaces(destinationQuery).then((r) => r[0] ?? null))

    const titleDest = placeResolved ? placeResolved.name : destinationQuery || 'Your Destination'
    const summaryText = wiki ? wiki.extract : `A curated travel plan exploring the top landmarks, dining, and scenic vistas of ${titleDest}.`

    // Generate dynamic days
    const dynamicDays: ItineraryDay[] = Array.from({ length: daysCount }).map((_, i) => {
      const dayNum = i + 1
      const themes = [
        'City Highlights & Iconic Landmarks',
        'Historic Heritage, Culture & Local Markets',
        'Nature Escapes, Scenic Vistas & Hidden Gems',
        'Art, Neighborhood Walks & Culinary Delights',
        'Day Trips & Outdoor Adventures',
      ]
      const theme = themes[i % themes.length]

      return {
        dayNumber: dayNum,
        theme,
        activities: [
          {
            timeOfDay: 'morning',
            title: `Morning Exploration & Landmark Walk`,
            description: `Start your day at the iconic center of ${titleDest}. Capture morning light, enjoy fresh local cafe breakfast, and beat early tourist queues.`,
            locationName: `${titleDest} City Center`,
            tips: 'Begin around 8:30 AM for cooler temperatures and tranquil photography.',
          },
          {
            timeOfDay: 'afternoon',
            title: `Cultural Immersion & Local Food Crawl`,
            description: `Visit local heritage sites, museums, and bustling market streets. Taste regional specialties and browse artisanal crafts.`,
            locationName: `${titleDest} Historic Quarter`,
            tips: 'Ask locals for neighborhood lunch spot recommendations away from main plazas.',
          },
          {
            timeOfDay: 'evening',
            title: `Sunset Vista & Evening Dining`,
            description: `Head to a panoramic viewpoint or waterfront promenade for twilight views, followed by a leisurely dinner featuring regional specialties.`,
            locationName: `${titleDest} Waterfront / Scenic Overlook`,
            tips: 'Reserve popular dining spots in advance or try authentic street food stalls.',
          },
        ],
        mealsToTry: ['Authentic Regional Specialty', 'Fresh Local Street Food', 'Signature Dessert & Local Beverage'],
      }
    })

    const dynamicItinerary: TripItinerary = {
      title: `${daysCount}-Day Itinerary for ${titleDest}`,
      destination: titleDest,
      durationDays: daysCount,
      summary: summaryText.slice(0, 300),
      vibe: 'Scenic & Cultural Exploration',
      days: dynamicDays,
      budgetLevel: 'moderate',
      packingHighlights: [
        'Comfortable broken-in walking shoes',
        'Universal power adapter & portable power bank',
        'Weather-appropriate layers and lightweight rain jacket',
      ],
      essentialTips: [
        'Download offline maps for smooth navigation.',
        'Keep small local currency handy for markets and taxis.',
        'Check museum and attraction opening hours in advance.',
      ],
    }

    const daysMarkdown = dynamicDays
      .map(
        (d) =>
          `### 🗓️ Day ${d.dayNumber}: ${d.theme}\n` +
          `• **Morning:** ${d.activities[0].description}\n` +
          `• **Afternoon:** ${d.activities[1].description}\n` +
          `• **Evening:** ${d.activities[2].description}\n`,
      )
      .join('\n')

    const reply = `## 🗺️ ${daysCount}-Day Plan for **${titleDest}**\n\n` +
      `${summaryText}\n\n` +
      `${daysMarkdown}\n` +
      `### 💡 Pro-Traveler Tips:\n` +
      `• **Transportation:** Inquire about 24-48hr public transit passes for cost-effective city travel.\n` +
      `• **Dining:** Seek out restaurants frequented by local residents for the best flavors and prices.\n\n` +
      `*A complete interactive itinerary has been added to your **Itinerary** tab!*`

    const commands: TripCommand[] = [
      { type: 'setItinerary', itinerary: dynamicItinerary },
    ]
    if (placeResolved) {
      commands.push({ type: 'select', place: placeResolved })
    }

    return {
      reply,
      commands,
      itinerary: dynamicItinerary,
      engine: 'smart',
    }
  }

  // 8. Travel Q&A: "What should I know before visiting X?"
  const isAdviceQuestion =
    /\b(what should i know|know before visiting|tips for|advice for|visiting|things to know)\b/i.test(lower)

  if (isAdviceQuestion) {
    const topic = extractPlaceFromMessage(text) || (trip.selected ? trip.selected.name : 'your destination')
    const matched = findMatchingDestination(topic)
    const placeResolved = await searchPlaces(topic).then((r) => r[0] ?? null)
    const wiki = await fetchWikiInfo(topic)

    if (matched && DESTINATION_INSIGHTS[matched.key]) {
      const data = DESTINATION_INSIGHTS[matched.key]
      const reply = `## ℹ️ Essential Guide: What to Know Before Visiting **${matched.name}**\n\n` +
        `> **Atmosphere:** ${data.vibe}\n\n` +
        `### 🗓️ Best Time to Visit\n${data.bestTime}\n\n` +
        `### ⭐ Top Highlights\n` +
        data.highlights.map((h) => `• **${h}**`).join('\n') +
        `\n\n### 🍴 Must-Try Food & Drink\n` +
        data.foods.map((f) => `• **${f}**`).join('\n') +
        `\n\n### 🎒 What to Pack\n` +
        data.packing.map((p) => `• ${p}`).join('\n') +
        `\n\n### 💡 Key Traveler Tips\n` +
        data.tips.map((t) => `• ${t}`).join('\n')

      const commands: TripCommand[] = []
      if (placeResolved) commands.push({ type: 'select', place: placeResolved })

      return { reply, commands, engine: 'smart' }
    }

    // Dynamic destination advice
    const wikiExtract = wiki ? wiki.extract : `A celebrated destination renowned for its vibrant culture, landmarks, and hospitable atmosphere.`
    const reply = `## ℹ️ What to Know Before Visiting **${topic}**\n\n` +
      `${wikiExtract}\n\n` +
      `### 🌟 Top Advice & Checklist:\n` +
      `• **Currency & Payments:** Carry a mix of contactless credit cards and a small amount of cash for local stalls.\n` +
      `• **Transportation:** Download local transport apps or ride-sharing services before arriving.\n` +
      `• **Attractions:** Popular monuments, museums, and boat tours often require timed-entry slots in peak season.\n` +
      `• **Safety & Health:** Keep emergency contacts and hotel addresses saved offline in your phone.\n` +
      `• **Etiquette:** Familiarize yourself with local greeting customs and appropriate dress for religious or historic sites.\n\n` +
      `Would you like me to generate a personalized multi-day itinerary for ${topic}? Just say *"Plan a 3-day trip to ${topic}"*!`

    const commands: TripCommand[] = []
    if (placeResolved) commands.push({ type: 'select', place: placeResolved })

    return { reply, commands, engine: 'smart' }
  }

  // 9. Best Time of Year / Weather questions
  if (/\b(best time|season|weather|when should i go|when to visit|climate|rainfall|temperature)\b/i.test(lower)) {
    const topic = extractPlaceFromMessage(text) || (trip.selected ? trip.selected.name : 'this location')
    const matched = findMatchingDestination(topic)
    const placeResolved = await searchPlaces(topic).then((r) => r[0] ?? null)

    if (matched && DESTINATION_INSIGHTS[matched.key]) {
      const data = DESTINATION_INSIGHTS[matched.key]
      const reply = `## ☀️ Best Time to Visit **${matched.name}**\n\n` +
        `**Optimal Window:** ${data.bestTime}\n\n` +
        `### 🌤️ Seasonal Breakdown:\n` +
        `• **Spring (Apr–May):** Mild temperatures, blooming scenery, lower crowds, and ideal walking weather.\n` +
        `• **Summer (Jun–Aug):** Long daylight hours, lively street festivals, and full attraction schedules (expect higher hotel rates).\n` +
        `• **Autumn (Sep–Oct):** Crisp air, striking foliage, harvest festivals, and wonderful wine & dining experiences.\n` +
        `• **Winter (Nov–Mar):** Cozy off-peak atmosphere, seasonal lights, fewer tourists, and best budget hotel rates.`

      const commands: TripCommand[] = []
      if (placeResolved) commands.push({ type: 'select', place: placeResolved })
      return { reply, commands, engine: 'smart' }
    }

    const reply = `## ☀️ Best Time to Visit **${topic}**\n\n` +
      `• **Peak Season (Spring & Autumn):** Generally the sweet spot for ${topic}. You'll enjoy comfortable temperatures for sightseeing, active city life, and manageable crowds.\n` +
      `• **Summer:** Vibrant and bustling with longer sunny days, though expect warmer weather and peak tourist prices.\n` +
      `• **Winter / Shoulder:** Great for budget travelers seeking fewer lines at top attractions.\n\n` +
      `*Tip: If visiting outdoor sights or natural reserves, check monthly rainfall patterns to pack appropriate waterproof gear!*`

    const commands: TripCommand[] = []
    if (placeResolved) commands.push({ type: 'select', place: placeResolved })
    return { reply, commands, engine: 'smart' }
  }

  // 10. Food & Dining questions
  if (/\b(food|eat|restaurant|cuisine|dish|dishes|must try|specialt|dining|taste)\b/i.test(lower)) {
    const topic = extractPlaceFromMessage(text) || (trip.selected ? trip.selected.name : 'this region')
    const matched = findMatchingDestination(topic)
    const placeResolved = await searchPlaces(topic).then((r) => r[0] ?? null)

    if (matched && DESTINATION_INSIGHTS[matched.key]) {
      const data = DESTINATION_INSIGHTS[matched.key]
      const reply = `## 🍽️ Culinary Guide: What Food is **${matched.name}** Known For?\n\n` +
        data.foods.map((f, i) => `### ${i + 1}. ${f}\nAn essential culinary experience showcasing the authentic heritage and regional produce of the area.\n`).join('\n') +
        `### 🍷 Dining Tips:\n` +
        `• Look for eateries that display seasonal menus written in the native language.\n` +
        `• Always ask your server for local beverage pairings and daily market specials!`

      const commands: TripCommand[] = []
      if (placeResolved) commands.push({ type: 'select', place: placeResolved })
      return { reply, commands, engine: 'smart' }
    }

    const reply = `## 🍽️ Culinary Highlights of **${topic}**\n\n` +
      `When traveling through **${topic}**, make sure to savor:\n` +
      `• **Signature Regional Dishes:** Local street foods, market stalls, and farm-to-table specialties unique to the province.\n` +
      `• **Fresh Produce & Bakeries:** Artisan pastries, locally roasted coffee, and fresh market fruits.\n` +
      `• **Evening Dining:** Traditional taverns, bistros, or night markets with local communal dining culture.\n\n` +
      `*Tip: Try booking food tours on your first afternoon to get an insider map of the neighborhood's best hidden culinary gems!*`

    const commands: TripCommand[] = []
    if (placeResolved) commands.push({ type: 'select', place: placeResolved })
    return { reply, commands, engine: 'smart' }
  }

  // 11. What to pack
  if (/\b(pack|packing|wear|clothes|clothing|luggage|bring)\b/i.test(lower)) {
    const topic = extractPlaceFromMessage(text) || (trip.selected ? trip.selected.name : 'your trip')
    const matched = findMatchingDestination(topic)
    const placeResolved = await searchPlaces(topic).then((r) => r[0] ?? null)

    const items = matched ? DESTINATION_INSIGHTS[matched.key].packing : [
      'Sturdy, comfortable walking shoes (you will easily walk 10,000+ steps daily)',
      'Breathable, versatile layers (light sweater, cardigan, and waterproof jacket)',
      'Universal travel power adapter and high-capacity portable power bank',
      'Compact daypack with secure anti-theft zipper closures',
      'Refillable insulated water bottle and personal travel pharmacy',
    ]

    const reply = `## 🎒 Packing Checklist for **${topic}**\n\n` +
      items.map((it) => `• **${it}**`).join('\n') +
      `\n\n### 💡 Smart Packing Tip:\n` +
      `Roll your clothes rather than folding to save 30% suitcase volume and minimize wrinkles. Keep all essential medications and travel documents in your personal carry-on!`

    const commands: TripCommand[] = []
    if (placeResolved) commands.push({ type: 'select', place: placeResolved })
    return { reply, commands, engine: 'smart' }
  }

  // 12. Explore Region & List Destinations
  if (/\b(explore|popular destinations?|places to visit|things to do|destinations)\b/i.test(lower)) {
    const region = extractRegionQuery(text) || extractPlaceFromMessage(text)
    if (region) {
      try {
        const { region: regPlace, destinations } = await findPopularDestinations(region, { limit: 8 })
        return {
          reply: `🌟 **Popular Destinations in ${regPlace.name}**\n\n${formatDestinationList(regPlace.name, destinations)}\n\n*All destinations have been pinned on the map! Click any pin to inspect details.*`,
          commands: [
            {
              type: 'setExplorePlaces',
              places: destinations,
              region: regPlace,
            },
          ],
          engine: 'smart',
        }
      } catch {
        // fallback
      }
    }
  }

  // 13. Single Place Search & Fly-To
  const showMatch = text.match(/(?:show|go to|fly to|locate|zoom to|find)\s+(.+)$/i)
  const placeName = showMatch ? cleanQuery(showMatch[1]) : extractPlaceFromMessage(text)

  if (placeName && placeName.length >= 2) {
    const place = await searchPlaces(placeName).then((r) => r[0] ?? null)
    if (place) {
      const wiki = await fetchWikiInfo(place.name)
      const detail = wiki ? wiki.extract : place.description || 'Worldwide destination'
      return {
        reply: `📍 **${place.name}**\n\n${detail}\n\n*Centered on the map. You can ask for directions, plan a multi-day trip, or explore nearby sights.*`,
        commands: [{ type: 'select', place }],
        engine: 'smart',
      }
    }
  }

  // 14. Friendly Conversational Help
  return {
    reply: `👋 **Hello! I'm your AI Travel Agent.**\n\nI can plan complete tailor-made itineraries, navigate routes, and answer any travel question in natural language!\n\n**Try asking:**\n• *"Plan a 3-day trip to Tokyo with cultural spots, sushi, and anime"* 🇯🇵\n• *"What should I know before visiting Niagara Falls?"* 🌊\n• *"I want to travel from Niagara Ontario to Toronto"* 🚗\n• *"Best time of year to visit Toronto and what to pack?"* 🍁\n• *"Add major stops where I can enjoy nature"* 🌲\n• *"Switch to satellite view"* 🛰️`,
    commands: [],
    engine: 'smart',
  }
}
