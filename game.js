const RAVE_CONFIG = {
  frames: {
    basePath: "assets/sprites",
    idle: "sprite_0000.png",
    movementByDirection: {
      up: "sprite_0001.png",
      down: "sprite_0011.png",
      left: "sprite_0004.png",
      right: "sprite_0005.png",
    },
    frameMs: 140,
  },
  notes: {
    travelMs: 3400,
    baseSpawnMs: 1450,
    loudSpawnMs: 900,
    quietThreshold: 0.06,
    loudThreshold: 0.24,
    missAfterMs: 520,
  },
  timing: {
    perfectMs: 150,
    goodMs: 290,
    poorMs: 460,
    loudTightenMs: 8,
  },
  confidence: {
    start: 100,
    perfect: 3,
    good: 2,
    poor: -2,
    bad: -5,
    miss: -7,
  },
  scoring: {
    perfect: 300,
    good: 170,
    poor: 70,
    bad: 20,
  },
};

const DIRECTIONS = ["up", "down", "left", "right"];
const SYMBOLS = { up: "\u2191", down: "\u2193", left: "\u2190", right: "\u2192" };
const LEADERBOARD_KEY = "rabbiesRaveLeaderboard";

class RabbiesRave {
  constructor(root) {
    this.root = root;
    this.views = [...root.querySelectorAll("[data-view]")];
    this.songList = root.querySelector("[data-song-list]");
    this.leaderboard = root.querySelector("[data-leaderboard]");
    this.playfield = root.querySelector("[data-playfield]");
    this.rabbie = root.querySelector("[data-rabbie]");
    this.feedback = root.querySelector("[data-feedback]");
    this.scoreEl = root.querySelector("[data-score]");
    this.songEl = root.querySelector("[data-current-song]");
    this.confidenceEl = root.querySelector("[data-confidence]");
    this.finalScoreEl = root.querySelector("[data-final-score]");
    this.resultCopy = root.querySelector("[data-result-copy]");
    this.resultKicker = root.querySelector("[data-result-kicker]");
    this.scoreForm = root.querySelector("[data-score-form]");
    this.menuStatus = root.querySelector("[data-menu-status]");

    this.songs = window.RABBIES_RAVE_SONGS || [];
    this.notes = [];
    this.score = 0;
    this.confidence = RAVE_CONFIG.confidence.start;
    this.running = false;
    this.lastSpawnAt = 0;
    this.startedAt = 0;
    this.currentSong = null;
    this.audio = null;
    this.audioContext = null;
    this.analyser = null;
    this.sourceNode = null;
    this.frequencyData = null;
    this.lastAmplitude = 0;

    this.renderSongs();
    this.renderLeaderboard();
    this.setRabbieIdle();
    this.bindEvents();
  }

