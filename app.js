/**
 * CABIN CLARITY — ENHANCED PASSENGER APP
 * Implements all states from the task spec:
 * - Connecting, Idle, Routine, Safety (moderate/high/critical),
 * Low Confidence (routine + safety), Captions Unavailable, Reconnecting
 * - Per-word confidence rendering (opacity + underline)
 * - All haptic patterns from spec
 * - ASL overlay (30% width, bottom-right, auto-fade)
 * - Safety action icons (SVG, 6 types)
 * - Safety mode: full UI transform, required acknowledgment
 * - History buffer (late-boarder replay on connect)
 * - Settings: text size, ASL on/off, haptic on/off, contrast, language
 * - WebSocket mock class (EventBus) shared with dashboard
 */

// ─── WEBSOCKET MOCK ──────────────────────────────────────────────────────────
class CabinWebSocket {
    constructor() {
        this.transport = new CabinTransport();
    }
    on(event, cb) {
        this.transport.on(event, cb);
    }
    connect(onReady) {
        this.transport.connect(onReady);
    }
    simulateDisconnect() {
        this.transport.simulateDisconnect();
    }
    dispatch(eventObj) {
        this.transport.dispatch(eventObj);
    }
}

// ─── SAFETY ACTION SVG ICONS ─────────────────────────────────────────────────
const SAFETY_SVGS = {
    seatbelt_on: `<svg viewBox="0 0 36 36"><circle cx="18" cy="9" r="5"/><path d="M12 16 Q12 22 18 26 Q24 22 24 16"/><path d="M10 28 Q18 20 26 28"/><line x1="18" y1="26" x2="18" y2="34"/></svg>`,
    turbulence: `<svg viewBox="0 0 36 36"><rect x="8" y="16" width="20" height="14" rx="2"/><path d="M13 16v-5a5 5 0 0 1 10 0v5"/><path d="M4 10 Q8 6 6 12"/><path d="M30 8 Q34 12 30 14"/></svg>`,
    brace: `<svg viewBox="0 0 36 36"><circle cx="18" cy="7" r="4"/><path d="M14 13 Q10 18 11 26"/><path d="M22 13 Q26 18 25 26"/><path d="M11 18 Q18 14 25 18"/><path d="M12 26 L8 34 M24 26 L28 34"/></svg>`,
    evacuate: `<svg viewBox="0 0 36 36"><circle cx="10" cy="8" r="4"/><path d="M6 14 L10 26 L14 20 L18 26"/><path d="M20 16 L32 16 M26 10 L32 16 L26 22"/></svg>`,
    oxygen: `<svg viewBox="0 0 36 36"><ellipse cx="18" cy="12" rx="7" ry="9"/><path d="M11 16 Q8 20 9 26 Q10 30 16 30 L20 30 Q26 30 27 26 Q28 20 25 16"/><line x1="16" y1="30" x2="20" y2="30" stroke-width="2.5"/><line x1="18" y1="30" x2="18" y2="34"/></svg>`,
    return_to_seat: `<svg viewBox="0 0 36 36"><rect x="8" y="16" width="20" height="14" rx="2"/><line x1="8" y1="23" x2="28" y2="23"/><line x1="23" y1="10" x2="23" y2="16"/><line x1="17" y1="10" x2="23" y2="10"/><path d="M2 23 L6 19 L6 27 Z"/></svg>`,
};

