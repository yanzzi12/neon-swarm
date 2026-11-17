// All sound is synthesised with WebAudio: no audio files, nothing fetched. Short oscillator
// and noise blips make the effects; a small look-ahead scheduler loops a bass-and-arpeggio
// synth track while a run is on. The context is created lazily on the first user gesture
// (browsers refuse audio before one), and every call is a safe no-op until then.

const BASS_LINE = [33, 0, 33, 0, 36, 0, 31, 0, 29, 0, 29, 0, 31, 0, 34, 0];
const ARP_NOTES = [57, 60, 64, 67, 64, 60, 55, 60, 53, 57, 60, 65, 60, 57, 55, 50];
const STEP_SECONDS = 60 / 112 / 2; // 112 BPM, eighth notes

function midiToFreq(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function createAudio() {
  let context = null;
  let master = null;
  let noiseBuffer = null;
  let muted = false;
  let lastShot = 0;
  let musicTimer = null;
  let musicStep = 0;
  let nextStepTime = 0;

  function ensure() {
    try {
      if (context === null) {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) return false;
        context = new AudioCtor();
        master = context.createGain();
        master.gain.value = muted ? 0 : 0.5;
        master.connect(context.destination);
        noiseBuffer = context.createBuffer(1, context.sampleRate * 0.5, context.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
      }
      if (context.state === 'suspended') context.resume();
      return true;
    } catch {
      return false;
    }
  }

  /** One oscillator blip: freq glides to freqEnd over dur seconds. */
  function tone(type, freq, freqEnd, dur, vol, when = 0, destination = null) {
    if (!ensure()) return;
    try {
      const start = context.currentTime + when;
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(20, freq), start);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), start + dur);
      gain.gain.setValueAtTime(vol, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(gain);
      gain.connect(destination ?? master);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    } catch {
      // A failed blip is silence, never a crash.
    }
  }

  /** One filtered noise burst, for explosions and hits. */
  function noise(dur, vol, fromFreq, toFreq, when = 0) {
    if (!ensure()) return;
    try {
      const start = context.currentTime + when;
      const source = context.createBufferSource();
      source.buffer = noiseBuffer;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(fromFreq, start);
      filter.frequency.exponentialRampToValueAtTime(Math.max(30, toFreq), start + dur);
      const gain = context.createGain();
      gain.gain.setValueAtTime(vol, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      source.start(start);
      source.stop(start + dur + 0.02);
    } catch {
      // Silence, as above.
    }
  }

  function scheduleMusic() {
    if (context === null) return;
    while (nextStepTime < context.currentTime + 0.14) {
      const step = musicStep % 16;
      const when = Math.max(0, nextStepTime - context.currentTime);
      const bass = BASS_LINE[step];
      if (bass !== 0) tone('sawtooth', midiToFreq(bass), midiToFreq(bass), STEP_SECONDS * 0.9, 0.055, when);
      if (step % 2 === 0) {
        const arp = ARP_NOTES[step];
        tone('triangle', midiToFreq(arp + 12), midiToFreq(arp + 12), STEP_SECONDS * 0.8, 0.028, when);
      }
      if (step % 4 === 2) noise(0.03, 0.012, 6000, 3000, when);
      nextStepTime += STEP_SECONDS;
      musicStep += 1;
    }
  }

  return {
    /** Call from any user gesture: creates/resumes the context. */
    unlock() {
      ensure();
    },
    shoot() {
      if (context === null) return;
      const now = performance.now();
      if (now - lastShot < 45) return; // At rapid-fire rates the ear wants a stream, not a stack.
      lastShot = now;
      tone('square', 920, 240, 0.07, 0.07);
    },
    enemyShot() {
      tone('square', 340, 180, 0.09, 0.03);
    },
    explosion(big) {
      noise(big ? 0.5 : 0.3, big ? 0.32 : 0.2, 1400, 90);
      tone('sine', big ? 130 : 110, 32, big ? 0.45 : 0.3, 0.3);
    },
    playerHit() {
      tone('sawtooth', 170, 55, 0.28, 0.3);
      noise(0.22, 0.2, 2000, 200);
    },
    shieldHit() {
      tone('square', 1250, 880, 0.1, 0.16);
      tone('square', 1900, 1400, 0.08, 0.08, 0.03);
    },
    powerup() {
      tone('square', 660, 660, 0.07, 0.14);
      tone('square', 880, 880, 0.07, 0.14, 0.07);
      tone('square', 1320, 1320, 0.12, 0.14, 0.14);
    },
    wave() {
      tone('sawtooth', 392, 392, 0.12, 0.1);
      tone('sawtooth', 587, 587, 0.2, 0.1, 0.11);
    },
    gameOver() {
      tone('sawtooth', 440, 440, 0.22, 0.16);
      tone('sawtooth', 349, 349, 0.22, 0.16, 0.2);
      tone('sawtooth', 262, 262, 0.24, 0.16, 0.4);
      tone('sawtooth', 175, 170, 0.55, 0.18, 0.6);
    },
    startMusic() {
      if (!ensure() || musicTimer !== null) return;
      musicStep = 0;
      nextStepTime = context.currentTime + 0.06;
      musicTimer = window.setInterval(scheduleMusic, 42);
    },
    stopMusic() {
      if (musicTimer !== null) {
        window.clearInterval(musicTimer);
        musicTimer = null;
      }
    },
    toggleMute() {
      muted = !muted;
      if (master !== null && context !== null) {
        master.gain.setTargetAtTime(muted ? 0 : 0.5, context.currentTime, 0.01);
      }
      return muted;
    },
    isMuted() {
      return muted;
    },
  };
}
