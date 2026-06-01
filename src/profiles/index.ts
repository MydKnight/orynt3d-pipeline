import { lootStudiosProfile } from './loot-studios.js'
import { fleshOfGodsProfile } from './flesh-of-gods.js'
import type { SubscriptionProfile } from './types.js'

const profiles: SubscriptionProfile[] = [
  lootStudiosProfile,
  fleshOfGodsProfile,
]

export function getProfileNames(): string[] {
  return profiles.map(p => p.name)
}

export function getProfile(name: string): SubscriptionProfile | undefined {
  return profiles.find(p => p.name.toLowerCase() === name.toLowerCase())
}
