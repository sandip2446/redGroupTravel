import { extractRegionQuery } from '../../lib/explore'
import { searchPlaces } from '../../lib/geocode'
import { generateGuideReply, isWebGpuAvailable } from '../guideModel'
import { buildSystemPrompt, buildUserPrompt } from '../prompts'
import type { AiAction, AiPlan, ChatMessage, TripSnapshot } from '../types'

function cleanGuideText(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, '$1')
    .replace(/^#{1,3}\s+/gm, '')
    .trim()
}

function extractJson(text: string): unknown {
  const trimmed = text.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = fence ? fence[1].trim() : trimmed
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('No JSON in WebLLM reply')
  return JSON.parse(raw.slice(start, end + 1))
}

function normalizePlan(data: unknown, fallbackReply: string): AiPlan {
  if (!data || typeof data !== 'object') {
    return { reply: cleanGuideText(fallbackReply), actions: [] }
  }
  const obj = data as Record<string, unknown>
  const reply =
    typeof obj.reply === 'string' && obj.reply.trim()
      ? cleanGuideText(obj.reply)
      : cleanGuideText(fallbackReply)
  const actions = Array.isArray(obj.actions)
    ? (obj.actions.filter(
        (a) => a && typeof a === 'object' && 'action' in (a as object),
      ) as AiAction[])
    : []
  return { reply, actions }
}

function tripContext(trip: TripSnapshot): string {
  const lines = [
    `Route: ${trip.from?.name ?? '—'} → ${trip.to?.name ?? '—'}`,
    trip.stops.length
      ? `Stops: ${trip.stops.map((s) => s.name).join(', ')}`
      : 'Stops: none',
    `Mode: ${trip.mode}`,
    trip.selected
      ? `Selected on map: ${trip.selected.name} (${trip.selected.description})`
      : null,
    trip.explorePlaces?.length
      ? `Explore pins: ${trip.explorePlaces
          .slice(0, 8)
          .map((p) => p.name)
          .join(', ')}`
      : null,
  ]
  return lines.filter(Boolean).join('\n')
}

