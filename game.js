const RAVE_CONFIG = {
  // Sprite values crop the uploaded 4-row by 3-frame sheet without editing the source image.
  sprite: {
    path: "assets/rabbie-sprite.png",
    sheetWidth: 1536,
    sheetHeight: 1024,
    displayScale: 0.5,
    cropWidth: 190,
    cropHeight: 190,
    rowByDirection: { up: 0, down: 1, left: 2, right: 3 },
    frameCentersX: [512, 768, 1088],
    rowCentersY: [128, 384, 640, 896],
    frameDurationMs: 90,
  },
  // Note generation is live: loud audio lowers the spawn interval and adds occasional doubles.
  notes: {
    travelMs: 1850,
    baseSpawnMs: 760,
    loudSpawnMs: 310,
    quietThreshold: 0.08,
    loudThreshold: 0.26,
    missAfterMs: 210,
  },
  // Timing windows are in milliseconds. Loud sections tighten these slightly.
  timing: {
    perfectMs: 70,
    goodMs: 125,
    poorMs: 190,
    loudTightenMs: 22,
  },
  // Confidence reaches zero when Rabbie has had enough and the run ends immediately.
  confidence: {
    start: 100,
    perfect: 2,
    good: 1,
    poor: -6,
    bad: -12,
    miss: -15,
  },
  // Score values for each timing band.
  scoring: {
    perfect: 300,
    good: 170,
    poor: 70,
    bad: 20,
  },
  demoModeMs: 60000,
};

