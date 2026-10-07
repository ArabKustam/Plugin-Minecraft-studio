# Armory & Orchard: guide

This is a **Java 1.21.11 resource pack** made with Minecraft Studio. It contains:

- 4 swords
- a 4-piece tool set
- 2 bows, each with 3 draw stages
- 2 animated staffs
- 6 fruits
- 2 wearable sets: ranger clothing and knight plate

No mods or plugins are needed. Every item is a vanilla item reskinned through the 1.21.4+ `item_model` component. The wearables also use the `equippable` component, which points at the pack's equipment assets.

> The pack passes the studio's resource-pack validator, including the equipment layers and the bow pull-state definitions. It has **not yet been tested in a Minecraft client**. The command syntax below is for 1.21.5+ components.

## Install

1. Copy `build-out/armory-and-orchard.zip` to `.minecraft/resourcepacks/`.
2. Enable the pack in *Options → Resource Packs*.
3. In a world with cheats enabled, paste the commands below.

## Swords

```mcfunction
/give @p diamond_sword[item_model="studio:ember_blade",item_name="Ember Blade"]
/give @p diamond_sword[item_model="studio:frost_fang",item_name="Frost Fang"]
/give @p netherite_sword[item_model="studio:void_katana",item_name="Void Katana"]
/give @p iron_sword[item_model="studio:bone_cleaver",item_name="Bone Cleaver"]
```

## Tools (Aurum set)

```mcfunction
/give @p golden_pickaxe[item_model="studio:aurum_pickaxe",item_name="Aurum Pickaxe"]
/give @p golden_axe[item_model="studio:aurum_axe",item_name="Aurum Axe"]
/give @p golden_shovel[item_model="studio:aurum_shovel",item_name="Aurum Shovel"]
/give @p golden_hoe[item_model="studio:aurum_hoe",item_name="Aurum Hoe"]
```

## Bows

Each bow has a standby texture and three draw stages. Its item definition switches between them with `minecraft:using_item` and `minecraft:use_duration`, the same way the vanilla bow does.

```mcfunction
/give @p bow[item_model="studio:storm_bow",item_name="Storm Bow"]
/give @p bow[item_model="studio:heartwood_longbow",item_name="Heartwood Longbow"]
```

## Staffs (animated)

The crystal on each staff pulses through a 4-frame `.mcmeta` animation.

```mcfunction
/give @p blaze_rod[item_model="studio:ember_staff",item_name="Ember Staff"]
/give @p stick[item_model="studio:tide_staff",item_name="Tide Staff"]
```

## Fruits

```mcfunction
/give @p apple[item_model="studio:starfruit",item_name="Starfruit"]
/give @p apple[item_model="studio:blood_orange",item_name="Blood Orange"]
/give @p sweet_berries[item_model="studio:frost_berries",item_name="Frost Berries"]
/give @p glow_berries[item_model="studio:glowfruit",item_name="Glowfruit"]
/give @p apple[item_model="studio:dragonfruit",item_name="Dragonfruit"]
/give @p golden_apple[item_model="studio:golden_pear",item_name="Golden Pear"]
```

## Wearables

The `asset_id` points at `assets/studio/equipment/<set>.json`. That file selects the worn textures in `textures/entity/equipment/humanoid/` and `.../humanoid_leggings/`.

### Ranger outfit (clothing)

```mcfunction
/give @p leather_helmet[item_model="studio:ranger_hood",item_name="Ranger Hood",equippable={slot:"head",asset_id:"studio:ranger"}]
/give @p leather_chestplate[item_model="studio:ranger_tunic",item_name="Ranger Tunic",equippable={slot:"chest",asset_id:"studio:ranger"}]
/give @p leather_leggings[item_model="studio:ranger_trousers",item_name="Ranger Trousers",equippable={slot:"legs",asset_id:"studio:ranger"}]
/give @p leather_boots[item_model="studio:ranger_boots",item_name="Ranger Boots",equippable={slot:"feet",asset_id:"studio:ranger"}]
```

### Knight plate armor

```mcfunction
/give @p iron_helmet[item_model="studio:knight_helm",item_name="Knight Helm",equippable={slot:"head",asset_id:"studio:knight"}]
/give @p iron_chestplate[item_model="studio:knight_cuirass",item_name="Knight Cuirass",equippable={slot:"chest",asset_id:"studio:knight"}]
/give @p iron_leggings[item_model="studio:knight_greaves",item_name="Knight Greaves",equippable={slot:"legs",asset_id:"studio:knight"}]
/give @p iron_boots[item_model="studio:knight_sabatons",item_name="Knight Sabatons",equippable={slot:"feet",asset_id:"studio:knight"}]
```

## How it was made

| Asset | Source | Tool |
|---|---|---|
| Item icons | `art/items/*.item.json`: part-labelled silhouettes (blade, edge, guard, grip, gem, peel…), materials and detail pixels | `texture_shade_item` adds lighting, rim light, specular corners, material styles and coloured outlines |
| Worn textures | `art/equipment/*_humanoid*.paint.json`: materials, trims, visor, emblem, transparent areas | `texture_paint_uv` paints them onto the vanilla 64×32 humanoid layouts |
| Mannequin previews | `art/equipment/mannequin_*.model.json`: outer layer inflated 1.0, leggings 0.5 (vanilla values) | `model_export` (`.bbmodel`) and `model_render` |

Rebuild everything with `node studio/produce.mjs --fresh`.
