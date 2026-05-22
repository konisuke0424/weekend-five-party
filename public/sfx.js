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
  // Try to unlock audio on first user gesture
  const unlock = () => { audio(); window.removeEventListener("pointerdown", unlock); };
  window.addEventListener("pointerdown", unlock);
})();
