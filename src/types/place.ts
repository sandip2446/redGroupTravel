export type Place = {
  id: string
  name: string
  description: string
  position: [number, number]
  type?: string
}

export type MapStyle = 'satellite' | 'terrain' | 'street'

export const DEFAULT_CENTER: [number, number] = [20, 0]
export const DEFAULT_ZOOM = 2
