#!/usr/bin/env node
// Звуки игры синтезируются здесь, без чужих записей: node tools/gen-sounds.mjs
// Короткие эффекты — WAV (без задержки при старте), фоновая музыка — MP3 через ffmpeg.
// Всё детерминировано (свой генератор случайных чисел), повторный запуск даёт те же файлы.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'assets/sounds');
const SR = 22050;

// ---------- Основа ----------

let seed = 12345;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const noise = () => rnd() * 2 - 1;
const TAU = Math.PI * 2;
const buf = (sec) => new Float32Array(Math.ceil(sec * SR));
const hz = (note) => 440 * 2 ** ((note - 69) / 12);

/** Добавить в out звук gen(t, i) длиной sec с момента at (секунды). */
function mix(out, at, sec, gen, gain = 1) {
  const i0 = Math.round(at * SR);
  const n = Math.min(Math.ceil(sec * SR), out.length - i0);
  for (let i = 0; i < n; i++) out[i0 + i] += gen(i / SR, i) * gain;
}

const decay = (t, tau) => Math.exp(-t / tau);
const attack = (t, a) => (t < a ? t / a : 1);

/** Однополюсный фильтр нижних частот на месте. */
function lowpass(x, cutoff) {
  const a = 1 - Math.exp((-TAU * cutoff) / SR);
  let y = 0;
  for (let i = 0; i < x.length; i++) x[i] = y += a * (x[i] - y);
  return x;
}
function highpass(x, cutoff) {
  const lp = lowpass(Float32Array.from(x), cutoff);
  for (let i = 0; i < x.length; i++) x[i] -= lp[i];
  return x;
}
/** Резонансный полосовой фильтр (биквад): форманты голоса, звон металла. */
function bandpass(x, f0, q) {
  const w = (TAU * f0) / SR;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b2 = -alpha / a0;
  const a1 = (-2 * Math.cos(w)) / a0;
  const a2 = (1 - alpha) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/** Полосовой шум: шум через ВЧ и НЧ фильтры. */
function bandNoise(sec, lo, hi) {
  const x = buf(sec);
  for (let i = 0; i < x.length; i++) x[i] = noise();
  return lowpass(highpass(x, lo), hi);
}

/** Ревербератор Шрёдера: 4 гребенчатых и 2 всепропускающих фильтра. loop — хвост заворачивается в начало. */
function reverb(x, wet = 0.25, room = 0.82, loop = false) {
  const combs = [558, 594, 638, 678].map((d) => ({ d, b: new Float32Array(d), i: 0, f: 0 }));
  const alls = [113, 278].map((d) => ({ d, b: new Float32Array(d), i: 0 }));
  const tail = loop ? 0 : Math.ceil(2 * SR);
  const n = x.length + tail;
  const out = new Float32Array(loop ? x.length : n);
  // В петле прогоняем звук дважды: на втором круге в фильтрах уже хвост от конца.
  const passes = loop ? 2 : 1;
  for (let pass = 0; pass < passes; pass++) {
    for (let k = 0; k < n; k++) {
      const input = k < x.length ? x[k] : 0;
      let s = 0;
      for (const c of combs) {
        const y = c.b[c.i];
        c.f = y * 0.6 + c.f * 0.4;
        c.b[c.i] = input + c.f * room;
        c.i = (c.i + 1) % c.d;
        s += y;
      }
      s *= 0.25;
      for (const a of alls) {
        const y = a.b[a.i];
        const v = s + y * 0.5;
        a.b[a.i] = v;
        a.i = (a.i + 1) % a.d;
        s = y - v * 0.5;
      }
      if (pass === passes - 1) out[k] = (k < x.length ? x[k] : 0) * (1 - wet) + s * wet;
    }
  }
  return out;
}

/** Щипок струны (Карплус — Стронг): звучит как лютня или арфа. */
function pluck(note, sec, bright = 0.5) {
  const f = hz(note);
  const N = Math.max(2, Math.round(SR / f));
  const line = new Float32Array(N);
  for (let i = 0; i < N; i++) line[i] = noise() * (0.5 + bright * 0.5);
  // Мягкий щипок: сглаживаем начальный шум.
  for (let k = 0; k < 2; k++) for (let i = 1; i < N; i++) line[i] = (line[i] + line[i - 1]) * 0.5;
  const out = buf(sec);
  let p = 0;
  for (let i = 0; i < out.length; i++) {
    const next = (p + 1) % N;
    const v = line[p];
    line[p] = (v + line[next]) * 0.5 * 0.996;
    out[i] = v;
    p = next;
  }
  return out;
}

/** Медный духовой: пила с фильтром, вибрато и мягкой атакой. */
function brass(note, sec, { vib = 5, cutoff = 1800, att = 0.04, rel = 0.12 } = {}) {
  const f = hz(note);
  const x = buf(sec);
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    ph += (f * (1 + 0.006 * Math.sin(TAU * vib * t) * Math.min(1, t * 3))) / SR;
    const saw = 2 * (ph % 1) - 1;
    const env = attack(t, att) * (t > sec - rel ? Math.max(0, (sec - t) / rel) : 1);
    x[i] = saw * env;
  }
  return lowpass(lowpass(x, cutoff), cutoff * 1.5);
}

