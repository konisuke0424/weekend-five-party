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
  // BGM: procedural ambient loop (no asset file needed)
  //   - 4-chord progression (Am - F - C - G), 4 seconds per chord, 16s loop.
  //   - Soft triangle + sine oscillators routed through a low-pass filter
  //     so it sounds like a slow pad rather than a chiptune.
  //   - Tied to a master gain we can fade in / out and mute.
  //   - Mute state persisted in localStorage so it survives reload.
  // ============================================================
  const BGM_PROGRESSION = [
    // [root, third, fifth, octave] in Hz
    [220.00, 261.63, 329.63, 440.00], // A minor
    [174.61, 220.00, 261.63, 349.23], // F major
    [130.81, 164.81, 196.00, 261.63], // C major
    [196.00, 246.94, 293.66, 392.00]  // G major
  ];
  const BGM_CHORD_SEC = 4.0;
  const BGM_LOOP_SEC = BGM_PROGRESSION.length * BGM_CHORD_SEC;
  const BGM_MASTER_VOL = 0.06; // intentionally subtle so it never overpowers SFX

  let bgmMaster = null;
  let bgmTimer = null;
  let bgmRunning = false;
  let bgmMuted = false;
  let bgmListeners = [];

  try { bgmMuted = localStorage.getItem("igame.bgm.muted") === "1"; } catch (_) {}

  function notifyBgmListeners() {
    for (const fn of bgmListeners) { try { fn(); } catch (_) {} }
  }

  function bgmPlayChord(ac, freqs, t0, dur) {
    const g = ac.createGain();
    g.connect(bgmMaster);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.55, t0 + 0.6);
    g.gain.linearRampToValueAtTime(0.45, t0 + dur * 0.6);
    g.gain.linearRampToValueAtTime(0, t0 + dur);

    freqs.forEach((f, i) => {
      const o = ac.createOscillator();
      o.type = i === 0 ? "triangle" : "sine";
      o.frequency.value = f;
      // Slight detune on upper voices for warmth.
      if (i >= 2) o.detune.value = (i - 2) * 6;
      const filt = ac.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.value = 1100;
      filt.Q.value = 0.7;
      o.connect(filt);
      filt.connect(g);
      o.start(t0);
      o.stop(t0 + dur + 0.1);
    });
  }

  function bgmScheduleLoop(ac, loopStartAt) {
    for (let i = 0; i < BGM_PROGRESSION.length; i++) {
      bgmPlayChord(ac, BGM_PROGRESSION[i], loopStartAt + i * BGM_CHORD_SEC, BGM_CHORD_SEC);
    }
    // Re-arm the next loop slightly before the current one ends so chords
    // overlap a hair and we never get an audible seam.
    const msUntilNext = (BGM_LOOP_SEC - 0.15) * 1000;
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
