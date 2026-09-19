// player.js — Auto-roll por tempo + detecção por microfone

export class AutoRollPlayer {
  constructor(options = {}) {
    this.container = options.container; // elemento rolável
    this.onPositionChange = options.onPositionChange || (() => {});
    this.onSongEnd = options.onSongEnd || (() => {});
    
    this.isPlaying = false;
    this.startTime = 0;
    this.duration = options.duration || 180; // segundos (padrão 3 min)
    this.speed = 1.0;
    this.scrollTop = 0;
    this.contentHeight = 0;
    this.viewportHeight = 0;
    this.maxScroll = 0;
    this.animationFrame = null;

    // Rolagem automática (desligada por padrão — rolagem manual apenas)
    this.autoScroll = options.autoScroll === true;
    
    // Microfone
    this.audioContext = null;
    this.analyser = null;
    this.micStream = null;
    this.silenceThreshold = 15; // 0-255
    this.silenceDuration = 3000; // ms de silêncio para considerar fim
    this.lastSoundTime = 0;
    this.silenceDetected = false;
    this.micEnabled = false;
    
    // Callbacks de microfone
    this.onMicStart = options.onMicStart || (() => {});
    this.onMicError = options.onMicError || (() => {});
    this.onSilence = options.onSilence || (() => {});
    this.onSound = options.onSound || (() => {});
  }

  // Configura duração estimada da música
  setDuration(seconds) {
    this.duration = Math.max(10, seconds);
    this.updateMaxScroll();
  }

  // Define velocidade (0.5 a 2.0)
  setSpeed(speed) {
    const newSpeed = Math.max(0.25, Math.min(3, speed));
    // Rebase do startTime para a posição atual não pular ao mudar a velocidade
    if (this.isPlaying && this.startTime) {
      const elapsed = (Date.now() - this.startTime) * this.speed;
      this.startTime = Date.now() - elapsed / newSpeed;
    }
    this.speed = newSpeed;
  }

  // Calcula altura rolável
  updateMaxScroll() {
    if (!this.container) return;
    this.contentHeight = this.container.scrollHeight;
    this.viewportHeight = this.container.clientHeight;
    this.maxScroll = Math.max(0, this.contentHeight - this.viewportHeight);
  }

  // Inicia "reprodução" (play/pause visual/controle). A rolagem automática
  // só acontece se autoScroll estiver ativo.
  async start() {
    if (this.isPlaying) return;
    
    this.updateMaxScroll();
    this.isPlaying = true;
    // Retoma de onde a cifra está (inclusive rolagem manual); evita 0/0 = NaN
    // quando a cifra cabe inteira na tela
    if (this.container) this.scrollTop = this.container.scrollTop;
    const progress = this.maxScroll > 0 ? Math.min(1, this.scrollTop / this.maxScroll) : 0;
    this.startTime = Date.now() - progress * this.duration * 1000 / this.speed;
    this.lastSoundTime = Date.now();
    this.silenceDetected = false;
    
    if (this.autoScroll) {
      this.animate();
    }
    
    // Tenta iniciar microfone se habilitado
    if (this.micEnabled) {
      await this.startMicrophone();
    }
  }

  // Pausa
  pause() {
    this.isPlaying = false;
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.stopMicrophone();
  }

  // Para completamente
  stop() {
    this.pause();
    this.scrollTop = 0;
    if (this.container) this.container.scrollTop = 0;
    this.onPositionChange(0);
  }

  // Loop de animação
  animate() {
    if (!this.isPlaying) return;
    
    const elapsed = (Date.now() - this.startTime) * this.speed;
    const progress = Math.min(1, elapsed / (this.duration * 1000));
    
    this.scrollTop = progress * this.maxScroll;
    if (this.container) this.container.scrollTop = this.scrollTop;
    this.onPositionChange(progress);
    
    if (progress >= 1) {
      this.isPlaying = false;
      this.onSongEnd();
      return;
    }
    
    this.animationFrame = requestAnimationFrame(() => this.animate());
  }

