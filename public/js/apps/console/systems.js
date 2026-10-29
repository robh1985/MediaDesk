// The consoles The Game Console plays, as the app shows them, and their controllers.
//
// Button ids are EmulatorJS's (libretro "RetroPad" numbering): 0 B, 1 Y, 2 Select, 3 Start,
// 4-7 D-pad up/down/left/right, 8 A, 9 X, 10 L, 11 R, 12 L2, 13 R2, 14 L3, 15 R3,
// 16-19 left stick right/left/down/up, 20-23 right stick right/left/down/up,
// 24 quick save, 25 quick load, 26 next save slot, 27 fast forward, 28 rewind, 29 slow motion.

// Labels say what's printed on that console's own controller.
const DPAD = [[4, 'Up'], [5, 'Down'], [6, 'Left'], [7, 'Right']];
const L_STICK = [[19, 'Stick up'], [18, 'Stick down'], [17, 'Stick left'], [16, 'Stick right']];
const R_STICK = [[23, 'Right stick up'], [22, 'Right stick down'], [21, 'Right stick left'], [20, 'Right stick right']];
const NINTENDO_AB = [[8, 'A'], [0, 'B']];

export const SYSTEMS = {
  nes: { name: 'Nintendo Entertainment System', short: 'NES', maker: 'Nintendo', year: 1985, kind: 'home', color: '#c0272d', buttons: [...NINTENDO_AB, [2, 'Select'], [3, 'Start'], ...DPAD] },
  snes: { name: 'Super Nintendo', short: 'Super NES', maker: 'Nintendo', year: 1991, kind: 'home', color: '#6a5acd', buttons: [...NINTENDO_AB, [9, 'X'], [1, 'Y'], [10, 'L'], [11, 'R'], [2, 'Select'], [3, 'Start'], ...DPAD] },
  n64: { name: 'Nintendo 64', short: 'N64', maker: 'Nintendo', year: 1996, kind: 'home', color: '#1f8a3b', buttons: [[0, 'A'], [1, 'B'], [12, 'Z'], [10, 'L'], [11, 'R'], [3, 'Start'], ...L_STICK, [23, 'C up'], [22, 'C down'], [21, 'C left'], [20, 'C right'], [4, 'D-pad up'], [5, 'D-pad down'], [6, 'D-pad left'], [7, 'D-pad right']], stick: true },
  gb: { name: 'Game Boy / Game Boy Color', short: 'Game Boy', maker: 'Nintendo', year: 1989, kind: 'handheld', color: '#8b9a2d', buttons: [...NINTENDO_AB, [2, 'Select'], [3, 'Start'], ...DPAD] },
  gba: { name: 'Game Boy Advance', short: 'GBA', maker: 'Nintendo', year: 2001, kind: 'handheld', color: '#4b3fa6', buttons: [...NINTENDO_AB, [10, 'L'], [11, 'R'], [2, 'Select'], [3, 'Start'], ...DPAD] },
  nds: { name: 'Nintendo DS', short: 'DS', maker: 'Nintendo', year: 2004, kind: 'handheld', color: '#5f6b7a', buttons: [...NINTENDO_AB, [9, 'X'], [1, 'Y'], [10, 'L'], [11, 'R'], [2, 'Select'], [3, 'Start'], ...DPAD, [14, 'Microphone']], touch: true },
  vb: { name: 'Virtual Boy', short: 'Virtual Boy', maker: 'Nintendo', year: 1995, kind: 'home', color: '#b3001b', buttons: [...NINTENDO_AB, [10, 'L'], [11, 'R'], [2, 'Select'], [3, 'Start'], [4, 'Left pad up'], [5, 'Left pad down'], [6, 'Left pad left'], [7, 'Left pad right'], [19, 'Right pad up'], [18, 'Right pad down'], [17, 'Right pad left'], [16, 'Right pad right']] },
  segaMD: { name: 'Sega Genesis / Mega Drive', short: 'Genesis', maker: 'Sega', year: 1989, kind: 'home', color: '#1d1d1f', buttons: [[1, 'A'], [0, 'B'], [8, 'C'], [10, 'X'], [9, 'Y'], [11, 'Z'], [3, 'Start'], [2, 'Mode'], ...DPAD] },
  segaMS: { name: 'Sega Master System', short: 'Master System', maker: 'Sega', year: 1986, kind: 'home', color: '#d4202a', buttons: [[0, 'Button 1 / Start'], [8, 'Button 2'], ...DPAD] },
  segaGG: { name: 'Sega Game Gear', short: 'Game Gear', maker: 'Sega', year: 1991, kind: 'handheld', color: '#2b2b2b', buttons: [[0, 'Button 1'], [8, 'Button 2'], [3, 'Start'], ...DPAD] },
  segaCD: { name: 'Sega CD / Mega-CD', short: 'Sega CD', maker: 'Sega', year: 1992, kind: 'home', color: '#24425e', disc: true, bios: true, buttons: [[1, 'A'], [0, 'B'], [8, 'C'], [10, 'X'], [9, 'Y'], [11, 'Z'], [3, 'Start'], [2, 'Mode'], ...DPAD] },
  sega32x: { name: 'Sega 32X', short: '32X', maker: 'Sega', year: 1994, kind: 'home', color: '#7a1f1f', buttons: [[1, 'A'], [0, 'B'], [8, 'C'], [10, 'X'], [9, 'Y'], [11, 'Z'], [3, 'Start'], [2, 'Mode'], ...DPAD] },
  segaSaturn: { name: 'Sega Saturn', short: 'Saturn', maker: 'Sega', year: 1995, kind: 'home', color: '#3a3f8f', disc: true, bios: true, buttons: [[1, 'A'], [0, 'B'], [8, 'C'], [9, 'X'], [10, 'Y'], [11, 'Z'], [12, 'L'], [13, 'R'], [3, 'Start'], ...DPAD] },
  dreamcast: { name: 'Sega Dreamcast', short: 'Dreamcast', maker: 'Sega', year: 1999, kind: 'home', color: '#e05a0b', disc: true, unsupported: 'No Dreamcast emulator runs in a web browser yet, so these games are listed but can’t be played here. MediaDesk will play them as soon as one is available.', buttons: [] },
  psx: { name: 'PlayStation', short: 'PlayStation', maker: 'Sony', year: 1995, kind: 'home', color: '#5b6b7f', disc: true, buttons: [[0, '✕ Cross'], [8, '○ Circle'], [1, '□ Square'], [9, '△ Triangle'], [10, 'L1'], [11, 'R1'], [12, 'L2'], [13, 'R2'], [2, 'Select'], [3, 'Start'], ...DPAD, ...L_STICK, ...R_STICK, [14, 'L3'], [15, 'R3']] },
  psp: { name: 'PlayStation Portable', short: 'PSP', maker: 'Sony', year: 2005, kind: 'handheld', color: '#2c2c34', disc: true, threads: true, buttons: [[0, '✕ Cross'], [8, '○ Circle'], [1, '□ Square'], [9, '△ Triangle'], [10, 'L'], [11, 'R'], [2, 'Select'], [3, 'Start'], ...DPAD, ...L_STICK] },
  pce: { name: 'TurboGrafx-16 / PC Engine', short: 'TurboGrafx-16', maker: 'NEC', year: 1989, kind: 'home', color: '#e8762d', buttons: [[8, 'I'], [0, 'II'], [2, 'Select'], [3, 'Run'], ...DPAD] },
  atari2600: { name: 'Atari 2600', short: 'Atari 2600', maker: 'Atari', year: 1977, kind: 'home', color: '#8a5a2b', buttons: [[0, 'Fire'], [2, 'Select'], [3, 'Reset'], ...DPAD, [10, 'Left difficulty A'], [12, 'Left difficulty B'], [11, 'Right difficulty A'], [13, 'Right difficulty B'], [14, 'Colour'], [15, 'Black & white']] },
  atari5200: { name: 'Atari 5200', short: 'Atari 5200', maker: 'Atari', year: 1982, kind: 'home', color: '#5a4630', bios: true, buttons: [[0, 'Fire 1'], [8, 'Fire 2'], [3, 'Start'], [2, 'Pause'], ...DPAD] },
  atari7800: { name: 'Atari 7800', short: 'Atari 7800', maker: 'Atari', year: 1986, kind: 'home', color: '#3b3b3b', buttons: [[0, 'Button 1'], [8, 'Button 2'], [2, 'Select'], [3, 'Pause'], [9, 'Reset'], ...DPAD, [10, 'Left difficulty'], [11, 'Right difficulty']] },
  lynx: { name: 'Atari Lynx', short: 'Lynx', maker: 'Atari', year: 1989, kind: 'handheld', color: '#4a4a4a', bios: true, buttons: [...NINTENDO_AB, [10, 'Option 1'], [11, 'Option 2'], [3, 'Pause'], ...DPAD] },
  jaguar: { name: 'Atari Jaguar', short: 'Jaguar', maker: 'Atari', year: 1993, kind: 'home', color: '#9b111e', buttons: [[8, 'A'], [0, 'B'], [1, 'C'], [2, 'Pause'], [3, 'Option'], ...DPAD] },
  ngp: { name: 'Neo Geo Pocket Color', short: 'Neo Geo Pocket', maker: 'SNK', year: 1999, kind: 'handheld', color: '#1d5fa8', buttons: [[0, 'A'], [8, 'B'], [3, 'Option'], ...DPAD] },
  ws: { name: 'WonderSwan Color', short: 'WonderSwan', maker: 'Bandai', year: 2000, kind: 'handheld', color: '#2e8b8b', buttons: [[8, 'A'], [0, 'B'], [3, 'Start'], [4, 'X1 (up)'], [5, 'X3 (down)'], [6, 'X4 (left)'], [7, 'X2 (right)'], [13, 'Y1'], [12, 'Y3'], [10, 'Y4'], [11, 'Y2']] },
  coleco: { name: 'ColecoVision', short: 'ColecoVision', maker: 'Coleco', year: 1982, kind: 'home', color: '#36454f', bios: true, buttons: [[8, 'Left button'], [0, 'Right button'], [9, '1'], [1, '2'], [11, '3'], [10, '4'], [13, '5'], [12, '6'], [15, '7'], [14, '8'], [2, '*'], [3, '#'], ...DPAD] },
  '3do': { name: '3DO Interactive Multiplayer', short: '3DO', maker: 'Panasonic', year: 1993, kind: 'home', color: '#333333', disc: true, bios: true, buttons: [[1, 'A'], [0, 'B'], [8, 'C'], [10, 'L'], [11, 'R'], [2, 'X (stop)'], [3, 'P (play)'], ...DPAD] },
  arcade: { name: 'Arcade', short: 'Arcade', maker: 'Various', year: 1980, kind: 'arcade', color: '#d81b60', buttons: [[0, 'Button 1'], [8, 'Button 2'], [1, 'Button 3'], [9, 'Button 4'], [10, 'Button 5'], [11, 'Button 6'], [2, 'Insert coin'], [3, 'Start'], ...DPAD] },
};

