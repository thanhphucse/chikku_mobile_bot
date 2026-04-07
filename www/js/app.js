'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  conversationId: null,
  messageCount:   0,
  isRecording:    false,
  isProcessing:   false,
  ttsEnabled:     true,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const pages = {
  splash:  document.getElementById('page-splash'),
  loading: document.getElementById('page-loading'),
  voice:   document.getElementById('page-voice'),
};

const ui = {
  loadingStatus: document.getElementById('loading-status'),
  loadingError:  document.getElementById('loading-error'),
  chatDisplay:   document.getElementById('chat-display'),
  statusLabel:   document.getElementById('status-label'),
  liveQuery:     document.getElementById('live-query'),
  btnMic:        document.getElementById('btn-mic'),
  btnNewChat:    document.getElementById('btn-new-chat'),
  btnMute:       document.getElementById('btn-mute'),
  textInputRow:  document.getElementById('text-input-row'),
  textInput:     document.getElementById('text-input'),
  btnSend:       document.getElementById('btn-send'),
};

// ─── Session (localStorage) ───────────────────────────────────────────────────

const SESSION_KEY = 'chikku_session';

function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; }
  catch { return null; }
}

function saveSession(conversationId, messageCount) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    conversation_id: conversationId,
    message_count: messageCount,
  }));
}

// ─── Text-to-Speech (Web Speech Synthesis) ────────────────────────────────────

function speak(text) {
  if (!state.ttsEnabled || !window.speechSynthesis) {
    console.log('[TTS] skipped — disabled or unavailable');
    return;
  }
  console.log('[TTS] speaking:', text.slice(0, 60));
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const cfg = window.CHIKKU_CONFIG;
  utterance.lang  = cfg.ttsLang  || 'en-US';
  utterance.rate  = cfg.ttsRate  || 1.0;
  utterance.pitch = cfg.ttsPitch || 1.0;
  window.speechSynthesis.speak(utterance);
}

function stopSpeaking() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

// ─── Speech Recognition ───────────────────────────────────────────────────────

// Supports both Capacitor native plugin (iOS) and Web Speech API (Android/web)
const CapacitorSTT = window.Capacitor?.Plugins?.SpeechRecognition || null;
const WebSTT = window.SpeechRecognition || window.webkitSpeechRecognition || null;
let recognition = null;
let finalTranscript = '';

async function requestMicPermission() {
  // Capacitor plugin handles its own permissions on iOS
  if (CapacitorSTT) {
    try {
      const result = await CapacitorSTT.requestPermission();
      return result.permission === 'granted';
    } catch { return false; }
  }
  // For Web Speech API, permission is requested automatically on first use
  return true;
}

async function startRecording() {
  console.log('[MIC] startRecording called — isRecording:', state.isRecording, 'isProcessing:', state.isProcessing);
  if (state.isRecording || state.isProcessing) return;
  stopSpeaking();

  if (CapacitorSTT) {
    console.log('[STT] using Capacitor plugin');
    await _startCapacitorSTT();
  } else if (WebSTT) {
    console.log('[STT] using Web Speech API');
    _startWebSTT();
  } else {
    console.warn('[STT] no STT engine available');
    setStatus('', '⚠ Speech recognition not supported on this device');
    return;
  }
}

async function _startCapacitorSTT() {
  try {
    await CapacitorSTT.start({
      language: 'en-US',
      maxResults: 1,
      partialResults: true,
      popup: false,
    });

    CapacitorSTT.addListener('partialResults', (data) => {
      if (data.matches?.length > 0) showLiveQuery(data.matches[0]);
    });

    // SpeechRecognition plugin fires 'listeningState' or resolves on stop
    setRecordingState(true);
  } catch (err) {
    setStatus('', `⚠ Microphone error: ${err.message}`);
  }
}

