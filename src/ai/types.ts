import type { TravelMode } from '../lib/routing'
import type { MapStyle, Place } from '../types/place'
import type { TripItinerary } from '../types/itinerary'

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  itinerary?: TripItinerary
}

export type TripSnapshot = {
  from: Place | null
  to: Place | null
  stops: Place[]
  mode: TravelMode
  mapStyle: MapStyle
  selected: Place | null
  explorePlaces?: Place[]
  itinerary?: TripItinerary | null
}

export type TripCommand =
  | { type: 'setFrom'; place: Place }
  | { type: 'setTo'; place: Place }
  | { type: 'addStop'; place: Place }
  | { type: 'setStops'; places: Place[] }
  | { type: 'removeStop'; name: string }
  | { type: 'clearStops' }
  | { type: 'setMode'; mode: TravelMode }
  | { type: 'setMapStyle'; style: MapStyle }
  | { type: 'select'; place: Place }
  | { type: 'setExplorePlaces'; places: Place[]; region: Place }
  | { type: 'clearExplore' }
  | { type: 'clearTrip' }
  | { type: 'swap' }
  | { type: 'openDirections' }
  | { type: 'useMyLocationAsFrom' }
  | { type: 'setItinerary'; itinerary: TripItinerary }
  | { type: 'clearItinerary' }

export type TripBotResult = {
  reply: string
  commands: TripCommand[]
  engine?: 'gemini' | 'transformers' | 'webllm' | 'smart' | 'local'
  itinerary?: TripItinerary
}

/** Structured actions the LLM can emit (natural language → tools). */
export type AiAction =
  | { action: 'plan_trip'; from: string; to: string; via?: string }
  | { action: 'set_start'; place: string }
  | { action: 'set_destination'; place: string }
  | { action: 'add_stop'; place: string }
  | {
      action: 'suggest_stops'
      theme: 'nature' | 'food' | 'culture' | 'cities' | 'scenic'
      replace?: boolean
    }
  | { action: 'remove_stop'; place: string }
  | { action: 'clear_stops' }
  | { action: 'clear_trip' }
  | { action: 'set_mode'; mode: TravelMode }
  | { action: 'set_map_style'; style: MapStyle }
  | { action: 'show_place'; place: string }
  | { action: 'explore_region'; region: string }
  | { action: 'swap' }
  | { action: 'use_my_location_as_start' }
  | { action: 'open_directions' }
  | { action: 'summarize_trip' }
  | { action: 'set_itinerary'; itinerary: TripItinerary }

export type AiPlan = {
  reply: string
  actions: AiAction[]
  itinerary?: TripItinerary
}