// The usual shape of each console's game box (width ÷ height), North American releases: the
// Super NES and N64 came in landscape boxes; NES, Genesis, Master System, Atari and most others
// in tall boxes or cases; PlayStation, TurboGrafx-16 and Dreamcast in CD-style square cases (some
// PlayStation games came in tall long boxes); PSP in tall UMD cases; Game Boy and DS in small,
// nearly square boxes. A game's own box art, once loaded, uses its own shape.
export const BOX = {
  nes: 0.72, snes: 1.38, n64: 1.4, gb: 0.88, gba: 0.92, nds: 0.9, vb: 0.75,
  segaMD: 0.72, segaMS: 0.72, segaGG: 0.72, segaCD: 0.73, sega32x: 0.72, segaSaturn: 0.72, dreamcast: 1,
  psx: 1, psp: 0.58, pce: 1, atari2600: 0.72, atari5200: 0.72, atari7800: 0.72, lynx: 0.72, jaguar: 0.72,
  ngp: 0.8, ws: 0.8, coleco: 0.75, '3do': 0.72, arcade: 0.72,
};

// Every console also gets these.
export const HOTKEYS = [[24, 'Quick save'], [25, 'Quick load'], [26, 'Next save slot'], [27, 'Fast forward (hold)'], [28, 'Rewind (hold)'], [29, 'Slow motion (hold)']];

