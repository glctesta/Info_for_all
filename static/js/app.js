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
let monitorName = '';
let docAlternateTimer = null;
let showingDocPdf = true;
let deptCarouselTimers = {};

// ===================================================================
//  INITIALIZATION
// ===================================================================
async function init() {
    const params = new URLSearchParams(window.location.search);
    monitorName = params.get('monitor') || '';
    console.log('Monitor:', monitorName || '(default)');

    // Mostra nome monitor nel footer
    const footerName = document.getElementById('footer-monitor-name');
    if (footerName && monitorName) footerName.textContent = monitorName;

    await loadConfig();
    buildClockMarkers();
    await buildPlaylist();
    startClock();
    startRotation();
    startBreakChecker();
    startConfigReloader();
}

// ===================================================================
//  CONFIG HOT-RELOAD (ogni 2 minuti)
// ===================================================================
let lastPlaylistJson = '';

function startConfigReloader() {
    const intervalMs = (config.rotation?.config_reload_seconds || 120) * 1000;
    setInterval(async () => {
        if (isBreakActive) return; // Non ricaricare durante una pausa
        try {
            await loadConfig();
            const oldJson = lastPlaylistJson;
            await buildPlaylist(true); // true = silent, non resettare slide se non cambiato
            if (lastPlaylistJson !== oldJson) {
                console.log('Playlist aggiornata dal server.');
                showSlide(0);
                scheduleNextSlide();
            }
        } catch (e) { console.error('Errore nel reload config:', e); }
    }, intervalMs);
}

function apiUrl(path) {
    return monitorName ? path + '?monitor=' + encodeURIComponent(monitorName) : path;
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
        const outerR = 135, innerR = isHour ? 120 : 128;
        const x1 = cx + outerR * Math.cos(angle), y1 = cy + outerR * Math.sin(angle);
        const x2 = cx + innerR * Math.cos(angle), y2 = cy + innerR * Math.sin(angle);

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1); line.setAttribute('y1', y1);
        line.setAttribute('x2', x2); line.setAttribute('y2', y2);
        line.setAttribute('class', isHour ? 'clock-marker-hour' : 'clock-marker-minute');
        g.appendChild(line);

        if (isHour) {
            const hourNum = (i / 5) || 12;
            const textR = 108;
            const tx = cx + textR * Math.cos(angle), ty = cy + textR * Math.sin(angle);
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', tx); text.setAttribute('y', ty);
            text.setAttribute('class', 'clock-number');
            text.textContent = hourNum;
            g.appendChild(text);
        }
    }
}

function updateAnalogClock() {
    const now = new Date();
    const h = now.getHours() % 12, m = now.getMinutes(), s = now.getSeconds();
    const cx = 150, cy = 150;
    setHand('hand-hour', cx, cy, 60, (h * 30) + (m * 0.5) - 90);
    setHand('hand-minute', cx, cy, 85, (m * 6) + (s * 0.1) - 90);
    setHand('hand-second', cx, cy, 100, (s * 6) - 90);
}

function setHand(id, cx, cy, length, angleDeg) {
    const el = document.getElementById(id);
    if (!el) return;
    const rad = angleDeg * Math.PI / 180;
    el.setAttribute('x2', cx + length * Math.cos(rad));
    el.setAttribute('y2', cy + length * Math.sin(rad));
}

function startAnalogClock() {
    updateAnalogClock();
    if (analogClockInterval) clearInterval(analogClockInterval);
    analogClockInterval = setInterval(updateAnalogClock, 1000);
}

function stopAnalogClock() {
    if (analogClockInterval) { clearInterval(analogClockInterval); analogClockInterval = null; }
}

