import { getStoredSettings } from '../types/settings'
import { isWebGpuAvailable } from './guideModel'
import { isGeminiConfigured, planWithGemini } from './providers/gemini'
import { executeSmartTravelMessage } from './providers/smartTravelEngine'
import { planWithWebLlm } from './providers/travelGuide'
import { executeAiPlan } from './tools'
import type { ChatMessage, TripBotResult, TripSnapshot } from './types'

export type AiEngine = 'gemini' | 'smart' | 'webllm' | 'transformers' | 'local'

/**
 * AI Travel Agent Brain
 *
 * 1. Gemini (Cloud AI: high quality, multi-day itineraries & full travel Q&A)
 * 2. Smart Travel Engine (Instant, robust, comprehensive trip planner & travel advisor)
 * 3. WebLLM (optional in-browser LLM if enabled by user)
 */
export async function processTripMessage(
  message: string,
  trip: TripSnapshot,
  history: ChatMessage[] = [],
  signal?: AbortSignal,
): Promise<TripBotResult> {
  const { preferredEngine } = getStoredSettings()

  // 1. If user preferred Smart Travel Engine, run it directly
  if (preferredEngine === 'smart') {
    return await executeSmartTravelMessage(message, trip)
  }

  // 2. If Gemini is configured and preferred/auto, use Gemini
  if (preferredEngine !== 'webllm' && isGeminiConfigured()) {
    try {
      const plan = await planWithGemini(message, trip, history, signal)
      const result = await executeAiPlan(plan, trip)
      return { ...result, engine: 'gemini' }
    } catch (err) {
      console.warn('[ai] Gemini failed, falling back to Smart Travel Engine:', err)
    }
  }

  // 3. If user explicitly wants WebLLM and WebGPU is available
  if (preferredEngine === 'webllm' && isWebGpuAvailable()) {
    try {
      const plan = await planWithWebLlm(message, trip, history)
      const result = await executeAiPlan(plan, trip)
      return { ...result, engine: 'webllm' }
    } catch (err) {
      console.warn('[ai] WebLLM failed, falling back to Smart Travel Engine:', err)
    }
  }

  // 4. Default & primary reliable engine: Smart Travel Engine
  // Delivers instant, comprehensive, high-quality itineraries & answers all travel questions
  try {
    return await executeSmartTravelMessage(message, trip)
  } catch (err) {
    console.error('[ai] Smart Travel Engine error:', err)
    return {
      reply: "I had a temporary issue planning that. Please try rephrasing or ask about a specific destination, e.g., 'Plan a 3-day trip to Tokyo' or 'What should I know before visiting Niagara Falls?'.",
      commands: [],
      engine: 'smart',
    }
  }
}

export function getAiEngineLabel(): AiEngine {
  const { preferredEngine } = getStoredSettings()
  if (preferredEngine === 'smart') return 'smart'
  if (preferredEngine === 'webllm' && isWebGpuAvailable()) return 'webllm'
  if (isGeminiConfigured()) return 'gemini'
  return 'smart'
}
