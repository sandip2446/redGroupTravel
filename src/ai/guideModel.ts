/**
 * WebLLM (MLC) — free, in-browser generative LLM via WebGPU.
 * Used as the Travel Guide brain for open-ended travel questions.
 */
import type { ModelLoadProgress } from './modelLoader'
import { emitGuideProgress } from './modelLoader'

/** Small instruct model that fits many laptops (~0.9GB cached after first download). */
export const GUIDE_MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC'

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

type MlcEngine = {
  chat: {
    completions: {
      create: (req: {
        messages: ChatMessage[]
        temperature?: number
        max_tokens?: number
      }) => Promise<{
        choices: Array<{ message?: { content?: string } }>
      }>
    }
  }
}

let enginePromise: Promise<MlcEngine> | null = null

export function isWebGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator
}

export async function getGuideEngine(): Promise<MlcEngine> {
  if (!isWebGpuAvailable()) {
    throw new Error('WebGPU is not available in this browser')
  }

  if (!enginePromise) {
    emitGuideProgress({
      status: 'loading',
      progress: 1,
      message: 'Starting Travel Guide LLM (WebLLM)…',
    })

    enginePromise = (async () => {
      const { CreateMLCEngine } = await import('@mlc-ai/web-llm')
      const engine = await CreateMLCEngine(GUIDE_MODEL_ID, {
        initProgressCallback: (report) => {
          const pct = Math.round((report.progress ?? 0) * 100)
          emitGuideProgress({
            status: 'loading',
            progress: Math.min(99, Math.max(2, pct)),
            message:
              report.text ||
              `Downloading Travel Guide model… ${Math.min(99, Math.max(2, pct))}%`,
          })
        },
      })

      emitGuideProgress({
        status: 'ready',
        progress: 100,
        message: 'Travel Guide LLM ready (WebLLM)',
      })
      return engine as unknown as MlcEngine
    })().catch((err) => {
      enginePromise = null
      emitGuideProgress({
        status: 'error',
        progress: 0,
        message:
          err instanceof Error ? err.message : 'Failed to load Travel Guide LLM',
      })
      throw err
    })
  }

  return enginePromise
}

export async function generateGuideReply(
  system: string,
  user: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  opts?: { temperature?: number; maxTokens?: number },
): Promise<string> {
  const engine = await getGuideEngine()
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    ...history.slice(-6),
    { role: 'user', content: user },
  ]

  const result = await engine.chat.completions.create({
    messages,
    temperature: opts?.temperature ?? 0.35,
    max_tokens: opts?.maxTokens ?? 900,
  })

  const text = result.choices[0]?.message?.content?.trim()
  if (!text) throw new Error('Empty Travel Guide reply')
  return text
}

export type { ModelLoadProgress }