export const ORDER = ['nes', 'snes', 'n64', 'gb', 'gba', 'nds', 'vb', 'segaMS', 'segaMD', 'segaCD', 'sega32x', 'segaGG', 'segaSaturn', 'dreamcast', 'psx', 'psp', 'pce', 'atari2600', 'atari5200', 'atari7800', 'lynx', 'jaguar', 'ngp', 'ws', 'coleco', '3do', 'arcade'];

export const CORE_NAMES = {
  fceumm: 'FCEUmm (recommended)', nestopia: 'Nestopia', snes9x: 'Snes9x', mupen64plus_next: 'Mupen64Plus-Next (recommended)', parallel_n64: 'ParaLLEl N64',
  gambatte: 'Gambatte (recommended)', mgba: 'mGBA', melonds: 'melonDS (recommended)', desmume2015: 'DeSmuME 2015', beetle_vb: 'Beetle VB',
  genesis_plus_gx: 'Genesis Plus GX (recommended)', picodrive: 'PicoDrive', smsplus: 'SMS Plus GX', yabause: 'Yabause',
  pcsx_rearmed: 'PCSX ReARMed (recommended)', mednafen_psx_hw: 'Beetle PSX HW (accurate, needs a BIOS)', ppsspp: 'PPSSPP', mednafen_pce: 'Beetle PCE',
  stella2014: 'Stella', a5200: 'a5200', prosystem: 'ProSystem', handy: 'Handy', virtualjaguar: 'Virtual Jaguar', mednafen_ngp: 'Beetle NeoPop',
  mednafen_wswan: 'Beetle WonderSwan', gearcoleco: 'Gearcoleco', opera: 'Opera', fbneo: 'FinalBurn Neo (recommended)', mame2003_plus: 'MAME 2003-Plus',
};

