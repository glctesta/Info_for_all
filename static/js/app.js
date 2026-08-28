'use strict';

// ===== STATE =====
let config = {};
let playlist = [];
let currentIndex = 0;
let rotationTimer = null;
let progressTimer = null;
let breakCheckTimer = null;
let isBreakActive = false;
let breakAudio = null;

// ===== INITIALIZATION =====
async function init() {
    await loadConfig();
    await buildPlaylist();
    startClock();
    startRotation();
    startBreakChecker();
}

// ===== CLOCK =====
function startClock() {
    const clockEl = document.getElementById('clock');
    function update() {
        const now = new Date();
        clockEl.textContent = now.toLocaleTimeString('it-IT', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
    }
    update();
    setInterval(update, 1000);
}

// ===== CONFIG LOADING =====
async function loadConfig() {
    try {
        const resp = await fetch('/api/config');
        config = await resp.json();
        document.documentElement.style.setProperty('--transition-duration', 
            (config.rotation?.transition_duration_ms || 1000) + 'ms');
        const container = document.getElementById('slide-container');
        container.className = 'transition-' + (config.rotation?.transition_effect || 'fade');
    } catch(e) {
        console.error('Errore nel caricamento della configurazione:', e);
    }
}

// ===== PLAYLIST =====
async function buildPlaylist() {
    playlist = [];
    
    // 1. Add monitor URLs
    try {
        const resp = await fetch('/api/monitors');
        const monitors = await resp.json();
        monitors.forEach(url => {
            playlist.push({type: 'monitor', url: url});
        });
    } catch(e) { console.error('Errore nel caricamento dei monitor:', e); }
    
    // 2. Add documents
    try {
        const resp = await fetch('/api/documents');
        const docs = await resp.json();
        docs.forEach(doc => {
            playlist.push({type: 'document', id: doc.id, title: doc.title || 'Document ' + doc.id});
        });
    } catch(e) { console.error('Errore nel caricamento dei documenti:', e); }
    
    if (playlist.length === 0) {
        const container = document.getElementById('slide-container');
        container.innerHTML = '<div class="slide active" style="display:flex;align-items:center;justify-content:center;font-size:24px;color:rgba(255,255,255,0.5);">Nessun contenuto disponibile</div>';
        return;
    }
    
    createSlides();
    createNavDots();
    showSlide(0);
}

// ===== SLIDES =====
function createSlides() {
    const container = document.getElementById('slide-container');
    container.innerHTML = '';
    
    playlist.forEach((item, i) => {
        const slide = document.createElement('div');
        slide.className = 'slide';
        slide.dataset.index = i;
        
        if (item.type === 'monitor') {
            const iframe = document.createElement('iframe');
            iframe.src = item.url;
            iframe.setAttribute('loading', 'lazy');
            iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms');
            slide.appendChild(iframe);
        } else if (item.type === 'document') {
            const iframe = document.createElement('iframe');
            iframe.src = '/api/documents/' + item.id + '/content';
            iframe.setAttribute('loading', 'lazy');
            slide.appendChild(iframe);
        }
        
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
            const duration = config.rotation?.transition_duration_ms || 1000;
            setTimeout(() => s.classList.remove('exiting'), duration);
        }
    });
    
    currentIndex = index;
    if (slides[currentIndex]) {
        slides[currentIndex].classList.add('active');
    }
    
    dots.forEach((d, i) => d.classList.toggle('active', i === currentIndex));
    
    startProgressBar();
}

function goToSlide(index) {
    if (isBreakActive) return;
    clearTimeout(rotationTimer);
    showSlide(index);
    scheduleNextSlide();
}

// ===== ROTATION =====
function startRotation() {
    if (playlist.length <= 1) return;
    scheduleNextSlide();
}

function scheduleNextSlide() {
    clearTimeout(rotationTimer);
    if (isBreakActive) return;
    
    const item = playlist[currentIndex];
    let interval;
    if (item && item.type === 'monitor') {
        interval = (config.rotation?.monitor_interval_seconds || 300) * 1000;
    } else {
        interval = (config.rotation?.slideshow_interval_seconds || 10) * 1000;
    }
    
    rotationTimer = setTimeout(() => {
        const nextIndex = (currentIndex + 1) % playlist.length;
        showSlide(nextIndex);
        scheduleNextSlide();
    }, interval);
}

