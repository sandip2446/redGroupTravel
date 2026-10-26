import { useState } from 'react'
import {
  getStoredSettings,
  saveStoredSettings,
  type AiEnginePreference,
} from '../types/settings'

type ApiKeyModalProps = {
  isOpen: boolean
  onClose: () => void
  onSettingsSaved?: () => void
}

export function ApiKeyModal({ isOpen, onClose, onSettingsSaved }: ApiKeyModalProps) {
  const current = getStoredSettings()
  const [apiKey, setApiKey] = useState(current.geminiApiKey)
  const [engine, setEngine] = useState<AiEnginePreference>(current.preferredEngine)
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  if (!isOpen) return null

  async function handleTestKey() {
    const trimmed = apiKey.trim()
    if (!trimmed) {
      setTestResult({ ok: false, message: 'Please enter an API key first.' })
      return
    }

    setTesting(true)
    setTestResult(null)

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${trimmed}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Respond with: "ready"' }] }],
        }),
      })

      if (res.ok) {
        setTestResult({ ok: true, message: '✅ Success! Gemini API key is valid and connected.' })
      } else {
        const err = await res.json().catch(() => ({}))
        const msg = (err as { error?: { message?: string } })?.error?.message || `HTTP ${res.status}`
        setTestResult({ ok: false, message: `❌ Error: ${msg}` })
      }
    } catch (e) {
      setTestResult({
        ok: false,
        message: `❌ Network error testing key: ${e instanceof Error ? e.message : 'Unknown'}`,
      })
    } finally {
      setTesting(false)
    }
  }

  function handleSave() {
    saveStoredSettings({
      geminiApiKey: apiKey.trim(),
      preferredEngine: engine,
    })
    onSettingsSaved?.()
    onClose()
  }

  function handleClear() {
    setApiKey('')
    setTestResult(null)
    saveStoredSettings({
      geminiApiKey: '',
      preferredEngine: 'auto',
    })
    onSettingsSaved?.()
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-card__header">
          <div className="modal-card__title-row">
            <span className="modal-card__icon" aria-hidden="true">
              ⚙️
            </span>
            <div>
              <h3 className="modal-card__title">AI Travel Agent Settings</h3>
              <p className="modal-card__subtitle">Configure your AI model engines & API keys</p>
            </div>
          </div>
          <button
            type="button"
            className="modal-card__close"
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <div className="modal-card__body">
          <div className="modal-section">
            <label className="modal-label" htmlFor="gemini-key-input">
              Google Gemini API Key (Optional)
            </label>
            <p className="modal-help">
              Unlock the power of Gemini 2.0 Flash for multi-day itineraries and nuanced travel reasoning.
              Get a 100% free key with no credit card required at{' '}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                className="modal-link"
              >
                Google AI Studio ↗
              </a>
            </p>

            <div className="modal-input-group">
              <input
                id="gemini-key-input"
                type={showKey ? 'text' : 'password'}
                className="modal-input"
                placeholder="AIzaSy..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <button
                type="button"
                className="modal-input-btn"
                onClick={() => setShowKey(!showKey)}
                title={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? '🙈' : '👁️'}
              </button>
            </div>

            {testResult && (
              <div
                className={`modal-alert ${testResult.ok ? 'modal-alert--success' : 'modal-alert--error'}`}
              >
                {testResult.message}
              </div>
            )}

            <div className="modal-actions-inline">
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={handleTestKey}
                disabled={testing || !apiKey.trim()}
              >
                {testing ? 'Testing connection…' : 'Test API Key'}
              </button>
              {apiKey && (
                <button
                  type="button"
                  className="btn-text btn-sm"
                  onClick={handleClear}
                >
                  Clear Key
                </button>
              )}
            </div>
          </div>

          <div className="modal-section">
            <span className="modal-label">Default AI Engine</span>
            <div className="modal-radio-list">
              <label className="modal-radio-card">
                <input
                  type="radio"
                  name="engine"
                  value="auto"
                  checked={engine === 'auto'}
                  onChange={() => setEngine('auto')}
                />
                <div className="modal-radio-text">
                  <strong>✨ Auto-Detect (Recommended)</strong>
                  <span>Uses Gemini when configured; otherwise uses built-in Smart Travel AI.</span>
                </div>
              </label>

              <label className="modal-radio-card">
                <input
                  type="radio"
                  name="engine"
                  value="smart"
                  checked={engine === 'smart'}
                  onChange={() => setEngine('smart')}
                />
                <div className="modal-radio-text">
                  <strong>⚡ Smart Travel Engine (No Key Required)</strong>
                  <span>Fast, verified travel wisdom, instant day-by-day itineraries & map controls.</span>
                </div>
              </label>

              <label className="modal-radio-card">
                <input
                  type="radio"
                  name="engine"
                  value="gemini"
                  checked={engine === 'gemini'}
                  onChange={() => setEngine('gemini')}
                />
                <div className="modal-radio-text">
                  <strong>🌐 Gemini 2.0 Cloud AI</strong>
                  <span>Deep conversational reasoning via your Google Gemini API key.</span>
                </div>
              </label>

              <label className="modal-radio-card">
                <input
                  type="radio"
                  name="engine"
                  value="webllm"
                  checked={engine === 'webllm'}
                  onChange={() => setEngine('webllm')}
                />
                <div className="modal-radio-text">
                  <strong>💻 WebLLM (On-Device WebGPU)</strong>
                  <span>Runs Llama 3.2 locally in browser (requires WebGPU & 1GB download).</span>
                </div>
              </label>
            </div>
          </div>
        </div>

        <div className="modal-card__footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={handleSave}>
            Save Changes
          </button>
        </div>
      </div>
    </div>
  )
}