// Cores per console, best first (the server decides which exist).
export const CORES = {
  nes: ['fceumm', 'nestopia'], snes: ['snes9x'], n64: ['mupen64plus_next', 'parallel_n64'], gb: ['gambatte', 'mgba'], gba: ['mgba'], nds: ['melonds', 'desmume2015'],
  vb: ['beetle_vb'], segaMD: ['genesis_plus_gx', 'picodrive'], segaMS: ['smsplus', 'genesis_plus_gx'], segaGG: ['genesis_plus_gx'], segaCD: ['genesis_plus_gx', 'picodrive'],
  sega32x: ['picodrive'], segaSaturn: ['yabause'], dreamcast: [], psx: ['pcsx_rearmed', 'mednafen_psx_hw'], psp: ['ppsspp'], pce: ['mednafen_pce'],
  atari2600: ['stella2014'], atari5200: ['a5200'], atari7800: ['prosystem'], lynx: ['handy'], jaguar: ['virtualjaguar'], ngp: ['mednafen_ngp'],
  ws: ['mednafen_wswan'], coleco: ['gearcoleco'], '3do': ['opera'], arcade: ['fbneo', 'mame2003_plus'],
};

export const SHADERS = [
  ['disabled', 'Sharp pixels'], ['crt-easymode.glslp', 'CRT TV (easy mode)'], ['crt-aperture.glslp', 'CRT TV (aperture grille)'], ['crt-geom.glslp', 'CRT TV (curved)'],
  ['crt-lottes', 'CRT TV (Lottes)'], ['crt-zfast', 'CRT TV (fast)'], ['sabr', 'Smooth edges (SABR)'], ['2xScaleHQ.glslp', 'Smooth (2×ScaleHQ)'], ['bicubic', 'Soft (bicubic)'], ['mix-frames', 'Handheld LCD blur'],
];

// ---- Default controls ----

