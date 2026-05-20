// ========== Константы и ключи хранилища ==========
const STORAGE_KEYS = {
  STATE: "quiz.state.v1",
};
const DATA_URL = "./data/questions.json";

// ========== Модели ==========
/**
 * @typedef {{ id: string; text: string; options: string[]; correctIndex: number; topic?: string }} QuestionDTO
 * @typedef {{ title: string; timeLimitSec: number; passThreshold: number; questions: QuestionDTO[] }} QuizDTO
 */

class Question {
  /** @param {QuestionDTO} dto */
  constructor(dto) {
    this.id = dto.id;
    this.text = dto.text;
    this.options = dto.options;
    this.correctIndex = dto.correctIndex;
    this.topic = dto.topic ?? null;
  }
}

// ========== Сервисы ==========
class StorageService {
  static saveState(state) {
    localStorage.setItem(STORAGE_KEYS.STATE, JSON.stringify(state));
  }

  static loadState() {
    const state = JSON.parse(localStorage.getItem(STORAGE_KEYS.STATE));
    return state;
  }

  static clear() {
    localStorage.removeItem(STORAGE_KEYS.STATE);
  }
}

// ========== Движок теста ==========
class QuizEngine {
  /** @param {QuizDTO} quiz */
  constructor(quiz) {
    this.title = quiz.title;
    this.timeLimitSec = quiz.timeLimitSec;
    this.passThreshold = quiz.passThreshold;
    this.questions = this.shuffleQuestions(quiz.questions);

    this.currentIndex = quiz.currentIndex ?? 0;
    /** @type {Record<string, number|undefined>} */
    this.answers = quiz.answers ?? {}; // questionId -> selectedIndex
    this.remainingSec = quiz.remainingSec ?? quiz.timeLimitSec;
    this.isFinished = quiz.isFinished ?? false;
  }

  get length() {
    return this.questions.length;
  }
  get currentQuestion() {
    return this.questions[this.currentIndex];
  }
  get answeredQuestionCount() {
    return Object.keys(this.answers).length;
  }

  /** @param {number} index */
  goTo(index) {
    if (index < 0 || index >= this.questions.length) return;
    this.currentIndex = index;
  }

  next() {
    if (this.currentIndex === this.questions.length - 1) return;
    this.currentIndex++;
  }

  prev() {
    if (this.currentIndex === 0) return;
    this.currentIndex--;
  }

  /** @param {number} optionIndex */
  select(optionIndex) {
    if (optionIndex < 0 || optionIndex >= this.currentQuestion.options.length)
      return;
    this.answers[this.currentQuestion.id] = optionIndex;
  }

  getSelectedIndex() {
    return this.answers[this.currentQuestion.id];
  }

  tick() {
    if (this.isFinished || this.remainingSec <= 0) return false;

    this.remainingSec--;
    return this.remainingSec > 0;
  }

  finish() {
    this.isFinished = true;

    const correct = this.questions.reduce(
      (acc, q) => acc + Number(this.answers[q.id] === q.correctIndex),
      0,
    );
    const total = this.questions.length;
    const percent = correct / total;
    const passed = percent >= this.passThreshold;
    return { correct, total, percent, passed };
  }

  /** @returns {Question[]} */
  shuffleQuestions(questions) {
    const shuffled = questions.map((q) => new Question(q));
    for (let i = shuffled.length - 1; i >= 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      shuffled[i].options = this.shuffleOptions(shuffled[i].options);
    }
    console.log(shuffled);
    return shuffled;
  }

