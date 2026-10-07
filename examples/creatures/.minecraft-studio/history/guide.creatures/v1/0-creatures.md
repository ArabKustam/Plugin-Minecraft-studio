# Studio Creatures — field guide

This guide covers seven creatures made with Minecraft Studio: three animals, two monsters and two anthropomorphic characters. They ship as a Bedrock add-on (`bedrock/RP` + `bedrock/BP`, packaged as `build-out/studio-creatures.mcaddon`). Each one also comes as a Blockbench project in `models/*.bbmodel`, which you can use with Blockbench or a Java model engine.

> **Not yet tested in a Bedrock client.** The add-on passes the studio's Bedrock validator: manifests, geometry, textures, animations, sounds and entity links all check out.

## Roster

| Creature | Entity id | Type | Temper | Health | Size (w × h) | Animations | Sounds |
|---|---|---|---|---|---|---|---|
| Ember Fox / Огненный лис | `studio:ember_fox` | animal | neutral: fights back when hit | 12 | 0.6 × 0.8 | idle, walk, attack (pounce) | ambient yip, hurt yelp, attack snarl |
| Highland Ox / Горный бык | `studio:highland_ox` | animal | neutral: headbutts when hit | 30 | 1.4 × 1.6 | idle (grazing), walk, attack (headbutt) | ambient low call, hurt, attack impact |
| Marsh Heron / Болотная цапля | `studio:marsh_heron` | animal | passive: panics when hit | 8 | 0.6 × 1.9 | idle, walk, attack (peck), flap | ambient croak, hurt squawk, attack clicks |
| Rust Crawler / Ржавый ползун | `studio:rust_crawler` | monster | hostile: hunts players within 16 blocks | 20 | 1.2 × 0.6 | idle, walk (tripod gait), attack (tail sting) | ambient chitter, hurt hiss, attack sting |
| Hollow Wraith / Полый призрак | `studio:hollow_wraith` | monster | hostile | 24 | 0.7 × 2.0 | idle (hover), walk (drift), attack (shriek) | ambient whisper, hurt wail, attack shriek |
| Abyssal Seer / Бездонный провидец | `studio:abyssal_seer` | anthropomorphic | hostile caster | 34 | 0.8 × 2.4 | idle (tentacle wave), walk (digitigrade gait), attack (staff cast, tentacles flare) | ambient chant & bubbles, hurt, attack cast |
| Badger Smith / Барсук-кузнец | `studio:badger_smith` | anthropomorphic | neutral NPC: defends itself with a hammer | 26 | 0.6 × 2.0 | idle, walk, attack (hammer strike), forge | ambient anvil clang, hurt grunt, attack impact |

## Spawning

1. Double-click `build-out/studio-creatures.mcaddon`. Minecraft Bedrock imports both packs.
2. Create or edit a world and enable both packs: *Resource Packs → Studio Creatures* and *Behavior Packs → Studio Creatures*.
3. In the Creative inventory, use the spawn eggs (e.g. **Spawn Ember Fox**), or run `/summon studio:ember_fox`.

## How the client chooses animations

The client entity picks an animation from these Molang conditions:

| Condition | Animation |
|---|---|
| `query.modified_move_speed < 0.05` | **idle** |
| `query.modified_move_speed >= 0.05` | **walk** |
| `variable.attack_time > 0.0` | **attack** (monsters, fox, ox, smith) |
| `!query.is_on_ground` | **flap** (Marsh Heron only) |
| standing still on the ground, every other second | **forge** (Badger Smith only) |

## Sounds

`sounds.json` maps each entity's `ambient`, `hurt` and `death` events to `mob.<id>.ambient` and `mob.<id>.hurt`. The attack sounds are defined in `sound_definitions.json`. You can trigger them with `/playsound mob.<id>.attack @a`, or from an animation controller.

## Files

| Path | Content |
|---|---|
| `art/models/*.model.json` | editable model sources (bones, pivots, box UV) |
| `art/paint/*.paint.json` | texture paint specs (materials, ramps, patterns, face details) |
| `art/animations/*.animation.json` | animations (Bedrock 1.8.0) |
| `art/sfx/*.recipe.json` | sound recipes |
| `bedrock/RP`, `bedrock/BP` | the add-on |
| `models/*.bbmodel` | Blockbench projects with textures and animations embedded |
| `audio/**.flac` | lossless sound masters |

Regenerate everything with `node studio/produce.mjs --fresh`.