/** Колокол: негармонические обертоны с долгим затуханием. */
function bell(note, sec) {
  const f = hz(note);
  const parts = [
    [0.5, 0.35, 1.6],
    [1, 1, 1.2],
    [1.183, 0.5, 0.8],
    [1.506, 0.45, 0.7],
    [2, 0.35, 0.5],
    [2.514, 0.25, 0.35],
    [2.662, 0.2, 0.3],
  ];
  const x = buf(sec);
  mix(x, 0, sec, (t) => parts.reduce((s, [r, a, tau]) => s + a * Math.sin(TAU * f * r * t) * decay(t, tau), 0) * attack(t, 0.002));
  return x;
}

/** Барабан: шумовой удар с телом на низкой частоте. */
function drum(out, at, { body = 110, drop = 0.5, tone = 0.8, snare = 0.4, len = 0.35 } = {}) {
  const sn = bandNoise(len, 300, 2500);
  let ph = 0;
  mix(out, at, len, (t, i) => {
    ph += (body * (1 + drop * decay(t, 0.03))) / SR;
    return Math.sin(TAU * ph) * decay(t, 0.12) * tone + sn[i] * decay(t, 0.05) * snare;
  });
}

/** Звон монеты: высокие негармонические обертоны. */
function coin(out, at, pitch = 1, gain = 1) {
  const fs = [2400, 3150, 4620, 5480].map((f) => f * pitch);
  mix(out, at, 0.35, (t) => fs.reduce((s, f, k) => s + Math.sin(TAU * f * t) * decay(t, 0.09 / (1 + k * 0.4)), 0) * 0.3 * attack(t, 0.001), gain);
}

function normalize(x, peak) {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  const k = m > 0 ? peak / m : 1;
  for (let i = 0; i < x.length; i++) x[i] *= k;
  // Короткие затухания на краях — без щелчков.
  const fade = Math.min(64, x.length >> 2);
  for (let i = 0; i < fade; i++) x[x.length - 1 - i] *= i / fade;
  return x;
}

function trim(x, threshold = 0.0015) {
  let end = x.length;
  while (end > 1 && Math.abs(x[end - 1]) < threshold) end--;
  return x.subarray(0, Math.min(x.length, end + 32));
}

