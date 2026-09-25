/* ==========================================================
   1. MOTOR DE AUDIO (con respaldo de voz sintetizada)
   ========================================================== */
const AudioEngine = (() => {
  let isMuted = false;
  const synth = window.speechSynthesis;
  let spanishVoice = null;

  function pickSpanishVoice() {
    const voices = synth ? synth.getVoices() : [];
    spanishVoice = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('es')) || voices[0] || null;
  }
  if (synth) {
    pickSpanishVoice();
    synth.onvoiceschanged = pickSpanishVoice;
  }

  function speakText(text) {
    return new Promise((resolve) => {
      if (!synth || isMuted || !text) return resolve();
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'es-ES';
      if (spanishVoice) utter.voice = spanishVoice;
      utter.rate = 0.9;
      utter.onend = resolve;
      utter.onerror = resolve;
      synth.speak(utter);
    });
  }

  // Intenta el archivo mp3 grabado; si falta, cae a voz sintetizada diciendo el nombre de la letra
  function playLetter(char) {
    return new Promise((resolve) => {
      if (isMuted || !char) return resolve();
      const letter = char.toLowerCase();
      const audio = new Audio(`audios/alfabeto-letra-${letter}.mp3`);
      audio.onended = resolve;
      audio.onerror = () => speakText(char).then(resolve);
      audio.play().catch(() => speakText(char).then(resolve));
    });
  }

  async function spellWord(letters, highlightFn) {
    if (isMuted) return;
    for (let i = 0; i < letters.length; i++) {
      highlightFn(i);
      await playLetter(letters[i]);
      await new Promise(r => setTimeout(r, 250));
    }
    highlightFn(-1);
  }

  async function playFullWord(word, highlightFn) {
    if (isMuted || !word) return;
    // Resalta todas las casillas mientras se escucha la palabra completa
    if (highlightFn) highlightFn('all');
    await speakText(word);
    if (highlightFn) highlightFn(-1);
  }

  function speakInstruction(text) {
    return speakText(text);
  }

  return {
    toggleMute: () => { isMuted = !isMuted; if (isMuted && synth) synth.cancel(); return isMuted; },
    isMuted: () => isMuted,
    playLetter,
    spellWord,
    playFullWord,
    speakInstruction
  };
})();

/* ==========================================================
   2. BANCO DE PALABRAS
   ========================================================== */
const Storage = (() => {
  const KEY = 'app_magica_palabras';
  const initial = [{ word: 'CASA', instruction: 'Forma una palabra de cuatro letras', img: '' }];

  return {
    get: () => {
      try {
        const data = localStorage.getItem(KEY);
        const parsed = data ? JSON.parse(data) : [...initial];
        return Array.isArray(parsed) && parsed.length ? parsed : [...initial];
      } catch (e) { return [...initial]; }
    },
    set: (list) => {
      try { localStorage.setItem(KEY, JSON.stringify(list)); }
      catch (e) { console.warn('No se pudo guardar el banco de palabras:', e); }
    }
  };
})();

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 2200);
}


function sanitizeWord(raw) {
  return raw
    .toUpperCase()
    .replace(/[^A-ZÁÉÍÓÚÑ]/g, ''); // Permite letras mayúsculas y la Ñ de forma directa
}

/* ==========================================================
   3. LÓGICA DE LA INTERFAZ
   ========================================================== */
