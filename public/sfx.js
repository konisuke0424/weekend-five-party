/* eslint-disable */
/* Sound effects via WebAudio (no asset needed) */

(function() {
  let ctx = null;
  function audio() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function envelope(gainNode, t0, attack, decay, sustain, sustainEnd, release) {
    const g = gainNode.gain;
    g.setValueAtTime(0, t0);
    g.linearRampToValueAtTime(sustain, t0 + attack);
    g.linearRampToValueAtTime(sustainEnd, t0 + attack + decay);
    g.linearRampToValueAtTime(0, t0 + attack + decay + release);
  }

  function tone(opts) {
    const ac = audio(); if (!ac) return;
    const { freq, type = "sine", t0 = ac.currentTime, dur = 0.2, vol = 0.2, slide, filter } = opts;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide != null) {
      osc.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
    }
    let node = osc;
    if (filter) {
      const filt = ac.createBiquadFilter();
      filt.type = filter.type || "lowpass";
      filt.frequency.value = filter.freq || 800;
      filt.Q.value = filter.Q || 1;
      osc.connect(filt);
      node = filt;
    }
    node.connect(gain);
    gain.connect(ac.destination);
    envelope(gain, t0, 0.005, 0.04, vol, vol * 0.6, dur);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function noise(opts) {
    const ac = audio(); if (!ac) return;
    const { t0 = ac.currentTime, dur = 0.2, vol = 0.2, filterFreq = 2000, type = "lowpass" } = opts || {};
    const buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.7;
    const src = ac.createBufferSource();
    src.buffer = buf;
    const filt = ac.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = filterFreq;
    const gain = ac.createGain();
    src.connect(filt); filt.connect(gain); gain.connect(ac.destination);
    envelope(gain, t0, 0.005, 0.05, vol, vol * 0.5, dur);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  const SFX = {
    gain() {
      const ac = audio(); if (!ac) return;
      const t = ac.currentTime;
      // ascending arpeggio
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        tone({ freq: f, type: "triangle", t0: t + i * 0.07, dur: 0.18, vol: 0.18 });
      });
    },
    loss() {
      const ac = audio(); if (!ac) return;
      const t = ac.currentTime;
      // descending wobble
      tone({ freq: 440, type: "sawtooth", t0: t, dur: 0.35, vol: 0.18, slide: 110, filter: { type: "lowpass", freq: 800 } });
      noise({ t0: t, dur: 0.25, vol: 0.15, filterFreq: 600 });
    },
    play() {
      const ac = audio(); if (!ac) return;
      const t = ac.currentTime;
      // whoosh + click
      noise({ t0: t, dur: 0.18, vol: 0.18, filterFreq: 3000, type: "bandpass" });
      tone({ freq: 880, type: "sine", t0: t + 0.05, dur: 0.08, vol: 0.15 });
    },
    fire() {
      const ac = audio(); if (!ac) return;
      const t = ac.currentTime;
      // low crackle
      noise({ t0: t, dur: 0.6, vol: 0.18, filterFreq: 500, type: "lowpass" });
      tone({ freq: 80, type: "sawtooth", t0: t, dur: 0.5, vol: 0.12, slide: 40 });
    },
    shield() {
      const ac = audio(); if (!ac) return;
      const t = ac.currentTime;
      // shimmery synth
      [880, 1318.5, 1760].forEach((f, i) => {
        tone({ freq: f, type: "sine", t0: t + i * 0.04, dur: 0.4, vol: 0.1 });
      });
    },
    end() {
      const ac = audio(); if (!ac) return;
      const t = ac.currentTime;
      tone({ freq: 660, type: "square", t0: t, dur: 0.08, vol: 0.15 });
      tone({ freq: 440, type: "square", t0: t + 0.08, dur: 0.12, vol: 0.15 });
    }
  };

  window.SFX = SFX;

  // ============================================================
  // BGM: procedural "upbeat / fun" loop (no asset file needed)
  //
  //   Style: 120 BPM, 4-chord pop progression (C - G - Am - F = I-V-vi-IV),
  //          1 chord = 4 beats = 2 seconds, total 8s loop.
  //   Layers (per chord):
  //     - Pad: held chord triad (sine + triangle) for warmth.
  //     - Bass: root note on every beat, square-ish pluck, octave below.
  //     - Arp: 8 eighth-notes through the chord triad (pattern below),
  //            triangle wave one octave up — gives the loop its "melody".
  //     - Kick: short low sine thump on beats 1 + 3.
  //     - Hat: filtered noise blip on every off-beat (the "&" counts).
  //   Mute state persisted in localStorage so it survives reload.
  // ============================================================
  const BGM_TEMPO_BPM = 120;
  const BGM_BEAT_SEC = 60 / BGM_TEMPO_BPM;          // 0.5s
  const BGM_CHORD_BEATS = 4;
  const BGM_CHORD_SEC = BGM_BEAT_SEC * BGM_CHORD_BEATS; // 2s
  // C, G, Am, F — classic pop progression. Each entry holds the triad freqs.
  const BGM_PROGRESSION = [
    { name: "C",  root: 130.81, third: 164.81, fifth: 196.00 },
    { name: "G",  root: 196.00, third: 246.94, fifth: 293.66 },
    { name: "Am", root: 220.00, third: 261.63, fifth: 329.63 },
    { name: "F",  root: 174.61, third: 220.00, fifth: 261.63 }
  ];
  const BGM_LOOP_SEC = BGM_PROGRESSION.length * BGM_CHORD_SEC; // 8s
  const BGM_MASTER_VOL = 0.085; // bumped vs the old ambient pad; still below SFX

  let bgmMaster = null;
  let bgmTimer = null;
  let bgmRunning = false;
  let bgmMuted = false;
  let bgmListeners = [];

  try { bgmMuted = localStorage.getItem("igame.bgm.muted") === "1"; } catch (_) {}

  function notifyBgmListeners() {
    for (const fn of bgmListeners) { try { fn(); } catch (_) {} }
  }

  // Soft chord pad — keeps the harmonic "bed" under the rhythmic layers.
  function bgmPlayPad(ac, chord, t0, dur) {
    const g = ac.createGain();
    g.connect(bgmMaster);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.42, t0 + 0.35);
    g.gain.linearRampToValueAtTime(0.32, t0 + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t0 + dur);

    [chord.root, chord.third, chord.fifth].forEach((f, i) => {
      const o = ac.createOscillator();
      o.type = i === 0 ? "triangle" : "sine";
      o.frequency.value = f;
      if (i >= 1) o.detune.value = i * 6;
      const filt = ac.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.value = 1500;
      filt.Q.value = 0.6;
      o.connect(filt);
      filt.connect(g);
      o.start(t0);
      o.stop(t0 + dur + 0.1);
    });
  }

  // Bass pluck — root one octave below, fast attack/decay for groove.
  function bgmPlayBassNote(ac, freq, t0) {
    const dur = BGM_BEAT_SEC * 0.85;
    const g = ac.createGain();
    g.connect(bgmMaster);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.7, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.05, t0 + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t0 + dur);

    const o = ac.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq * 0.5; // octave below the chord root
    const filt = ac.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 600;
    filt.Q.value = 1.6;
    o.connect(filt);
    filt.connect(g);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  // Lead arpeggio — 8 eighth-notes per chord, triangle wave one octave up.
  // Pattern (in chord-tone indices): root, third, fifth, third, root, third, fifth, octave.
  function bgmPlayArp(ac, chord, t0) {
    const tones = [chord.root, chord.third, chord.fifth];
    const pattern = [0, 1, 2, 1, 0, 1, 2, 3]; // 3 = octave above root
    for (let i = 0; i < pattern.length; i++) {
      const t = t0 + i * (BGM_BEAT_SEC * 0.5);
      const dur = BGM_BEAT_SEC * 0.45;
      const idx = pattern[i];
      const freq = idx === 3 ? chord.root * 2 : tones[idx];
      const g = ac.createGain();
      g.connect(bgmMaster);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.03, t + dur * 0.8);
      g.gain.linearRampToValueAtTime(0, t + dur);

      const o = ac.createOscillator();
      o.type = "triangle";
      o.frequency.value = freq * 2; // one octave up for the lead melody
      const filt = ac.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.value = 3500;
      filt.Q.value = 0.7;
      o.connect(filt);
      filt.connect(g);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  // Kick — short low sine thump.
  function bgmPlayKick(ac, t0) {
    const dur = 0.18;
    const g = ac.createGain();
    g.connect(bgmMaster);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.9, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.01, t0 + dur);

    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(140, t0);
    o.frequency.exponentialRampToValueAtTime(45, t0 + dur * 0.9);
    o.connect(g);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  // Hat — short filtered noise blip on off-beats.
  function bgmPlayHat(ac, t0) {
    const dur = 0.06;
    const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.6;
    const src = ac.createBufferSource();
    src.buffer = buf;
    const filt = ac.createBiquadFilter();
    filt.type = "highpass";
    filt.frequency.value = 5000;
    filt.Q.value = 0.7;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.18, t0 + 0.005);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    src.connect(filt); filt.connect(g); g.connect(bgmMaster);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  function bgmScheduleLoop(ac, loopStartAt) {
    for (let chordIdx = 0; chordIdx < BGM_PROGRESSION.length; chordIdx++) {
      const chord = BGM_PROGRESSION[chordIdx];
      const chordStart = loopStartAt + chordIdx * BGM_CHORD_SEC;
      // Pad bed.
      bgmPlayPad(ac, chord, chordStart, BGM_CHORD_SEC);
      // Arpeggio over the full chord.
      bgmPlayArp(ac, chord, chordStart);
      // Bass on every beat (4 per chord).
      for (let beat = 0; beat < BGM_CHORD_BEATS; beat++) {
        const t = chordStart + beat * BGM_BEAT_SEC;
        bgmPlayBassNote(ac, chord.root, t);
        // Kick on beats 1 and 3 (every other beat).
        if (beat % 2 === 0) bgmPlayKick(ac, t);
        // Hat on the "&" of every beat.
        bgmPlayHat(ac, t + BGM_BEAT_SEC * 0.5);
      }
    }
    // Re-arm slightly before the current loop ends so we never get a seam.
    const msUntilNext = (BGM_LOOP_SEC - 0.12) * 1000;
    bgmTimer = setTimeout(() => {
      if (bgmRunning) bgmScheduleLoop(ac, loopStartAt + BGM_LOOP_SEC);
    }, msUntilNext);
  }

  function bgmStart() {
    if (bgmRunning || bgmMuted) return;
    const ac = audio();
    if (!ac) return;
    if (!bgmMaster) {
      bgmMaster = ac.createGain();
      bgmMaster.connect(ac.destination);
    }
    // Fade in.
    bgmMaster.gain.cancelScheduledValues(ac.currentTime);
    bgmMaster.gain.setValueAtTime(0, ac.currentTime);
    bgmMaster.gain.linearRampToValueAtTime(BGM_MASTER_VOL, ac.currentTime + 0.8);
    bgmRunning = true;
    bgmScheduleLoop(ac, ac.currentTime + 0.05);
    notifyBgmListeners();
  }

  function bgmStop() {
    if (!bgmRunning) return;
    bgmRunning = false;
    if (bgmTimer) { clearTimeout(bgmTimer); bgmTimer = null; }
    const ac = audio();
    if (ac && bgmMaster) {
      bgmMaster.gain.cancelScheduledValues(ac.currentTime);
      bgmMaster.gain.setValueAtTime(bgmMaster.gain.value, ac.currentTime);
      bgmMaster.gain.linearRampToValueAtTime(0, ac.currentTime + 0.4);
    }
    notifyBgmListeners();
  }

  function bgmToggle() {
    bgmMuted = !bgmMuted;
    try { localStorage.setItem("igame.bgm.muted", bgmMuted ? "1" : "0"); } catch (_) {}
    if (bgmMuted) bgmStop();
    else bgmStart();
    notifyBgmListeners();
    return bgmMuted;
  }

  window.BGM = {
    start: bgmStart,
    stop: bgmStop,
    toggle: bgmToggle,
    isMuted: () => bgmMuted,
    isOn: () => bgmRunning && !bgmMuted,
    onChange: (fn) => { bgmListeners.push(fn); return () => { bgmListeners = bgmListeners.filter(f => f !== fn); }; }
  };

  // Try to unlock audio on first user gesture
  const unlock = () => { audio(); window.removeEventListener("pointerdown", unlock); };
  window.addEventListener("pointerdown", unlock);
})();
