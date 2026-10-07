// Unified event timeline: one representation that synchronises Minecraft
// events, animations, texture states, particles, SFX, music, voice, UI and
// lighting. Game code consumes the compiled cue list (ticks), the dashboard
// renders it, QA checks it.
//
// { "id": "reactor_startup", "title": "Reactor start sequence", "duration": 5, "trigger": "reactor.start",
//   "tracks": {
//     "sfx":       [ { "t": 0.12, "sound": "ns:reactor.button" } ],
//     "animation": [ { "t": 1.5, "animation": "animation.reactor.startup", "target": "rotor" } ],
//     "texture":   [ { "t": 3.5, "state": "active", "model": "ns:reactor_core_active" } ],
//     "particles": [ { "t": 2.0, "particle": "minecraft:smoke", "count": 12, "spread": [0.4, 1, 0.4], "duration": 1 } ],
//     "music":     [ { "t": 4.0, "action": "transition", "state": "calm", "quantize": "bar" } ],
//     "voice":     [ { "t": 0.5, "line": "startup_initiated", "sound": "ns:voice.startup", "duration": 2.1 } ],
//     "ui":        [ { "t": 0, "bossbar": "Starting…", "progress": 0 } ],
//     "lighting":  [ { "t": 3.5, "level": 15 } ],
//     "state":     [ { "t": 5.0, "state": "RUNNING" } ],
//     "event":     [ { "t": 0, "id": "command" } ] } }
import { StudioError } from './fsutil.js';

export const TRACKS = ['event', 'sfx', 'animation', 'texture', 'particles', 'music', 'voice', 'ui', 'lighting', 'state'];
const REQUIRED = { sfx: ['sound'], animation: ['animation'], texture: ['state'], particles: ['particle'], music: ['action'], voice: ['line'], ui: [], lighting: ['level'], state: ['state'], event: ['id'] };

export function validateTimeline(tl, { soundEvents = null, animations = null, music = null } = {}) {
  const issues = [];
  const add = (severity, track, detail) => issues.push({ severity, track, detail });
  if (!tl?.id) add('error', '-', 'timeline needs an id');
  if (!(tl?.duration > 0)) add('error', '-', 'duration must be > 0 seconds');
  for (const [track, cues] of Object.entries(tl?.tracks || {})) {
    if (!TRACKS.includes(track)) { add('error', track, `unknown track (allowed: ${TRACKS.join(', ')})`); continue; }
    if (!Array.isArray(cues)) { add('error', track, 'track must be an array'); continue; }
    let prev = -Infinity;
    for (const c of cues) {
      if (typeof c.t !== 'number' || c.t < 0) add('error', track, `cue without valid time: ${JSON.stringify(c)}`);
      if (c.t > tl.duration + 1e-9) add('warning', track, `cue at ${c.t}s is after the timeline end (${tl.duration}s)`);
      if (c.t < prev) add('warning', track, `cues are not sorted (${c.t}s after ${prev}s)`);
      prev = c.t;
      for (const k of REQUIRED[track] || []) if (c[k] === undefined) add('error', track, `cue at ${c.t}s missing "${k}"`);
      if (track === 'sfx' && soundEvents && c.sound && !soundEvents.includes(c.sound)) add('error', track, `sound event ${c.sound} not defined in sounds.json`);
      if (track === 'voice' && soundEvents && c.sound && !soundEvents.includes(c.sound)) add('error', track, `voice sound ${c.sound} not defined in sounds.json`);
      if (track === 'animation' && animations && !animations.includes(c.animation)) add('error', track, `animation ${c.animation} not found`);
      if (Math.abs(c.t * 20 - Math.round(c.t * 20)) > 1e-6) add('info', track, `cue at ${c.t}s is not on a game tick (rounds to ${Math.round(c.t * 20) / 20}s)`);
    }
  }
  // overlapping voice lines are unintelligible
  const voice = [...(tl?.tracks?.voice || [])].sort((a, b) => a.t - b.t);
  for (let i = 1; i < voice.length; i++) if (voice[i - 1].duration && voice[i - 1].t + voice[i - 1].duration > voice[i].t) add('warning', 'voice', `voice line ${voice[i].line} starts before ${voice[i - 1].line} ends`);
  // music transitions should land on bar lines when metadata is known
  if (music?.bar_seconds) for (const c of tl?.tracks?.music || []) if (c.quantize !== 'bar' && c.quantize !== 'beat') add('info', 'music', `music cue at ${c.t}s has no quantize; the game will switch immediately (may cut a phrase)`);
  const errors = issues.filter((i) => i.severity === 'error').length;
  return { verdict: errors ? 'fail' : issues.some((i) => i.severity === 'warning') ? 'warn' : 'pass', issues };
}

/** Flatten to tick-ordered cues for game code. */
export function compileTimeline(tl) {
  const v = validateTimeline(tl);
  if (v.verdict === 'fail') throw new StudioError('E_TIMELINE', `Timeline invalid: ${v.issues.filter((i) => i.severity === 'error').map((i) => `${i.track}: ${i.detail}`).join('; ')}`);
  const cues = [];
  for (const [track, list] of Object.entries(tl.tracks || {})) for (const c of list) cues.push({ tick: Math.round(c.t * 20), t: c.t, track, ...c });
  cues.sort((a, b) => a.tick - b.tick || TRACKS.indexOf(a.track) - TRACKS.indexOf(b.track));
  return { id: tl.id, title: tl.title || tl.id, trigger: tl.trigger || null, duration_ticks: Math.round(tl.duration * 20), duration: tl.duration, cues };
}

/** ASCII lane view for chat summaries. */
export function renderTimelineText(tl, width = 60) {
  const lines = [];
  const scale = (t) => Math.min(width - 1, Math.round((t / tl.duration) * (width - 1)));
  lines.push(`${'time'.padEnd(10)}|${'0s'.padEnd(width - 6)}${`${tl.duration}s`.padStart(6)}`);
  for (const [track, cues] of Object.entries(tl.tracks || {})) {
    const row = Array(width).fill('·');
    for (const c of cues) row[scale(c.t)] = '◆';
    lines.push(`${track.padEnd(10)}|${row.join('')}`);
  }
  return lines.join('\n');
}
