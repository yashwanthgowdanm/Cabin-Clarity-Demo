class CabinTransport {
    constructor() {
        this.listeners = { status: [], announcement: [] };
        this.ws = null;
        this.connected = false;
        this.reconnectAttempts = 0;
        this.maxReconnect = 10;
        this.lastEventId = null;
    }

    on(event, cb) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(cb);
    }

    emit(event, payload) {
        (this.listeners[event] || []).forEach(cb => cb(payload));
    }

    connect(onReady) {
        this.emit('status', { state: 'connecting' });

        // Default to localhost — change IP for cross-device demo
        const host = new URLSearchParams(window.location.search).get('host') || 'localhost';
        const port = new URLSearchParams(window.location.search).get('port') || '8765';
        const wsUrl = `ws://${host}:${port}/ws`;

        try {
            this.ws = new WebSocket(wsUrl);
        } catch (e) {
            console.error('WebSocket connection failed:', e);
            this._fallbackToMock(onReady);
            return;
        }

        this.ws.onopen = () => {
            this.connected = true;
            this.reconnectAttempts = 0;
            this.emit('status', { state: 'connected' });

            // Send handshake with last event ID for replay
            this.ws.send(JSON.stringify({
                type: 'handshake',
                lastEventId: this.lastEventId,
                preferences: this._getPreferences()
            }));

            if (typeof onReady === 'function') onReady();
        };

        this.ws.onmessage = (msg) => {
            try {
                const data = JSON.parse(msg.data);
                this._handleIncoming(data);
            } catch (e) {
                console.error('Failed to parse message:', e);
            }
        };

        this.ws.onclose = () => {
            this.connected = false;
            this.emit('status', { state: 'reconnecting' });
            this._attemptReconnect(onReady);
        };

        this.ws.onerror = (err) => {
            console.error('WebSocket error:', err);
        };
    }

    _attemptReconnect(onReady) {
        if (this.reconnectAttempts >= this.maxReconnect) {
            this.emit('status', { state: 'disconnected' });
            return;
        }
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 10000);
        setTimeout(() => this.connect(onReady), delay);
    }

    _fallbackToMock(onReady) {
        // If WebSocket fails, fall back to local mock mode
        // so the app still works for offline testing
        console.warn('Falling back to mock transport');
        this.connected = true;
        this.emit('status', { state: 'connected' });
        if (typeof onReady === 'function') onReady();
    }

    _handleIncoming(data) {
        if (!data || !data.type) return;

        // Track event IDs for replay on reconnect
        if (data.event_id) {
            this.lastEventId = data.event_id;
        }

        switch (data.type) {
            case 'caption':
                // Complete caption (PRAM or template snap)
                this.emit('announcement', data);
                break;

            case 'caption_word':
                // Single word for progressive display
                this.emit('word', data);
                break;

            case 'urgency_shift':
                this.emit('announcement', data);
                break;

            case 'status':
                this.emit('status', data);
                break;

            case 'snapshot':
                // Initial state on connect (late boarder)
                this.emit('snapshot', data);
                break;

            default:
                console.warn('Unknown event type:', data.type);
        }
    }

    _getPreferences() {
        // Read from app settings if available
        return {
            captionLanguage: localStorage.getItem('cc_caption_language') || 'en',
            signLanguage: localStorage.getItem('cc_sign_language') || 'none'
        };
    }

    // Keep simulateDisconnect for local testing
    simulateDisconnect() {
        this.emit('status', { state: 'reconnecting' });
        setTimeout(() => {
            this.emit('status', { state: 'connected' });
        }, 1800);
    }

    // Keep dispatch for local testing with keyboard shortcuts
    dispatch(eventObj) {
        const stamped = { ...eventObj, _ts: Date.now() };
        this.emit('announcement', stamped);
    }
}

window.CabinTransport = CabinTransport;
