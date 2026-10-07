// Animations use the Bedrock animation JSON format (also produced/consumed by
// Blockbench), so they stay editable in standard tools:
// { "format_version": "1.8.0", "animations": { "animation.reactor.startup": {
//     "loop": false, "animation_length": 5,
//     "bones": { "rotor": { "rotation": { "0.0": [0,0,0], "1.4": { "post": [0,90,0], "lerp_mode": "catmullrom" } } } },
//     "timeline": { "0.2": "relay_click" } } } }
import { StudioError } from '../core/fsutil.js';

const CHANNELS = ['rotation', 'position', 'scale'];

function parseKeyframes(channel) {
  if (Array.isArray(channel) || typeof channel === 'number') return [{ t: 0, v: toVec(channel), lerp: 'linear' }];
  return Object.entries(channel).map(([t, val]) => {
    const time = Number(t);
    if (!Number.isFinite(time)) throw new StudioError('E_ANIM', `Invalid keyframe time ${t}`);
    if (Array.isArray(val) || typeof val === 'number') return { t: time, v: toVec(val), lerp: 'linear' };
    const post = val.post ?? val.pre;
    if (post === undefined) throw new StudioError('E_ANIM', `Keyframe ${t} needs a vector or {post}`);
    return { t: time, v: toVec(post), pre: val.pre ? toVec(val.pre) : null, lerp: val.lerp_mode || 'linear' };
  }).sort((a, b) => a.t - b.t);
}

function toVec(v) {
  if (typeof v === 'number') return [v, v, v];
  if (!Array.isArray(v) || v.length !== 3) throw new StudioError('E_ANIM', `Keyframe value must be [x,y,z], got ${JSON.stringify(v)}`);
  return v.map((n) => {
    if (typeof n === 'string') throw new StudioError('E_ANIM', `Molang expressions are not supported by the studio sampler: ${n}`);
    return n;
  });
}

const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return p1.map((_, i) => 0.5 * ((2 * p1[i]) + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3));
}

export function sampleChannel(kfs, time) {
  if (!kfs.length) return null;
  if (time <= kfs[0].t) return kfs[0].pre || kfs[0].v;
  if (time >= kfs.at(-1).t) return kfs.at(-1).v;
  let i = kfs.findIndex((k) => k.t > time) - 1;
  const a = kfs[i], b = kfs[i + 1];
  const u = (time - a.t) / (b.t - a.t || 1);
  if (a.lerp === 'step') return a.v;
  if (a.lerp === 'catmullrom' || b.lerp === 'catmullrom') {
    const p0 = kfs[Math.max(0, i - 1)].v, p3 = kfs[Math.min(kfs.length - 1, i + 2)].v;
    return catmull(p0, a.v, b.pre || b.v, p3, u);
  }
  return lerp(a.v, b.pre || b.v, u);
}

export function loadAnimations(file) {
  if (!file?.animations) throw new StudioError('E_ANIM', 'Animation file must contain an "animations" object');
  return Object.entries(file.animations).map(([name, a]) => ({
    name, loop: a.loop === true || a.loop === 'loop', hold: a.loop === 'hold_on_last_frame', length: Number(a.animation_length ?? 0),
    bones: Object.fromEntries(Object.entries(a.bones || {}).map(([bone, chans]) => [bone, Object.fromEntries(CHANNELS.filter((c) => chans[c] !== undefined).map((c) => [c, parseKeyframes(chans[c])]))])),
    timeline: a.timeline || {},
  }));
}

/** Pose = per-bone {rotation, position, scale} offsets at time t. */
export function poseAt(anim, t) {
  const time = anim.loop && anim.length > 0 ? t % anim.length : Math.min(t, anim.length || t);
  const pose = {};
  for (const [bone, chans] of Object.entries(anim.bones)) {
    pose[bone] = {};
    for (const [c, kfs] of Object.entries(chans)) pose[bone][c] = sampleChannel(kfs, time);
  }
  return pose;
}

/**
 * Validate animations against a model (bone names) and against motion quality
 * heuristics: snapping, loop seams, missing easing, keyframes past the end.
 */
export function validateAnimations(file, { boneNames = null, maxDegPerSecond = 720 } = {}) {
  const results = [];
  let anims;
  try { anims = loadAnimations(file); } catch (e) { return { verdict: 'fail', animations: [], checks: [{ name: 'structure', status: 'fail', detail: e.message }] }; }
  for (const a of anims) {
    const checks = [];
    const add = (name, status, detail) => checks.push({ name, status, detail });
    if (!(a.length > 0)) add('length', 'fail', 'animation_length must be > 0');
    else add('length', 'pass', `${a.length}s`);
    if (boneNames) {
      const missing = Object.keys(a.bones).filter((b) => !boneNames.includes(b));
      add('bone references', missing.length ? 'fail' : 'pass', missing.length ? `unknown bones: ${missing.join(', ')}` : 'all bones exist in model');
    }
    let late = 0, fastest = 0, fastestAt = null, linearOnly = true, seams = [];
    for (const [bone, chans] of Object.entries(a.bones)) {
      for (const [c, kfs] of Object.entries(chans)) {
        late += kfs.filter((k) => k.t > a.length + 1e-6).length;
        if (kfs.some((k) => k.lerp !== 'linear') || kfs.length > 3) linearOnly = false;
        if (c === 'rotation') {
          for (let i = 1; i < kfs.length; i++) {
            const dt = kfs[i].t - kfs[i - 1].t;
            const d = Math.max(...kfs[i].v.map((v, k) => Math.abs(v - kfs[i - 1].v[k])));
            const speed = dt > 0 ? d / dt : (d > 0 ? Infinity : 0);
            if (speed > fastest) { fastest = speed; fastestAt = `${bone} ${kfs[i - 1].t}s→${kfs[i].t}s`; }
          }
        }
        if (a.loop && kfs.length > 1) {
          const first = kfs[0].v, last = kfs.at(-1).v;
          const delta = Math.max(...first.map((v, k) => Math.abs(v - last[k])));
          const full = c === 'rotation' && first.every((v, k) => Math.abs(((last[k] - v) % 360)) < 1e-6);
          if (delta > 1e-3 && !full) seams.push(`${bone}.${c}`);
          if (kfs.at(-1).t < a.length - 1e-6 && kfs.at(-1).t > 0) seams.push(`${bone}.${c} (ends at ${kfs.at(-1).t}s < length)`);
        }
      }
    }
    add('keyframes within length', late ? 'warn' : 'pass', late ? `${late} keyframes after animation_length` : 'ok');
    add('angular speed', fastest === Infinity ? 'fail' : fastest > maxDegPerSecond ? 'warn' : 'pass', fastest === Infinity ? `instant snap at ${fastestAt}` : `max ${Math.round(fastest)}°/s${fastestAt ? ` at ${fastestAt}` : ''}`);
    if (a.loop) add('loop seam', seams.length ? 'warn' : 'pass', seams.length ? `first/last keyframes differ: ${seams.join(', ')}` : 'seamless');
    add('easing', linearOnly && Object.keys(a.bones).length ? 'warn' : 'pass', linearOnly ? 'only linear 2–3 key motion: consider anticipation, ease-in/out (catmullrom) or overshoot' : 'eased / multi-key motion');
    const verdict = checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') ? 'warn' : 'pass';
    results.push({ name: a.name, length: a.length, loop: a.loop, bones: Object.keys(a.bones), timeline: a.timeline, verdict, checks });
  }
  const verdict = results.some((r) => r.verdict === 'fail') ? 'fail' : results.some((r) => r.verdict === 'warn') ? 'warn' : 'pass';
  return { verdict, animations: results };
}
