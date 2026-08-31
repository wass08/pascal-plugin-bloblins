/**
 * Pre-generated pet names — PURE (no React/three/host imports).
 *
 * The register is deliberately narrow: snack-shaped, squishy, faintly absurd.
 * A procedural clay blob called "Gnocchi" lands; one called "Shadowfang" does
 * not. Names are drawn, never assembled from syllables, so every roll is a
 * name someone would actually pick.
 */

export const PET_NAMES = [
  // Snacks, sweets, and things you'd find in a fridge
  'Mochi',
  'Boba',
  'Miso',
  'Pudding',
  'Waffle',
  'Pickle',
  'Nugget',
  'Beans',
  'Tofu',
  'Churro',
  'Gnocchi',
  'Crouton',
  'Noodle',
  'Dumpling',
  'Toast',
  'Bagel',
  'Biscuit',
  'Muffin',
  'Pretzel',
  'Jelly',
  'Custard',
  'Marshmallow',
  'Ravioli',
  'Pierogi',
  'Brioche',
  'Wonton',
  'Edamame',
  'Matcha',
  'Sesame',
  'Peanut',
  'Scone',
  'Crumpet',
  'Pancake',
  'Meatball',
  'Halloumi',
  'Nacho',
  'Popcorn',
  'Truffle',
  'Bonbon',
  'Tater',
  'Sherbet',
  // Fruit and veg, which read as names on their own
  'Taro',
  'Yuzu',
  'Kiwi',
  'Plum',
  'Momo',
  'Coco',
  'Clementine',
  'Mango',
  'Lychee',
  'Pumpkin',
  'Olive',
  'Radish',
  'Turnip',
  'Apricot',
  // Texture and sound — the nonsense half
  'Bubbles',
  'Ziggy',
  'Doodle',
  'Pebble',
  'Squish',
  'Blob',
  'Wiggles',
  'Floof',
  'Sprinkles',
  'Pom',
  'Pip',
  'Squeak',
  'Bloop',
  'Wobble',
  'Nubbin',
  'Snoot',
  'Boop',
  'Gizmo',
  'Widget',
  'Bumble',
  'Waddle',
  'Tumble',
  'Snorkel',
  'Nibbles',
  'Zoomies',
  'Gloop',
  'Thimble',
  'Doink',
  'Pudge',
  'Chonk',
  'Wisp',
  'Mittens',
  'Pipsqueak',
  'Fizz',
  'Noot',
] as const

/** Titles a very small creature has not earned: "Sir Wiggles", "DJ Boba". */
export const HONORIFICS = ['Sir', 'Lady', 'Captain', 'Lord', 'Baron', 'DJ', 'Professor'] as const

/** Rare enough that a title still reads as a joke rather than a naming scheme. */
const HONORIFIC_CHANCE = 0.12

function pick<T>(options: readonly T[], rng: () => number): T {
  return options[Math.floor(rng() * options.length)] ?? options[0]!
}

/** Deterministic given `rng`: same generator state in, same name out. */
export function randomPetName(rng: () => number = Math.random): string {
  const name = pick(PET_NAMES, rng)
  if (rng() >= HONORIFIC_CHANCE) return name
  return `${pick(HONORIFICS, rng)} ${name}`
}
