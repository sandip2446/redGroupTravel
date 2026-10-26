import type {
  ProgressCallback,
  ZeroShotClassificationPipeline,
} from '@huggingface/transformers'

export type ModelLoadProgress = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  progress: number
  message: string
}

type ProgressListener = (p: ModelLoadProgress) => void

const INTENT_MODEL = 'Xenova/mobilebert-uncased-mnli'

let classifierPromise: Promise<ZeroShotClassificationPipeline> | null = null
let latest: ModelLoadProgress = {
  status: 'idle',
  progress: 0,
  message: 'AI model not loaded yet',
}
const listeners = new Set<ProgressListener>()

function emit(partial: Partial<ModelLoadProgress>) {
  latest = { ...latest, ...partial }
  for (const listener of listeners) listener(latest)
}

/** Shared progress channel for WebLLM Travel Guide downloads. */
export function emitGuideProgress(partial: Partial<ModelLoadProgress>) {
  emit(partial)
}

export function getModelProgress(): ModelLoadProgress {
  return latest
}

export function subscribeModelProgress(listener: ProgressListener): () => void {
  listeners.add(listener)
  listener(latest)
  return () => listeners.delete(listener)
}

const onProgress: ProgressCallback = (info) => {
  if (
    (info.status === 'progress' || info.status === 'progress_total') &&
    'progress' in info &&
    info.progress != null
  ) {
    emit({
      status: 'loading',
      progress: Math.round(info.progress),
      message: `Downloading AI model… ${Math.round(info.progress)}%`,
    })
  } else if (info.status === 'initiate' || info.status === 'download') {
    emit({
      status: 'loading',
      progress: Math.max(latest.progress, 2),
      message: 'Fetching Hugging Face model…',
    })
  } else if (info.status === 'done') {
    emit({
      status: 'loading',
      progress: Math.max(latest.progress, 90),
      message: 'Preparing AI model…',
    })
  } else if (info.status === 'ready') {
    emit({
      status: 'ready',
      progress: 100,
      message: 'On-device AI ready',
    })
  }
}

/**
 * Lazy-load Transformers.js zero-shot classifier (free, in-browser, no API key).
 * Dynamic import keeps the WASM/runtime out of the initial app bundle.
 */
export async function getIntentClassifier(): Promise<ZeroShotClassificationPipeline> {
  if (!classifierPromise) {
    emit({
      status: 'loading',
      progress: 1,
      message: 'Starting Hugging Face Transformers.js…',
    })
    classifierPromise = (async () => {
      const { env, pipeline } = await import('@huggingface/transformers')
      env.allowLocalModels = false
      env.useBrowserCache = true

      const pipe = await pipeline(
        'zero-shot-classification',
        INTENT_MODEL,
        {
          progress_callback: onProgress,
          dtype: 'q8',
        },
      )

      emit({
        status: 'ready',
        progress: 100,
        message: 'On-device AI ready',
      })
      return pipe as ZeroShotClassificationPipeline
    })().catch((err) => {
      classifierPromise = null
      emit({
        status: 'error',
        progress: 0,
        message: err instanceof Error ? err.message : 'Failed to load AI model',
      })
      throw err
    })
  }
  return classifierPromise
}

export function isTransformersReady(): boolean {
  return latest.status === 'ready'
}
