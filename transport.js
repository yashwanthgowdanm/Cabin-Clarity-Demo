// transport.js
// Shared transport for Cabin Clarity demo
// Uses BroadcastChannel when available, with postMessage fallback.

(function () {
  const CHANNEL_NAME = 'cabin-clarity';
  const TYPE_EVENT = 'cc_event';
  const TYPE_STATUS = 'cc_status';

  function safeClone(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }

  class CabinTransport {
    constructor() {
      this.listeners = { status: [], announcement: [] };
      this.connected = false;
      this.channel = null;
      this.windowListenerAttached = false;

      if ('BroadcastChannel' in window) {
        this.channel = new BroadcastChannel(CHANNEL_NAME);
        this.channel.onmessage = (e) => this._handleIncoming(e.data);
      }

      if (!this.windowListenerAttached) {
        window.addEventListener('message', (e) => {
          if (e.data && (e.data.type === TYPE_EVENT || e.data.type === TYPE_STATUS)) {
            this._handleIncoming(e.data);
          }
        });
        this.windowListenerAttached = true;
      }
    }

    on(event, cb) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(cb);
    }

    emit(event, payload) {
      (this.listeners[event] || []).forEach(cb => cb(payload));
    }

    connect(onReady) {
      this.connected = true;
      this.emit('status', { state: 'connecting' });

      setTimeout(() => {
        this.emit('status', { state: 'connected' });
        if (typeof onReady === 'function') onReady();
      }, 600);
    }

    simulateDisconnect() {
      this.connected = false;
      this.emit('status', { state: 'reconnecting' });

      setTimeout(() => {
        this.connected = true;
        this.emit('status', { state: 'connected' });
      }, 1800);
    }

    dispatch(eventObj) {
      const stamped = { ...safeClone(eventObj), _ts: Date.now() };
      this.emit('announcement', stamped);

      const payload = { type: TYPE_EVENT, payload: stamped };

      if (this.channel) {
        this.channel.postMessage(payload);
      }

      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(payload, '*');
      }
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, '*');
      }
    }

    sendStatus(state) {
      const payload = { type: TYPE_STATUS, payload: { state } };
      this.emit('status', payload.payload);

      if (this.channel) {
        this.channel.postMessage(payload);
      }

      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(payload, '*');
      }
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, '*');
      }
    }

    _handleIncoming(msg) {
      if (!msg || !msg.type) return;
      if (msg.type === TYPE_EVENT && msg.payload) {
        this.emit('announcement', msg.payload);
      }
      if (msg.type === TYPE_STATUS && msg.payload) {
        this.emit('status', msg.payload);
      }
    }
  }

  window.CabinTransport = CabinTransport;
})();