// SG-01 style guide palette (concept_arts/warfront_00_style_guide.png, D-017).
export const palette = {
  // Teams
  blue: 0x2f6bd6,
  blueShade: 0x22509f,
  red: 0xd23c32,
  redShade: 0x9a2a23,
  // Uniforms
  greatcoat: 0x8b5a35,
  leather: 0x6a4126,
  infantry: 0x557f3f,
  khaki: 0x8f8a66,
  // Machines and metal
  olive: 0x6d7a3c,
  iron: 0x5a5650,
  gunmetal: 0x3c4147,
  hazard: 0xd9a628,
  brass: 0xd8a64a,
  // World
  concrete: 0x9e9a90,
  concreteShadow: 0x7b776f,
  sandbag: 0xbca67a,
  sandbagShadow: 0xa58e64,
  camoNet: 0x66713a,
  wood: 0x8c5a33,
  mud: 0x6b5540,
  scorched: 0x4f3f30,
  grass: 0x76803f,
  // Map surfaces (map spec MP-01)
  laneDirt: 0x9a8160,
  wheelRuts: 0x8b7354,
  jungle: 0x6c6043,
  trenchFloor: 0x4e3e2f,
  arenaFloor: 0x5d4a37,
  craterFloor: 0x3e3226,
  // Effects and sky (not in SG-01)
  smoke: 0x8c8c86,
  fire: 0xff8a2a,
  muzzle: 0xffd45c,
  danger: 0xff3b30, // attack telegraphs only
  haze: 0x4a4436,
} as const;