// ===================================================================
//  CONFIG
// ===================================================================
async function loadConfig() {
    try {
        const resp = await fetch(apiUrl('/api/config'));
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
//  PLAYLIST
// ===================================================================
async function buildPlaylist(silent) {
    const newPlaylist = [];
    try {
        const resp = await fetch(apiUrl('/api/monitors'));
        const monitors = await resp.json();
        monitors.forEach(url => newPlaylist.push({ type: 'monitor', url }));
    } catch (e) { console.error('Errore caricamento monitor:', e); }

    const newJson = JSON.stringify(newPlaylist);

    // Se silent e la playlist non è cambiata, non ricostruire il DOM
    if (silent && newJson === lastPlaylistJson) return;

    playlist = newPlaylist;
    lastPlaylistJson = newJson;

    if (playlist.length === 0) {
        document.getElementById('slide-container').innerHTML =
            '<div class="slide active" style="display:flex;align-items:center;justify-content:center;font-size:24px;color:rgba(255,255,255,0.5);">Nessun contenuto disponibile</div>';
        return;
    }
    createSlides();
    createNavDots();
    if (!silent) showSlide(0);
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

    // La slide vecchia diventa "exiting" (fade out sotto)
    slides.forEach(s => {
        if (s.classList.contains('active')) {
            s.classList.remove('active');
            s.classList.add('exiting');
            setTimeout(() => s.classList.remove('exiting'), 1000);
        }
    });

    // La nuova slide diventa active (fade in sopra)
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
function startRotation() { if (playlist.length <= 1) return; scheduleNextSlide(); }

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
    bar.offsetHeight;
    bar.style.transition = 'width ' + interval + 'ms linear';
    bar.style.width = '100%';
}

// ===================================================================
//  BREAK CHECKER — Sistema a 5 fasi + cambio turno
// ===================================================================
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
            if (!isBreakActive) activateBreak(data);
            else updateBreakPhase(data);
        } else if (isBreakActive) {
            deactivateBreak();
        }
    } catch (e) { console.error('Errore controllo pause:', e); }
}

const OVERLAY_EFFECTS = ['anim-fade', 'anim-zoom', 'anim-blur', 'anim-slide', 'anim-rotate', 'anim-curtain', 'anim-diamond', 'anim-puzzle'];
let currentOverlayEffect = '';

function pickRandomEffect() {
    return OVERLAY_EFFECTS[Math.floor(Math.random() * OVERLAY_EFFECTS.length)];
}

function clearOverlayEffects(overlay) {
    OVERLAY_EFFECTS.forEach(cls => overlay.classList.remove(cls));
    overlay.classList.remove('showing', 'hiding');
    // Rimuovi griglia puzzle se presente
    const grid = overlay.querySelector('.puzzle-grid');
    if (grid) grid.remove();
}

