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
    name: "Carbon Knuckle",
    damage: 20,
    knockback: 4.8,
    reach: 2.55,
    cooldown: 0.32,
    swingDuration: 0.22,
    colorHex: 0xd1d5db,
    emissiveHex: 0x38bdf8,
  },
  baton: {
    id: "baton",
    name: "Titanium Baton",
    damage: 34,
    knockback: 6.8,
    reach: 2.95,
    cooldown: 0.4,
    swingDuration: 0.26,
    colorHex: 0x94a3b8,
    emissiveHex: 0xf59e0b,
  },
  whip: {
    id: "whip",
    name: "Razor Whip-Chain",
    damage: 40,
    knockback: 7.8,
    reach: 3.3,
    cooldown: 0.44,
    swingDuration: 0.29,
    colorHex: 0xcbd5e1,
    emissiveHex: 0xf97316,
  },
  katana: {
    id: "katana",
    name: "Thermal Katana",
    damage: 48,
    knockback: 8.4,
    reach: 3.15,
    cooldown: 0.44,
    swingDuration: 0.27,
    colorHex: 0xf87171,
    emissiveHex: 0xff2a85,
  },
  arc: {
    id: "arc",
    name: "Arc Shock-Gauntlet",
    damage: 56,
    knockback: 9.4,
    reach: 3.25,
    cooldown: 0.48,
    swingDuration: 0.28,
    colorHex: 0x38bdf8,
    emissiveHex: 0x00f0ff,
  },
};
