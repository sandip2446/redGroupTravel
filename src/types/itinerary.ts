export type ItineraryActivity = {
  timeOfDay: 'morning' | 'afternoon' | 'evening'
  title: string
  description: string
  locationName?: string
  lat?: number
  lng?: number
  costEstimate?: string
  tips?: string
}

export type ItineraryDay = {
  dayNumber: number
  theme: string
  title?: string
  activities: ItineraryActivity[]
  stayOrArea?: string
  mealsToTry?: string[]
}

export type TripItinerary = {
  title: string
  destination: string
  origin?: string
  durationDays: number
  summary: string
  vibe?: string
  days: ItineraryDay[]
  budgetLevel?: 'budget' | 'moderate' | 'luxury'
  packingHighlights?: string[]
  essentialTips?: string[]
}