  // Pula para posição (0-1)
  seek(progress) {
    progress = Math.max(0, Math.min(1, progress));
    this.scrollTop = progress * this.maxScroll;
    if (this.container) this.container.scrollTop = this.scrollTop;
    this.startTime = Date.now() - progress * this.duration * 1000 / this.speed;
    this.onPositionChange(progress);
  }

  // ===== MICROFONE =====
  
  async enableMic(enabled = true) {
    this.micEnabled = enabled;
    if (enabled && this.isPlaying) {
      await this.startMicrophone();
    } else if (!enabled) {
      this.stopMicrophone();
    }
  }

  async startMicrophone() {
    if (this.micStream) return true;
    
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: true, 
          noiseSuppression: true,
          autoGainControl: true 
        } 
      });
      
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.8;
      
      const source = this.audioContext.createMediaStreamSource(this.micStream);
      source.connect(this.analyser);
      
      this.lastSoundTime = Date.now();
      this.silenceDetected = false;
      this.micLoop();
      
      this.onMicStart();
      return true;
    } catch (err) {
      console.warn("Microfone não disponível:", err);
      this.onMicError(err);
      return false;
    }
  }

  stopMicrophone() {
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.analyser = null;
  }

  micLoop() {
    if (!this.analyser || !this.isPlaying) return;
    
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    
    // Média das frequências médias (voz/violão ~200-2000Hz)
    // Bins: sampleRate/fftSize = ~21.5Hz per bin. 200Hz=bin9, 2000Hz=bin93
    let sum = 0, count = 0;
    for (let i = 9; i <= 93 && i < data.length; i++) {
      sum += data[i];
      count++;
    }
    const avg = count ? sum / count : 0;
    
    const now = Date.now();
    if (avg > this.silenceThreshold) {
      this.lastSoundTime = now;
      if (this.silenceDetected) {
        this.silenceDetected = false;
        this.onSound();
      }
    } else {
      // Silêncio prolongado
      if (!this.silenceDetected && (now - this.lastSoundTime) > this.silenceDuration) {
        this.silenceDetected = true;
        this.onSilence();
      }
    }
    
    requestAnimationFrame(() => this.micLoop());
  }

  // Ajusta sensibilidade do microfone
  setSilenceThreshold(value) {
    this.silenceThreshold = Math.max(0, Math.min(100, value));
  }

  setSilenceDuration(ms) {
    this.silenceDuration = Math.max(500, ms);
  }

  // Obtém progresso atual (0-1)
  getProgress() {
    if (!this.isPlaying) return this.scrollTop / (this.maxScroll || 1);
    const elapsed = (Date.now() - this.startTime) * this.speed;
    return Math.min(1, elapsed / (this.duration * 1000));
  }

  // Obtém tempo restante em segundos
  getRemainingTime() {
    const progress = this.getProgress();
    return Math.max(0, this.duration * (1 - progress));
  }
}

// Helper: estima duração a partir de BPM e compassos
export function estimateDuration(bpm, measures, beatsPerMeasure = 4) {
  const beats = measures * beatsPerMeasure;
  const secondsPerBeat = 60 / bpm;
  return Math.round(beats * secondsPerBeat);
}

// Helper: detecta BPM aproximado por tap
// Aceita batidas contínuas (sem limite). O BPM é recalculado a cada nova
// batida usando a média dos intervalos das últimas 4 batidas (janela móvel).
export class TapTempo {
  constructor() {
    this.taps = [];
  }

  tap() {
    const now = Date.now();
    // Pausa longa entre batidas = nova contagem (senão o BPM despenca)
    const last = this.taps[this.taps.length - 1];
    if (last && now - last > 2000) this.taps = [];
    this.taps.push(now);
    // Mantém apenas as últimas 64 batidas para não acumular memória,
    // mas nunca impede de bater novamente (batida infinita).
    if (this.taps.length > 64) this.taps.shift();
  }

  getBPM() {
    const last = this.taps.slice(-4); // janela móvel das 4 batidas mais recentes
    if (last.length < 2) return null;
    const intervals = [];
    for (let i = 1; i < last.length; i++) {
      intervals.push(last[i] - last[i - 1]);
    }
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    return Math.round(60000 / avg);
  }

  reset() {
    this.taps = [];
  }
}