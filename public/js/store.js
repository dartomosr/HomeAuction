import { ELIMINATION_EFFECTS } from './constants.js';

export function readSetting(key, fallback = null) {
  const value = localStorage.getItem(key);
  return value === null ? fallback : value;
}

export function writeSetting(key, value) {
  localStorage.setItem(key, value);
}

export function removeSetting(key) {
  localStorage.removeItem(key);
}

let enabledEffects;
try {
  const savedEffects = JSON.parse(readSetting('auction_effect_list'));
  enabledEffects = Array.isArray(savedEffects)
    ? savedEffects.filter(id => ELIMINATION_EFFECTS.some(([effectId]) => effectId === id))
    : ELIMINATION_EFFECTS.map(([id]) => id);
} catch (error) {
  console.warn('?? ??????? ????????? ??????????? ??????? ????????', error);
  enabledEffects = ELIMINATION_EFFECTS.map(([id]) => id);
}

export const store = {
  appState: null,
  myToken: readSetting('auction_token'),
  myName: readSetting('auction_name', ''),
  isSpectator: readSetting('auction_spectator', 'off') === 'on',
  soundEnabled: readSetting('auction_sound', 'on') !== 'off',
  currentTheme: readSetting('auction_theme', 'anime'),
  themeAnimationEnabled: readSetting('auction_theme_animation', 'on') !== 'off',
  poolFilter: ['all', 'own', 'others'].includes(readSetting('auction_pool_filter', 'all'))
    ? readSetting('auction_pool_filter', 'all')
    : 'all',
  autoSpinActive: false,
  autoSpinTimer: null,
  activeSpinFrame: null,
  activeElimination: null,
  lastFxType: null,
  effectsEnabled: readSetting('auction_effects_enabled', 'on') !== 'off',
  enabledEffects,
  wheelRotation: 0,
  isAnimatingWheel: false,
  activeSpinSlices: null,
  wheelPixelRatio: 1,
  wheelLabelFont: '',
  audioCtx: null,
  socket: null,
  wheelFx: null
};