function _startWebSTT() {
  finalTranscript = '';
  recognition = new WebSTT();
  recognition.lang = 'en-US';
  recognition.continuous = true;   // stay on until user taps stop
  recognition.interimResults = true;

  recognition.onstart = () => {
    console.log('[STT] started');
    setRecordingState(true);
  };

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript;
        console.log('[STT] final chunk:', event.results[i][0].transcript);
      } else {
        interim += event.results[i][0].transcript;
      }
    }
    console.log('[STT] transcript so far — final:', finalTranscript, '| interim:', interim);
    showLiveQuery(finalTranscript + interim);
  };

  recognition.onerror = (event) => {
    console.warn('[STT] error:', event.error);
    if (event.error === 'no-speech') return; // ignore silence, keep going
    setRecordingState(false);
    if (event.error === 'not-allowed') {
      setStatus('', '⚠ Microphone permission denied — allow in settings');
      showTextInputFallback();
    } else if (event.error === 'network') {
      console.warn('[STT] network error — showing text input fallback');
      setStatus('', '⌨ STT unavailable — type your message below');
      showTextInputFallback();
    } else {
      setStatus('', `⚠ Speech error: ${event.error}`);
    }
  };

  // Browser may stop recognition internally — restart if user hasn't tapped stop
  recognition.onend = () => {
    console.log('[STT] onend fired — isRecording:', state.isRecording);
    if (state.isRecording) {
      console.log('[STT] restarting recognition…');
      try { recognition.start(); } catch (e) { console.warn('[STT] restart failed:', e.message); }
    }
  };

  try {
    recognition.start();
  } catch (err) {
    console.error('[STT] start failed:', err.message);
    setStatus('', `⚠ Could not start microphone: ${err.message}`);
  }
}

function stopRecording() {
  console.log('[MIC] stopRecording called — finalTranscript:', finalTranscript);
  if (!state.isRecording) return;
  state.isRecording = false; // set before stop so onend doesn't restart

  if (CapacitorSTT) {
    CapacitorSTT.stop().catch(() => {});
    CapacitorSTT.removeAllListeners();
  } else if (recognition) {
    recognition.stop();
    recognition = null;
  }

  ui.btnMic.textContent = '🎤';
  ui.btnMic.classList.remove('recording');

  const transcript = finalTranscript.trim();
  finalTranscript = '';

  console.log('[MIC] transcript to send:', transcript || '(empty)');

  if (transcript) {
    hideLiveQuery();
    handleTranscript(transcript);
  } else {
    setStatus('', 'No speech detected — try again');
  }
}

function setRecordingState(isRecording) {
  state.isRecording = isRecording;
  if (isRecording) {
    ui.btnMic.textContent = '⏹';
    ui.btnMic.classList.add('recording');
    setStatus('recording', '⏺ Recording… tap again to stop');
  } else {
    ui.btnMic.textContent = '🎤';
    ui.btnMic.classList.remove('recording');
    if (!state.isProcessing) setStatus('', 'Ready — press mic to speak');
  }
}

// ─── STT → API pipeline ───────────────────────────────────────────────────────

async function handleTranscript(query) {
  console.log('[API] handleTranscript:', query);
  if (!query || !query.trim()) {
    setStatus('', 'No speech detected — try again');
    return;
  }

  state.isProcessing = true;
  ui.btnMic.classList.add('disabled');

  showLiveQuery(query);
  appendUserMessage(query);
  setStatus('thinking', '⏳ Getting response…');
  const thinkingEl = appendThinking();

  try {
    console.log('[API] sending to conversationId:', state.conversationId);
    const result = await window.chikkuAPI.sendMessageWithRetry(query.trim(), state.conversationId);
    console.log('[API] response received:', JSON.stringify(result).slice(0, 120));
    thinkingEl.remove();
    hideLiveQuery();

    if (!result) throw new Error('Empty response');

    const { response, items } = result;
    appendBotMessage(response, items);
    speak(response);
    state.messageCount++;
    saveSession(state.conversationId, state.messageCount);
    setStatus('success', '✓ Ready — press mic to speak');
  } catch (err) {
    thinkingEl.remove();
    hideLiveQuery();
    const errMsg = '⚠ Sorry, I couldn\'t reach the server. Please try again.';
    appendBotMessage(errMsg);
    speak(errMsg);
    setStatus('', 'API error — try again');
    console.error('[API] error:', err.message);
  }

  state.isProcessing = false;
  ui.btnMic.classList.remove('disabled');
}

