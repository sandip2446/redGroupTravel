/**
 * Red Group Travel Guide AI (`src/ai`)
 * ------------------------------------
 * Controls the map and answers travel questions.
 *
 * Engines (in order):
 * 1. Gemini — optional free cloud key (`VITE_GEMINI_API_KEY`)
 * 2. WebLLM — free in-browser LLM (map tools + Travel Guide Q&A)
 * 3. Transformers.js — Hugging Face NLU for map commands
 * 4. Local rules / fact fallback — backup (still moves the map when possible)
 */
export { processTripMessage, getAiEngineLabel, type AiEngine } from './agent'
export { isGeminiConfigured } from './providers/gemini'
export {
  getModelProgress,
  subscribeModelProgress,
  getIntentClassifier,
  isTransformersReady,
  type ModelLoadProgress,
} from './modelLoader'
export { GUIDE_MODEL_ID, isWebGpuAvailable } from './guideModel'
export type {
  AiAction,
  AiPlan,
  ChatMessage,
  TripBotResult,
  TripCommand,
  TripSnapshot,
} from './types'
