'use strict';

// ===================================================================
//  STATE
// ===================================================================
let config = {};
let playlist = [];
let currentIndex = 0;
let rotationTimer = null;
let breakCheckTimer = null;
let isBreakActive = false;
let currentPhase = null;
let breakAudio = null;
let shiftMusicStarted = false;
let shiftMusicTimer = null;
let clockInterval = null;
let analogClockInterval = null;

// ===================================================================
//  INITIALIZATION
// ===================================================================
async function init() {
    await loadConfig();
    buildClockMarkers();
    await buildPlaylist();
    startClock();
    startRotation();
    startBreakChecker();
}

// ===================================================================
//  DIGITAL CLOCK (header)
// ===================================================================
function startClock() {
    const clockEl = document.getElementById('clock');
    function update() {
        const now = new Date();
        clockEl.textContent = now.toLocaleTimeString('it-IT', {
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
    }
    update();
    setInterval(update, 1000);
}

// ===================================================================
//  ANALOG CLOCK (break overlay SVG)
// ===================================================================
function buildClockMarkers() {
    const g = document.getElementById('clock-markers');
    if (!g) return;
    const cx = 150, cy = 150;

    for (let i = 0; i < 60; i++) {
        const angle = (i * 6 - 90) * Math.PI / 180;
        const isHour = (i % 5 === 0);
        const outerR = 135;
        const innerR = isHour ? 120 : 128;
        const x1 = cx + outerR * Math.cos(angle);
        const y1 = cy + outerR * Math.sin(angle);
        const x2 = cx + innerR * Math.cos(angle);
        const y2 = cy + innerR * Math.sin(angle);

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('class', isHour ? 'clock-marker-hour' : 'clock-marker-minute');
        g.appendChild(line);

        // Numeri delle ore
        if (isHour) {
            const hourNum = (i / 5) || 12;
            const textR = 108;
            const tx = cx + textR * Math.cos(angle);
            const ty = cy + textR * Math.sin(angle);
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', tx);
            text.setAttribute('y', ty);
            text.setAttribute('class', 'clock-number');
            text.textContent = hourNum;
            g.appendChild(text);
        }
    }
}

function updateAnalogClock() {
    const now = new Date();
    const h = now.getHours() % 12;
    const m = now.getMinutes();
    const s = now.getSeconds();

    const hourAngle = (h * 30) + (m * 0.5) - 90;
    const minuteAngle = (m * 6) + (s * 0.1) - 90;
    const secondAngle = (s * 6) - 90;

    const cx = 150, cy = 150;

    // Lancetta ore
    setHand('hand-hour', cx, cy, 60, hourAngle);
    // Lancetta minuti
    setHand('hand-minute', cx, cy, 85, minuteAngle);
    // Lancetta secondi
    setHand('hand-second', cx, cy, 100, secondAngle);
}

function setHand(id, cx, cy, length, angleDeg) {
    const el = document.getElementById(id);
    if (!el) return;
    const rad = angleDeg * Math.PI / 180;
    const x2 = cx + length * Math.cos(rad);
    const y2 = cy + length * Math.sin(rad);
    el.setAttribute('x2', x2);
    el.setAttribute('y2', y2);
}

function startAnalogClock() {
    updateAnalogClock();
    if (analogClockInterval) clearInterval(analogClockInterval);
    analogClockInterval = setInterval(updateAnalogClock, 1000);
}

function stopAnalogClock() {
    if (analogClockInterval) {
        clearInterval(analogClockInterval);
        analogClockInterval = null;
    }
}

// ===================================================================
//  CONFIG LOADING
// ===================================================================
async function loadConfig() {
    try {
        const resp = await fetch('/api/config');
        config = await resp.json();
        document.documentElement.style.setProperty('--transition-duration',
            (config.rotation?.transition_duration_ms || 1000) + 'ms');
        const container = document.getElementById('slide-container');
        container.className = 'transition-' + (config.rotation?.transition_effect || 'fade');
    } catch (e) {
        console.error('Errore nel caricamento della configurazione:', e);
    }
}

// ===================================================================
//  PLAYLIST (monitor URLs + documenti)
// ===================================================================
async function buildPlaylist() {
    playlist = [];

    try {
        const resp = await fetch('/api/monitors');
        const monitors = await resp.json();
        monitors.forEach(url => playlist.push({ type: 'monitor', url }));
    } catch (e) { console.error('Errore nel caricamento dei monitor:', e); }

    try {
        const resp = await fetch('/api/documents');
        const docs = await resp.json();
        docs.forEach(doc => playlist.push({
            type: 'document', id: doc.id, title: doc.title || 'Documento ' + doc.id
        }));
    } catch (e) { console.error('Errore nel caricamento dei documenti:', e); }

    if (playlist.length === 0) {
        const container = document.getElementById('slide-container');
        container.innerHTML = '<div class="slide active" style="display:flex;align-items:center;justify-content:center;font-size:24px;color:rgba(255,255,255,0.5);">Nessun contenuto disponibile</div>';
        return;
    }

    createSlides();
    createNavDots();
    showSlide(0);
}

// ===================================================================
//  SLIDES
// ===================================================================
function createSlides() {
    const container = document.getElementById('slide-container');
    container.innerHTML = '';

    playlist.forEach((item, i) => {
        const slide = document.createElement('div');
        slide.className = 'slide';
        slide.dataset.index = i;

        const iframe = document.createElement('iframe');
        if (item.type === 'monitor') {
            iframe.src = item.url;
            iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms');
        } else {
            iframe.src = '/api/documents/' + item.id + '/content';
        }
        iframe.setAttribute('loading', 'lazy');
        slide.appendChild(iframe);
        container.appendChild(slide);
    });
}

function createNavDots() {
    const dotsContainer = document.getElementById('nav-dots');
    dotsContainer.innerHTML = '';
    playlist.forEach((_, i) => {
        const dot = document.createElement('div');
        dot.className = 'nav-dot';
        dot.addEventListener('click', () => goToSlide(i));
        dotsContainer.appendChild(dot);
    });
}

function showSlide(index) {
    if (playlist.length === 0) return;
    const slides = document.querySelectorAll('.slide');
    const dots = document.querySelectorAll('.nav-dot');

    slides.forEach(s => {
        if (s.classList.contains('active')) {
            s.classList.remove('active');
            s.classList.add('exiting');
            const dur = config.rotation?.transition_duration_ms || 1000;
            setTimeout(() => s.classList.remove('exiting'), dur);
        }
    });

    currentIndex = index;
    if (slides[currentIndex]) slides[currentIndex].classList.add('active');
    dots.forEach((d, i) => d.classList.toggle('active', i === currentIndex));
    startProgressBar();
}

function goToSlide(index) {
    if (isBreakActive) return;
    clearTimeout(rotationTimer);
    showSlide(index);
    scheduleNextSlide();
}

// ===================================================================
//  ROTATION
// ===================================================================
function startRotation() {
    if (playlist.length <= 1) return;
    scheduleNextSlide();
}

function scheduleNextSlide() {
    clearTimeout(rotationTimer);
    if (isBreakActive) return;

    const item = playlist[currentIndex];
    const interval = (item && item.type === 'monitor')
        ? (config.rotation?.monitor_interval_seconds || 300) * 1000
        : (config.rotation?.slideshow_interval_seconds || 10) * 1000;

    rotationTimer = setTimeout(() => {
        showSlide((currentIndex + 1) % playlist.length);
        scheduleNextSlide();
    }, interval);
}

// ===================================================================
//  PROGRESS BAR
// ===================================================================
function startProgressBar() {
    const bar = document.getElementById('progress-bar');
    if (!bar) return;

    const item = playlist[currentIndex];
    const interval = (item && item.type === 'monitor')
        ? (config.rotation?.monitor_interval_seconds || 300) * 1000
        : (config.rotation?.slideshow_interval_seconds || 10) * 1000;

    bar.style.transition = 'none';
    bar.style.width = '0%';
    bar.offsetHeight; // forza reflow
    bar.style.transition = 'width ' + interval + 'ms linear';
    bar.style.width = '100%';
}

// ===================================================================
//  BREAK CHECKER — Sistema a 5 fasi
// ===================================================================
//
//  Timeline di una pausa:
//  ─────────────────────────────────────────────────────────────
//  FromTime-30s    FromTime    FromTime+30s     ToTime-30s    ToTime    ToTime+30s
//       │             │             │               │           │           │
//       ├─ PRE_START ─┤─ ANNOUNCE  ─┤── DOCUMENT ──┤─ PRE_END ─┤─ ANNOUNCE ┤
//       │  Orologio + │  Reparti + │  Documento    │  Orologio+│  Reparti +│
//       │  countdown  │  suono     │  TextToshow   │  countdown│  suono    │
//       ─────────────────────────────────────────────────────────────────────
//

function startBreakChecker() {
    const checkInterval = (config.breaks?.check_interval_seconds || 5) * 1000;
    checkBreak();
    breakCheckTimer = setInterval(checkBreak, checkInterval);
}

async function checkBreak() {
    try {
        const resp = await fetch('/api/breaks/current');
        const data = await resp.json();

        if (data.active) {
            if (!isBreakActive) {
                activateBreak(data);
            } else {
                updateBreakPhase(data);
            }
        } else if (isBreakActive) {
            deactivateBreak();
        }
    } catch (e) {
        console.error('Errore nel controllo delle pause:', e);
    }
}

function activateBreak(data) {
    isBreakActive = true;
    clearTimeout(rotationTimer);

    const overlay = document.getElementById('break-overlay');
    overlay.classList.remove('hidden', 'hiding');
    overlay.classList.add('showing');

    showPhase(data);
}

function deactivateBreak() {
    isBreakActive = false;
    currentPhase = null;
    shiftMusicStarted = false;

    if (shiftMusicTimer) {
        clearTimeout(shiftMusicTimer);
        shiftMusicTimer = null;
    }

    stopAnalogClock();
    stopBreakSound();

    const overlay = document.getElementById('break-overlay');
    overlay.classList.remove('showing');
    overlay.classList.add('hiding');
    setTimeout(() => {
        overlay.classList.add('hidden');
        overlay.classList.remove('hiding');
        hideAllPhases();
    }, 500);

    scheduleNextSlide();
}

function updateBreakPhase(data) {
    // Se la fase è cambiata, aggiorna la visualizzazione
    if (data.phase !== currentPhase) {
        showPhase(data);
    } else {
        // Aggiorna solo il countdown
        if (data.phase === 'pre_start' || data.phase === 'pre_end') {
            updateClockCountdown(data.countdown);
        } else if (data.phase === 'shift_pre') {
            updateClockCountdown(data.countdown);
            // Avvia musica quando mancano N secondi (shift_music_advance)
            const musicAdv = data.shift_music_advance || 15;
            if (data.countdown <= musicAdv && !shiftMusicStarted && data.break.has_sound) {
                shiftMusicStarted = true;
                playShiftChangeSound(data.break.id, (data.shift_music_duration || 60) * 1000);
            }
        }
    }
}

function hideAllPhases() {
    document.getElementById('phase-clock')?.classList.add('hidden');
    document.getElementById('phase-announce')?.classList.add('hidden');
    document.getElementById('phase-document')?.classList.add('hidden');
}

function showPhase(data) {
    const brk = data.break;
    currentPhase = data.phase;
    hideAllPhases();

    switch (data.phase) {
        // ── Pause normali (5 fasi) ──
        case 'pre_start':
            showPhasePreStart(data.countdown);
            break;
        case 'announce_start':
            showPhaseAnnounce(brk, 'inizio');
            break;
        case 'document':
            showPhaseDocument(brk);
            break;
        case 'pre_end':
            showPhasePreEnd(data.countdown);
            break;
        case 'announce_end':
            showPhaseAnnounce(brk, 'fine');
            break;

        // ── Cambio turno (2 fasi) ──
        case 'shift_pre':
            showPhaseShiftPre(data);
            break;
        case 'shift_announce':
            showPhaseShiftAnnounce(data);
            break;
    }
}

// --- FASE 1: PRE_START (orologio + countdown) ---
function showPhasePreStart(countdown) {
    stopBreakSound();
    const panel = document.getElementById('phase-clock');
    panel.classList.remove('hidden');

    document.getElementById('phase-clock-label').textContent = 'Pausa tra...';
    updateClockCountdown(countdown);
    startAnalogClock();
}

// --- FASE 4: PRE_END (orologio + countdown) ---
function showPhasePreEnd(countdown) {
    stopBreakSound();
    const panel = document.getElementById('phase-clock');
    panel.classList.remove('hidden');

    document.getElementById('phase-clock-label').textContent = 'Fine pausa tra...';
    updateClockCountdown(countdown);
    startAnalogClock();
}

function updateClockCountdown(seconds) {
    const el = document.getElementById('clock-countdown');
    if (el) el.textContent = Math.max(0, Math.ceil(seconds));
}

// --- FASE 2 & 5: ANNUNCIO (reparti + suono) ---
function showPhaseAnnounce(brk, moment) {
    stopAnalogClock();
    const panel = document.getElementById('phase-announce');
    panel.classList.remove('hidden');

    // Tipo pausa
    const typeEl = document.getElementById('announce-type');
    if (brk.is_for_change_shift === 1) {
        typeEl.textContent = config.breaks?.shift_change_label || '🔄 Cambio Turno';
    } else {
        typeEl.textContent = config.breaks?.smoking_break_label || '🚬 Pausa Sigaretta';
    }

    // Fascia oraria
    document.getElementById('announce-time-range').textContent =
        brk.from_time + ' → ' + brk.to_time;

    // Reparti / sotto-reparti / funzioni
    const deptContainer = document.getElementById('announce-departments');
    deptContainer.innerHTML = '';

    if (brk.departments && brk.departments.length > 0) {
        brk.departments.forEach(dept => {
            const card = document.createElement('div');
            card.className = 'dept-card';

            let html = '';
            if (dept.id_cdc !== null && dept.id_cdc !== undefined) {
                html += '<div class="dept-label">Reparto</div>';
                html += '<div class="dept-value">' + escapeHtml(String(dept.id_cdc)) + '</div>';
            }
            if (dept.id_sub_cdc !== null && dept.id_sub_cdc !== undefined) {
                html += '<div class="dept-label">Sotto-Reparto</div>';
                html += '<div class="dept-value">' + escapeHtml(String(dept.id_sub_cdc)) + '</div>';
            }
            if (dept.function_id !== null && dept.function_id !== undefined) {
                html += '<div class="dept-label">Funzione</div>';
                html += '<div class="dept-value">' + escapeHtml(String(dept.function_id)) + '</div>';
            }

            card.innerHTML = html;
            deptContainer.appendChild(card);
        });
    }

    // Suono
    if (brk.has_sound) {
        playBreakSound(brk.id);
    }
}

// --- FASE 3: DOCUMENTO (TextToshow iframe) ---
function showPhaseDocument(brk) {
    stopAnalogClock();
    stopBreakSound();
    const panel = document.getElementById('phase-document');
    panel.classList.remove('hidden');

    const iframe = document.getElementById('break-document-frame');
    if (brk.has_document) {
        iframe.src = '/api/breaks/' + brk.id + '/document';
    } else {
        // Se non c'è documento, mostra un messaggio
        iframe.srcdoc = '<html><body style="display:flex;align-items:center;justify-content:center;height:100%;margin:0;background:#1a1a2e;color:white;font-family:Segoe UI,sans-serif;font-size:24px;">Pausa in corso</body></html>';
    }
}

// --- Cambio Turno: FASE shift_pre (orologio + countdown 5min + musica a -15s) ---
function showPhaseShiftPre(data) {
    const panel = document.getElementById('phase-clock');
    panel.classList.remove('hidden');

    document.getElementById('phase-clock-label').textContent = 'Cambio turno tra...';
    updateClockCountdown(data.countdown);
    startAnalogClock();

    // Avvia musica se mancano <= shift_music_advance secondi
    const musicAdv = data.shift_music_advance || 15;
    if (data.countdown <= musicAdv && !shiftMusicStarted && data.break.has_sound) {
        shiftMusicStarted = true;
        playShiftChangeSound(data.break.id, (data.shift_music_duration || 60) * 1000);
    }
}

// --- Cambio Turno: FASE shift_announce (reparti + musica continua) ---
function showPhaseShiftAnnounce(data) {
    stopAnalogClock();
    const brk = data.break;
    const panel = document.getElementById('phase-announce');
    panel.classList.remove('hidden');

    // Tipo
    document.getElementById('announce-type').textContent =
        config.breaks?.shift_change_label || '🔄 Cambio Turno';

    // Orario
    document.getElementById('announce-time-range').textContent =
        'Ore ' + brk.from_time;

    // Reparti
    const deptContainer = document.getElementById('announce-departments');
    deptContainer.innerHTML = '';
    if (brk.departments && brk.departments.length > 0) {
        brk.departments.forEach(dept => {
            const card = document.createElement('div');
            card.className = 'dept-card';
            let html = '';
            if (dept.id_cdc !== null && dept.id_cdc !== undefined) {
                html += '<div class="dept-label">Reparto</div>';
                html += '<div class="dept-value">' + escapeHtml(String(dept.id_cdc)) + '</div>';
            }
            if (dept.id_sub_cdc !== null && dept.id_sub_cdc !== undefined) {
                html += '<div class="dept-label">Sotto-Reparto</div>';
                html += '<div class="dept-value">' + escapeHtml(String(dept.id_sub_cdc)) + '</div>';
            }
            if (dept.function_id !== null && dept.function_id !== undefined) {
                html += '<div class="dept-label">Funzione</div>';
                html += '<div class="dept-value">' + escapeHtml(String(dept.function_id)) + '</div>';
            }
            card.innerHTML = html;
            deptContainer.appendChild(card);
        });
    }

    // La musica dovrebbe già essere partita da shift_pre;
    // se non è partita (es. entrata diretta in questa fase), avviala
    if (!shiftMusicStarted && brk.has_sound) {
        shiftMusicStarted = true;
        playShiftChangeSound(brk.id, (data.shift_music_duration || 60) * 1000);
    }
}

// ===================================================================
//  AUDIO
// ===================================================================
function playBreakSound(breakId) {
    stopBreakSound();
    try {
        breakAudio = new Audio('/api/breaks/' + breakId + '/sound');
        breakAudio.play().catch(e => console.warn('Impossibile riprodurre audio:', e));
    } catch (e) {
        console.error('Errore riproduzione audio:', e);
    }
}

function playShiftChangeSound(breakId, durationMs) {
    stopBreakSound();
    try {
        breakAudio = new Audio('/api/breaks/' + breakId + '/sound');
        breakAudio.loop = true;  // Ripeti se il brano è troppo corto
        breakAudio.play().catch(e => console.warn('Impossibile riprodurre audio:', e));

        // Ferma dopo la durata configurata (default 60s)
        shiftMusicTimer = setTimeout(() => {
            if (breakAudio) {
                breakAudio.loop = false;
                breakAudio.pause();
                breakAudio = null;
            }
            shiftMusicTimer = null;
        }, durationMs);
    } catch (e) {
        console.error('Errore riproduzione audio cambio turno:', e);
    }
}

function stopBreakSound() {
    if (breakAudio) {
        breakAudio.pause();
        breakAudio.currentTime = 0;
        breakAudio = null;
    }
}

// ===================================================================
//  UTILITY
// ===================================================================
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ===================================================================
//  START
// ===================================================================
document.addEventListener('DOMContentLoaded', init);