// ─── Page navigation ──────────────────────────────────────────────────────────

function showPage(name) {
  Object.entries(pages).forEach(([k, el]) => {
    if (k === name) {
      el.style.display = 'flex';
      requestAnimationFrame(() => el.classList.add('active'));
    } else {
      el.classList.remove('active');
      setTimeout(() => { if (!el.classList.contains('active')) el.style.display = 'none'; }, 400);
    }
  });
}

// ─── Loading sequence ─────────────────────────────────────────────────────────

async function runLoading() {
  console.log('[BOOT] runLoading started');
  console.log('[BOOT] API URL:', window.CHIKKU_CONFIG.apiBaseUrl);
  console.log('[BOOT] WebSTT available:', !!WebSTT);
  console.log('[BOOT] CapacitorSTT available:', !!CapacitorSTT);
  showPage('loading');
  setLoadingStatus('Connecting to API…');

  const healthy = await window.chikkuAPI.healthCheck();
  console.log('[BOOT] API health:', healthy);
  if (!healthy) {
    showLoadingError('API is not available.\nMake sure the saigonbot server is running\nand the device is on the same network.');
    return;
  }

  setLoadingStatus('Restoring session…');
  const session = getSession();
  let conversationId = session?.conversation_id || null;

  if (!conversationId) {
    setLoadingStatus('Creating new session…');
    try {
      conversationId = await window.chikkuAPI.createConversation();
    } catch (err) {
      showLoadingError('Failed to create a session.\nCheck API connection.');
      return;
    }
    if (!conversationId) {
      showLoadingError('Failed to create a session.\nCheck API connection.');
      return;
    }
    saveSession(conversationId, 0);
  }

  state.conversationId = conversationId;
  state.messageCount   = session?.message_count || 0;

  setLoadingStatus('Checking microphone…');
  await requestMicPermission();

  setLoadingStatus('Ready!');
  await delay(300);
  showPage('voice');
  await delay(500);
  speak("Hello! I'm Chikku, your Hotel Saigon assistant. How can I help you today?");
}

function setLoadingStatus(msg) {
  ui.loadingStatus.textContent = msg;
}

function showLoadingError(msg) {
  ui.loadingError.textContent = msg;
  ui.loadingError.classList.remove('hidden');
  ui.loadingStatus.classList.add('hidden');
}

// ─── Chat UI helpers ──────────────────────────────────────────────────────────

function appendUserMessage(text) {
  const row = document.createElement('div');
  row.className = 'msg-row user';
  row.innerHTML = `<div class="user-bubble">${escHtml(text)}</div>`;
  ui.chatDisplay.appendChild(row);
  scrollChat();
}

function appendBotMessage(text, items) {
  const row = document.createElement('div');
  row.className = 'msg-row bot';

  let itemsHtml = '';
  if (items && items.length > 0) {
    const rows = items.map((item) => `
      <div class="item-row">
        <div>
          <div class="item-name">${escHtml(item.name || '')}</div>
          <div class="item-section">${escHtml(item.section || '')}</div>
          <div class="item-tags">${(item.tags || []).map((t) => `<span class="tag">${escHtml(t)}</span>`).join('')}</div>
        </div>
        <div class="item-price">${item.price ? `${item.price.toLocaleString()} ${item.currency || 'VND'}` : ''}</div>
      </div>
    `).join('');
    itemsHtml = `<div class="items-list">${rows}</div>`;
  }

  row.innerHTML = `<div class="bot-bubble">${renderMarkdown(text)}${itemsHtml}</div>`;
  ui.chatDisplay.appendChild(row);
  scrollChat();
}

function appendThinking() {
  const row = document.createElement('div');
  row.className = 'msg-row bot';
  row.innerHTML = `<div class="thinking"><span></span><span></span><span></span></div>`;
  ui.chatDisplay.appendChild(row);
  scrollChat();
  return row;
}

