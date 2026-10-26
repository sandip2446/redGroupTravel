# Travel Guide AI (`src/ai`)

Natural-language **travel guide** that **controls the map** (routes, pins, layers, stops) and answers travel questions.

## Engines

| Priority | Engine | Needs key? | Library |
|----------|--------|------------|---------|
| 1 | Gemini | Optional free key | Google Generative Language API |
| 2 | **WebLLM** (Travel Guide Q&A) | **No** | `@mlc-ai/web-llm` (WebGPU) |
| 3 | Transformers.js (map NLU) | **No** | `@huggingface/transformers` |
| 4 | Local rules | No | Built-in patterns |

## WebLLM Travel Guide (default for Q&A)

Runs **Llama 3.2 1B Instruct** in the browser via WebGPU — free, private, no API key.

- First travel question downloads the model once (~0.9GB), then cached
- Progress bar appears in chat while loading
- Enriched with free Wikipedia summaries + Photon/Nominatim place facts
- Needs Chrome/Edge (or another WebGPU browser); otherwise fact-based fallback still answers

## Transformers.js (map commands)

**MobileBERT MNLI** zero-shot classification for intents like plan trip, explore region, change mode/layer.

## Optional Gemini

1. Create a free key at [Google AI Studio](https://aistudio.google.com/apikey)
2. Add to `.env.local`:

```bash
VITE_GEMINI_API_KEY=your_key_here
```

3. Restart `npm run dev`

## Folder layout

```
src/ai/
  agent.ts                 # engine selection
  guideModel.ts            # WebLLM Travel Guide loader
  modelLoader.ts           # Transformers.js + shared progress
  prompts.ts               # Gemini system prompts
  tools.ts                 # actions → map commands
  providers/
    travelGuide.ts         # Q&A routing + fact enrichment
    transformersJs.ts      # on-device map NLU
    gemini.ts              # cloud NLU + answers
    local.ts               # rule fallback
  types.ts
  index.ts
```
