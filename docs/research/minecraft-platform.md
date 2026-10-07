# Research: Minecraft platform & versions (2026-10)

- **Paper versioning.** After 1.21.11, Paper switched to year-based versions:

  | Version | Channel |
  |---|---|
  | 26.1 | — |
  | 26.2 | latest stable (build 132) |
  | 26.3 | beta |

  - The `paper-api` coordinates changed from `<ver>-R0.1-SNAPSHOT` (up to 1.21.11) to `26.x.build.N-stable` (26.x).
  - 26.x requires **Java 25**; 1.20.5–1.21.11 require Java 21.
  - Sources: [docs.papermc.io](https://docs.papermc.io/paper/dev/project-setup/), [fill.papermc.io](https://fill.papermc.io/v3/projects/paper).
- **Downloads.** `GET https://fill.papermc.io/v3/projects/paper/versions/{v}/builds/latest` returns `downloads["server:default"].url` and `checksums.sha256`.
- **Item models (1.21.4+).** Each item model is defined in `assets/<ns>/items/<id>.json`, e.g. `{"model":{"type":"minecraft:model","model":"ns:item/x"}}`. Plugin code applies it with `ItemMeta#setItemModel(NamespacedKey)`.
- **Resource pack formats:**

  | Minecraft | Pack format |
  |---|---|
  | 1.21.4 | 46 |
  | 1.21.5 | 55 |
  | 1.21.6 | 63 |
  | 1.21.7–8 | 64 |
  | 1.21.9–10 | 69 |
  | 1.21.11 | 75 |
  | 26.1 | 84 |
  | 26.2 | 88 |

  Since 1.21.9, `pack.mcmeta` also supports `min_format`/`max_format`. Source: [minecraft.wiki/w/Pack_format](https://minecraft.wiki/w/Pack_format).
- **Demo decision.** The demo targets Paper 1.21.11 with Java 21, the toolchain installed here. 26.x is supported through version detection and the pack-format table above.