function extractTopic(message: string, trip: TripSnapshot): string {
  const cleaned = message.trim().replace(/[?.!,;]+$/g, '')
  const about = cleaned.match(
    /\b(?:about|before visiting|visiting|visit|around|near|show|find|in)\s+([A-Za-z][A-Za-z\s\-']{1,50})$/i,
  )
  if (about?.[1]) return about[1].trim()

  const region = extractRegionQuery(cleaned)
  if (region) return region

  if (trip.selected?.name) return trip.selected.name
  if (trip.to?.name) return trip.to.name
  if (trip.from?.name) return trip.from.name
  return cleaned.slice(0, 80)
}

async function fetchWikiSummary(topic: string): Promise<string | null> {
  const title = topic
    .replace(/\b(ontario|canada|region)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (title.length < 2) return null

  const candidates = [title, `${title} (Ontario)`, title.replace(/\s+/g, '_')]

  for (const c of candidates) {
    try {
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(c)}`
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!res.ok) continue
      const data = (await res.json()) as {
        type?: string
        title?: string
        extract?: string
      }
      if (data.type === 'disambiguation') continue
      if (data.extract && data.extract.length > 40) {
        return `${data.title ?? c}: ${data.extract}`
      }
    } catch {
      // try next
    }
  }
  return null
}

async function nearbyFacts(topic: string): Promise<string | null> {
  try {
    const places = await searchPlaces(topic, undefined, { limit: 5 })
    if (!places.length) return null
    return places
      .map(
        (p, i) =>
          `${i + 1}. ${p.name}${p.description ? ` — ${p.description}` : ''}`,
      )
      .join('\n')
  } catch {
    return null
  }
}

/**
 * When the model forgets tools, infer map actions so the AI still moves the map.
 */
export function inferMapActions(
  message: string,
  plan: AiPlan,
  trip: TripSnapshot,
): AiPlan {
  if (plan.actions.length > 0) return plan

  const text = message.trim()
  const actions: AiAction[] = []

  const fromTo =
    text.match(
      /(?:want\s+to\s+)?(?:travel|go|drive|fly|get|plan(?:\s+a)?\s+(?:trip|route|journey)?)\s+from\s+(.+?)\s+to\s+(.+?)(?:\s+via\s+(.+))?$/i,
    ) || text.match(/\bfrom\s+(.+?)\s+to\s+(.+?)(?:\s+via\s+(.+))?$/i)

  if (fromTo) {
    actions.push({
      action: 'plan_trip',
      from: fromTo[1].trim().replace(/[?.!,;]+$/g, ''),
      to: fromTo[2].trim().replace(/[?.!,;]+$/g, ''),
      via: fromTo[3]?.trim(),
    })
    actions.push({ action: 'open_directions' })
    return {
      reply: plan.reply || `Planning ${fromTo[1].trim()} → ${fromTo[2].trim()}.`,
      actions,
    }
  }

  const region = extractRegionQuery(text)
  if (
    region &&
    /\b(explore|popular destinations?|list.+destinations?|things to do|places to visit|show (me )?(on )?map|pin)\b/i.test(
      text,
    )
  ) {
    actions.push({ action: 'explore_region', region })
    return {
      reply: plan.reply || `Exploring popular destinations in ${region}…`,
      actions,
    }
  }

  if (/\bsatellite\b/i.test(text)) {
    actions.push({ action: 'set_map_style', style: 'satellite' })
  } else if (/\bterrain\b|\btopo\b/i.test(text)) {
    actions.push({ action: 'set_map_style', style: 'terrain' })
  } else if (/\bstreet map\b|\bmap view\b/i.test(text)) {
    actions.push({ action: 'set_map_style', style: 'street' })
  }

  if (/\b(walk|walking)\b/i.test(text) && !/\bfrom\b/i.test(text)) {
    actions.push({ action: 'set_mode', mode: 'walking' })
  } else if (/\b(bike|cycling|bicycle)\b/i.test(text)) {
    actions.push({ action: 'set_mode', mode: 'cycling' })
  } else if (/\b(drive|driving|car)\b/i.test(text) && !/\bfrom\b/i.test(text)) {
    actions.push({ action: 'set_mode', mode: 'driving' })
  }

  const show = text.match(
    /(?:show|go to|fly to|find|locate|take me to|zoom to)\s+(.+)$/i,
  )
  if (show?.[1] && !/\bfrom\b.+\bto\b/i.test(text)) {
    actions.push({
      action: 'show_place',
      place: show[1].trim().replace(/[?.!,;]+$/g, ''),
    })
  }

  // Pure travel Q&A about a place → still fly the map there
  if (
    actions.length === 0 &&
    /\b(what|where|tell me|know before|visit|about|food|best time|recommend)\b/i.test(
      text,
    )
  ) {
    const topic = extractTopic(text, trip)
    if (
      topic.length >= 3 &&
      topic.length < 60 &&
      !/^(what|where|when|how|why|best|tell|know)$/i.test(topic)
    ) {
      actions.push({ action: 'show_place', place: topic })
    }
  }

  if (
    actions.length === 0 &&
    /\b(nature|food|culture|scenic|cities)\b/i.test(text) &&
    /\b(stop|stops|along)\b/i.test(text) &&
    trip.from &&
    trip.to
  ) {
    const theme = /\bnature\b/i.test(text)
      ? 'nature'
      : /\bfood\b/i.test(text)
        ? 'food'
        : /\bculture\b/i.test(text)
          ? 'culture'
          : /\bcit(y|ies)\b/i.test(text)
            ? 'cities'
            : 'scenic'
    actions.push({ action: 'suggest_stops', theme, replace: true })
  }

  if (actions.length === 0) return plan
  return {
    reply:
      plan.reply ||
      (actions[0].action === 'show_place'
        ? `Showing ${(actions[0] as { place: string }).place} on the map.`
        : 'Updating the map.'),
    actions,
  }
}

/**
 * WebLLM plans map actions + travel answers (JSON tools, same schema as Gemini).
 */
export async function planWithWebLlm(
  message: string,
  trip: TripSnapshot,
  history: ChatMessage[] = [],
): Promise<AiPlan> {
  if (!isWebGpuAvailable()) {
    throw new Error('WebGPU is not available')
  }

  const topic = extractTopic(message, trip)
  const [wiki, places] = await Promise.all([
    fetchWikiSummary(topic),
    nearbyFacts(topic),
  ])

  const facts = [
    wiki ? `Wikipedia: ${wiki}` : null,
    places ? `Related places:\n${places}` : null,
    `Live trip:\n${tripContext(trip)}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const system =
    buildSystemPrompt(trip) +
    `\n\nExtra FACTS for better answers (optional):\n${facts || '(none)'}\n\nYou CONTROL THE MAP. Whenever the user mentions a place, route, explore, layer, or mode, include the matching actions. For pure advice, you may still show_place so the map follows the conversation.`

  const user = buildUserPrompt(
    message,
    history.map((m) => ({ role: m.role, text: m.text })),
  )

  const raw = await generateGuideReply(
    system,
    user,
    history
      .filter((m) => m.id !== 'welcome')
      .slice(-4)
      .map((m) => ({ role: m.role, content: m.text })),
    { temperature: 0.25, maxTokens: 900 },
  )

  let plan: AiPlan
  try {
    plan = normalizePlan(extractJson(raw), raw)
  } catch {
    // Model returned prose — keep the answer and infer map tools
    plan = { reply: cleanGuideText(raw), actions: [] }
  }

  return inferMapActions(message, plan, trip)
}

/** Fact-only fallback when WebLLM cannot run (still tries to move the map). */
export async function planTravelGuideFallback(
  message: string,
  trip: TripSnapshot,
): Promise<AiPlan> {
  const topic = extractTopic(message, trip)
  const [wiki, places] = await Promise.all([
    fetchWikiSummary(topic),
    nearbyFacts(topic),
  ])

  const parts: string[] = []
  if (wiki) parts.push(wiki)
  else parts.push(`Here's what I can share about ${topic} from open map data.`)
  if (places) parts.push(`Nearby / related places:\n${places}`)
  parts.push(
    `Trip: ${trip.from?.name ?? '—'} → ${trip.to?.name ?? '—'}. I can also plan routes and pin places — try "from A to B" or "explore [region]".`,
  )

  return inferMapActions(
    message,
    { reply: parts.join('\n\n'), actions: [] },
    trip,
  )
}

/** @deprecated use planWithWebLlm — kept name for clarity in older call sites */
export function isTravelGuideQuestion(message: string): boolean {
  const text = message.trim()
  if (text.length < 3) return false
  if (/\bfrom\b.+\bto\b/i.test(text)) return false
  if (
    /\b(explore|popular destinations?|list.+destinations?)\b/i.test(text) &&
    extractRegionQuery(text)
  ) {
    return false
  }
  if (
    /^(satellite|terrain|street map|drive|driving|walk|walking|bike|cycling|clear|swap|reset)\b/i.test(
      text,
    )
  ) {
    return false
  }
  return (
    /\?$/.test(text) ||
    /\b(what|where|when|why|how|tell me|explain|recommend|suggest|advice|tips?|best time|food|visa|weather|safety|budget|pack|itinerary|culture|history)\b/i.test(
      text,
    )
  )
}