// Keyboard key codes and standard-gamepad buttons by RetroPad position, so every console's
// buttons sit where they did on its own controller (A on the right, B at the bottom...).
const KEY = { z: 90, x: 88, a: 65, s: 83, q: 81, w: 87, e: 69, r: 82, enter: 13, shift: 16, up: 38, down: 40, left: 37, right: 39, i: 73, j: 74, k: 75, l: 76, t: 84, f: 70, g: 71, h: 72, space: 32, backspace: 8, f2: 113, f3: 114, f4: 115, c: 67, v: 86 };
const BASE = {
  0: [KEY.z, 'BUTTON_1'], 1: [KEY.a, 'BUTTON_3'], 2: [KEY.shift, 'SELECT'], 3: [KEY.enter, 'START'],
  4: [KEY.up, 'DPAD_UP'], 5: [KEY.down, 'DPAD_DOWN'], 6: [KEY.left, 'DPAD_LEFT'], 7: [KEY.right, 'DPAD_RIGHT'],
  8: [KEY.x, 'BUTTON_2'], 9: [KEY.s, 'BUTTON_4'], 10: [KEY.q, 'LEFT_TOP_SHOULDER'], 11: [KEY.w, 'RIGHT_TOP_SHOULDER'],
  12: [KEY.e, 'LEFT_BOTTOM_SHOULDER'], 13: [KEY.r, 'RIGHT_BOTTOM_SHOULDER'], 14: [KEY.c, 'LEFT_STICK'], 15: [KEY.v, 'RIGHT_STICK'],
  16: [KEY.h, 'LEFT_STICK_X:+1'], 17: [KEY.f, 'LEFT_STICK_X:-1'], 18: [KEY.g, 'LEFT_STICK_Y:+1'], 19: [KEY.t, 'LEFT_STICK_Y:-1'],
  20: [KEY.l, 'RIGHT_STICK_X:+1'], 21: [KEY.j, 'RIGHT_STICK_X:-1'], 22: [KEY.k, 'RIGHT_STICK_Y:+1'], 23: [KEY.i, 'RIGHT_STICK_Y:-1'],
  24: [KEY.f2, null], 25: [KEY.f4, null], 26: [KEY.f3, null], 27: [KEY.space, null], 28: [KEY.backspace, null], 29: [null, null],
};
// Consoles whose main control is an analogue stick get it on the arrow keys.
const OVERRIDES = {
  n64: { 19: [KEY.up], 18: [KEY.down], 17: [KEY.left], 16: [KEY.right], 4: [KEY.t], 5: [KEY.g], 6: [KEY.f], 7: [KEY.h], 0: [KEY.x], 1: [KEY.z, 'BUTTON_3'], 12: [KEY.e, 'LEFT_BOTTOM_SHOULDER'] },
  // The Mode button is rarely needed; Genesis 3-button games use A B C.
  segaMD: { 2: [KEY.shift, 'SELECT'] },
};

export function defaultBinding(system, id, player = 0) {
  const o = OVERRIDES[system]?.[id] || [];
  const b = BASE[id] || [null, null];
  const key = o[0] !== undefined ? o[0] : b[0];
  const pad = o[1] !== undefined ? o[1] : b[1];
  // Only player 1 gets the keyboard; everyone gets their own gamepad.
  return { key: player === 0 ? key : null, pad: id >= 24 ? null : pad };
}

export const buttonsFor = (system) => [...(SYSTEMS[system]?.buttons || []), ...HOTKEYS];

// ---- Names for keys and gamepad buttons ----

const KEY_NAMES = { 8: 'Backspace', 9: 'Tab', 13: 'Enter', 16: 'Shift', 17: 'Ctrl', 18: 'Alt', 20: 'Caps Lock', 27: 'Esc', 32: 'Space', 33: 'Page Up', 34: 'Page Down', 35: 'End', 36: 'Home', 37: '←', 38: '↑', 39: '→', 40: '↓', 45: 'Insert', 46: 'Delete',
  186: ';', 187: '=', 188: ',', 189: '-', 190: '.', 191: '/', 192: '`', 219: '[', 220: '\\', 221: ']', 222: '\'', 106: 'Num *', 107: 'Num +', 109: 'Num -', 110: 'Num .', 111: 'Num /' };