  /** @returns {{text: string, idx: number}[]} */
  shuffleOptions(options) {
    const shuffled = options.map((opt, i) => ({ text: opt, idx: i }));
    for (let i = shuffled.length - 1; i >= 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /** Восстановление/выгрузка состояния для localStorage */
  toState() {
    return {
      currentIndex: this.currentIndex,
      answers: this.answers,
      remainingSec: this.remainingSec,
      isFinished: this.isFinished,
    };
  }

  /** @param {any} state */
  static fromState(quiz, state) {
    return new QuizEngine({ ...quiz, ...state });
  }
}

// ========== DOM-утилиты ==========
const $ = (sel) => /** @type {HTMLElement} */ (document.querySelector(sel));
const els = {
  title: $("#quiz-title"),
  progress: $("#progress"),
  timer: $("#timer"),
  qSection: $("#question-section"),
  qText: $("#question-text"),
  form: $("#options-form"),
  btnPrev: $("#btn-prev"),
  btnNext: $("#btn-next"),
  btnFinish: $("#btn-finish"),
  result: $("#result-section"),
  resultSummary: $("#result-summary"),
  btnReview: $("#btn-review"),
  btnRestart: $("#btn-restart"),
};

let engine = /** @type {QuizEngine|null} */ (null);
let timerId = /** @type {number|undefined} */ (undefined);
let reviewMode = false;

// ========== Инициализация ==========
document.addEventListener("DOMContentLoaded", async () => {
  const quiz = await loadQuiz();
  els.title.textContent = quiz.title;

  const saved = StorageService.loadState?.(); // заглушка
  if (saved) {
    engine = QuizEngine.fromState(quiz, saved);
  } else {
    engine = new QuizEngine(quiz);
  }

  bindEvents();
  renderAll();

  if (engine.isFinished) {
    renderResult(engine.finish());
  } else {
    startTimer();
  }
});

async function loadQuiz() {
  // Загружаем JSON с вопросами
  const res = await fetch(DATA_URL);
  /** @type {QuizDTO} */
  const data = await res.json();
  // Простейшая валидация формата (можно расширить)
  if (!data?.questions?.length) {
    throw new Error("Некорректные данные теста");
  }
  return data;
}

// ========== Таймер ==========
function startTimer() {
  stopTimer();
  timerId = window.setInterval(() => {
    try {
      const isActive = engine.tick();
      persist();
      renderTimer();

      if (!isActive) {
        finishQuiz();
      }
    } catch (e) {
      // До реализации tick() попадём сюда — это нормально для шаблона.
      stopTimer();
    }
  }, 1000);
}
function stopTimer() {
  if (timerId) {
    clearInterval(timerId);
    timerId = undefined;
  }
}
function finishQuiz() {
  const summary = safeCall(() => engine.finish());
  if (summary) {
    stopTimer();
    renderAll();
    renderResult(summary);
    persist();
  }
}

// ========== События ==========
function bindEvents() {
  els.btnPrev.addEventListener("click", () => {
    safeCall(() => engine.prev());
    persist();
    renderAll();
  });

  els.btnNext.addEventListener("click", () => {
    safeCall(() => engine.next());
    persist();
    renderAll();
  });

  els.btnFinish.addEventListener("click", () => {
    finishQuiz();
  });

  els.btnReview.addEventListener("click", () => {
    reviewMode = true;
    renderAll();
  });

  els.btnRestart.addEventListener("click", () => {
    StorageService.clear?.();
    window.location.reload();
  });

  els.form.addEventListener("change", (e) => {
    const target = /** @type {HTMLInputElement} */ (e.target);
    if (target?.name === "option") {
      const idx = Number(target.value);
      safeCall(() => engine.select(idx));
      persist();
      renderNav();
    }
  });
}

function safeCall(fn) {
  try {
    return fn?.();
  } catch {
    /* noop в шаблоне */
  }
}

// ========== Рендер ==========
function renderAll() {
  renderProgress();
  renderTimer();
  renderQuestion();
  renderNav();
}

function renderProgress() {
  els.progress.textContent = `Вопрос ${engine.currentIndex + 1} из ${
    engine.length
  }`;
}

function renderTimer() {
  const sec = engine.remainingSec ?? 0;
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  els.timer.textContent = `${m}:${s}`;
}

function renderQuestion() {
  const q = engine.currentQuestion;
  els.qText.textContent = q.text;

  els.form.innerHTML = "";

  q.options.forEach((opt, i) => {
    const id = `opt-${q.id}-${i}`;
    const wrapper = document.createElement("label");
    wrapper.className = "option";
    if (reviewMode) {
      const chosen = engine.answers[q.id];
      if (opt.idx === q.correctIndex) wrapper.classList.add("correct");
      if (chosen === opt.idx && opt.idx !== q.correctIndex)
        wrapper.classList.add("incorrect");
    }

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "option";
    input.value = String(opt.idx);
    input.id = id;
    input.checked = engine.getSelectedIndex?.() === opt.idx;
    input.disabled = engine.isFinished;

    const span = document.createElement("span");
    span.textContent = opt.text;

    wrapper.appendChild(input);
    wrapper.appendChild(span);
    els.form.appendChild(wrapper);
  });
}

function renderNav() {
  const hasSelection = Number.isInteger(engine.getSelectedIndex?.());
  els.btnPrev.disabled = engine.currentIndex === 0;
  els.btnNext.disabled = !(
    engine.currentIndex < engine.length - 1 && hasSelection
  );
  els.btnFinish.disabled =
    !(engine.answeredQuestionCount === engine.length) || engine.isFinished;
}

function renderResult(summary) {
  els.result.classList.remove("hidden");
  const pct = Math.round(summary.percent * 100);
  const status = summary.passed ? "Пройден" : "Не пройден";
  els.resultSummary.textContent = `${summary.correct} / ${summary.total} (${pct}%) — ${status}`;
}

// ========== Persist ==========
function persist() {
  try {
    const snapshot = engine.toState?.();
    if (snapshot) StorageService.saveState(snapshot);
  } catch {
    /* noop в шаблоне */
  }
}
