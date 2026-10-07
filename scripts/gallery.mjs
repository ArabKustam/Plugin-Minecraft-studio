// Build README gallery images from the produced demo (real assets, not mock-ups).
//   node scripts/gallery.mjs   (after examples/industrial-reactor/studio/produce.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPng, writePng, scaleNearest } from '../runtime/src/lib/texture/image.js';
import { renderSpec } from '../runtime/src/lib/texture/pixelart.js';
import { variantStrip } from '../runtime/src/lib/texture/ops.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = path.join(ROOT, 'examples/industrial-reactor');
const OUT = path.join(ROOT, 'docs/images');
const tex = (p) => readPng(path.join(DEMO, 'resourcepack/assets/reactor/textures', p));

writePng(path.join(OUT, 'logo.png'), scaleNearest(renderSpec(JSON.parse(fs.readFileSync(path.join(OUT, 'logo.pixelspec.json'), 'utf8'))).image, 16));
writePng(path.join(OUT, 'texture-sheet.png'), variantStrip(['block/steel_plate', 'block/machine_casing', 'block/vent', 'block/pipe_block', 'block/hazard_stripes', 'item/core_top', 'item/rotor', 'item/panel_front', 'item/panel_side', 'item/lamp_off', 'item/lamp_on'].map((p) => tex(`${p}.png`))));
writePng(path.join(OUT, 'texture-states.png'), variantStrip(['off', 'active', 'warning', 'critical'].map((s) => tex(`item/core_side_${s}.png`))));
for (const [src, dst] of [['model_reactor_rig.png', 'model-turnaround.png'], ['model_control_panel.png', 'model-control-panel.png'], ['anim_animation_reactor_startup.png', 'animation-startup.png']]) {
  fs.copyFileSync(path.join(DEMO, '.minecraft-studio/previews', src), path.join(OUT, dst));
}
console.log(fs.readdirSync(OUT).join('\n'));