  bindEvents() {
    this.root.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      const songId = event.target.closest("[data-song]")?.dataset.song;
      const direction = event.target.closest("[data-direction]")?.dataset.direction;
      if (action) this.handleAction(action);
      if (songId) this.startSong(songId);
      if (direction) this.hit(direction);
    });

    this.root.querySelectorAll("[data-direction]").forEach((button) => {
      button.addEventListener("touchstart", (event) => {
        event.preventDefault();
        this.hit(button.dataset.direction);
      }, { passive: false });
    });

    document.addEventListener("keydown", (event) => {
      const direction = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      }[event.key];
      if (!direction || !this.running) return;
      event.preventDefault();
      this.hit(direction);
    });

    this.scoreForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = new FormData(this.scoreForm).get("player");
      this.saveScore(name);
      this.scoreForm.reset();
      this.showView("leaderboard");
    });
  }

  handleAction(action) {
    if (action === "show-menu") this.showView("menu");
    if (action === "show-songs") this.showView("songs");
    if (action === "show-leaderboard") {
      this.renderLeaderboard();
      this.showView("leaderboard");
    }
    if (action === "end-run") this.endRun("Run ended", false);
  }

  showView(name) {
    this.views.forEach((view) => {
      view.classList.toggle("rave-view--active", view.dataset.view === name);
    });
  }

  renderSongs() {
    this.songList.innerHTML = this.songs.map((song) => `
      <button class="song-card" type="button" data-song="${song.id}">
        <strong>${song.title}</strong>
        <span>${song.artist}</span>
        <small>${song.file}</small>
      </button>
    `).join("");
  }

  async startSong(songId) {
    this.currentSong = this.songs.find((song) => song.id === songId);
    if (!this.currentSong) return;

    this.resetRun();
    this.showView("game");
    this.songEl.textContent = `${this.currentSong.title} - ${this.currentSong.artist}`;
    this.showFeedback("Loading", "okay");

    try {
      await this.prepareAudio(this.currentSong.file);
      await this.audio.play();
      this.running = true;
      this.startedAt = performance.now();
      this.lastSpawnAt = this.startedAt - 500;
      requestAnimationFrame((time) => this.loop(time));
    } catch (error) {
      this.showFeedback("Audio failed", "bad");
      this.menuStatus.textContent = `Could not play ${this.currentSong.title}. Check the audio path in songs.js.`;
      this.showView("songs");
      this.stopAudio();
      console.error(error);
    }
  }

  resetRun() {
    this.stopAudio();
    this.notes.forEach((note) => note.el.remove());
    this.notes = [];
    this.score = 0;
    this.confidence = RAVE_CONFIG.confidence.start;
    this.scoreEl.textContent = "0";
    this.updateConfidence();
    this.setRabbieIdle();
  }

  async prepareAudio(file) {
    this.audio = new Audio(file);
    this.audio.preload = "auto";
    this.audio.src = file;

    this.audioContext ||= new AudioContext();
    if (this.audioContext.state === "suspended") await this.audioContext.resume();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.sourceNode = this.audioContext.createMediaElementSource(this.audio);
    this.sourceNode.connect(this.analyser);
    this.analyser.connect(this.audioContext.destination);
    this.audio.addEventListener("ended", () => this.endRun("Run complete", true), { once: true });
  }

  stopAudio() {
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    this.audio = null;
  }

  loop(now) {
    if (!this.running) return;
    const amplitude = this.readAmplitude();
    this.lastAmplitude = amplitude;
    this.maybeSpawnNote(now, amplitude);
    this.updateNotes(now);
    this.checkMisses(now);
    requestAnimationFrame((time) => this.loop(time));
  }

  readAmplitude() {
    if (!this.analyser || !this.frequencyData) return 0;
    this.analyser.getByteFrequencyData(this.frequencyData);
    const total = this.frequencyData.reduce((sum, value) => sum + value, 0);
    const analysed = total / this.frequencyData.length / 255;
    const elapsed = performance.now() - this.startedAt;
    const floor = 0.075 + (Math.sin(elapsed / 210) * 0.5 + 0.5) * 0.035;
    return Math.max(analysed, floor);
  }

  maybeSpawnNote(now, amplitude) {
    const intensity = this.intensityFor(amplitude);
    const spawnMs = this.lerp(RAVE_CONFIG.notes.baseSpawnMs, RAVE_CONFIG.notes.loudSpawnMs, intensity);
    if (now - this.lastSpawnAt < spawnMs) return;
    if (amplitude < RAVE_CONFIG.notes.quietThreshold && Math.random() > 0.3) return;

    this.spawnNote(DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)], now);
    this.lastSpawnAt = now;

    if (intensity > 0.78 && Math.random() < 0.24) {
      window.setTimeout(() => {
        if (this.running) this.spawnNote(DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)], performance.now());
      }, 170);
    }
  }

  spawnNote(direction, now) {
    const el = document.createElement("div");
    el.className = `falling-note falling-note--${direction}`;
    el.textContent = SYMBOLS[direction];
    this.playfield.appendChild(el);
    this.notes.push({
      direction,
      targetAt: now + RAVE_CONFIG.notes.travelMs,
      el,
      hit: false,
    });
  }

  updateNotes(now) {
    const fieldHeight = this.playfield.clientHeight;
    const targetY = fieldHeight - 118;
    this.notes.forEach((note) => {
      const progress = 1 - (note.targetAt - now) / RAVE_CONFIG.notes.travelMs;
      const y = this.lerp(-54, targetY, progress);
      note.el.style.transform = `translate3d(0, ${y}px, 0)`;
      note.el.style.opacity = progress > 1.14 ? "0" : "1";
    });
  }

  checkMisses(now) {
    this.notes = this.notes.filter((note) => {
      if (note.hit) return false;
      if (now - note.targetAt <= RAVE_CONFIG.notes.missAfterMs) return true;
      note.el.remove();
      this.changeConfidence(RAVE_CONFIG.confidence.miss);
      this.showFeedback("Miss", "bad");
      return false;
    });
  }

  hit(direction) {
    if (!this.running) return;
    this.animateRabbie(direction);

    const now = performance.now();
    const windows = this.timingWindows();
    const candidate = this.notes
      .filter((note) => note.direction === direction && !note.hit)
      .map((note) => ({ note, delta: Math.abs(now - note.targetAt) }))
      .sort((a, b) => a.delta - b.delta)[0];

    if (!candidate || candidate.delta > windows.bad) {
      this.changeConfidence(RAVE_CONFIG.confidence.bad);
      this.showFeedback("Bad", "bad");
      return;
    }

    candidate.note.hit = true;
    candidate.note.el.remove();
    this.notes = this.notes.filter((note) => !note.hit);

    if (candidate.delta <= windows.perfect) this.award("Perfect", "great", RAVE_CONFIG.scoring.perfect, RAVE_CONFIG.confidence.perfect);
    else if (candidate.delta <= windows.good) this.award("Good", "okay", RAVE_CONFIG.scoring.good, RAVE_CONFIG.confidence.good);
    else if (candidate.delta <= windows.poor) this.award("Early/Late", "poor", RAVE_CONFIG.scoring.poor, RAVE_CONFIG.confidence.poor);
    else this.award("Barely", "bad", RAVE_CONFIG.scoring.bad, RAVE_CONFIG.confidence.bad);
  }

  timingWindows() {
    const tighten = this.intensityFor(this.lastAmplitude) * RAVE_CONFIG.timing.loudTightenMs;
    return {
      perfect: RAVE_CONFIG.timing.perfectMs - tighten,
      good: RAVE_CONFIG.timing.goodMs - tighten,
      poor: RAVE_CONFIG.timing.poorMs - tighten,
      bad: RAVE_CONFIG.timing.poorMs + 160 - tighten,
    };
  }

  award(label, quality, points, confidenceChange) {
    this.score += points;
    this.scoreEl.textContent = String(this.score);
    this.changeConfidence(confidenceChange);
    this.showFeedback(`+${points} ${label}`, quality);
  }

  changeConfidence(amount) {
    this.confidence = Math.max(0, Math.min(100, this.confidence + amount));
    this.updateConfidence();
    if (this.confidence === 0) this.endRun("Confidence gone", false);
  }

  updateConfidence() {
    this.confidenceEl.style.width = `${this.confidence}%`;
  }

  showFeedback(text, quality) {
    this.feedback.textContent = text;
    this.feedback.dataset.quality = quality;
    this.feedback.classList.remove("hit-feedback--pop");
    void this.feedback.offsetWidth;
    this.feedback.classList.add("hit-feedback--pop");
  }

  animateRabbie(direction) {
    [false, true, false].forEach((isMoveFrame, index) => {
      window.setTimeout(() => {
        if (isMoveFrame) this.setRabbieMove(direction);
        else this.setRabbieIdle();
      }, index * RAVE_CONFIG.frames.frameMs);
    });
  }

  setRabbieIdle() {
    this.rabbie.src = `${RAVE_CONFIG.frames.basePath}/${RAVE_CONFIG.frames.idle}`;
  }

  setRabbieMove(direction) {
    const frame = RAVE_CONFIG.frames.movementByDirection[direction] || RAVE_CONFIG.frames.idle;
    this.rabbie.src = `${RAVE_CONFIG.frames.basePath}/${frame}`;
  }

  endRun(kicker, completed) {
    if (!this.running) return;
    this.running = false;
    this.stopAudio();
    this.notes.forEach((note) => note.el.remove());
    this.notes = [];
    this.resultKicker.textContent = kicker;
    this.finalScoreEl.textContent = String(this.score);
    this.resultCopy.textContent = completed ? "Rabbie finished with poise and excellent footwork." : "Rabbie has left the floor, but the score still counts.";
    this.showView("result");
  }

  saveScore(name) {
    const scores = this.getScores();
    scores.push({
      player: String(name || "Anonymous").trim() || "Anonymous",
      song: this.currentSong ? `${this.currentSong.title} - ${this.currentSong.artist}` : "Unknown song",
      score: this.score,
      date: new Date().toISOString(),
    });
    localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(scores.sort((a, b) => b.score - a.score).slice(0, 25)));
    this.renderLeaderboard();
  }

  getScores() {
    return JSON.parse(localStorage.getItem(LEADERBOARD_KEY) || "[]");
  }

  renderLeaderboard() {
    const scores = this.getScores();
    this.leaderboard.innerHTML = scores.length
      ? scores.sort((a, b) => b.score - a.score).map((score) => `<li><strong>${score.player}</strong><span>${score.song}</span><em>${score.score}</em></li>`).join("")
      : "<li>No scores yet. Rabbie is waiting.</li>";
  }

  intensityFor(amplitude) {
    const range = RAVE_CONFIG.notes.loudThreshold - RAVE_CONFIG.notes.quietThreshold;
    return Math.max(0, Math.min(1, (amplitude - RAVE_CONFIG.notes.quietThreshold) / range));
  }

  lerp(start, end, amount) {
    return start + (end - start) * Math.max(0, Math.min(1, amount));
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const root = document.querySelector("[data-rave]");
  if (root) window.rabbiesRave = new RabbiesRave(root);
});
