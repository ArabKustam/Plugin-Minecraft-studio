// Bedrock/Blockbench animation sampler — a faithful port of
// runtime/src/lib/model/animation.js (linear / catmullrom / step, keyframes as
// "time": [x,y,z] | number | {pre?, post, lerp_mode}).

const CHANNELS = ['rotation', 'position', 'scale'];

function toVec(v) {
  if (typeof v === 'number') return [v, v, v];
  if (!Array.isArray(v) || v.length !== 3) throw new Error(`Keyframe value must be [x,y,z], got ${JSON.stringify(v)}`);
  return v.map((n) => {
    if (typeof n === 'string') {
      const num = Number(n);
      if (Number.isFinite(num)) return num;
      throw new Error(`Molang expressions are not supported: ${n}`);
    }
    return n;
  });
}

function parseKeyframes(channel) {
  if (Array.isArray(channel) || typeof channel === 'number') return [{ t: 0, v: toVec(channel), lerp: 'linear' }];
  return Object.entries(channel).map(([t, val]) => {
    const time = Number(t);
    if (!Number.isFinite(time)) throw new Error(`Invalid keyframe time ${t}`);
    if (Array.isArray(val) || typeof val === 'number') return { t: time, v: toVec(val), lerp: 'linear' };
    const post = val.post ?? val.pre;
    if (post === undefined) throw new Error(`Keyframe ${t} needs a vector or {post}`);
    return { t: time, v: toVec(post), pre: val.pre ? toVec(val.pre) : null, lerp: val.lerp_mode || 'linear' };
  }).sort((a, b) => a.t - b.t);
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
  const i = kfs.findIndex((k) => k.t > time) - 1;
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
  if (!file?.animations) throw new Error('Animation file must contain an "animations" object');
  return Object.entries(file.animations).map(([name, a]) => ({
    name, loop: a.loop === true || a.loop === 'loop', hold: a.loop === 'hold_on_last_frame', length: Number(a.animation_length ?? 0),
    bones: Object.fromEntries(Object.entries(a.bones || {}).map(([bone, chans]) => [bone, Object.fromEntries(CHANNELS.filter((c) => chans[c] !== undefined).map((c) => [c, parseKeyframes(chans[c])]))])),
    timeline: a.timeline || {},
  }));
}

/** Pose at time t. `loop` overrides the animation's own loop flag (player toggle). */
export function poseAt(anim, t, loop = anim.loop) {
  const time = loop && anim.length > 0 ? t % anim.length : Math.min(t, anim.length || t);
  const pose = {};
  for (const [bone, chans] of Object.entries(anim.bones)) {
    pose[bone] = {};
    for (const [c, kfs] of Object.entries(chans)) pose[bone][c] = sampleChannel(kfs, time);
  }
  return pose;
}

/** Effective length: animation_length, or the last keyframe when it is 0. */
export function animLength(anim) {
  if (anim.length > 0) return anim.length;
  let m = 0;
  for (const chans of Object.values(anim.bones)) for (const kfs of Object.values(chans)) for (const k of kfs) m = Math.max(m, k.t);
  return m || 1;
}
