import { h, icon, fmtClock } from '../dom.js';
import { api, fetchFileJson, fileUrl } from '../api.js';
import { pageHeader, statusChip, empty, kv, section, tag, assetHeader, genericAssetSections, spinner, segmented, toggle, button, card } from '../ui.js';
import { loadAnimations, poseAt, animLength } from '../anim.js';
import { listAssets, splitLayout, listItem, replace } from './common.js';
import { loadModelAsset, viewerPanel, boneTree } from './modelutil.js';

const CH_COLOR = { rotation: 'var(--accent)', position: 'var(--info)', scale: 'var(--warn)' };

function animFile(a) { return (a.files || []).find((f) => /\.json$/i.test(f.path))?.path || null; }

/** Player: transport + keyframe lanes, drives a pose callback. */
function animPlayer(anim, onPose) {
  const len = animLength(anim);
  const st = { t: 0, playing: true, loop: anim.loop, speed: 1 };
  let raf = 0, last = 0;
  const timeEl = h('span', { class: 'mono anim-time' });
  const scrub = h('input', { type: 'range', class: 'scrubber', min: '0', max: String(len), step: '0.001', value: '0', 'aria-label': 'Animation time' });
  const playBtn = h('button', { type: 'button', class: 'btn btn-play', 'aria-label': 'Pause' });
  const playheads = [];
  const apply = () => {
    const t = st.loop ? st.t % len : Math.min(st.t, len);
    onPose(poseAt(anim, t, st.loop));
    timeEl.textContent = `${fmtClock(t)} / ${fmtClock(len)}`;
    scrub.value = String(t);
    for (const ph of playheads) ph.style.left = `${(t / len) * 100}%`;
    playBtn.replaceChildren(icon(st.playing ? 'pause' : 'play', { size: 16 }));
    playBtn.setAttribute('aria-label', st.playing ? 'Pause' : 'Play');
  };
  const frame = (now) => {
    if (!st.playing) { raf = 0; return; }
    if (last) st.t += ((now - last) / 1000) * st.speed;
    last = now;
    if (!st.loop && st.t >= len) { st.t = len; st.playing = false; }
    else if (st.loop && st.t >= len) st.t %= len;
    apply();
    raf = st.playing ? requestAnimationFrame(frame) : 0;
  };
  const play = () => { if (!st.loop && st.t >= len) st.t = 0; st.playing = true; last = 0; if (!raf) raf = requestAnimationFrame(frame); apply(); };
  const pause = () => { st.playing = false; apply(); };
  playBtn.addEventListener('click', () => (st.playing ? pause() : play()));
  scrub.addEventListener('input', () => { st.playing = false; st.t = Number(scrub.value); apply(); });

  // keyframe lanes
  const lanes = h('div', { class: 'lanes' });
  const seekFromEvent = (track, e) => { const r = track.getBoundingClientRect(); st.playing = false; st.t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * len; apply(); };
  const lane = (label, ticks, cls = '') => {
    const track = h('div', { class: 'lane-track' }, ticks);
    const ph = h('span', { class: 'lane-playhead', 'aria-hidden': 'true' });
    playheads.push(ph);
    track.appendChild(ph);
    track.addEventListener('pointerdown', (e) => { seekFromEvent(track, e); const mv = (ev) => seekFromEvent(track, ev); const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); }; window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); });
    return h('div', { class: `lane ${cls}` }, h('div', { class: 'lane-label mono' }, label), track);
  };
  // ruler
  const rulerTicks = [];
  const step = len <= 2 ? 0.25 : len <= 6 ? 0.5 : len <= 20 ? 1 : 5;
  for (let t = 0; t <= len + 1e-9; t += step) rulerTicks.push(h('span', { class: 'ruler-tick', style: { left: `${(t / len) * 100}%` } }, h('span', null, `${Number(t.toFixed(2))}s`)));
  lanes.appendChild(lane('time', rulerTicks, 'lane-ruler'));
  const events = Object.entries(anim.timeline || {});
  if (events.length) lanes.appendChild(lane('events', events.map(([t, v]) => h('span', { class: 'kf kf-event', style: { left: `${(Number(t) / len) * 100}%` }, title: `${t}s: ${typeof v === 'string' ? v : JSON.stringify(v)}` }, h('span', { class: 'kf-label' }, typeof v === 'string' ? v : 'event')))));
  for (const [bone, chans] of Object.entries(anim.bones)) {
    const ticks = [];
    Object.entries(chans).forEach(([ch, kfs], ci) => {
      for (const k of kfs) ticks.push(h('span', { class: `kf kf-${k.lerp}`, style: { left: `${(Math.min(k.t, len) / len) * 100}%`, top: `${6 + ci * 9}px`, background: CH_COLOR[ch] }, title: `${bone}.${ch} @ ${k.t}s → [${k.v.map((n) => Number(n.toFixed(3))).join(', ')}] (${k.lerp})` }));
    });
    lanes.appendChild(lane(bone, ticks));
  }
  const legend = h('div', { class: 'lane-legend small muted' }, Object.entries(CH_COLOR).map(([k, c]) => h('span', null, h('i', { style: { background: c } }), k)), h('span', null, h('i', { class: 'kf-step-demo' }), 'step'), h('span', null, h('i', { class: 'kf-cat-demo' }), 'catmullrom'));

  const transport = h('div', { class: 'transport' }, playBtn, timeEl, scrub,
    toggle('Loop', st.loop, (v) => { st.loop = v; if (v && !st.playing) play(); apply(); }),
    h('label', { class: 'speed' }, h('span', { class: 'muted small' }, 'Speed'), h('select', { class: 'select', 'aria-label': 'Playback speed', onchange: (e) => { st.speed = Number(e.target.value); } }, [0.25, 0.5, 1, 1.5, 2].map((v) => h('option', { value: String(v), selected: v === 1 }, `${v}×`)))));
  apply();
  play();
  return { transport, lanes: h('div', { class: 'lanes-wrap' }, lanes, legend), destroy: () => { st.playing = false; cancelAnimationFrame(raf); } };
}