function scrollChat() {
  ui.chatDisplay.scrollTop = ui.chatDisplay.scrollHeight;
}

function showLiveQuery(text) {
  ui.liveQuery.textContent = `"${text}"`;
  ui.liveQuery.classList.remove('hidden');
}

function hideLiveQuery() {
  ui.liveQuery.classList.add('hidden');
}

function setStatus(type, msg) {
  ui.statusLabel.textContent = msg;
  ui.statusLabel.className = 'status-label' + (type ? ` ${type}` : '');
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

function renderMarkdown(text) {
  if (!text) return '';
  const blocks = text.split(/\n{2,}/);
  return blocks.map((block) => {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*[-*]\s/.test(l) || l.trim() === '')) {
      const items = lines.filter((l) => /^\s*[-*]\s/.test(l))
        .map((l) => `<li>${inlineMarkdown(l.replace(/^\s*[-*]\s/, ''))}</li>`).join('');
      return `<ul>${items}</ul>`;
    }
    if (lines.every((l) => /^\s*\d+\.\s/.test(l) || l.trim() === '')) {
      const items = lines.filter((l) => /^\s*\d+\.\s/.test(l))
        .map((l) => `<li>${inlineMarkdown(l.replace(/^\s*\d+\.\s/, ''))}</li>`).join('');
      return `<ol>${items}</ol>`;
    }
    if (/^[-*]{3,}$/.test(block.trim())) return '<hr>';
    return `<p>${lines.map((l) => inlineMarkdown(l)).join('<br>')}</p>`;
  }).join('');
}

function inlineMarkdown(text) {
  return escHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

// ─── Text input fallback ──────────────────────────────────────────────────────

function showTextInputFallback() {
  ui.textInputRow.classList.remove('hidden');
  ui.textInput.focus();
}

async function sendTextInput() {
  const query = ui.textInput.value.trim();
  if (!query || state.isProcessing) return;
  ui.textInput.value = '';
  await handleTranscript(query);
}

// ─── Button events ────────────────────────────────────────────────────────────

ui.btnMic.addEventListener('click', async () => {
  if (ui.btnMic.classList.contains('disabled')) return;
  if (state.isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
});

ui.btnNewChat.addEventListener('click', async () => {
  if (state.isRecording) stopRecording();
  state.isProcessing = true;
  ui.btnMic.classList.add('disabled');
  setStatus('thinking', 'Creating new conversation…');

  try {
    const conversationId = await window.chikkuAPI.createConversation();
    if (conversationId) {
      state.conversationId = conversationId;
      state.messageCount = 0;
      saveSession(conversationId, 0);
      ui.chatDisplay.innerHTML = `
        <div class="welcome-msg">
          <span class="bot-bubble">👋 Hello! I'm Chikku, your Hotel Saigon assistant.<br>Press the microphone button and speak your question.</span>
        </div>`;
      setStatus('success', '✓ New conversation started');
    } else {
      setStatus('', 'Could not create new conversation');
    }
  } catch {
    setStatus('', 'Could not create new conversation');
  }

  state.isProcessing = false;
  ui.btnMic.classList.remove('disabled');
});

ui.btnSend.addEventListener('click', sendTextInput);

ui.textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendTextInput();
});

ui.btnMute.addEventListener('click', () => {
  state.ttsEnabled = !state.ttsEnabled;
  if (!state.ttsEnabled) {
    stopSpeaking();
    ui.btnMute.textContent = '🔇 Muted';
    ui.btnMute.classList.add('muted');
  } else {
    ui.btnMute.textContent = '🔊 Voice';
    ui.btnMute.classList.remove('muted');
  }
});

// ─── Utils ────────────────────────────────────────────────────────────────────

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Boot sequence ────────────────────────────────────────────────────────────

(async () => {
  showPage('splash');
  await delay(window.CHIKKU_CONFIG.splashDurationMs || 3000);
  await runLoading();
})();