function createPuzzleGrid(overlay) {
    const grid = document.createElement('div');
    grid.className = 'puzzle-grid';
    const cols = 5, rows = 4;
    const totalTiles = cols * rows;
    // Ordine casuale per lo stagger
    const indices = Array.from({length: totalTiles}, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    for (let i = 0; i < totalTiles; i++) {
        const tile = document.createElement('div');
        tile.className = 'puzzle-tile';
        const delay = indices.indexOf(i) * 60; // stagger casuale
        tile.style.animationDelay = delay + 'ms';
        grid.appendChild(tile);
    }
    overlay.appendChild(grid);
    // Rimuovi la griglia dopo l'animazione
    setTimeout(() => grid.remove(), totalTiles * 60 + 600);
}

function activateBreak(data) {
    isBreakActive = true;
    clearTimeout(rotationTimer);
    const overlay = document.getElementById('break-overlay');
    clearOverlayEffects(overlay);
    overlay.classList.remove('hidden');

    currentOverlayEffect = pickRandomEffect();
    console.log('Effetto transizione:', currentOverlayEffect);

    if (currentOverlayEffect === 'anim-puzzle') {
        overlay.classList.add('anim-fade'); // fade base per il contenuto
        createPuzzleGrid(overlay);
    } else {
        overlay.classList.add(currentOverlayEffect);
    }

    showPhase(data);
}

function deactivateBreak() {
    isBreakActive = false;
    currentPhase = null;
    shiftMusicStarted = false;
    if (shiftMusicTimer) { clearTimeout(shiftMusicTimer); shiftMusicTimer = null; }
    if (docAlternateTimer) { clearInterval(docAlternateTimer); docAlternateTimer = null; }
    // Ferma carousel reparti
    Object.keys(deptCarouselTimers).forEach(k => {
        clearInterval(deptCarouselTimers[k]);
    });
    deptCarouselTimers = {};
    stopAnalogClock();
    stopBreakSound();

    const overlay = document.getElementById('break-overlay');
    clearOverlayEffects(overlay);
    overlay.classList.add('hiding');
    setTimeout(() => {
        overlay.classList.add('hidden');
        clearOverlayEffects(overlay);
        hideAllPhases();
    }, 600);
    scheduleNextSlide();
}

function updateBreakPhase(data) {
    if (data.phase !== currentPhase) {
        showPhase(data);
    } else {
        if (data.phase === 'pre_start' || data.phase === 'pre_end') {
            updateClockCountdown(data.countdown);
        } else if (data.phase === 'document') {
            // Aggiorna countdown rimanente durante la fase documento
            updateDocCountdown(data.remaining);
        } else if (data.phase === 'shift_pre') {
            updateClockCountdown(data.countdown);
            const musicAdv = data.shift_music_advance || 15;
            if (data.countdown <= musicAdv && !shiftMusicStarted && data.break.has_sound) {
                shiftMusicStarted = true;
                playShiftChangeSound(data.break, (data.shift_music_duration || 60) * 1000);
            }
        }
    }
}

function hideAllPhases() {
    document.getElementById('phase-clock')?.classList.add('hidden');
    document.getElementById('phase-announce')?.classList.add('hidden');
    document.getElementById('phase-break-end')?.classList.add('hidden');
    document.getElementById('phase-document')?.classList.add('hidden');
}

function showPhase(data) {
    const brk = data.break;
    currentPhase = data.phase;
    hideAllPhases();
    if (docAlternateTimer) { clearInterval(docAlternateTimer); docAlternateTimer = null; }

    switch (data.phase) {
        case 'pre_start':    showPhaseClock(data, 'Pauză în...'); break;
        case 'announce_start': showPhaseAnnounce(brk, data); break;
        case 'document':     showPhaseDocument(data); break;
        case 'pre_end':      showPhaseClock(data, 'Sfârșitul pauzei în...'); break;
        case 'announce_end': showPhaseBreakEnd(data); break;
        case 'shift_pre':    showPhaseShiftPre(data); break;
        case 'shift_announce': showPhaseShiftAnnounce(data); break;
    }
}

// ===================================================================
//  REASON HELPERS
// ===================================================================

function getReasonEmoji(reason) {
    const r = (reason || '').toLowerCase();
    if (r.includes('pran') || r.includes('masa') || r.includes('lunch') || r.includes('mensa'))
        return '🍝';
    if (r.includes('sigar') || r.includes('fumar') || r.includes('tigar') || r.includes('smok'))
        return '🚬';
    if (r.includes('schimb') || r.includes('turno') || r.includes('shift'))
        return '🔄';
    return '⏸️';
}

function getReasonMessage(reason) {
    const r = (reason || '').toLowerCase();
    if (r.includes('pran') || r.includes('masa') || r.includes('lunch') || r.includes('mensa'))
        return '<div class="reason-fun reason-lunch">🍝 Poftă bună tuturor! 🍕</div>';
    if (r.includes('sigar') || r.includes('fumar') || r.includes('tigar') || r.includes('smok'))
        return '<div class="reason-fun reason-smoke">' +
            '<div class="smoke-warning">🚭</div>' +
            '<div class="smoke-msg">Știați? Fiecare țigară în minus este un cadou pentru sănătatea ta!</div>' +
            '<div class="smoke-sub">Corpul tău începe să se regenereze după doar 20 de minute de la ultima țigară.</div>' +
            '</div>';
    return '';
}

function formatCountdown(totalSeconds) {
    const secs = Math.max(0, Math.ceil(totalSeconds));
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    if (m > 0) return m + ':' + String(s).padStart(2, '0');
    return String(s);
}

function buildSoundUrl(brk) {
    return '/api/breaks/sound?from=' + encodeURIComponent(brk.from_time)
         + '&to=' + encodeURIComponent(brk.to_time)
         + '&shift=' + encodeURIComponent(brk.shift);
}

function buildDocUrl(brk) {
    return '/api/breaks/document?from=' + encodeURIComponent(brk.from_time)
         + '&to=' + encodeURIComponent(brk.to_time)
         + '&shift=' + encodeURIComponent(brk.shift)
         + '#toolbar=0&navpanes=0&scrollbar=0';
}

// ===================================================================
//  FASE 1 & 4: OROLOGIO + COUNTDOWN + REPARTI SCORREVOLI
// ===================================================================
function showPhaseClock(data, label) {
    stopBreakSound();
    const panel = document.getElementById('phase-clock');
    panel.classList.remove('hidden');
    document.getElementById('phase-clock-label').textContent = label;
    updateClockCountdown(data.countdown);
    startAnalogClock();

    // Suono gong
    playGong();

    // Reparti scorrevoli
    const brk = data.break;
    const track = document.getElementById('clock-departments-track');
    if (track && brk && brk.departments && brk.departments.length > 0) {
        const items = brk.departments.map(d => {
            let text = d.cdc || '';
            if (d.sub_cdc) text += ' — ' + d.sub_cdc;
            return text;
        }).filter(t => t);
        // Duplica per loop continuo
        const joined = items.join('     ★     ');
        track.textContent = joined + '     ★     ' + joined;
        // Reset animazione
        track.style.animation = 'none';
        track.offsetHeight; // force reflow
        const duration = Math.max(15, items.length * 4);
        track.style.animation = 'tickerScroll ' + duration + 's linear infinite';
        document.getElementById('clock-departments').style.display = 'block';
    } else {
        document.getElementById('clock-departments').style.display = 'none';
    }
}

function playGong() {
    try {
        const gong = document.getElementById('gong-audio');
        if (gong) {
            gong.currentTime = 0;
            gong.play().catch(e => console.warn('Gong non disponibile:', e));
        }
    } catch (e) { /* ignore */ }
}

function updateClockCountdown(seconds) {
    const el = document.getElementById('clock-countdown');
    if (el) el.textContent = formatCountdown(seconds);
}

// ===================================================================
//  FASE 2 & 5: ANNUNCIO (reparti + motivo + immagine + suono)
// ===================================================================
function showPhaseAnnounce(brk, data) {
    stopAnalogClock();
    const panel = document.getElementById('phase-announce');
    panel.classList.remove('hidden');

    const imgEl = document.getElementById('announce-reason-image');
    imgEl.innerHTML = '<span class="reason-emoji">' + getReasonEmoji(brk.reason) + '</span>';

    const typeEl = document.getElementById('announce-type');
    typeEl.textContent = brk.reason || 'Pauză';

    const reasonEl = document.getElementById('announce-reason');
    reasonEl.innerHTML = getReasonMessage(brk.reason);

    document.getElementById('announce-time-range').textContent =
        brk.from_time + ' → ' + brk.to_time;

    buildDepartmentCards('announce-departments', brk.departments);

    // Suono con durata dal config server
    if (brk.has_sound) {
        const dur = (data.break_sound_duration || 30) * 1000;
        playBreakSound(brk, dur);
    }
}

// ===================================================================
//  FASE 3: DOCUMENTO con countdown + alternanza reparti
// ===================================================================
function showPhaseDocument(data) {
    const brk = data.break;
    stopAnalogClock();
    stopBreakSound();
    const panel = document.getElementById('phase-document');
    panel.classList.remove('hidden');

    const pdfView = document.getElementById('doc-pdf-view');
    const deptView = document.getElementById('doc-dept-view');

    // Prepara vista PDF
    const iframe = document.getElementById('break-document-frame');
    if (brk.has_document) {
        iframe.src = buildDocUrl(brk);
    } else {
        iframe.srcdoc = '<html><body style="display:flex;align-items:center;justify-content:center;height:100%;margin:0;background:#1a1a2e;color:white;font-family:Segoe UI,sans-serif;font-size:24px;">Pauză în curs</body></html>';
    }

    // Countdown sovrapposto
    updateDocCountdown(data.remaining);

    // Prepara vista reparti alternata
    const reasonImg = document.getElementById('doc-reason-image');
    reasonImg.innerHTML = '<span class="reason-emoji-sm">' + getReasonEmoji(brk.reason) + '</span>';
    const reasonText = document.getElementById('doc-reason-text');
    reasonText.innerHTML = '<div class="doc-reason-title">' + escapeHtml(brk.reason || 'Pauză') + '</div>'
                         + getReasonMessage(brk.reason);
    buildDepartmentCards('doc-departments', brk.departments);

    // Mostra prima il PDF
    showingDocPdf = true;
    pdfView.classList.remove('hidden');
    deptView.classList.add('hidden');

    // Alterna con intervallo dal config
    const altInterval = (data.doc_alternate_seconds || 10) * 1000;
    docAlternateTimer = setInterval(() => {
        showingDocPdf = !showingDocPdf;
        if (showingDocPdf) {
            pdfView.classList.remove('hidden');
            deptView.classList.add('hidden');
        } else {
            pdfView.classList.add('hidden');
            deptView.classList.remove('hidden');
        }
    }, altInterval);
}

function updateDocCountdown(seconds) {
    const el = document.getElementById('doc-countdown');
    if (el) el.textContent = 'Sfârșitul pauzei: ' + formatCountdown(seconds);
}

// ===================================================================
//  FASE 5: FINE PAUSA — messaggio chiaro
// ===================================================================
function showPhaseBreakEnd(data) {
    stopAnalogClock();
    stopBreakSound();
    playGong();

    const panel = document.getElementById('phase-break-end');
    panel.classList.remove('hidden');

    // Prossima pausa
    const nextEl = document.getElementById('break-end-next');
    if (data.next_break) {
        const nb = data.next_break;
        nextEl.innerHTML =
            '<div class="next-break-label">Următoarea pauză:</div>' +
            '<div class="next-break-info">' +
                '<span class="next-break-reason">' + escapeHtml(nb.reason || 'Pauză') + '</span>' +
                ' — ' +
                '<span class="next-break-time">' + nb.from_time + ' → ' + nb.to_time + '</span>' +
            '</div>';
    } else {
        nextEl.innerHTML = '<div class="next-break-label">Nu mai sunt pauze programate pentru acest schimb.</div>';
    }
}

// ===================================================================
//  CAMBIO TURNO
// ===================================================================
function showPhaseShiftPre(data) {
    const panel = document.getElementById('phase-clock');
    panel.classList.remove('hidden');
    document.getElementById('phase-clock-label').textContent = 'Schimb de tură în...';
    updateClockCountdown(data.countdown);
    startAnalogClock();

    const musicAdv = data.shift_music_advance || 15;
    if (data.countdown <= musicAdv && !shiftMusicStarted && data.break.has_sound) {
        shiftMusicStarted = true;
        playShiftChangeSound(data.break, (data.shift_music_duration || 60) * 1000);
    }
}

function showPhaseShiftAnnounce(data) {
    stopAnalogClock();
    const brk = data.break;
    const panel = document.getElementById('phase-announce');
    panel.classList.remove('hidden');

    document.getElementById('announce-reason-image').innerHTML =
        '<span class="reason-emoji">🔄</span>';
    document.getElementById('announce-type').textContent =
        brk.reason || config.breaks?.shift_change_label || 'Schimb de Tură';
    document.getElementById('announce-reason').innerHTML =
        '<div class="shift-all-staff">Toți operatorii, tehnicienii, șefii de tură, șefii de linie,<br>producția, calitatea, magazinul și mentenanța</div>';
    document.getElementById('announce-time-range').textContent = 'Ora ' + brk.from_time;

    // Cambio turno: nessuna lista reparti (riguarda tutti)
    document.getElementById('announce-departments').innerHTML = '';
    document.querySelector('#phase-announce .announce-section-title').textContent = '';

    if (!shiftMusicStarted && brk.has_sound) {
        shiftMusicStarted = true;
        playShiftChangeSound(brk, (data.shift_music_duration || 60) * 1000);
    }
}

// ===================================================================
//  DEPARTMENT CARDS
// ===================================================================
function buildDepartmentCards(containerId, departments) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    // Ferma eventuale carousel precedente
    if (deptCarouselTimers[containerId]) {
        clearInterval(deptCarouselTimers[containerId]);
        delete deptCarouselTimers[containerId];
    }
    if (!departments || departments.length === 0) return;

    const CARDS_PER_PAGE = 6;
    const PAGE_INTERVAL = 4000; // ms tra una pagina e l'altra

    // Crea tutte le card HTML
    const allCards = departments.map(dept => {
        let html = '';
        if (dept.cdc) {
            html += '<div class="dept-label">Departament</div>';
            html += '<div class="dept-value">' + escapeHtml(String(dept.cdc)) + '</div>';
        }
        if (dept.sub_cdc) {
            html += '<div class="dept-label">Sub-departament</div>';
            html += '<div class="dept-value">' + escapeHtml(String(dept.sub_cdc)) + '</div>';
        }
        return html;
    }).filter(h => h);

    if (allCards.length === 0) return;

    // Dividi in pagine
    const pages = [];
    for (let i = 0; i < allCards.length; i += CARDS_PER_PAGE) {
        pages.push(allCards.slice(i, i + CARDS_PER_PAGE));
    }

    // Wrapper con overflow nascosto
    container.innerHTML = '<div class="dept-carousel"></div>';
    if (pages.length > 1) {
        container.innerHTML += '<div class="dept-page-dots"></div>';
    }
    const carousel = container.querySelector('.dept-carousel');
    const dotsContainer = container.querySelector('.dept-page-dots');

    // Crea dots
    if (dotsContainer) {
        pages.forEach((_, i) => {
            const dot = document.createElement('span');
            dot.className = 'dept-dot' + (i === 0 ? ' active' : '');
            dotsContainer.appendChild(dot);
        });
    }

    let currentPage = 0;

    function showPage(pageIndex) {
        // Fade out corrente
        carousel.classList.add('dept-fadeout');

        setTimeout(() => {
            carousel.innerHTML = '';
            const page = pages[pageIndex];
            page.forEach((cardHtml, idx) => {
                const card = document.createElement('div');
                card.className = 'dept-card dept-card-anim';
                card.style.animationDelay = (idx * 0.08) + 's';
                card.innerHTML = cardHtml;
                carousel.appendChild(card);
            });

            carousel.classList.remove('dept-fadeout');
            carousel.classList.add('dept-fadein');
            setTimeout(() => carousel.classList.remove('dept-fadein'), 600);

            // Aggiorna dots
            if (dotsContainer) {
                dotsContainer.querySelectorAll('.dept-dot').forEach((d, i) => {
                    d.classList.toggle('active', i === pageIndex);
                });
            }
        }, 300);
    }

    // Prima pagina
    showPage(0);

    // Rotazione automatica se più pagine
    if (pages.length > 1) {
        deptCarouselTimers[containerId] = setInterval(() => {
            currentPage = (currentPage + 1) % pages.length;
            showPage(currentPage);
        }, PAGE_INTERVAL);
    }
}