// ===== PROGRESS BAR =====
function startProgressBar() {
    const bar = document.getElementById('progress-bar');
    if (!bar) return;
    
    const item = playlist[currentIndex];
    let interval;
    if (item && item.type === 'monitor') {
        interval = (config.rotation?.monitor_interval_seconds || 300) * 1000;
    } else {
        interval = (config.rotation?.slideshow_interval_seconds || 10) * 1000;
    }
    
    bar.style.transition = 'none';
    bar.style.width = '0%';
    
    bar.offsetHeight;
    
    bar.style.transition = 'width ' + interval + 'ms linear';
    bar.style.width = '100%';
}

// ===== BREAK CHECKER =====
function startBreakChecker() {
    const checkInterval = (config.breaks?.check_interval_seconds || 15) * 1000;
    checkBreak();
    breakCheckTimer = setInterval(checkBreak, checkInterval);
}

async function checkBreak() {
    try {
        const resp = await fetch('/api/breaks/current');
        const data = await resp.json();
        
        if (data.active && !isBreakActive) {
            activateBreak(data.break);
        } else if (!data.active && isBreakActive) {
            deactivateBreak();
        } else if (data.active && isBreakActive) {
            updateBreakCountdown(data.break);
        }
    } catch(e) {
        console.error('Errore nel controllo delle pause:', e);
    }
}

function activateBreak(brk) {
    isBreakActive = true;
    clearTimeout(rotationTimer);
    
    const overlay = document.getElementById('break-overlay');
    overlay.classList.remove('hidden', 'hiding');
    overlay.classList.add('showing');
    
    const typeEl = document.getElementById('break-type');
    if (brk.is_for_change_shift === 1) {
        typeEl.textContent = config.breaks?.shift_change_label || '🔄 Cambio Turno';
    } else {
        typeEl.textContent = config.breaks?.smoking_break_label || '🚬 Pausa Sigaretta';
    }
    
    const from = parseTime(brk.from_time);
    const to = parseTime(brk.to_time);
    const durationMin = Math.round((to - from) / 60000);
    document.getElementById('break-duration').textContent = 'Durata: ' + durationMin + ' minuti';
    document.getElementById('break-time-range').textContent = brk.from_time + ' → ' + brk.to_time;
    
    const textEl = document.getElementById('break-text');
    if (brk.text_to_show) {
        textEl.textContent = '"' + brk.text_to_show + '"';
        textEl.style.display = 'block';
    } else {
        textEl.style.display = 'none';
    }
    
    if (brk.has_sound) {
        playBreakSound(brk.id);
    }
    
    updateBreakClock();
    updateBreakCountdown(brk);
}

function deactivateBreak() {
    isBreakActive = false;
    
    const overlay = document.getElementById('break-overlay');
    overlay.classList.remove('showing');
    overlay.classList.add('hiding');
    
    setTimeout(() => {
        overlay.classList.add('hidden');
        overlay.classList.remove('hiding');
    }, 500);
    
    if (breakAudio) {
        breakAudio.pause();
        breakAudio = null;
    }
    
    scheduleNextSlide();
}

function updateBreakClock() {
    if (!isBreakActive) return;
    const clockEl = document.getElementById('break-clock');
    if (clockEl) {
        const now = new Date();
        clockEl.textContent = now.toLocaleTimeString('it-IT', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
    }
    setTimeout(updateBreakClock, 1000);
}

function updateBreakCountdown(brk) {
    const countdownEl = document.getElementById('break-countdown');
    if (!countdownEl) return;
    
    const now = new Date();
    const toTime = parseTime(brk.to_time);
    const diff = toTime - now;
    
    if (diff <= 0) {
        countdownEl.innerHTML = '⏳ Riprende tra: <span>00:00</span>';
        return;
    }
    
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    countdownEl.innerHTML = '⏳ Riprende tra: <span>' + 
        String(minutes).padStart(2, '0') + ':' + 
        String(seconds).padStart(2, '0') + '</span>';
}

function parseTime(timeStr) {
    const parts = timeStr.split(':');
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 
                    parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2] || 0));
}

function playBreakSound(breakId) {
    try {
        breakAudio = new Audio('/api/breaks/' + breakId + '/sound');
        breakAudio.play().catch(e => console.warn('Impossibile riprodurre l\'audio:', e));
    } catch(e) {
        console.error('Errore nella riproduzione dell\'audio della pausa:', e);
    }
}

// ===== START =====
document.addEventListener('DOMContentLoaded', init);