// ─── SCENARIO DEFINITIONS ─────────────────────────────────────────────────────
const SCENARIOS = {
    turbulence: {
        urgency: 'SAFETY', severity: 'moderate',
        confidence_level: 'high', confidence: 0.94,
        source: 'template_snap', language: 'en-US',
        caption: 'Ladies and gentlemen please return to your seats and fasten your seatbelts. We are entering an area of turbulence.',
        plain: 'Bumpy air ahead. Sit down and buckle up now.',
        word_confidences: null,
        asl_clip_id: 'asl_seatbelt_003',
        action: 'seatbelt_on',
        template_match: 'seatbelt_on',
        latency: 88
    },
    severe_turbulence: {
        urgency: 'SAFETY', severity: 'high',
        confidence_level: 'high', confidence: 0.99,
        source: 'template_snap', language: 'en-US',
        caption: 'Attention all passengers. We are entering severe turbulence. Please remain seated with your seatbelt securely fastened. Crew please be seated immediately.',
        plain: 'Severe bumps — stay seated, belt fastened tight.',
        word_confidences: null,
        asl_clip_id: 'asl_turbulence_001',
        action: 'turbulence',
        template_match: 'severe_turbulence',
        latency: 62
    },
    brace: {
        urgency: 'SAFETY', severity: 'critical',
        confidence_level: 'high', confidence: 1.0,
        source: 'template_snap', language: 'en-US',
        caption: 'EMERGENCY BRACE — adopt brace position now. Head down, hands behind head. Brace, brace, brace.',
        plain: 'Emergency landing. Bend forward, hands on head. Do it NOW.',
        word_confidences: null,
        asl_clip_id: 'asl_brace_001',
        action: 'brace',
        template_match: 'emergency_brace',
        latency: 24
    },
    meal: {
        urgency: 'ROUTINE', severity: null,
        confidence_level: 'high', confidence: 0.97,
        source: 'asr', language: 'en-US',
        caption: 'Cabin crew please begin the meal service for the main cabin. We will start from the front of the aircraft.',
        plain: 'Food and drinks are coming soon.',
        word_confidences: null,
        asl_clip_id: null,
        action: null,
        template_match: 'meal_service_start',
        latency: 142
    },
    landing: {
        urgency: 'ROUTINE', severity: null,
        confidence_level: 'high', confidence: 0.96,
        source: 'asr', language: 'en-US',
        caption: 'Ladies and gentlemen we have begun our initial descent into Seattle. Please stow your tray tables and return your seats to the upright position.',
        plain: 'We are landing soon. Pack up and buckle in.',
        word_confidences: null,
        asl_clip_id: null,
        action: null,
        template_match: 'initial_descent',
        latency: 168
    },
    low_conf_routine: {
        urgency: 'ROUTINE', severity: null,
        confidence_level: 'low', confidence: 0.49,
        source: 'pram', language: 'en-US',
        caption: 'We will be serving [unclear] shortly and the cabin crew will [unclear] any questions you may have about [unclear].',
        plain: 'Service coming — some words unclear due to audio quality.',
        word_confidences: [0.92, 0.9, 0.88, 0.3, 0.85, 0.82, 0.9, 0.75, 0.3, 0.7, 0.65, 0.88, 0.6, 0.55, 0.3, 0.45, 0.4],
        asl_clip_id: null,
        action: null,
        template_match: null,
        latency: 312
    },
    low_conf_safety: {
        urgency: 'SAFETY', severity: 'moderate',
        confidence_level: 'low', confidence: 0.41,
        source: 'asr', language: 'en-US',
        caption: 'Please [unclear] your seatbelts and remain [unclear] — the crew will [unclear] your area shortly.',
        plain: 'Safety alert — some words unclear. Fasten your seatbelt now.',
        word_confidences: [0.85, 0.25, 0.2, 0.82, 0.88, 0.9, 0.3, 0.2, 0.85, 0.8, 0.3, 0.2, 0.45, 0.82, 0.7],
        asl_clip_id: 'asl_seatbelt_003',
        action: 'seatbelt_on',
        template_match: null,
        latency: 395
    },
    feed_lost: {
        urgency: 'OPERATIONAL', status: 'audio_feed_disconnected',
        source: 'system', latency: 0
    },
    reconnect: {
        urgency: 'OPERATIONAL', status: 'ws_reconnecting',
        source: 'system', latency: 0
    }
};

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
const app = {
    ws: null,
    safetyActive: false,
    currentScreen: 'connecting', // connecting | idle | caption | unavailable | reconnecting
    acknowledged: true,
    _aslTimer: null,   // Explicitly declaring timer variables
    _toastTimer: null,

    history: [
        {
            time: '13:05', type: 'routine', urgency: 'ROUTINE',
            confidence_level: 'high', language: 'en-US',
            text: 'Prepare for main cabin meal service.', asl_clip_id: null
        },
        {
            time: '12:40', type: 'safety', urgency: 'SAFETY',
            confidence_level: 'high', language: 'en-US',
            text: 'Seatbelt sign ON. Flight attendants please take your jumpseats.', asl_clip_id: 'asl_seatbelt_003'
        },
        {
            time: '12:15', type: 'routine', urgency: 'ROUTINE',
            confidence_level: 'high', language: 'en-US',
            text: 'We have reached our cruising altitude of 35,000 feet.', asl_clip_id: null
        }
    ],

    settings: {
        asl: true,
        haptic: true,
        contrast: false,
        textSize: 18,
        language: 'en',
        largeDisplay: false
    },

    init() {
        // Read preferences from the onboarding screen (opening.html)
        if (localStorage.getItem('cc_language')) this.settings.language = localStorage.getItem('cc_language');
        if (localStorage.getItem('cc_asl')) this.settings.asl = localStorage.getItem('cc_asl') === 'true';
        
        this.ws = new CabinWebSocket();
        this.setupWSListeners();
        this.setupNavigation();
        this.updateClock();
        this.setupKeyboardShortcuts();
        this.renderHistory();
        this.applySettings();

        // Boot: show connecting state, then connect
        this.showState('connecting');
        this.ws.connect(() => {
            this.showState('idle');
            this.setWSIndicator('connected');
            this.showToast('Connected to cabin network');
            // Late-boarder: replay history buffer
            this.replayHistoryForLateBoarder();
        });

        console.log('Cabin Clarity: Initialized. Open dashboard.html in another tab for the ops view.');
    },

    // ─── WebSocket Listeners ───────────────────────────────────────────────
    setupWSListeners() {
        this.ws.on('status', ({ state }) => {
            this.setWSIndicator(state);
            if (state === 'connecting') this.showState('connecting');
            if (state === 'reconnecting') this.showState('reconnecting');
            if (state === 'connected' && this.currentScreen === 'reconnecting') {
                this.showState('idle');
                this.showToast('Reconnected');
            }
        });

        this.ws.on('announcement', (evt) => {
            if (evt.status === 'audio_feed_disconnected') {
                this.clearSafetyMode();
                this.showState('unavailable');
                return;
            }
            if (evt.status === 'ws_reconnecting') {
                this.ws.simulateDisconnect();
                return;
            }
            this.handleAnnouncement(evt);
        });
    },

    // ─── State Machine ─────────────────────────────────────────────────────
    showState(state) {
        this.currentScreen = state;
        const states = ['connecting', 'idle', 'caption', 'unavailable', 'reconnecting'];
        states.forEach(s => {
            const el = document.getElementById('state-' + s);
            if (el) el.classList.toggle('hidden', s !== state);
        });
    },

    // ─── Announcement Handler ──────────────────────────────────────────────
    handleAnnouncement(evt) {
        const isSafety = evt.urgency === 'SAFETY';
        
        // Update caption card
        this.renderCaptionCard(evt);
        this.showState('caption');

        // Safety mode toggle
        if (isSafety) {
            this.setSafetyMode(evt);
        } else if (!this.safetyActive) {
            this.clearSafetyMode();
        }

        // ASL overlay
        this.handleASL(evt);

        // Haptic
        this.triggerHapticForEvent(evt);

        // Badge if not on status tab
        if (this.activeTab !== 'view-flight') {
            const badge = document.getElementById('badge-flight');
            if (badge) badge.classList.remove('hidden');
        }

        // Add to history
        this.addToHistory(evt);
    },

    // ─── Caption Rendering ─────────────────────────────────────────────────
    renderCaptionCard(evt) {
        const isSafety = evt.urgency === 'SAFETY';
        const isLowConf = evt.confidence_level === 'low' || evt.confidence_level === 'medium';

        const safetyLabel = document.getElementById('safety-label-large');
        if (safetyLabel) {
            safetyLabel.textContent = isSafety
                ? `SAFETY${evt.severity ? ' · ' + evt.severity.toUpperCase() : ''}`
                : 'SAFETY';
        }

        // Badge
        const badge = document.getElementById('urgency-badge');
        if (badge) {
            badge.className = 'urgency-badge';
            if (isSafety) {
                badge.classList.add('badge-safety');
                const span = badge.querySelector('span');
                if(span) span.textContent = `⚠ SAFETY${evt.severity ? ' · ' + evt.severity.toUpperCase() : ''}`;
            } else if (isLowConf) {
                badge.classList.add('badge-low-conf');
                const span = badge.querySelector('span');
                if(span) span.textContent = '◐ ROUTINE · LOW CONFIDENCE';
            } else {
                badge.classList.add('badge-routine');
                const span = badge.querySelector('span');
                if(span) span.textContent = '● ROUTINE';
            }
        }

        // Caption card style
        const captionCard = document.getElementById('caption-card');
        if (captionCard) {
            captionCard.className = 'card caption-card';
            if (isSafety) captionCard.classList.add('urgency-safety');
            else if (isLowConf) captionCard.classList.add('urgency-low-conf');
        }

        // Caption text with per-word confidence
        const textEl = document.getElementById('live-caption-text');
        if (textEl && evt.caption) {
            const words = evt.caption.split(' ');
            const wc = evt.word_confidences;

            if (wc && wc.length > 0) {
                textEl.innerHTML = words.map((word, i) => {
                    const conf = wc[i] !== undefined ? wc[i] : 1.0;
                    let cls = 'conf-high';
                    if (conf < 0.6) cls = 'conf-low';
                    else if (conf < 0.85) cls = 'conf-medium';
                    return `<span class="word ${cls}">${word} </span>`;
                }).join('');
            } else {
                textEl.textContent = evt.caption;
            }
            // Apply text size from settings
            textEl.style.fontSize = this.settings.textSize + 'px';
        }

        // Low confidence bar
        const lowConfBar = document.getElementById('low-conf-bar');
        if (lowConfBar) lowConfBar.classList.toggle('visible', isLowConf);

        // Safety action icon
        const actionWrap = document.getElementById('safety-action-wrap');
        const actionIcon = document.getElementById('safety-action-icon');
        if (actionWrap && actionIcon) {
            if (isSafety && evt.action && SAFETY_SVGS[evt.action]) {
                actionWrap.classList.remove('hidden');
                actionIcon.innerHTML = SAFETY_SVGS[evt.action];
            } else {
                actionWrap.classList.add('hidden');
            }
        }

        // Plain English summary
        const summary = document.getElementById('plain-english-summary');
        if (summary && evt.plain) summary.textContent = evt.plain;

        // Ack button reset
        const ackBtn = document.getElementById('confirm-receipt-btn');
        if (ackBtn) {
            ackBtn.textContent = '✓ Acknowledge';
            ackBtn.style.background = '';
            ackBtn.style.color = '';
            this.acknowledged = false;
        }

        // Source metadata
        const metaEl = document.getElementById('caption-meta');
        if (metaEl) {
            metaEl.textContent = `${evt.source || '—'} · ${evt.language || '—'} · ${evt.latency ? evt.latency + 'ms' : '—'}`;
        }
    },

    // ─── Safety Mode ───────────────────────────────────────────────────────
    // ─── Safety Mode ───────────────────────────────────────────────────────
    setSafetyMode(evt) {
        this.safetyActive = true;
        document.documentElement.setAttribute('data-safety', 'true');
        document.querySelector('.device-frame')?.classList.add('safety-glow');
        this.setWSIndicator('safety');

        // Required ack: show banner
        const banner = document.getElementById('ack-required-banner');
        if (banner) banner.style.display = 'flex';

        // NEW: Update Flight Status Card to Seatbelt ON
        const seatbeltCard = document.getElementById('seatbelt-status-card');
        if (seatbeltCard) {
            seatbeltCard.style.background = 'var(--warning-bg, #fef2f2)';
            seatbeltCard.style.borderColor = 'var(--warning-text, #dc2626)';
            seatbeltCard.innerHTML = `
                <span style="font-size:1.8rem;">🚨</span>
                <div>
                    <div class="font-bold" style="color: var(--warning-text, #dc2626);">Seatbelt ON</div>
                    <div class="text-small text-muted">${evt.severity === 'critical' ? 'Emergency protocol active' : 'Safety requirement active'}</div>
                </div>
            `;
        }
    },

    clearSafetyMode() {
        this.safetyActive = false;
        document.documentElement.removeAttribute('data-safety');
        document.querySelector('.device-frame')?.classList.remove('safety-glow');
        this.setWSIndicator('connected');

        const banner = document.getElementById('ack-required-banner');
        if (banner) banner.style.display = 'none';

        // NEW: Revert Flight Status Card to Seatbelt OFF
        const seatbeltCard = document.getElementById('seatbelt-status-card');
        if (seatbeltCard) {
            seatbeltCard.style.background = '';
            seatbeltCard.style.borderColor = '';
            seatbeltCard.innerHTML = `
                <span style="font-size:1.8rem; filter: grayscale(1); opacity: 0.6;">💺</span>
                <div>
                    <div class="font-bold text-dark">Seatbelt OFF</div>
                    <div class="text-small text-muted">Cruising conditions</div>
                </div>
            `;
        }
    },

    // ─── ASL Overlay ───────────────────────────────────────────────────────
    handleASL(evt) {
        const overlay = document.getElementById('asl-overlay');
        const video = document.getElementById('asl-video');
        const fallbackText = document.getElementById('asl-fallback-text');
        if (!overlay || !video) return;

        // NEW LOGIC: If the user enabled ASL on the portal, ALWAYS show the overlay during an announcement.
        if (this.settings.asl) {
            overlay.classList.add('active');
            
            // If the backend sent a specific clip (like "brace_001"), use it. 
            // Otherwise, use a default "generic_update" clip ID for routine announcements.
            const clipId = evt.asl_clip_id ? evt.asl_clip_id : 'generic_update';
            
            const aslClipLabel = document.getElementById('asl-clip-id');
            if (aslClipLabel) aslClipLabel.textContent = clipId;

            // Attempt to play the video. 
            video.src = `assets/asl/${clipId}.mp4`; 
            
            // Hackathon trick: If the video file doesn't actually exist in your folder, 
            // the video player will fail to load. We catch that error and show the fallback text instead!
            video.play().catch(() => {
                video.style.display = 'none';
                fallbackText.style.display = 'block';
            });

            // Automatically hide the ASL overlay after 6 seconds
            clearTimeout(this._aslTimer);
            this._aslTimer = setTimeout(() => {
                overlay.classList.remove('active');
                video.style.display = 'block';
                fallbackText.style.display = 'none';
            }, 6000);
            
        } else {
            // If user turned ASL OFF in the portal, ensure it stays hidden
            overlay.classList.remove('active');
            video.removeAttribute('src');
            video.load();
        }
    },
    // ─── Haptic Patterns (from spec) ──────────────────────────────────────
    triggerHapticForEvent(evt) {
        if (!this.settings.haptic) return;
        if (evt.urgency === 'ROUTINE') {
            // No vibration for routine
        } else if (evt.urgency === 'SAFETY') {
            if (evt.severity === 'critical') this.triggerHaptic([100,50,100,50,100,50,100]); // rapid
            else if (evt.severity === 'high')   this.triggerHaptic([500]);                    // one long
            else                                 this.triggerHaptic([200, 100, 200]);           // two short
        }
    },

    triggerHaptic(pattern = [200]) {
        if (this.settings.haptic && navigator.vibrate) navigator.vibrate(pattern);
        const frame = document.querySelector('.device-frame');
        if (frame) {
            frame.classList.remove('haptic-pulse');
            void frame.offsetWidth; // trigger reflow
            frame.classList.add('haptic-pulse');
        }
    },

    // ─── History ──────────────────────────────────────────────────────────
    addToHistory(evt) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        this.history.unshift({
            time: timeStr,
            type: evt.urgency === 'SAFETY' ? 'safety' : 'routine',
            urgency: evt.urgency,
            confidence_level: evt.confidence_level,
            language: evt.language,
            text: evt.caption || evt.text || '',
            asl_clip_id: evt.asl_clip_id || null
        });

        this.renderHistory();
    },

    renderHistory() {
        const container = document.getElementById('history-log');
        if (!container) return;

        const filter = document.getElementById('history-filter')?.value || 'all';
        container.innerHTML = '';

        const filtered = this.history.filter(h => filter === 'all' || h.type === filter);

        if (!filtered.length) {
            container.innerHTML = '<p class="text-muted text-small" style="text-align:center;padding:16px 0">No announcements yet.</p>';
            return;
        }

        filtered.forEach(item => {
            const el = document.createElement('div');
            el.className = 'history-item';
            el.style.cursor = 'pointer';

            const typeClass = item.type === 'safety' ? 'type-safety' : 'type-routine';
            const icon = item.type === 'safety' ? '⚠' : '●';

            el.innerHTML = `
                <div class="history-time">${item.time}</div>
                <div class="history-content">
                    <div class="history-type ${typeClass}">${icon} ${item.urgency || item.type.toUpperCase()}</div>
                    <div class="history-text">${item.text}</div>
                    <div class="history-conf">
                        ${item.confidence_level ? item.confidence_level + ' conf' : ''}
                        ${item.asl_clip_id ? '· ASL ▶ (Tap to Expand & Replay)' : '· Tap to Expand'}
                    </div>
                </div>
            `;

            el.addEventListener('click', () => {
                el.classList.toggle('expanded');

                if (item.asl_clip_id && el.classList.contains('expanded')) {
                    this.handleASL({ asl_clip_id: item.asl_clip_id });
                    this.showToast('Replaying ASL Clip');
                    this.triggerHaptic([50]);
                }
            });

            container.appendChild(el);
        });
    },

    // Late boarder: send all previous history on connect
    replayHistoryForLateBoarder() {
        if (this.history.length > 0) {
            this.renderHistory();
            this.showToast(`${this.history.length} previous announcements loaded`);
        }
    },

    // ─── Settings ─────────────────────────────────────────────────────────
    applySettings() {
        document.getElementById('text-size-preview')?.style.setProperty(
            'font-size',
            this.settings.textSize + 'px'
        );

        const textSizeVal = document.getElementById('text-size-val');
        if (textSizeVal) textSizeVal.textContent = this.settings.textSize + 'px';

        const sizeSlider = document.getElementById('text-size-slider');
        if (sizeSlider) sizeSlider.value = this.settings.textSize;

        document.documentElement.classList.toggle('high-contrast', this.settings.contrast);
        document.documentElement.classList.toggle('large-display', this.settings.largeDisplay);
        document.documentElement.lang = this.settings.language || 'en';

        const routeSub = document.querySelector('.route-sub');
        if (routeSub) {
            routeSub.textContent = `Seat 12C · ${this.settings.language.toUpperCase()}${this.settings.asl ? ', ASL' : ''}`;
        }
    },

    toggleSetting(settingName, value) {
        this.settings[settingName] = value;
        this.showToast(`${settingName}: ${value ? 'On' : 'Off'}`);
        this.triggerHaptic([30]);
        this.applySettings();
    },

    updateTextSize(val) {
        this.settings.textSize = parseInt(val);
        const preview = document.getElementById('text-size-preview');
        const label = document.getElementById('text-size-val');
        if (preview) preview.style.fontSize = val + 'px';
        if (label) label.textContent = val + 'px';
        
        // Live-update current caption if shown
        const captionEl = document.getElementById('live-caption-text');
        if (captionEl && this.currentScreen === 'caption') captionEl.style.fontSize = val + 'px';
    },

    // ─── UI Helpers ───────────────────────────────────────────────────────
    updateClock() {
        const clock = document.getElementById('ios-clock');
        if (!clock) return;
        const tick = () => {
            const now = new Date();
            clock.innerText = `${now.getHours() % 12 || 12}:${now.getMinutes().toString().padStart(2,'0')}`;
        };
        setInterval(tick, 1000);
        tick();
    },

    setWSIndicator(state) {
        const dot = document.getElementById('ws-indicator-dot');
        const label = document.getElementById('ws-indicator-label');
        if (!dot || !label) return;
        dot.className = 'ws-dot';
        if (state === 'connecting') { dot.classList.add('connecting'); label.textContent = 'Connecting...'; }
        else if (state === 'connected') { dot.classList.add('connected'); label.textContent = 'Connected'; }
        else if (state === 'disconnected' || state === 'reconnecting') { dot.classList.add('disconnected'); label.textContent = 'Reconnecting...'; }
        else if (state === 'safety') { dot.style.background = '#ef4444'; label.textContent = 'SAFETY ALERT'; }
    },

    showToast(message) {
        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.innerText = message;
        toast.classList.remove('hidden');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => toast.classList.add('hidden'), 2500);
    },

    // ─── Navigation ───────────────────────────────────────────────────────
    activeTab: 'view-flight',

    setupNavigation() {
        const tabs = document.querySelectorAll('.tab-item');
        tabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                tabs.forEach(t => t.classList.remove('active'));
                e.currentTarget.classList.add('active');
                document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
                const targetId = e.currentTarget.getAttribute('data-target');
                const target = document.getElementById(targetId);
                if (target) target.classList.add('active');
                this.activeTab = targetId;
                if (targetId === 'view-flight') {
                    const badge = document.getElementById('badge-flight');
                    if (badge) badge.classList.add('hidden');
                }
                document.querySelector('.container')?.scrollTo({ top: 0, behavior: 'smooth' });
                this.triggerHaptic([15]);
            });
        });
    },

    // ─── Simulation (called from sim panel) ───────────────────────────────
    simulatePilot(scenario) {
        const data = SCENARIOS[scenario];
        if (!data) return;
        // Dispatch through the WS so the dashboard also receives it
        this.ws.dispatch(data);
    },

    triggerEmergency() {
        const overlay = document.getElementById('emergency-overlay');
        if(overlay) overlay.classList.remove('hidden');
        this.triggerHaptic([100,50,100,50,100,50,100]);
    },

    dismissEmergency() {
        const overlay = document.getElementById('emergency-overlay');
        if(overlay) overlay.classList.add('hidden');
        this.clearSafetyMode();
        this.triggerHaptic([30]);
    },

    confirmReceipt() {
        const btn = document.getElementById('confirm-receipt-btn');
        if(btn) {
            btn.textContent = '✓ Acknowledged';
            btn.style.background = 'var(--success-color)';
            btn.style.color = 'white';
        }
        this.acknowledged = true;
        this.clearSafetyMode();
        this.showToast('Confirmed with crew.');
        this.triggerHaptic([100, 50, 100]);
    },

    // ─── Crew & Service ───────────────────────────────────────────────────
    sendCrew(requestType) {
        this.triggerHaptic([50]);
        this.showToast(`${requestType} request sent to crew`);
    },

    orderItem(item) {
        this.triggerHaptic([50]);
        this.showToast(`${item} added to your order`);
    },

    // ─── Theme ────────────────────────────────────────────────────────────
    toggleTheme() {
        const html = document.documentElement;
        const next = html.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        html.setAttribute('data-theme', next);
        this.triggerHaptic([50]);
    },

    // ─── IFE Pairing ──────────────────────────────────────────────────────
    pairIFE() {
        const pins = document.querySelectorAll('.pin-box');
        const code = Array.from(pins).map(p => p.value).join('');
        if (code.length < 4) { this.showToast('Please enter all 4 digits.'); return; }
        document.getElementById('ife-pairing-card')?.classList.add('hidden');
        document.getElementById('ife-active-card')?.classList.remove('hidden');
        this.showToast(`Synced! Code: ${code}`);
        this.triggerHaptic([100, 50, 100]);
    },

    disconnectIFE() {
        document.getElementById('ife-active-card')?.classList.add('hidden');
        document.getElementById('ife-pairing-card')?.classList.remove('hidden');
        document.querySelectorAll('.pin-box').forEach(p => p.value = '');
        const syncBtn = document.getElementById('ife-sync-btn');
        if (syncBtn) { syncBtn.disabled = true; syncBtn.style.opacity = '0.5'; }
        this.showToast('Disconnected from seatback screen.');
        this.triggerHaptic([50]);
    },

    checkPinComplete() {
        const pins = document.querySelectorAll('.pin-box');
        const allFilled = Array.from(pins).every(p => p.value.length === 1);
        const syncBtn = document.getElementById('ife-sync-btn');
        if (syncBtn) {
            syncBtn.disabled = !allFilled;
            syncBtn.style.opacity = allFilled ? '1' : '0.5';
            syncBtn.style.cursor = allFilled ? 'pointer' : 'not-allowed';
        }
    },

    moveToNext(currentInput, event) {
        if (currentInput.value.length === 1) {
            let next = currentInput.nextElementSibling;
            while (next && next.tagName !== 'INPUT') next = next.nextElementSibling;
            if (next) next.focus();
        }
        if (event.key === 'Backspace') {
            currentInput.value = '';
            let prev = currentInput.previousElementSibling;
            while (prev && prev.tagName !== 'INPUT') prev = prev.previousElementSibling;
            if (prev) prev.focus();
        }
        this.checkPinComplete();
    },

    // ─── Keyboard Shortcuts ───────────────────────────────────────────────
    setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT') return;
            const k = e.key.toLowerCase();
            if (k === 'e') this.triggerEmergency();
            if (k === 't') this.simulatePilot('turbulence');
            if (k === 's') this.simulatePilot('severe_turbulence');
            if (k === 'b') this.simulatePilot('brace');
            if (k === 'm') this.simulatePilot('meal');
            if (k === 'l') this.simulatePilot('landing');
            if (k === 'c') this.simulatePilot('low_conf_routine');
            if (k === 'f') this.simulatePilot('feed_lost');
            if (k === 'r') this.simulatePilot('reconnect');
        });
    },

    // ─── Dashboard Window ─────────────────────────────────────────────────
    openDashboard() {
        window.__dashboardWindow = window.open('dashboard.html', 'cc_dashboard', 'width=1100,height=750');
    }
};

// Initialize App
window.onload = () => app.init();