function wav(x) {
  const data = Buffer.alloc(x.length * 2);
  for (let i = 0; i < x.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const sounds = {};

// ---------- Интерфейс ----------

// Нажатие кнопки: деревянный щелчок.
sounds.click = (() => {
  const x = buf(0.08);
  const n = bandNoise(0.08, 1500, 5000);
  mix(x, 0, 0.08, (t, i) => (Math.sin(TAU * 950 * t) * 0.6 + Math.sin(TAU * 1480 * t) * 0.3) * decay(t, 0.012) + n[i] * decay(t, 0.006) * 0.5);
  return normalize(x, 0.45);
})();

// Выбор клетки: тихий тик.
sounds.select = (() => {
  const x = buf(0.09);
  mix(x, 0, 0.09, (t) => (Math.sin(TAU * 1320 * t) + 0.3 * Math.sin(TAU * 2640 * t)) * decay(t, 0.018) * attack(t, 0.002));
  return normalize(x, 0.35);
})();

// Нельзя: два низких глухих тона.
sounds.error = (() => {
  const x = buf(0.3);
  for (const [at, f] of [[0, 220], [0.12, 175]]) mix(x, at, 0.14, (t) => (Math.sin(TAU * f * t) + 0.4 * Math.sin(TAU * f * 2 * t)) * decay(t, 0.05) * attack(t, 0.004));
  return normalize(lowpass(x, 1500), 0.5);
})();

// ---------- Приказы ----------

// Марш: три удара походного барабана.
sounds.march = (() => {
  const x = buf(0.6);
  [0, 0.13, 0.26].forEach((at, k) => drum(x, at, { body: 160, snare: 0.9, tone: 0.5, len: 0.25 + k * 0.05 }));
  return normalize(reverb(x, 0.15), 0.7);
})();

// Монеты: налог, покупка, найм.
sounds.coins = (() => {
  const x = buf(0.6);
  [[0, 1, 1], [0.07, 1.12, 0.8], [0.15, 0.94, 0.7], [0.21, 1.05, 0.5]].forEach(([at, p, g]) => coin(x, at, p, g));
  return normalize(reverb(x, 0.12), 0.55);
})();

// Стройка: два удара молотка по дереву.
sounds.build = (() => {
  const x = buf(0.55);
  for (const at of [0, 0.2]) {
    let ph = 0;
    const n = bandNoise(0.12, 800, 4000);
    mix(x, at, 0.12, (t, i) => {
      ph += (180 + 120 * decay(t, 0.01)) / SR;
      return Math.sin(TAU * ph) * decay(t, 0.04) + n[i] * decay(t, 0.008) * 0.8;
    });
  }
  return normalize(reverb(x, 0.15), 0.65);
})();

// Набор войск: монеты и удар барабана.
sounds.recruit = (() => {
  const x = buf(0.7);
  coin(x, 0, 1.05, 0.8);
  coin(x, 0.06, 0.95, 0.6);
  drum(x, 0.18, { body: 120, snare: 0.6, tone: 0.8, len: 0.35 });
  drum(x, 0.34, { body: 120, snare: 0.6, tone: 0.8, len: 0.35 });
  return normalize(reverb(x, 0.15), 0.65);
})();

// ---------- События ----------

// Бой: залп мушкетов, выстрел пушки, лязг клинков, барабан и крики вдалеке.
sounds.battle = (() => {
  const x = buf(2.3);
  // Залп: полтора десятка сухих хлопков вразнобой.
  for (let k = 0; k < 16; k++) {
    const at = 0.02 + rnd() * 0.45;
    const tau = 0.01 + rnd() * 0.012;
    const g = 0.5 + rnd() * 0.5;
    const n = bandNoise(0.15, 400 + rnd() * 400, 4500);
    let low = 0;
    mix(x, at, 0.15, (t, i) => {
      low += (n[i] - low) * 0.15;
      return (n[i] * 1.4 + low * 2) * decay(t, tau) * g;
    });
  }
  // Пушка: глухой удар с раскатом.
  const boom = lowpass(bandNoise(1.3, 20, 700), 380);
  let ph = 0;
  mix(x, 0.42, 1.3, (t, i) => {
    ph += (38 + 60 * decay(t, 0.07)) / SR;
    return (boom[i] * 2.6 + Math.sin(TAU * ph) * 0.9) * decay(t, 0.35) * attack(t, 0.004);
  }, 0.9);
  // Клинки: металлический удар со звоном.
  for (const [at, f0, g] of [[0.85, 1150, 0.5], [1.02, 1380, 0.4], [1.3, 1240, 0.45], [1.52, 1460, 0.3]]) {
    const hit = bandNoise(0.03, 2000, 8000);
    mix(x, at, 0.45, (t, i) => {
      const ring = [1, 2.76, 5.4, 8.93].reduce((sum, r, k) => sum + Math.sin(TAU * f0 * r * t) * decay(t, 0.16 / (1 + k)) / (1 + k), 0);
      return (ring * 0.5 + (hit[i] ?? 0) * decay(t, 0.004) * 1.5) * g;
    });
  }
  // Боевой барабан.
  drum(x, 0, { body: 75, drop: 0.7, snare: 0.2, tone: 1, len: 0.5 });
  drum(x, 0.6, { body: 75, drop: 0.7, snare: 0.2, tone: 0.8, len: 0.5 });
  // Крики: шум через форманты «а», громкость дрожит.
  const roar = buf(1.9);
  for (let i = 0; i < roar.length; i++) roar[i] = noise();
  const shout = [bandpass(roar, 700, 4), bandpass(roar, 1150, 5), bandpass(roar, 2500, 6)];
  mix(x, 0.25, 1.9, (t, i) => {
    const swell = Math.sin(Math.PI * Math.min(1, t / 1.9)) ** 1.5;
    const flutter = 0.7 + 0.3 * Math.sin(TAU * 5.5 * t + Math.sin(TAU * 1.3 * t) * 2);
    return (shout[0][i] + shout[1][i] * 0.7 + shout[2][i] * 0.25) * swell * flutter;
  }, 0.55);
  return normalize(reverb(x, 0.28, 0.84), 0.85);
})();

// Захват провинции: короткий сигнал трубы.
sounds.capture = (() => {
  const notes = [[0, 67, 0.12], [0.13, 72, 0.12], [0.26, 76, 0.12], [0.39, 79, 0.45]];
  const x = buf(1.1);
  for (const [at, n, len] of notes) {
    const b = brass(n, len);
    mix(x, at, len, (t, i) => b[i], 0.5);
  }
  return normalize(reverb(x, 0.25), 0.7);
})();

// Потеря провинции: нисходящий минор.
sounds.lost = (() => {
  const x = buf(1.3);
  for (const [at, n, len] of [[0, 64, 0.3], [0.28, 60, 0.3], [0.56, 57, 0.55]]) {
    const b = brass(n, len, { cutoff: 900, vib: 4 });
    mix(x, at, len, (t, i) => b[i], 0.5);
  }
  return normalize(reverb(x, 0.3), 0.6);
})();

// Новый ход: удар колокола.
sounds.turn = (() => normalize(reverb(bell(76, 1.8), 0.2), 0.5))();

// Война: боевые барабаны и низкий рог.
sounds.war = (() => {
  const x = buf(1.8);
  [0, 0.22, 0.44, 0.88].forEach((at) => drum(x, at, { body: 70, drop: 0.8, snare: 0.25, tone: 1, len: 0.5 }));
  const horn = brass(50, 1.1, { cutoff: 700, vib: 3 });
  mix(x, 0.5, 1.1, (t, i) => horn[i], 0.6);
  return normalize(reverb(x, 0.3, 0.85), 0.8);
})();

// Мир: мягкие колокольчики вверх.
sounds.peace = (() => {
  const x = buf(1.8);
  [84, 88, 91, 96].forEach((n, k) => {
    const f = hz(n);
    mix(x, k * 0.14, 1.2, (t) => (Math.sin(TAU * f * t) + 0.2 * Math.sin(TAU * f * 2.01 * t)) * decay(t, 0.45) * attack(t, 0.003), 0.5);
  });
  return normalize(reverb(x, 0.3), 0.5);
})();

// Победа: фанфара с аккордом.
sounds.victory = (() => {
  const x = buf(3.2);
  const line = [[0, 60, 0.18], [0.2, 64, 0.18], [0.4, 67, 0.18], [0.6, 72, 0.5], [1.15, 67, 0.18], [1.35, 72, 1.3]];
  for (const [at, n, len] of line) {
    const b = brass(n, len);
    mix(x, at, len, (t, i) => b[i], 0.45);
  }
  for (const n of [48, 55, 64]) {
    const b = brass(n, 1.3, { cutoff: 1200 });
    mix(x, 1.35, 1.3, (t, i) => b[i], 0.22);
  }
  drum(x, 1.35, { body: 70, drop: 0.6, snare: 0.3, len: 0.6 });
  return normalize(reverb(x, 0.3, 0.85), 0.8);
})();

// Поражение: медленный нисходящий минорный аккорд.
sounds.defeat = (() => {
  const x = buf(3.2);
  for (const [at, chord] of [[0, [57, 60, 64]], [0.9, [55, 58, 62]], [1.8, [52, 55, 59]]]) {
    for (const n of chord) {
      const b = brass(n, 1.1, { cutoff: 800, vib: 4 });
      mix(x, at, 1.1, (t, i) => b[i], 0.25);
    }
  }
  return normalize(reverb(x, 0.35, 0.86), 0.65);
})();

// ---------- Музыка ----------
// Медленная петля в ре миноре, 66 ударов в минуту, 32 такта (~2 минуты): струнные аккорды, литавры,
// тихая лютня; во второй части — маршевый барабан и валторна с мелодией на квартах и квинтах.

/** Струнные: три слегка расстроенные пилы на ноту, мягкое нарастание. */
function pad(notes, sec) {
  const x = buf(sec);
  for (const n of notes) {
    for (const det of [-0.003, 0, 0.0035]) {
      const f = hz(n) * (1 + det);
      let ph = rnd();
      for (let i = 0; i < x.length; i++) {
        const t = i / SR;
        ph += f / SR;
        const env = attack(t, 0.9) * (t > sec - 0.9 ? Math.max(0, (sec - t) / 0.9) : 1);
        x[i] += (2 * (ph % 1) - 1) * env;
      }
    }
  }
  return lowpass(lowpass(x, 1000), 1400);
}

/** Литавра: низкий тон с проседанием высоты и глухим шумом удара. */
function timpani(out, at, note, gain) {
  const f = hz(note);
  const n = lowpass(bandNoise(0.2, 40, 600), 300);
  let ph = 0;
  mix(out, at, 1.4, (t, i) => {
    ph += (f * (1 + 0.08 * decay(t, 0.05))) / SR;
    return (Math.sin(TAU * ph) + 0.35 * Math.sin(TAU * ph * 1.5) * decay(t, 0.2) + (n[i] ?? 0) * decay(t, 0.03) * 1.5) * decay(t, 0.55);
  }, gain);
}

/** Маршевый барабан: короткий шумовой удар с призвуком корпуса. */
function snare(out, at, gain) {
  const n = bandNoise(0.2, 1200, 6000);
  mix(out, at, 0.2, (t, i) => (n[i] * decay(t, 0.06) + Math.sin(TAU * 190 * t) * decay(t, 0.025) * 0.6) * attack(t, 0.001), gain);
}

function music() {
  const bpm = 66;
  const beat = 60 / bpm;
  const bar = 4 * beat;
  const Dm = [50, 57, 62, 65];
  const Bb = [46, 53, 58, 62];
  const F = [53, 57, 60, 65];
  const C = [48, 55, 60, 64];
  const Gm = [43, 50, 55, 58];
  const A = [45, 52, 57, 61];
  // A — тихо; B — добавляется марш; A2 — валторна; C — всё вместе и возврат к началу.
  const prog = [
    Dm, Dm, Bb, C, Dm, Dm, Gm, A,
    F, C, Dm, Dm, Bb, F, Gm, A,
    Dm, Dm, Bb, C, Dm, Bb, Gm, A,
    Dm, Bb, F, C, Gm, Dm, A, Dm,
  ];
  const sec = prog.length * bar;
  const x = buf(sec);

  prog.forEach((ch, k) => {
    const t0 = k * bar;
    // Аккорд струнных чуть длиннее такта — соседние перетекают друг в друга.
    const p = pad(ch, bar + 1.2);
    mix(x, Math.max(0, t0 - 0.3), bar + 1.2, (t, i) => p[i], 0.05);
    // Бас — виолончель: корень аккорда на первую долю, на полтакта.
    const b = brass(ch[0] - 12, bar * 0.55, { cutoff: 420, vib: 3, att: 0.15, rel: 0.4 });
    mix(x, t0, bar * 0.55, (t, i) => b[i], 0.22);
    // Литавры настроены на ре и ля: удар на первую долю (на до-мажорном аккорде — пауза);
    // в конце каждой фразы — «та-та-БУМ».
    const timp = ch === C ? null : ch === A || ch === F ? 33 : 38;
    if (timp !== null) timpani(x, t0, timp, k >= 8 ? 0.55 : 0.4);
    if (k % 4 === 3) {
      timpani(x, t0 + 3 * beat, 33, 0.3);
      timpani(x, t0 + 3.5 * beat, 33, 0.35);
    }
    // Лютня: тихие щипки четвертями (в первой и третьей частях).
    if (k < 8 || (k >= 16 && k < 24)) {
      [1, 2, 3, 2].forEach((n, j) => {
        const pl = pluck(ch[n] + 12, 1.8, 0.4);
        mix(x, t0 + j * beat + (j % 2 ? beat * 0.03 : 0), 1.8, (t, i) => pl[i], 0.13);
      });
    }
    // Маршевый барабан — со второй части: удары на 2 и 4, дробь перед сменой части.
    if (k >= 8) {
      const g = k >= 24 ? 0.16 : 0.11;
      snare(x, t0 + beat, g);
      snare(x, t0 + 2.5 * beat, g * 0.6);
      snare(x, t0 + 3 * beat, g);
      if (k % 8 === 7) for (let r = 0; r < 8; r++) snare(x, t0 + 3 * beat + (r * beat) / 8, g * (0.4 + r * 0.08));
    }
  });

  // Валторна: мелодия на квартах и квинтах (такт, доля, нота, длительность в долях).
  const horn = [
    [16, 0, 62, 1.5], [16, 1.5, 62, 0.5], [16, 2, 69, 2],
    [17, 0, 74, 3], [17, 3, 72, 1],
    [18, 0, 70, 2], [18, 2, 65, 2],
    [19, 0, 67, 1.5], [19, 1.5, 67, 0.5], [19, 2, 72, 2],
    [20, 0, 69, 4],
    [21, 0, 70, 2], [21, 2, 74, 2],
    [22, 0, 74, 2], [22, 2, 70, 1], [22, 3, 67, 1],
    [23, 0, 69, 2], [23, 2, 73, 2],
    [24, 0, 74, 2], [24, 2, 77, 2],
    [25, 0, 74, 3], [25, 3, 70, 1],
    [26, 0, 72, 2], [26, 2, 69, 2],
    [27, 0, 67, 1.5], [27, 1.5, 69, 0.5], [27, 2, 72, 2],
    [28, 0, 70, 2], [28, 2, 74, 2],
    [29, 0, 69, 4],
    [30, 0, 64, 1], [30, 1, 69, 1], [30, 2, 73, 2],
    [31, 0, 74, 3],
  ];
  for (const [b, d, n, len] of horn) {
    const dur = len * beat;
    const h = brass(n, dur, { cutoff: 1300, vib: 4, att: 0.09, rel: 0.25 });
    mix(x, b * bar + d * beat, dur, (t, i) => h[i], 0.3);
  }
  return normalize(reverb(lowpass(x, 5000), 0.32, 0.86, true), 0.6);
}

// ---------- Запись ----------

fs.mkdirSync(OUT, { recursive: true });
for (const [name, x] of Object.entries(sounds)) {
  fs.writeFileSync(path.join(OUT, `${name}.wav`), wav(trim(x)));
}
const tmp = path.join(os.tmpdir(), `warplanet-music-${process.pid}.wav`);
fs.writeFileSync(tmp, wav(music()));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-codec:a', 'libmp3lame', '-b:a', '64k', path.join(OUT, 'music.mp3')]);
fs.unlinkSync(tmp);
console.log(`assets/sounds: ${Object.keys(sounds).length} эффектов и music.mp3`);
