export type WeaponId = "knuckle" | "baton" | "whip" | "katana" | "arc";

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  damage: number;
  knockback: number;
  reach: number;
  cooldown: number;
  swingDuration: number;
  colorHex: number;
  emissiveHex: number;
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  knuckle: {
    id: "knuckle",
    name: "Brass Knuckles",
    damage: 20,
    knockback: 4.8,
    reach: 2.55,
    cooldown: 0.32,
    swingDuration: 0.22,
    colorHex: 0xd4a343,
    emissiveHex: 0x000000,
  },
  baton: {
    id: "baton",
    name: "Police Nightstick",
    damage: 34,
    knockback: 6.8,
    reach: 2.95,
    cooldown: 0.4,
    swingDuration: 0.26,
    colorHex: 0x1f242d,
    emissiveHex: 0x000000,
  },
  whip: {
    id: "whip",
    name: "Heavy Steel Chain",
    damage: 40,
    knockback: 7.8,
    reach: 3.3,
    cooldown: 0.44,
    swingDuration: 0.29,
    colorHex: 0x9ca3af,
    emissiveHex: 0x000000,
  },
  katana: {
    id: "katana",
    name: "Alloy Baseball Bat",
    damage: 48,
    knockback: 8.4,
    reach: 3.15,
    cooldown: 0.44,
    swingDuration: 0.27,
    colorHex: 0xcbd5e1,
    emissiveHex: 0x000000,
  },
  arc: {
    id: "arc",
    name: "Steel Crowbar",
    damage: 56,
    knockback: 9.4,
    reach: 3.25,
    cooldown: 0.48,
    swingDuration: 0.28,
    colorHex: 0xb91c1c,
    emissiveHex: 0x000000,
  },
};
