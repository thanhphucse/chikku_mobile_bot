'use strict';

// ── App Configuration ─────────────────────────────────────────────────────────
// Edit API_BASE_URL to point to your saigonbot server.

window.CHIKKU_CONFIG = {
  apiBaseUrl:       'http://localhost:8001',
  apiTimeoutMs:     180000,
  apiRetryAttempts: 3,
  apiRetryDelayMs:  2000,
  splashDurationMs: 3000,   // shorter than desktop (mobile loads faster)
  ttsLang:          'en-US',
  ttsRate:          1.0,    // 0.1 – 10
  ttsPitch:         1.0,    // 0 – 2
};
