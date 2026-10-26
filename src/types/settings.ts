export type AiEnginePreference = 'auto' | 'gemini' | 'smart' | 'webllm'

export type AppSettings = {
  geminiApiKey: string
  preferredEngine: AiEnginePreference
}

const SETTINGS_KEY = 'redgroup_travel_settings'

export function getStoredSettings(): AppSettings {
  if (typeof window === 'undefined') {
    return {
      geminiApiKey: '',
      preferredEngine: 'auto',
    }
  }

  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppSettings>
      return {
        geminiApiKey: parsed.geminiApiKey ?? '',
        preferredEngine: parsed.preferredEngine ?? 'auto',
      }
    }
  } catch {
    // fallback
  }

  // Check legacy localStorage or env
  const legacyKey = localStorage.getItem('redgroup_gemini_api_key') ?? ''
  return {
    geminiApiKey: legacyKey,
    preferredEngine: 'auto',
  }
}

export function saveStoredSettings(settings: Partial<AppSettings>): AppSettings {
  const current = getStoredSettings()
  const updated: AppSettings = {
    ...current,
    ...settings,
  }
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated))
    if (updated.geminiApiKey) {
      localStorage.setItem('redgroup_gemini_api_key', updated.geminiApiKey)
    } else {
      localStorage.removeItem('redgroup_gemini_api_key')
    }
  } catch (err) {
    console.warn('[settings] Failed to save settings to localStorage:', err)
  }
  return updated
}

export function getEffectiveGeminiApiKey(): string | null {
  const fromStorage = getStoredSettings().geminiApiKey?.trim()
  if (fromStorage && !fromStorage.includes('your_')) {
    return fromStorage
  }
  const fromEnv = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim()
  if (fromEnv && !fromEnv.includes('your_')) {
    return fromEnv
  }
  return null
}
