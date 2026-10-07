# Paper 1.21.11: custom item models & display-entity rigs

**Question.** How does a Paper plugin show animated custom machine parts without a client mod?

**Answer.**

- **Version.** Target Paper 1.21.11 (`io.papermc.paper:paper-api:1.21.11-R0.1-SNAPSHOT`, Java 21). It is the last release on the `-R0.1-SNAPSHOT` scheme. Paper 26.x uses build versions such as `26.2.build.132-stable` and needs Java 25. The local toolchain is Java 21, so the demo stays on 1.21.11.
- **Custom item models (1.21.4+).**
  - Write an item model definition at `assets/<ns>/items/<id>.json`, e.g. `{"model":{"type":"minecraft:model","model":"<ns>:item/<id>"}}`.
  - Code selects it with `ItemMeta#setItemModel(NamespacedKey)`.
  - This replaces CustomModelData overrides; `setCustomModelData(Integer)` is deprecated in favour of `CustomModelDataComponent`.
- **Animation.**
  - Spawn an `ItemDisplay` showing the item model.
  - Set the target with `Display#setTransformation`, then `setInterpolationDelay(0)` and `setInterpolationDuration(ticks)`. The client interpolates smoothly.
  - Chain steps of ≤ 90° for continuous rotation, so a rotation is never ambiguous.
- **Resource pack format.**
  - 1.21.11 uses resource pack format **75** (1.21.4 = 46, 1.21.8 = 64, 1.21.10 = 69).
  - Since 1.21.9, `pack.mcmeta` also accepts `min_format`/`max_format`.
- **Sounds.**
  - Sound files must be Ogg Vorbis. Only mono files attenuate with distance.
  - Long music should set `"stream": true` in `sounds.json`.
  - Music is played per player (`Player#playSound`, category `RECORDS`) and stopped with `Player#stopSound(key, category)`.

**Decision.**
- The reactor is a display-entity rig made of `core` (4 state models), `rotor` and `lamp` (off/on).
- Click handling uses an `Interaction` entity.
- Animation timing lives in the Minecraft Studio timeline files, not in code.

**Sources** (checked 2026-10):
- https://docs.papermc.io/paper/dev/project-setup/
- https://fill.papermc.io/v3/projects/paper
- https://jd.papermc.io/paper/1.21.11/org/bukkit/inventory/meta/ItemMeta.html
- https://minecraft.wiki/w/Items_model_definition
- https://minecraft.wiki/w/Pack_format
- https://minecraft.wiki/w/Sounds.json
