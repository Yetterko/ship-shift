// The building (the town): name cleaning and the one-line-per-floor summary sent to everyone every 2 s.
import { PARK } from '../shared/protocol.js';
import { floorLine } from './floors.mjs';

const BAD_NAMES = /fuck|shit|cunt|bitch|nigg|fag|rape|nazi|hitler|penis|vagina|whore|slut|dick|cock|pussy|wank|twat|porn|arse|asshole|bastard|kill|sex/;
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };

/** A name as the town shows it: plain characters, bounded, or null when it is empty or rude. */
export function cleanName(v, max = 14) {
  if (typeof v !== 'string') return null;
  const name = v.normalize('NFKC').replace(/[^\p{L}\p{N} '.&-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  if (!name) return null;
  const flat = name.toLowerCase().replace(/[013457@$!]/g, c => LEET[c]).replace(/[^a-z]/g, '');
  return BAD_NAMES.test(flat) || BAD_NAMES.test(flat.replace(/(.)\1+/g, '$1')) ? null : name;
}

/** The `building` message body. */
export function buildingSummary({ floors, roles, now }) {
  return {
    type: 'building', now,
    floors: floors.list().sort((a, b) => a.number - b.number).map(floorLine),
    slots: roles.slots(),
    liveOpen: roles.liveOpen('player'),
    park: { w: PARK.w, h: PARK.h },
  };
}