document.addEventListener('DOMContentLoaded', () => {
  let words = Storage.get();
  let currentIndex = 0;
  let activeIndex = 0;
  let userSlots = [];
  let hasCelebrated = false;

  const slotsContainer = document.getElementById('slotsContainer');
  const formedText = document.getElementById('formedText');
  const resultBox = document.getElementById('resultBox');
  const boxImg = document.getElementById('boxImg');
  const boxPlaceholder = document.getElementById('boxPlaceholder');
  const taskInstruction = document.getElementById('taskInstruction');
  const counter = document.getElementById('counter');
  const teacherModal = document.getElementById('teacherModal');
  const wordHint = document.getElementById('wordHint');

  const layout = [
    ['Q','W','E','R','T','Y','U','I','O','P'],
    ['A','S','D','F','G','H','J','K','L','Ñ'],
    ['Z','X','C','V','B','N','M']
  ];

  function buildKeyboard() {
    const kbContainer = document.getElementById('keyboardRows');
    kbContainer.innerHTML = '';
    layout.forEach(row => {
      const div = document.createElement('div');
      div.className = 'kb-row';
      row.forEach(char => {
        const btn = document.createElement('button');
        btn.className = 'key-btn';
        btn.textContent = char;
        btn.setAttribute('aria-label', `Letra ${char}`);
        btn.onclick = () => handleChar(char);
        div.appendChild(btn);
      });
      kbContainer.appendChild(div);
    });
  }

  function renderWord({ announce = true } = {}) {
    const current = words[currentIndex];
    counter.textContent = `${currentIndex + 1} / ${words.length}`;
    taskInstruction.textContent = current.instruction;
    hasCelebrated = false;
    resultBox.classList.remove('success');

    if (current.img) {
      boxImg.src = current.img;
      boxImg.style.display = 'block';
      boxImg.alt = `Imagen de la palabra ${current.word}`;
      boxPlaceholder.style.display = 'none';
    } else {
      boxImg.style.display = 'none';
      boxPlaceholder.textContent = current.word;
      boxPlaceholder.style.display = 'block';
    }

    userSlots = new Array(current.word.length).fill('');
    activeIndex = 0;
    renderSlots();
    updateFormed();

    // Lee la consigna en voz alta automáticamente al cambiar de palabra
    if (announce && !AudioEngine.isMuted()) {
      AudioEngine.speakInstruction(current.instruction);
    }
  }

  function renderSlots() {
    slotsContainer.innerHTML = '';
    userSlots.forEach((char, i) => {
      const col = document.createElement('div');
      col.className = 'slot-col';

      const slot = document.createElement('div');
      slot.className = `letter-slot ${i === activeIndex ? 'active' : ''}`;
      slot.textContent = char;
      slot.setAttribute('role', 'button');
      slot.setAttribute('tabindex', '0');
      slot.setAttribute('aria-label', char ? `Casilla ${i + 1}: letra ${char}` : `Casilla ${i + 1}: vacía`);
      slot.onclick = () => { activeIndex = i; renderSlots(); if (char) AudioEngine.playLetter(char); };
      slot.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); slot.onclick(); } };

      const btnListen = document.createElement('button');
      btnListen.className = 'btn-listen';
      btnListen.textContent = '🔊';
      btnListen.setAttribute('aria-label', `Escuchar letra en la casilla ${i + 1}`);
      btnListen.onclick = (e) => { e.stopPropagation(); AudioEngine.playLetter(userSlots[i] || words[currentIndex].word[i]); };

      col.appendChild(slot);
      col.appendChild(btnListen);
      slotsContainer.appendChild(col);
    });
  }

  function checkCompletion() {
    const target = words[currentIndex].word;
    const formed = userSlots.join('');
    if (formed === target && !hasCelebrated) {
      hasCelebrated = true;
      resultBox.classList.add('success');
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
    } else if (formed !== target) {
      resultBox.classList.remove('success');
      hasCelebrated = false;
    }
  }

  function handleChar(char) {
    if (activeIndex < userSlots.length) {
      userSlots[activeIndex] = char;
      AudioEngine.playLetter(char);
      if (activeIndex < userSlots.length - 1) activeIndex++;
      renderSlots();
      updateFormed();
      checkCompletion();
    }
  }

  function handleDel() {
    if (userSlots[activeIndex] !== '') userSlots[activeIndex] = '';
    else if (activeIndex > 0) { activeIndex--; userSlots[activeIndex] = ''; }
    renderSlots();
    updateFormed();
    checkCompletion();
  }

  function updateFormed() { formedText.textContent = userSlots.map(c => c || '_').join(' '); }

  document.getElementById('btnSound').onclick = (e) => {
    const isMuted = AudioEngine.toggleMute();
    e.target.textContent = isMuted ? '🔇 Sonido: OFF' : '🔊 Sonido: ON';
    e.target.setAttribute('aria-pressed', String(!isMuted));
  };

  document.getElementById('btnPrev').onclick = () => { currentIndex = (currentIndex > 0) ? currentIndex - 1 : words.length - 1; renderWord(); };
  document.getElementById('btnNext').onclick = () => { currentIndex = (currentIndex < words.length - 1) ? currentIndex + 1 : 0; renderWord(); };
  document.getElementById('btnClear').onclick = () => { userSlots.fill(''); activeIndex = 0; resultBox.classList.remove('success'); hasCelebrated = false; renderSlots(); updateFormed(); };
  document.getElementById('btnBackspace').onclick = handleDel;
  document.getElementById('btnHearInstruction').onclick = () => AudioEngine.speakInstruction(words[currentIndex].instruction);

  document.getElementById('btnSpeak').onclick = () => {
    const textToPlay = userSlots.some(c => c !== '') ? userSlots.join('') : words[currentIndex].word;
    AudioEngine.playFullWord(textToPlay, (idx) => {
      const items = slotsContainer.querySelectorAll('.letter-slot');
      items.forEach((item, i) => item.classList.toggle('active', idx === 'all' || i === idx));
    });
    checkCompletion();
  };

  document.getElementById('btnSpell').onclick = () => {
    const seq = (userSlots.some(c => c !== '') ? userSlots : words[currentIndex].word.split('')).filter(Boolean);
    AudioEngine.spellWord(seq, (idx) => {
      const items = slotsContainer.querySelectorAll('.letter-slot');
      items.forEach((item, i) => item.classList.toggle('active', i === idx));
    });
  };

  document.getElementById('btnTeacher').onclick = () => { renderTeacherList(); teacherModal.style.display = 'flex'; };
  document.getElementById('btnCloseModal').onclick = () => { teacherModal.style.display = 'none'; };
  teacherModal.addEventListener('click', (e) => { if (e.target === teacherModal) teacherModal.style.display = 'none'; });

  document.getElementById('inpWord').addEventListener('input', (e) => {
    const clean = sanitizeWord(e.target.value);
    if (clean !== e.target.value) e.target.value = clean;
    wordHint.textContent = clean.length ? `${clean.length} letra(s): ${clean}` : '';
  });

  document.getElementById('addWordForm').onsubmit = (e) => {
    e.preventDefault();
    const w = sanitizeWord(document.getElementById('inpWord').value.trim());
    const ins = document.getElementById('inpInstruction').value.trim();
    const file = document.getElementById('inpFile').files[0];

    if (!w) { showToast('Escribe una palabra válida (solo letras).'); return; }
    if (words.some(item => item.word === w)) { showToast('Esa palabra ya está en el banco.'); return; }

    const save = (imgStr) => {
      words.push({ word: w, instruction: ins, img: imgStr });
      Storage.set(words);
      e.target.reset();
      wordHint.textContent = '';
      renderTeacherList();
      currentIndex = words.length - 1;
      renderWord({ announce: false });
      showToast(`"${w}" guardada.`);
    };

    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => save(evt.target.result);
      reader.readAsDataURL(file);
    } else { save(''); }
  };

  document.getElementById('btnExport').onclick = () => {
    const blob = new Blob([JSON.stringify(words, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'banco-de-palabras.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  document.getElementById('inpImport').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const imported = JSON.parse(evt.target.result);
        if (!Array.isArray(imported) || !imported.every(it => it && typeof it.word === 'string')) {
          throw new Error('Formato inválido');
        }
        words = imported.map(it => ({
          word: sanitizeWord(it.word),
          instruction: typeof it.instruction === 'string' ? it.instruction : '',
          img: typeof it.img === 'string' ? it.img : ''
        })).filter(it => it.word);
        if (!words.length) words = [...[{ word: 'CASA', instruction: 'Forma una palabra', img: '' }]];
        Storage.set(words);
        currentIndex = 0;
        renderTeacherList();
        renderWord({ announce: false });
        showToast('Banco de palabras importado.');
      } catch (err) {
        showToast('No se pudo leer ese archivo.');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  function renderTeacherList() {
    const list = document.getElementById('savedWordsList');
    list.innerHTML = '';
    words.forEach((item, idx) => {
      const div = document.createElement('div');
      div.className = 'word-list-item';
      div.innerHTML = `
        <div>
          <strong style="font-family: 'Fredoka', sans-serif;">${item.word}</strong>
          <div style="font-size:0.8rem; color:#636e72;">${item.instruction}</div>
        </div>
        <button class="btn-delete" aria-label="Eliminar ${item.word}">Eliminar</button>
      `;
      div.querySelector('button').onclick = () => {
        words.splice(idx, 1);
        if (words.length === 0) words.push({ word: 'CASA', instruction: 'Forma una palabra', img: '' });
        Storage.set(words);
        if (currentIndex >= words.length) currentIndex = 0;
        renderTeacherList();
        renderWord({ announce: false });
      };
      list.appendChild(div);
    });
  }

  buildKeyboard();
  renderWord({ announce: false });
});