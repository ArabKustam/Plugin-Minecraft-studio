import overview from './overview.js';
import tasks from './tasks.js';
import agents from './agents.js';
import { codeView, particlesView, assetView } from './assetlist.js';
import textures from './textures.js';
import model from './model.js';
import animations from './animations.js';
import { sfxView, voiceView } from './sounds.js';
import music from './music.js';
import pack from './pack.js';
import { guidesView, referencesView } from './docs.js';
import tests from './tests.js';
import logs from './logs.js';
import git from './git.js';
import tools from './tools.js';
import settings from './settings.js';

export const VIEWS = {
  overview, tasks, agents,
  code: codeView, textures, '3d': model, animations, sfx: sfxView, music, voice: voiceView, particles: particlesView, pack,
  guides: guidesView, tests, logs, git, tools, references: referencesView, settings,
  asset: assetView,
};

export const NAV = [
  { label: 'Studio', items: ['overview', 'tasks', 'agents'] },
  { label: 'Assets', items: ['code', 'textures', '3d', 'animations', 'sfx', 'music', 'voice', 'particles', 'pack'] },
  { label: 'Docs & QA', items: ['guides', 'tests', 'logs'] },
  { label: 'Project', items: ['git', 'tools', 'references', 'settings'] },
];
