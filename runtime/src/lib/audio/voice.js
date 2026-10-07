// Voice direction: persistent voice profiles, a project pronunciation
// dictionary (stress marks, aliases, abbreviations, numbers) and consistent
// post-processing so dozens of lines sound like one character.
import { StudioError, readJson, writeJson, assertId, exists } from '../core/fsutil.js';

export function voiceProfilePath(studio, id) { return studio.p('voices', `${assertId(id, 'voice id')}.json`); }

export function saveVoiceProfile(studio, profile) {
  if (!profile.id) throw new StudioError('E_VOICE', 'Voice profile needs an id');
  const full = {
    id: profile.id, name: profile.name || profile.id, language: profile.language || 'en',
    character: profile.character || [], pace: profile.pace ?? 1, pitch_semitones: profile.pitch_semitones ?? 0,
    direction: profile.direction || '', providers: profile.providers || {},
    processing: profile.processing || [{ type: 'compress', threshold: -20, ratio: 3 }],
    loudness_lufs: profile.loudness_lufs ?? -18, notes: profile.notes || '',
  };
  writeJson(voiceProfilePath(studio, profile.id), full);
  studio.log({ agent: 'voice-director', event: 'voice.profile', message: `Saved voice profile ${full.id}` });
  return full;
}

export function loadVoiceProfile(studio, id) {
  const f = voiceProfilePath(studio, id);
  if (!exists(f)) throw new StudioError('E_NOT_FOUND', `Voice profile ${id} not found. Create it with studio_voice_profile_save.`);
  return readJson(f);
}

export function pronunciationPath(studio) { return studio.p('voices', 'pronunciation.json'); }
export function loadPronunciation(studio) { return readJson(pronunciationPath(studio), { entries: [] }); }

/**
 * Entry: { term, say?, stress?, language?, note? }
 *  - say: replacement text (aliases: "ГЭС" → "гэ-эс", "MW" → "мегаватт")
 *  - stress: the word with the stressed vowel in UPPER CASE ("реАктор") → rendered with U+0301
 */
export function addPronunciation(studio, entry) {
  if (!entry.term) throw new StudioError('E_VOICE', 'Pronunciation entry needs term');
  const dict = loadPronunciation(studio);
  dict.entries = dict.entries.filter((e) => e.term.toLowerCase() !== entry.term.toLowerCase());
  dict.entries.push(entry);
  writeJson(pronunciationPath(studio), dict);
  return dict;
}

const VOWELS = 'аеёиоуыэюяaeiouy';
export function stressToAcute(word) {
  // "реАктор" → "реа́ктор" (combining acute after the single upper-case vowel)
  let out = '';
  for (const ch of word) {
    if (VOWELS.includes(ch.toLowerCase()) && ch !== ch.toLowerCase()) out += `${ch.toLowerCase()}́`;
    else out += ch;
  }
  return out;
}

const RU_ONES = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const RU_TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const RU_HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
export function ruNumber(n) {
  if (n < 0 || n > 999999 || !Number.isInteger(n)) return String(n);
  if (n < 20) return RU_ONES[n];
  if (n < 100) return `${RU_TENS[Math.floor(n / 10)]}${n % 10 ? ` ${RU_ONES[n % 10]}` : ''}`;
  if (n < 1000) return `${RU_HUNDREDS[Math.floor(n / 100)]}${n % 100 ? ` ${ruNumber(n % 100)}` : ''}`;
  const th = Math.floor(n / 1000), rest = n % 1000;
  const thWord = th % 10 === 1 && th % 100 !== 11 ? 'тысяча' : [2, 3, 4].includes(th % 10) && ![12, 13, 14].includes(th % 100) ? 'тысячи' : 'тысяч';
  const thNum = ruNumber(th).replace(/один$/, 'одна').replace(/два$/, 'две');
  return `${thNum} ${thWord}${rest ? ` ${ruNumber(rest)}` : ''}`;
}

/** Apply dictionary + number expansion. Returns the text sent to the provider and a change log. */
export function prepareText(studio, text, { language = 'en', provider = 'elevenlabs' } = {}) {
  const dict = loadPronunciation(studio);
  const changes = [];
  let out = text;
  for (const e of dict.entries) {
    if (e.language && e.language !== language) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${e.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'giu');
    const replacement = e.say ? e.say : e.stress ? (provider === 'elevenlabs' ? stressToAcute(e.stress) : e.stress.toLowerCase()) : null;
    if (replacement && re.test(out)) {
      // keep sentence-initial capitals: "Реактор" stays capitalised after the stress mark is applied
      out = out.replace(re, (m) => (m[0] !== m[0].toLowerCase() ? replacement[0].toUpperCase() + replacement.slice(1) : replacement));
      changes.push({ term: e.term, as: replacement });
    }
  }
  if (language === 'ru') out = out.replace(/\d+/g, (m) => { const w = ruNumber(Number(m)); if (w !== m) changes.push({ term: m, as: w }); return w; });
  return { text: out, changes };
}

export function voiceLinePaths(studio, lineId) {
  return { wav: studio.p('sources', `voice_${lineId}`, `${lineId}.wav`), dir: studio.p('sources', `voice_${lineId}`) };
}