export function keyName(code) {
  if (code == null || code === '') return '—';
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code >= 48 && code <= 57) return String(code - 48);
  if (code >= 65 && code <= 90) return String.fromCharCode(code);
  if (code >= 96 && code <= 105) return `Num ${code - 96}`;
  if (code >= 112 && code <= 123) return `F${code - 111}`;
  return `Key ${code}`;
}
// Standard gamepad button index -> EmulatorJS's name for it.
export const PAD_BUTTONS = ['BUTTON_1', 'BUTTON_2', 'BUTTON_3', 'BUTTON_4', 'LEFT_TOP_SHOULDER', 'RIGHT_TOP_SHOULDER', 'LEFT_BOTTOM_SHOULDER', 'RIGHT_BOTTOM_SHOULDER', 'SELECT', 'START', 'LEFT_STICK', 'RIGHT_STICK', 'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT'];
const PAD_NAMES = {
  xbox: { BUTTON_1: 'A', BUTTON_2: 'B', BUTTON_3: 'X', BUTTON_4: 'Y', LEFT_TOP_SHOULDER: 'LB', RIGHT_TOP_SHOULDER: 'RB', LEFT_BOTTOM_SHOULDER: 'LT', RIGHT_BOTTOM_SHOULDER: 'RT', SELECT: 'View', START: 'Menu', LEFT_STICK: 'LS click', RIGHT_STICK: 'RS click' },
  playstation: { BUTTON_1: '✕', BUTTON_2: '○', BUTTON_3: '□', BUTTON_4: '△', LEFT_TOP_SHOULDER: 'L1', RIGHT_TOP_SHOULDER: 'R1', LEFT_BOTTOM_SHOULDER: 'L2', RIGHT_BOTTOM_SHOULDER: 'R2', SELECT: 'Share', START: 'Options', LEFT_STICK: 'L3', RIGHT_STICK: 'R3' },
  nintendo: { BUTTON_1: 'B', BUTTON_2: 'A', BUTTON_3: 'Y', BUTTON_4: 'X', LEFT_TOP_SHOULDER: 'L', RIGHT_TOP_SHOULDER: 'R', LEFT_BOTTOM_SHOULDER: 'ZL', RIGHT_BOTTOM_SHOULDER: 'ZR', SELECT: '−', START: '+', LEFT_STICK: 'L stick click', RIGHT_STICK: 'R stick click' },
};
const COMMON = { DPAD_UP: 'D-pad ↑', DPAD_DOWN: 'D-pad ↓', DPAD_LEFT: 'D-pad ←', DPAD_RIGHT: 'D-pad →',
  'LEFT_STICK_X:+1': 'Left stick →', 'LEFT_STICK_X:-1': 'Left stick ←', 'LEFT_STICK_Y:+1': 'Left stick ↓', 'LEFT_STICK_Y:-1': 'Left stick ↑',
  'RIGHT_STICK_X:+1': 'Right stick →', 'RIGHT_STICK_X:-1': 'Right stick ←', 'RIGHT_STICK_Y:+1': 'Right stick ↓', 'RIGHT_STICK_Y:-1': 'Right stick ↑' };

// What kind of controller this is, from the name the browser gives it.
export function padStyle(id = '') {
  const s = id.toLowerCase();
  if (/(045e|xbox|xinput)/.test(s)) return 'xbox';
  if (/(054c|playstation|dualshock|dualsense|^wireless controller)/.test(s)) return 'playstation';
  if (/(057e|nintendo|pro controller|joy-con|8bitdo)/.test(s)) return 'nintendo';
  return 'xbox';
}
export function padName(value, style = 'xbox') {
  if (value == null || value === '') return '—';
  if (typeof value === 'number') return `Button ${value}`;
  return PAD_NAMES[style]?.[value] || COMMON[value] || value.replace(/_/g, ' ').toLowerCase();
}
