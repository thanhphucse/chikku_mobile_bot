'use strict';

// ── API Client (fetch-based, no external dependencies) ────────────────────────

class APIClient {
  constructor() {
    const cfg = window.CHIKKU_CONFIG;
    this.baseUrl      = (cfg.apiBaseUrl || 'http://192.168.0.106:8000').replace(/\/$/, '');
    this.timeoutMs    = cfg.apiTimeoutMs || 180000;
    this.retryAttempts = cfg.apiRetryAttempts || 3;
    this.retryDelayMs = cfg.apiRetryDelayMs || 2000;
  }

  async _fetch(path, options = {}, timeoutMs = this.timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        signal: controller.signal,
        ...options,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async healthCheck() {
    try {
      const data = await this._fetch('/health', {}, 5000);
      return data?.status && data.status !== 'unhealthy';
    } catch {
      return false;
    }
  }

  async createConversation() {
    const data = await this._fetch('/conversation/new', { method: 'POST' });
    return data?.conversation_id || null;
  }

  async sendMessage(query, conversationId) {
    return await this._fetch('/chat/text', {
      method: 'POST',
      body: JSON.stringify({ query, conversation_id: conversationId }),
    });
  }

  async sendMessageWithRetry(query, conversationId) {
    let lastErr;
    for (let i = 0; i < this.retryAttempts; i++) {
      try {
        const result = await this.sendMessage(query, conversationId);
        if (result) return result;
      } catch (err) {
        lastErr = err;
        console.warn(`API attempt ${i + 1}/${this.retryAttempts} failed: ${err.message}`);
        if (i < this.retryAttempts - 1) {
          await new Promise((r) => setTimeout(r, this.retryDelayMs));
        }
      }
    }
    throw lastErr || new Error('All API retry attempts failed');
  }
}

window.chikkuAPI = new APIClient();