// ===================================================================
//  AUDIO
// ===================================================================
function playBreakSound(brk, durationMs) {
    stopBreakSound();
    try {
        breakAudio = new Audio(buildSoundUrl(brk));
        breakAudio.loop = true;
        breakAudio.play().catch(e => console.warn('Impossibile riprodurre audio:', e));
        if (durationMs) {
            setTimeout(() => {
                if (breakAudio) { breakAudio.loop = false; breakAudio.pause(); breakAudio = null; }
            }, durationMs);
        }
    } catch (e) { console.error('Errore riproduzione audio:', e); }
}

function playShiftChangeSound(brk, durationMs) {
    stopBreakSound();
    try {
        breakAudio = new Audio(buildSoundUrl(brk));
        breakAudio.loop = true;
        breakAudio.play().catch(e => console.warn('Impossibile riprodurre audio:', e));
        shiftMusicTimer = setTimeout(() => {
            if (breakAudio) { breakAudio.loop = false; breakAudio.pause(); breakAudio = null; }
            shiftMusicTimer = null;
        }, durationMs);
    } catch (e) { console.error('Errore riproduzione audio cambio turno:', e); }
}

function stopBreakSound() {
    if (breakAudio) { breakAudio.pause(); breakAudio.currentTime = 0; breakAudio = null; }
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