export default {
  title: 'Animations', icon: 'animation',
  async mount(root, { param, app }) {
    let assets = [];
    let selected = param;
    let panel = null, player = null;
    let animName = null;
    const listEl = h('div', { class: 'list' });
    const detailEl = h('div', { class: 'detail' });
    const drawList = () => replace(listEl, assets.map((a) => listItem(a, {
      active: a.id === selected, onSelect: (x) => { location.hash = `#/animations/${encodeURIComponent(x.id)}`; },
      extra: h('span', { class: 'li-chips' }, h('span', { class: 'muted small' }, `${a.metadata?.animations?.length || 0} clips`), statusChip(a.status)),
    })));

    const teardown = () => { player?.destroy(); player = null; panel?.destroy(); panel = null; };

    const showDetail = async (id) => {
      teardown();
      if (!assets.some((x) => x.id === id)) { replace(detailEl, empty('animation', 'Select an animation', 'Pick an animation asset on the left.')); return; }
      replace(detailEl, spinner('Loading animation…'));
      const a = await api('asset', { id });
      const file = animFile(a);
      let anims = [], animErr = null, loaded = null, modelErr = null, modelAsset = null;
      try { anims = loadAnimations(await fetchFileJson(file)); } catch (e) { animErr = e; }
      const models = await api('assets', { type: 'model', existing: 1 });
      modelAsset = models.find((m) => (a.dependencies || []).includes(m.id));
      if (modelAsset) { try { loaded = await loadModelAsset(await api('asset', { id: modelAsset.id })); } catch (e) { modelErr = e; } } else modelErr = new Error('This animation has no model dependency — playback shows keyframes only.');
      if (selected !== id) return;
      if (!anims.find((x) => x.name === animName)) animName = anims[0]?.name || null;

      const stage = h('div', { class: 'anim-stage' });
      const lanesBox = h('div');
      const transportBox = h('div');
      const info = h('div');
      const hidden = new Set();
      if (loaded) { panel = viewerPanel(); panel.viewer.setModel(loaded.model, loaded.textures); stage.appendChild(panel.el); }
      else stage.appendChild(h('div', { class: 'callout callout-warn' }, icon('alert'), h('div', null, h('strong', null, 'No model to play on'), h('p', { class: 'small' }, modelErr?.message || ''))));

      const selectAnim = (name) => {
        player?.destroy();
        animName = name;
        const anim = anims.find((x) => x.name === name);
        if (!anim) return;
        player = animPlayer(anim, (pose) => panel?.viewer.setPose(pose));
        replace(transportBox, player.transport);
        replace(lanesBox, player.lanes);
        const missing = loaded ? Object.keys(anim.bones).filter((b) => !loaded.model.bones.some((x) => x.name === b)) : [];
        replace(info, kv([
          ['Length', `${animLength(anim)}s`],
          ['Loop', anim.loop ? tag('loop', 'tag-accent') : anim.hold ? tag('hold on last frame') : tag('once')],
          ['Bones', h('div', { class: 'chips' }, Object.keys(anim.bones).map((b) => h('code', { class: `pill mono ${missing.includes(b) ? 'pill-bad' : ''}`, title: missing.includes(b) ? 'bone not in model' : '' }, b)))],
          ['Events', Object.keys(anim.timeline || {}).length ? h('div', { class: 'chips' }, Object.entries(anim.timeline).map(([t, v]) => h('code', { class: 'pill mono' }, `${t}s ${typeof v === 'string' ? v : 'event'}`))) : null],
          ['Model', modelAsset ? h('a', { href: `#/3d/${encodeURIComponent(modelAsset.id)}` }, modelAsset.name) : null],
          ['File', file ? h('a', { class: 'mono path small', href: fileUrl(file), target: '_blank', rel: 'noopener' }, file) : null],
        ]));
      };
      const tabs = anims.length ? segmented(anims.map((x) => ({ value: x.name, label: x.name.replace(/^animation\./, '') })), animName, selectAnim, { label: 'Animation clip' }) : null;
      replace(detailEl,
        h('div', { class: 'detail-head' }, h('h2', null, a.name), assetHeader(a)),
        animErr ? h('div', { class: 'callout callout-error' }, icon('alert'), `Animation file could not be parsed: ${animErr.message}`) : null,
        tabs ? h('div', { class: 'toolbar' }, tabs) : null,
        h('div', { class: 'model-layout' },
          h('div', { class: 'model-main' }, stage, transportBox),
          h('aside', { class: 'model-side stack' }, section('Clip', info), loaded ? section('Bones', boneTree(loaded.model, hidden, (n, v) => { if (v) hidden.delete(n); else hidden.add(n); panel.viewer.setHidden(new Set(hidden)); })) : null)),
        card('Keyframes', lanesBox, { cls: 'card-lanes', sub: 'Ticks per bone & channel; click or drag on a lane to scrub.' }),
        ...genericAssetSections(a, { skip: ['metadata'] }));
      if (animName) selectAnim(animName);
    };

    const render = async () => {
      assets = await listAssets('animation', app);
      if (!selected && assets.length) selected = assets[0].id;
      if (!assets.length) { root.replaceChildren(pageHeader('Animations', 'Bedrock / Blockbench animation playback'), empty('animation', 'No animations yet', 'Animations saved with animation_save and linked to a model asset can be played back here.')); return false; }
      drawList();
      root.replaceChildren(pageHeader('Animations', `${assets.length} animation asset${assets.length === 1 ? '' : 's'} · sampled exactly like the studio renderer (linear, catmull-rom, step)`), splitLayout(listEl, detailEl));
      return true;
    };
    if (await render()) await showDetail(selected);
    return {
      update: async () => {
        if (!root.contains(listEl)) { if (await render()) await showDetail(selected); return; }
        assets = await listAssets('animation', app); drawList();
      },
      setParam: async (p) => { if (!p || p === selected) return; selected = p; drawList(); await showDetail(p); },
      destroy: teardown,
    };
  },
};