const DIRECTIONS = ["up", "down", "left", "right"];
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

    this.renderSongs();
    this.renderLeaderboard();
    this.applySpriteFrame("up", 0);
    this.bindEvents();
  }

  bindEvents() {
    this.root.addEventListener("click", (event) => {
      const actionButton = event.target.closest("[data-action]");
      const songButton = event.target.closest("[data-song]");
      const directionButton = event.target.closest("[data-direction]");

      if (actionButton) this.handleAction(actionButton.dataset.action);
      if (songButton) this.startSong(songButton.dataset.song);
      if (directionButton) this.hit(directionButton.dataset.direction);
    });

    this.root.querySelectorAll("[data-direction]").forEach((button) => {
      button.addEventListener("touchstart", (event) => {
        event.preventDefault();
        this.hit(button.dataset.direction);
      }, { passive: false });
    });

    document.addEventListener("keydown", (event) => {
      const directionByKey = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      };
      if (!directionByKey[event.key] || !this.running) return;
      event.preventDefault();
      this.hit(directionByKey[event.key]);
    });

    this.scoreForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(this.scoreForm);
      this.saveScore(formData.get("player"));
      this.scoreForm.reset();
      this.showView("leaderboard");
    });
  }

  handleAction(action) {
    const actionMap = {
      "show-menu": () => this.showView("menu"),
      "show-songs": () => this.showView("songs"),
      "show-leaderboard": () => {
        this.renderLeaderboard();
        this.showView("leaderboard");
      },
      "end-run": () => this.endRun("Run ended", false),
    };

    actionMap[action]?.();
  }

  showView(name) {
    this.views.forEach((view) => {
      view.classList.toggle("rave-view--active", view.dataset.view === name);
    });
  }

  renderSongs() {
    this.songList.innerHTML = this.songs
      .map(
        (song) => `
          <button class="song-card" type="button" data-song="${song.id}">
            <strong>${song.title}</strong>
            <span>${song.artist}</span>
            <small>${song.file}</small>
          </button>
        `,
      )
      .join("");
  }

  async startSong(songId) {
    this.currentSong = this.songs.find((song) => song.id === songId);
    if (!this.currentSong) return;

    this.resetRun();
    this.songEl.textContent = `${this.currentSong.title} - ${this.currentSong.artist}`;
    this.showView("game");
    this.startedAt = performance.now();
    this.running = true;

    try {
      await this.setupAudio(this.currentSong.file);
    } catch {
      this.stopAudio();
      this.showFeedback("Demo mode", "okay");
    }

    requestAnimationFrame((time) => this.loop(time));
  }

  resetRun() {
    this.stopAudio();
    this.notes.forEach((note) => note.el.remove());
    this.notes = [];
    this.score = 0;
    this.confidence = RAVE_CONFIG.confidence.start;
    this.lastSpawnAt = 0;
    this.scoreEl.textContent = "0";
    this.updateConfidence();
    this.applySpriteFrame("up", 0);
  }

  async setupAudio(file) {
    this.audio = new Audio(file);
    this.audio.crossOrigin = "anonymous";
    this.audio.preload = "auto";

    this.audioContext ||= new AudioContext();
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.sourceNode = this.audioContext.createMediaElementSource(this.audio);
    this.sourceNode.connect(this.analyser);
    this.analyser.connect(this.audioContext.destination);
    this.audio.addEventListener("ended", () => this.endRun("Run complete", true), { once: true });
    await this.audio.play();
  }

  stopAudio() {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
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

    const amplitude = this.getAmplitude(now);
    this.maybeSpawnNote(now, amplitude);
    this.updateNotes(now);
    this.checkMisses(now);

    if (!this.audio && now - this.startedAt > RAVE_CONFIG.demoModeMs) {
      this.endRun("Demo complete", true);
      return;
    }

    requestAnimationFrame((time) => this.loop(time));
  }

  getAmplitude(now) {
    if (!this.analyser || !this.frequencyData) {
      const beat = Math.sin((now - this.startedAt) / 170) * 0.5 + 0.5;
      return 0.1 + beat * 0.24;
    }

    this.analyser.getByteFrequencyData(this.frequencyData);
    const average = this.frequencyData.reduce((total, value) => total + value, 0) / this.frequencyData.length;
    return average / 255;
  }

  maybeSpawnNote(now, amplitude) {
    const intensity = this.getIntensity(amplitude);
    const spawnEvery = this.lerp(RAVE_CONFIG.notes.baseSpawnMs, RAVE_CONFIG.notes.loudSpawnMs, intensity);
    const enoughTime = now - this.lastSpawnAt > spawnEvery;
    const peakChance = amplitude > RAVE_CONFIG.notes.quietThreshold && Math.random() < 0.76;

    if (!enoughTime || !peakChance) return;

    this.spawnNote(DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)], now);
    this.lastSpawnAt = now;

    if (intensity > 0.82 && Math.random() < 0.28) {
      window.setTimeout(() => {
        if (this.running) this.spawnNote(DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)], performance.now());
      }, 150);
    }
  }

  spawnNote(direction, now) {
    const note = document.createElement("div");
    note.className = `falling-note falling-note--${direction}`;
    note.textContent = this.symbolFor(direction);
    note.dataset.direction = direction;
    this.playfield.appendChild(note);
    this.notes.push({
      id: crypto.randomUUID ? crypto.randomUUID() : `${now}-${Math.random()}`,
      direction,
      targetAt: now + RAVE_CONFIG.notes.travelMs,
      el: note,
      hit: false,
    });
  }

  updateNotes(now) {
    this.notes.forEach((note) => {
      const progress = 1 - (note.targetAt - now) / RAVE_CONFIG.notes.travelMs;
      note.el.style.transform = `translate3d(0, ${this.lerp(-18, 76, progress)}svh, 0)`;
      note.el.style.opacity = progress > 1.16 ? "0" : "1";
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
    const candidates = this.notes
      .filter((note) => note.direction === direction && !note.hit)
      .map((note) => ({ note, delta: Math.abs(now - note.targetAt) }))
      .sort((a, b) => a.delta - b.delta);

    const best = candidates[0];
    const window = this.getTimingWindow();

    if (!best || best.delta > window.bad) {
      this.changeConfidence(RAVE_CONFIG.confidence.bad);
      this.showFeedback("Bad", "bad");
      return;
    }

    best.note.hit = true;
    best.note.el.remove();

    if (best.delta <= window.perfect) {
      this.award("Perfect", "great", RAVE_CONFIG.scoring.perfect, RAVE_CONFIG.confidence.perfect);
    } else if (best.delta <= window.good) {
      this.award("Good", "okay", RAVE_CONFIG.scoring.good, RAVE_CONFIG.confidence.good);
    } else if (best.delta <= window.poor) {
      this.award("Early/Late", "poor", RAVE_CONFIG.scoring.poor, RAVE_CONFIG.confidence.poor);
    } else {
      this.award("Barely", "bad", RAVE_CONFIG.scoring.bad, RAVE_CONFIG.confidence.bad);
    }

    this.notes = this.notes.filter((note) => !note.hit);
  }

  getTimingWindow() {
    const amplitude = this.getAmplitude(performance.now());
    const tighten = this.getIntensity(amplitude) * RAVE_CONFIG.timing.loudTightenMs;
    return {
      perfect: RAVE_CONFIG.timing.perfectMs - tighten,
      good: RAVE_CONFIG.timing.goodMs - tighten,
      poor: RAVE_CONFIG.timing.poorMs - tighten,
      bad: RAVE_CONFIG.timing.poorMs + 55 - tighten,
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
    if (this.confidence === 0) {
      this.endRun("Confidence gone", false);
    }
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
    const frames = [0, 1, 2, 0];
    frames.forEach((frame, index) => {
      window.setTimeout(() => this.applySpriteFrame(direction, frame), index * RAVE_CONFIG.sprite.frameDurationMs);
    });
  }

  applySpriteFrame(direction, frame) {
    const sprite = RAVE_CONFIG.sprite;
    const scale = sprite.displayScale;
    const centerX = sprite.frameCentersX[frame] * scale;
    const centerY = sprite.rowCentersY[sprite.rowByDirection[direction]] * scale;
    const x = -(centerX - sprite.cropWidth / 2);
    const y = -(centerY - sprite.cropHeight / 2);

    this.rabbie.style.backgroundImage = `url("${sprite.path}")`;
    this.rabbie.style.backgroundSize = `${sprite.sheetWidth * scale}px ${sprite.sheetHeight * scale}px`;
    this.rabbie.style.backgroundPosition = `${x}px ${y}px`;
  }

  endRun(kicker, completed) {
    if (!this.running) return;

    this.running = false;
    this.stopAudio();
    this.notes.forEach((note) => note.el.remove());
    this.notes = [];
    this.resultKicker.textContent = kicker;
    this.finalScoreEl.textContent = String(this.score);
    this.resultCopy.textContent = completed
      ? "Rabbie finished with poise, dignity, and excellent footwork."
      : "Rabbie has left the floor, but the score still counts.";
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
    if (!scores.length) {
      this.leaderboard.innerHTML = "<li>No scores yet. Rabbie is waiting.</li>";
      return;
    }

    this.leaderboard.innerHTML = scores
      .sort((a, b) => b.score - a.score)
      .map(
        (score) => `
          <li>
            <strong>${score.player}</strong>
            <span>${score.song}</span>
            <em>${score.score}</em>
          </li>
        `,
      )
      .join("");
  }

  symbolFor(direction) {
    return { up: "↑", down: "↓", left: "←", right: "→" }[direction];
  }

  getIntensity(amplitude) {
    const range = RAVE_CONFIG.notes.loudThreshold - RAVE_CONFIG.notes.quietThreshold;
    return Math.max(0, Math.min(1, (amplitude - RAVE_CONFIG.notes.quietThreshold) / range));
  }

  lerp(start, end, amount) {
    return start + (end - start) * Math.max(0, Math.min(1, amount));
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const root = document.querySelector("[data-rave]");
  if (root) {
    window.rabbiesRave = new RabbiesRave(root);
  }
});
