import { getEffectiveGeminiApiKey } from '../../types/settings'
import { buildSystemPrompt, buildUserPrompt } from '../prompts'
import type { AiAction, AiPlan, ChatMessage, TripSnapshot } from '../types'
import type { TripItinerary } from '../../types/itinerary'

const GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash']

export function isGeminiConfigured(): boolean {
  return Boolean(getEffectiveGeminiApiKey())
}

/**
 * Resilient JSON extractor that repairs common LLM artifacts:
 * - Markdown fences
 * - Raw unescaped newlines inside quotes
 * - Trailing commas
 */
export function extractJsonFromLlm(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  let raw = fence ? fence[1].trim() : trimmed

  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1) {
    throw new Error('No JSON object found in response')
  }
  raw = raw.slice(start, end + 1)

  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    // Attempt sanitization: replace literal newlines within string literals
    try {
      const sanitized = raw.replace(/"((?:\\.|[^"\\])*)"/gs, (_, inner) => {
        return (
          '"' +
          inner
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t') +
          '"'
        )
      })
      return JSON.parse(sanitized) as Record<string, unknown>
    } catch {
      // Last-ditch extraction: pull "reply" manually if possible
      const replyMatch = raw.match(/"reply"\s*:\s*"((?:\\.|[^"\\])*)"/s)
      if (replyMatch) {
        return {
          reply: replyMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
          actions: [],
        }
      }
      throw new Error('Failed to parse model JSON reply')
    }
  }
}

function normalizePlan(data: unknown): AiPlan {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid plan payload')
  }
  const obj = data as Record<string, unknown>
  const reply =
    typeof obj.reply === 'string' && obj.reply.trim()
      ? obj.reply.trim()
      : 'Here is your travel recommendation.'

  const actions = Array.isArray(obj.actions)
    ? (obj.actions.filter(
        (a) => a && typeof a === 'object' && 'action' in (a as object),
      ) as AiAction[])
    : []

  const itinerary =
    obj.itinerary && typeof obj.itinerary === 'object'
      ? (obj.itinerary as TripItinerary)
      : undefined

  return { reply, actions, itinerary }
}

export async function planWithGemini(
  message: string,
  trip: TripSnapshot,
  history: ChatMessage[],
  signal?: AbortSignal,
): Promise<AiPlan> {
  const apiKey = getEffectiveGeminiApiKey()
  if (!apiKey) throw new Error('Gemini API key missing')

  let lastError: Error | null = null

  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                buildSystemPrompt(trip) +
                '\n\n' +
                buildUserPrompt(
                  message,
                  history.map((m) => ({ role: m.role, text: m.text })),
                ),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
      },
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`Gemini ${model} HTTP ${res.status}: ${errText.slice(0, 150)}`)
      }

      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      }

      const text = data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? '')
        .join('')
        .trim()

      if (!text) throw new Error('Empty Gemini response')

      const parsed = extractJsonFromLlm(text)
      return normalizePlan(parsed)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      // Try next model if available
    }
  }

  throw lastError ?? new Error('Gemini request failed')
}
