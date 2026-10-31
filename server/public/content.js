/**
 * Netflix Party Sync & Video Call - Content Script
 * Handles:
 *  1. Injecting player bridge into main page
 *  2. Injected floating draggable overlay UI
 *  3. WebRTC 2-way audio/video peer connection
 *  4. Individual audio mixing (Netflix media vs Friend's voice)
 *  5. Play/pause/seek synchronization with media key emulation & Catch-Up Sync
 *  6. Show compatibility detection & episode mismatch alerting
 *  7. Independent microphone and camera enable/disable controls
 */

(function () {
  'use strict';

  if (window.__nps_injected) return;
  window.__nps_injected = true;

  console.log('[NetflixPartySync] Content script active.');

  // Inject Bridge Script into MAIN world
  function injectBridge() {
    if (window.__nps_bridge_loaded) return;

    const script = document.createElement('script');
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      script.src = chrome.runtime.getURL('netflix_bridge.js');
    } else {
      const base = (window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1) || './');
      script.src = base + 'netflix_bridge.js';
    }
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }
  injectBridge();

  // State
  let sigClient = null;
  let pc = null;
  let localStream = null;
  let remoteStream = null;
  let audioCtx = null;
  let friendGainNode = null;
  let dataChannel = null;

  let roomId = 'PARTY77';
  let peerId = 'peer-' + Math.random().toString(36).substring(2, 9);
  let userName = 'You';
  let serverWsUrl = 'cloud'; // Default: Serverless Cloud Mode (0 local servers needed)

  let isAudioEnabled = true;
  let isVideoEnabled = true;
  let netflixVolume = 0.8;
  let friendVolume = 1.0;

  let currentLocalVideoId = null;
  let currentLocalTitle = '';
  let remoteVideoId = null;
  let remoteTitle = '';

  let ignoreLocalEventsUntil = 0;
  let currentRemoteTime = 0;
  let lastKnownPlayerTime = 0;
  let isPlayerPaused = true;
  let catchUpInterval = null;

  // ICE configuration with Google public STUN
  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // Build Floating UI Overlay
  function buildOverlayDOM() {
    if (document.getElementById('nps-overlay-root')) return;

    const root = document.createElement('div');
    root.id = 'nps-overlay-root';
    root.innerHTML = `
      <!-- Minimized Floating Pill -->
      <div class="nps-pill" id="nps-pill" title="Click to expand video call">
        <span class="nps-status-dot" id="nps-pill-dot"></span>
        <span id="nps-pill-status">Netflix Sync</span>
        <span class="nps-badge" id="nps-pill-time">00:00</span>
      </div>

      <!-- Main Window Card -->
      <div class="nps-window" id="nps-window">
        <!-- Draggable Header -->
        <div class="nps-header" id="nps-drag-handle">
          <div class="nps-header-left">
            <span class="nps-status-dot" id="nps-status-dot"></span>
            <span class="nps-title">Netflix Sync <span class="nps-badge" id="nps-room-badge">${roomId}</span></span>
          </div>
          <div class="nps-header-actions">
            <button class="nps-icon-btn" id="nps-copy-btn" title="Copy Invite Link">🔗</button>
            <button class="nps-icon-btn" id="nps-min-btn" title="Minimize overlay">_</button>
            <button class="nps-icon-btn" id="nps-close-btn" title="Hide overlay">✕</button>
          </div>
        </div>

        <!-- Show Status / Episode Sync Banner -->
        <div class="nps-show-banner hidden" id="nps-show-banner">
          <span class="nps-show-title" id="nps-show-text">🎬 Detecting Netflix show...</span>
          <button class="nps-jump-btn" id="nps-jump-btn" style="display:none;">Jump to Episode</button>
        </div>

        <!-- Video Call Stage -->
        <div class="nps-video-stage">
          <!-- Transient Sync Alert -->
          <div class="nps-sync-alert" id="nps-sync-alert">
            <span id="nps-alert-icon">⏸️</span>
            <span id="nps-alert-msg">Friend paused</span>
          </div>

          <!-- Remote Friend Video -->
          <video class="nps-remote-video hidden" id="nps-remote-video" autoplay playsinline></video>
          
          <!-- Remote Avatar Fallback -->
          <div class="nps-avatar-placeholder" id="nps-avatar-placeholder">
            <div class="nps-avatar-circle" id="nps-avatar-circle">F</div>
            <div class="nps-avatar-name" id="nps-avatar-name">Waiting for friend...</div>
          </div>

          <!-- Local Self Preview (PIP) -->
          <div class="nps-local-pip" id="nps-local-pip" title="Your camera preview">
            <video class="nps-local-video" id="nps-local-video" autoplay playsinline muted></video>
            <div class="nps-local-off-label hidden" id="nps-local-off-label">Cam Off</div>
          </div>
        </div>

        <!-- Audio Mixer Panel (Individual Volume Controls) -->
        <div class="nps-mixer-panel">
          <!-- Netflix Media Volume -->
          <div class="nps-mixer-row">
            <div class="nps-mixer-label-row">
              <span class="nps-mixer-title">🎬 Netflix Audio</span>
              <span class="nps-mixer-val" id="nps-netflix-vol-label">80%</span>
            </div>
            <div class="nps-slider-container">
              <input type="range" class="nps-slider" id="nps-netflix-slider" min="0" max="100" value="80">
            </div>
          </div>

          <!-- Friend Voice Volume (with up to 200% boost) -->
          <div class="nps-mixer-row">
            <div class="nps-mixer-label-row">
              <span class="nps-mixer-title">🎙️ Friend Voice</span>
              <span class="nps-mixer-val" id="nps-friend-vol-label">100%</span>
            </div>
            <div class="nps-slider-container">
              <input type="range" class="nps-slider" id="nps-friend-slider" min="0" max="200" value="100">
            </div>
          </div>

          <!-- Mic Input Activity & Headphone Isolation Status -->
          <div class="nps-mixer-row">
            <div class="nps-mixer-label-row">
              <span class="nps-mixer-title">🎤 Mic Input (Studio 48kHz)</span>
              <span class="nps-audio-badge" id="nps-a2dp-badge" title="Bluetooth locked in A2DP high-res mode (AAC/LDAC/SBC)">🎧 A2DP Safe</span>
            </div>
            <div class="nps-meter-container" title="Green shows only your voice. Drops to zero when you are silent.">
              <div class="nps-meter-track">
                <div class="nps-meter-fill" id="nps-mic-meter-fill"></div>
              </div>
            </div>
            <div style="font-size: 10px; color: #888; display: flex; justify-content: space-between; align-items: center; margin-top: 2px;">
              <span>Source:</span>
              <select id="nps-mic-select" style="background: #252525; color: #ccc; border: 1px solid #444; border-radius: 4px; font-size: 10px; padding: 1px 4px; outline: none; max-width: 160px;"></select>
            </div>
          </div>
        </div>

        <!-- Playback Info & Catch-Up Sync Bar -->
        <div class="nps-playback-bar">
          <span class="nps-timecode" id="nps-timecode-label">00:00:00</span>
          <div style="display: flex; gap: 6px;">
            <button class="nps-sync-btn" id="nps-playpause-btn" title="Toggle Play / Pause (Spacebar)">⏯️ Play/Pause</button>
            <button class="nps-sync-btn nps-catchup-btn" id="nps-catchup-btn" title="Catch-Up Sync: If behind, plays until aligned while keeping ahead party paused">🎯 Catch Up</button>
          </div>
        </div>

        <!-- Call Toolbar -->
        <div class="nps-call-controls">
          <button class="nps-call-btn" id="nps-toggle-mic" title="Mute/Unmute Mic">🎙️</button>
          <button class="nps-call-btn" id="nps-toggle-cam" title="Turn Camera On/Off">📹</button>
          <button class="nps-call-btn" id="nps-toggle-pip" title="Toggle Self Preview">🪟</button>
          <button class="nps-call-btn leave" id="nps-reconnect-btn" title="Reconnect / Rejoin">🔄</button>
        </div>
      </div>
    `;

    document.body.appendChild(root);
    setupDragEvents();
    setupUIListeners();
  }

  // Draggable logic
  function setupDragEvents() {
    const root = document.getElementById('nps-overlay-root');
    const handle = document.getElementById('nps-drag-handle');
    if (!root || !handle) return;

    let isDragging = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = root.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      root.style.right = 'auto';
      root.style.left = `${initialLeft}px`;
      root.style.top = `${initialTop}px`;
      document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const newLeft = Math.max(10, Math.min(window.innerWidth - 330, initialLeft + dx));
      const newTop = Math.max(10, Math.min(window.innerHeight - 100, initialTop + dy));
      root.style.left = `${newLeft}px`;
      root.style.top = `${newTop}px`;
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        document.body.style.userSelect = '';
      }
    });
  }

  // UI Event Listeners
  function setupUIListeners() {
    const root = document.getElementById('nps-overlay-root');
    const minBtn = document.getElementById('nps-min-btn');
    const pill = document.getElementById('nps-pill');
    const closeBtn = document.getElementById('nps-close-btn');
    const copyBtn = document.getElementById('nps-copy-btn');
    const netflixSlider = document.getElementById('nps-netflix-slider');
    const netflixLabel = document.getElementById('nps-netflix-vol-label');
    const friendSlider = document.getElementById('nps-friend-slider');
    const friendLabel = document.getElementById('nps-friend-vol-label');
    const micBtn = document.getElementById('nps-toggle-mic');
    const camBtn = document.getElementById('nps-toggle-cam');
    const pipBtn = document.getElementById('nps-toggle-pip');
    const localPip = document.getElementById('nps-local-pip');
    const playPauseBtn = document.getElementById('nps-playpause-btn');
    const catchUpBtn = document.getElementById('nps-catchup-btn');
    const reconnectBtn = document.getElementById('nps-reconnect-btn');

    // Minimize & Restore
    minBtn.addEventListener('click', () => root.classList.add('nps-minimized'));
    pill.addEventListener('click', () => root.classList.remove('nps-minimized'));

    closeBtn.addEventListener('click', () => {
      root.style.display = 'none';
    });

    // Copy Invite Link
    copyBtn.addEventListener('click', () => {
      const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
      navigator.clipboard.writeText(inviteUrl).then(() => {
        showSyncAlert('🔗 Link Copied to Clipboard!');
      });
    });

    // Netflix Volume Slider
    netflixSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      netflixVolume = val / 100;
      netflixLabel.textContent = `${val}%`;
      window.postMessage({
        source: 'NETFLIX_PARTY_CONTENT',
        action: 'volume',
        volume: netflixVolume
      }, '*');
    });

    // Friend Voice Volume Slider (with boost)
    friendSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      friendVolume = val / 100;
      friendLabel.textContent = `${val}%`;
      if (friendGainNode) {
        friendGainNode.gain.value = friendVolume;
      }
    });

    // Mic Toggle (Independent Mute/Unmute)
    micBtn.addEventListener('click', () => {
      isAudioEnabled = !isAudioEnabled;
      if (localStream) {
        localStream.getAudioTracks().forEach(t => t.enabled = isAudioEnabled);
      }
      updateMediaUI();
      showSyncAlert(isAudioEnabled ? 'Microphone Active' : 'Microphone Disabled', isAudioEnabled ? '🎙️' : '🔇');
    });

    // Camera Toggle (Independent Video Enable/Disable)
    camBtn.addEventListener('click', () => {
      isVideoEnabled = !isVideoEnabled;
      if (localStream) {
        localStream.getVideoTracks().forEach(t => t.enabled = isVideoEnabled);
      }
      updateMediaUI();
      showSyncAlert(isVideoEnabled ? 'Camera Active' : 'Camera Disabled', isVideoEnabled ? '📹' : '🚫');
    });

    // PIP Self Preview Toggle
    pipBtn.addEventListener('click', () => {
      const isHidden = localPip.style.display === 'none';
      localPip.style.display = isHidden ? 'block' : 'none';
      pipBtn.classList.toggle('off', !isHidden);
    });

    // Play / Pause Toggle Button
    if (playPauseBtn) {
      playPauseBtn.addEventListener('click', () => {
        const nextAction = isPlayerPaused ? 'play' : 'pause';
        const video = document.querySelector('video');
        const now = video ? video.currentTime : lastKnownPlayerTime;
        ignoreLocalEventsUntil = Date.now() + 1500;
        simulateMediaControl(nextAction, now);
        broadcastSyncState(nextAction, now);
        showSyncAlert(`You ${nextAction}ed playback`, nextAction === 'play' ? '▶️' : '⏸️');
      });
    }

    // Catch-Up Sync Button
    if (catchUpBtn) {
      catchUpBtn.addEventListener('click', () => {
        const video = document.querySelector('video');
        const now = video ? video.currentTime : lastKnownPlayerTime;
        if (typeof currentRemoteTime === 'number' && currentRemoteTime > 0) {
          runCatchUpTo(currentRemoteTime, isPlayerPaused ? 'pause' : 'play', 'Friend');
        } else {
          // Broadcast catch-up request
          broadcastSyncState('request_catch_up', now);
          showSyncAlert('🎯 Sent catch-up request to friend', '📡');
        }
      });
    }

    reconnectBtn.addEventListener('click', () => {
      initWebSocket();
      showSyncAlert('Reconnecting...');
    });
  }

  function updateMediaUI() {
    const micBtn = document.getElementById('nps-toggle-mic');
    const camBtn = document.getElementById('nps-toggle-cam');
    const localVideo = document.getElementById('nps-local-video');
    const offLabel = document.getElementById('nps-local-off-label');
    const fillEl = document.getElementById('nps-mic-meter-fill');

    if (micBtn) {
      micBtn.classList.toggle('off', !isAudioEnabled);
      micBtn.innerHTML = isAudioEnabled ? '🎙️' : '🔇';
      micBtn.title = isAudioEnabled ? 'Microphone Active (Click to Mute)' : 'Microphone Disabled (Click to Unmute)';
    }

    if (!isAudioEnabled && fillEl) {
      fillEl.style.width = '0%';
    }

    if (camBtn) {
      camBtn.classList.toggle('off', !isVideoEnabled);
      camBtn.innerHTML = isVideoEnabled ? '📹' : '🚫';
      camBtn.title = isVideoEnabled ? 'Camera Active (Click to Turn Off)' : 'Camera Disabled (Click to Turn On)';
    }

    if (localVideo && offLabel) {
      localVideo.classList.toggle('hidden', !isVideoEnabled);
      offLabel.classList.toggle('hidden', isVideoEnabled);
    }
  }

  function showSyncAlert(msg, icon = '🎬') {
    const alertBox = document.getElementById('nps-sync-alert');
    const msgEl = document.getElementById('nps-alert-msg');
    const iconEl = document.getElementById('nps-alert-icon');
    if (!alertBox || !msgEl) return;

    iconEl.textContent = icon;
    msgEl.textContent = msg;
    alertBox.classList.add('active');

    clearTimeout(alertBox.__timer);
    alertBox.__timer = setTimeout(() => {
      alertBox.classList.remove('active');
    }, 2500);
  }

  function formatTime(seconds) {
    const sec = Math.floor(seconds || 0);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  // Web Audio Setup for Friend Voice
  function setupFriendAudioMixer(stream) {
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') {
        const resumeOnGesture = () => {
          audioCtx.resume();
          window.removeEventListener('click', resumeOnGesture);
        };
        window.addEventListener('click', resumeOnGesture);
      }

      if (stream.getAudioTracks().length > 0) {
        const source = audioCtx.createMediaStreamSource(stream);
        friendGainNode = audioCtx.createGain();
        friendGainNode.gain.value = friendVolume;
        source.connect(friendGainNode);
        friendGainNode.connect(audioCtx.destination);
        console.log('[Mixer] Friend Web Audio GainNode connected.');
      }
    } catch (e) {
      console.warn('[Mixer] Web Audio fallback to HTML audio element:', e);
    }
  }

  // WebRTC Setup
  let micMeterInterval = null;
  function setupLocalMicMeter(stream) {
    try {
      if (!stream || stream.getAudioTracks().length === 0) return;
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      const fillEl = document.getElementById('nps-mic-meter-fill');

      if (micMeterInterval) clearInterval(micMeterInterval);
      micMeterInterval = setInterval(() => {
        if (!fillEl || !isAudioEnabled) {
          if (fillEl) fillEl.style.width = '0%';
          return;
        }
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        const percent = Math.min(100, Math.round((avg / 128) * 100 * 1.6));
        fillEl.style.width = `${percent}%`;
      }, 50);
    } catch (e) {
      console.warn('[Mixer] Mic meter error:', e);
    }
  }

  // Optimize Opus SDP for Studio Broadcast Quality (48kHz, 128kbps, fullband stereo)
  function optimizeOpusSDP(sdp) {
    if (!sdp) return sdp;
    let lines = sdp.split('\r\n');
    let opusPt = null;
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^a=rtpmap:(\d+)\s+opus\/48000/i);
      if (match) {
        opusPt = match[1];
        break;
      }
    }
    if (opusPt) {
      let fmtpFound = false;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith(`a=fmtp:${opusPt}`)) {
          fmtpFound = true;
          if (!lines[i].includes('maxaveragebitrate')) {
            lines[i] = `${lines[i]};maxaveragebitrate=128000;stereo=1;sprop-stereo=1;cbr=1;useinbandfec=1`;
          }
          break;
        }
      }
      if (!fmtpFound) {
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith(`a=rtpmap:${opusPt}`)) {
            lines.splice(i + 1, 0, `a=fmtp:${opusPt} minptime=10;useinbandfec=1;maxaveragebitrate=128000;stereo=1;sprop-stereo=1;cbr=1`);
            break;
          }
        }
      }
    }
    return lines.join('\r\n');
  }

  function applyHighBitrateSenders() {
    if (!pc) return;
    try {
      pc.getSenders().forEach((sender) => {
        if (sender.track && sender.track.kind === 'audio') {
          const params = sender.getParameters();
          if (params.encodings && params.encodings.length > 0) {
            params.encodings[0].maxBitrate = 128000;
            params.encodings[0].networkPriority = 'high';
            sender.setParameters(params).catch(() => {});
          }
        }
      });
    } catch (e) {}
  }

  let activeMicDeviceId = null;

  async function getAudioInputDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(d => d.kind === 'audioinput');
    } catch (e) {
      return [];
    }
  }

  function pickBestBuiltInMic(inputs) {
    if (!inputs || inputs.length === 0) return null;
    const builtInPatterns = [/built-in/i, /internal/i, /macbook/i, /microphone array/i, /realtek/i, /intel/i, /default/i];
    for (const pat of builtInPatterns) {
      const found = inputs.find(d => pat.test(d.label));
      if (found) return found;
    }
    const btPatterns = [/bluetooth/i, /airpods/i, /headset/i, /wh-1000/i, /galaxy buds/i, /freebuds/i, /bose/i, /pixel buds/i];
    const nonBt = inputs.find(d => !btPatterns.some(p => p.test(d.label)));
    if (nonBt) return nonBt;
    return inputs[0];
  }

  function populateMicSelect(inputs, selectedId) {
    const select = document.getElementById('nps-mic-select');
    if (!select || !inputs || inputs.length === 0) return;
    select.innerHTML = '';
    inputs.forEach((d, idx) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Microphone ${idx + 1}`;
      if (d.deviceId === selectedId) opt.selected = true;
      select.appendChild(opt);
    });

    select.onchange = async () => {
      await switchMicrophone(select.value);
    };
  }

  async function switchMicrophone(deviceId) {
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: { ideal: 48000 },
          channelCount: { ideal: 2 }
        }
      });
      const newTrack = newStream.getAudioTracks()[0];
      if (localStream) {
        const oldTrack = localStream.getAudioTracks()[0];
        if (oldTrack) {
          localStream.removeTrack(oldTrack);
          oldTrack.stop();
        }
        localStream.addTrack(newTrack);
      }
      if (pc) {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
        if (sender) {
          await sender.replaceTrack(newTrack);
          applyHighBitrateSenders();
        }
      }
      setupLocalMicMeter(localStream);
      activeMicDeviceId = deviceId;
      showSyncAlert('Switched to: ' + (newTrack.label || 'Mic'), '🎙️');
    } catch (e) {
      console.warn('[Mixer] Failed to switch microphone:', e);
    }
  }

  async function initLocalMedia() {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,    // Eliminates acoustic leakage from loud headphones
          noiseSuppression: true,    // Cuts laptop fan hum, AC hum, keyboard clicks
          autoGainControl: true,     // Balances voice level
          sampleRate: { ideal: 48000 },
          channelCount: { ideal: 2 }
        },
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { max: 24 } }
      });

      // Apply initial audio/video toggle preferences
      localStream.getAudioTracks().forEach(t => t.enabled = isAudioEnabled);
      localStream.getVideoTracks().forEach(t => t.enabled = isVideoEnabled);
      updateMediaUI();

      // Discover devices and ensure Built-in mic is picked (locking Bluetooth in A2DP)
      const inputs = await getAudioInputDevices();
      const bestBuiltIn = pickBestBuiltInMic(inputs);

      if (bestBuiltIn && bestBuiltIn.deviceId) {
        activeMicDeviceId = bestBuiltIn.deviceId;
        const currentLabel = localStream.getAudioTracks()[0]?.label || '';
        const btKeywords = [/airpods/i, /bluetooth/i, /headset/i, /wh-1000/i, /bose/i, /galaxy buds/i];
        if (btKeywords.some(p => p.test(currentLabel)) && bestBuiltIn.deviceId !== localStream.getAudioTracks()[0]?.getSettings()?.deviceId) {
          await switchMicrophone(bestBuiltIn.deviceId);
        }
        populateMicSelect(inputs, activeMicDeviceId);
      } else {
        populateMicSelect(inputs, localStream.getAudioTracks()[0]?.getSettings()?.deviceId);
      }

      const localVideo = document.getElementById('nps-local-video');
      if (localVideo) {
        localVideo.srcObject = localStream;
      }
      setupLocalMicMeter(localStream);
    } catch (err) {
      console.warn('[WebRTC] Camera/Mic access denied or unavailable. Joining in sync-only mode.', err);
      localStream = new MediaStream();
    }
  }

  async function createPeerConnection(isInitiator, targetPeerId) {
    if (pc) pc.close();

    pc = new RTCPeerConnection(rtcConfig);

    // Add local tracks
    if (localStream) {
      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    // Create Data Channel for ultra-low latency sync
    if (isInitiator) {
      dataChannel = pc.createDataChannel('sync-channel', { ordered: true });
      setupDataChannel(dataChannel);
    } else {
      pc.ondatachannel = (e) => {
        dataChannel = e.channel;
        setupDataChannel(dataChannel);
      };
    }

    // Handle remote tracks
    pc.ontrack = (event) => {
      console.log('[WebRTC] Received remote track:', event.track.kind);
      const remoteVideo = document.getElementById('nps-remote-video');
      const placeholder = document.getElementById('nps-avatar-placeholder');
      remoteStream = event.streams[0] || new MediaStream([event.track]);

      if (remoteVideo) {
        remoteVideo.srcObject = remoteStream;
        remoteVideo.classList.remove('hidden');
        if (placeholder) placeholder.style.display = 'none';
      }

      if (event.track.kind === 'audio') {
        setupFriendAudioMixer(remoteStream);
      }
    };

    // ICE Candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && sigClient) {
        sigClient.send({
          type: 'signal',
          targetId: targetPeerId,
          signal: { candidate: event.candidate }
        });
      }
    };

    if (isInitiator) {
      const offer = await pc.createOffer();
      const enhancedSdp = optimizeOpusSDP(offer.sdp);
      await pc.setLocalDescription({ type: offer.type, sdp: enhancedSdp });
      applyHighBitrateSenders();
      if (sigClient) {
        sigClient.send({
          type: 'signal',
          targetId: targetPeerId,
          signal: { sdp: pc.localDescription }
        });
      }
    }
  }

  function setupDataChannel(dc) {
    dc.onopen = () => console.log('[DataChannel] Peer Data Channel OPEN');
    dc.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleRemoteSyncMessage(data);
      } catch (e) {}
    };
  }

  // Universal Cloud / Local Signaling Connection
  function initWebSocket() {
    if (sigClient) {
      try { sigClient.close(); } catch (e) {}
    }

    const dot = document.getElementById('nps-status-dot');
    const pillDot = document.getElementById('nps-pill-dot');

    sigClient = new UniversalSignalingClient({
      roomId: roomId,
      peerId: peerId,
      userName: userName,
      serverUrl: serverWsUrl,
      onStatusChange: (status) => {
        const isConn = status === 'connected';
        if (dot) dot.className = isConn ? 'nps-status-dot connected' : 'nps-status-dot disconnected';
        if (pillDot) pillDot.className = isConn ? 'nps-status-dot connected' : 'nps-status-dot disconnected';
      },
      onMessage: async (msg) => {
        try {
          if (msg.type === 'joined') {
            console.log('[Signaling] Joined room', msg.roomId, 'Existing peers:', msg.peers);
            if (msg.peers && msg.peers.length > 0) {
              const peer = msg.peers[0];
              updateFriendInfo(peer.userName);
              await createPeerConnection(true, peer.peerId);
            }
          } else if (msg.type === 'peer-joined') {
            console.log('[Signaling] Peer joined room:', msg.peerId);
            updateFriendInfo(msg.userName);
            showSyncAlert(`${msg.userName} joined!`, '👋');
            await createPeerConnection(false, msg.peerId);
          } else if (msg.type === 'signal') {
            handleSignalingData(msg.signal, msg.senderId);
          } else if (msg.type === 'sync') {
            handleRemoteSyncMessage(msg);
          } else if (msg.type === 'peer-left') {
            showSyncAlert(`${msg.userName || 'Friend'} left`, '👋');
            resetFriendUI();
          }
        } catch (e) {
          console.error('[Signaling Message Error]', e);
        }
      }
    });

    sigClient.connect();
  }

  async function handleSignalingData(signal, senderId) {
    if (!pc) {
      await createPeerConnection(false, senderId);
    }

    if (signal.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      if (signal.sdp.type === 'offer') {
        const answer = await pc.createAnswer();
        const enhancedSdp = optimizeOpusSDP(answer.sdp);
        await pc.setLocalDescription({ type: answer.type, sdp: enhancedSdp });
        applyHighBitrateSenders();
        if (sigClient) {
          sigClient.send({
            type: 'signal',
            targetId: senderId,
            signal: { sdp: pc.localDescription }
          });
        }
      }
    } else if (signal.candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } catch (e) {
        console.warn('[WebRTC] Candidate error:', e);
      }
    }
  }

  function updateFriendInfo(name) {
    const avatarName = document.getElementById('nps-avatar-name');
    const avatarCircle = document.getElementById('nps-avatar-circle');
    if (avatarName) avatarName.textContent = name || 'Friend';
    if (avatarCircle) avatarCircle.textContent = (name || 'F').charAt(0).toUpperCase();
  }

  function resetFriendUI() {
    const remoteVideo = document.getElementById('nps-remote-video');
    const placeholder = document.getElementById('nps-avatar-placeholder');
    if (remoteVideo) {
      remoteVideo.srcObject = null;
      remoteVideo.classList.add('hidden');
    }
    if (placeholder) {
      placeholder.style.display = 'flex';
      updateFriendInfo('Waiting for friend...');
    }
  }

  // Multi-tier Media Control & Key Emulation
  function simulateMediaControl(action, time) {
    const video = document.querySelector('video');
    const isPaused = video ? video.paused : isPlayerPaused;

    // Time seeking if difference is significant (> 1.2s)
    if (typeof time === 'number' && !isNaN(time) && video) {
      if (Math.abs(video.currentTime - time) > 1.2) {
        try { video.currentTime = time; } catch (e) {}
      }
    }

    // 1. Direct HTML5 Video execution (instant, zero-latency)
    if (video) {
      try {
        if (action === 'play' && video.paused) {
          const playPromise = video.play();
          if (playPromise && playPromise.catch) {
            playPromise.catch(() => {});
          }
        } else if (action === 'pause' && !video.paused) {
          video.pause();
        } else if (action === 'seek' && typeof time === 'number') {
          video.currentTime = time;
        }
      } catch (e) {}
    }

    // 2. Click Netflix React UI Control Buttons if present
    try {
      const btnSelector = (action === 'play')
        ? '[data-uia="control-play-pause-play"], button[aria-label="Play"], .button-nfplayerPlay'
        : '[data-uia="control-play-pause-pause"], button[aria-label="Pause"], .button-nfplayerPause';
      const btn = document.querySelector(btnSelector);
      if (btn) {
        btn.click();
      } else {
        // 3. Media key emulation (MediaPlayPause & Space key events)
        const needsStateChange = (action === 'play' && isPaused) || (action === 'pause' && !isPaused);
        if (needsStateChange) {
          const target = video || document.querySelector('.watch-video--player-view') || document.activeElement || document.body;
          // Dispatch MediaPlayPause (keyCode 179)
          target.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'MediaPlayPause',
            code: 'MediaPlayPause',
            keyCode: 179,
            which: 179,
            bubbles: true,
            cancelable: true
          }));
          // Dispatch Spacebar (keyCode 32)
          target.dispatchEvent(new KeyboardEvent('keydown', {
            key: ' ',
            code: 'Space',
            keyCode: 32,
            which: 32,
            bubbles: true,
            cancelable: true
          }));
          target.dispatchEvent(new KeyboardEvent('keyup', {
            key: ' ',
            code: 'Space',
            keyCode: 32,
            which: 32,
            bubbles: true,
            cancelable: true
          }));
        }
      }
    } catch (e) {}

    // 4. Send command to Main World Bridge (Cadmium internal Netflix API)
    window.postMessage({
      source: 'NETFLIX_PARTY_CONTENT',
      action: action,
      time: time
    }, '*');
  }

  // Catch-Up Sync Execution: Plays behind party until aligned, keeping ahead party paused
  function stopCatchUp() {
    if (catchUpInterval) {
      clearInterval(catchUpInterval);
      catchUpInterval = null;
    }
  }

  function runCatchUpTo(targetTime, desiredAction = 'pause', sender = 'Friend') {
    stopCatchUp();

    const video = document.querySelector('video');
    const localTime = video ? video.currentTime : lastKnownPlayerTime;
    const diff = targetTime - localTime;

    // Within 0.4s: Already aligned!
    if (Math.abs(diff) <= 0.4) {
      ignoreLocalEventsUntil = Date.now() + 1500;
      simulateMediaControl(desiredAction, targetTime);
      showSyncAlert(`🎯 In sync with ${sender}! (${formatTime(targetTime)})`, desiredAction === 'pause' ? '⏸️' : '▶️');
      return;
    }

    // SCENARIO 1: Remote is ahead (targetTime > localTime) -> Local user is behind
    // Action: Play local video until catching up to remote's time!
    if (diff > 0.4) {
      ignoreLocalEventsUntil = Date.now() + 60000; // Suppress play bounce during catch-up run
      simulateMediaControl('play', localTime);
      showSyncAlert(`⏩ Catching up to ${sender} (${diff.toFixed(1)}s behind)...`, '⚡');

      catchUpInterval = setInterval(() => {
        const now = video ? video.currentTime : lastKnownPlayerTime;
        if (now >= targetTime - 0.25 || now > targetTime) {
          stopCatchUp();
          ignoreLocalEventsUntil = Date.now() + 1500;
          simulateMediaControl(desiredAction, targetTime);
          showSyncAlert(`🎯 Caught up to ${sender} at ${formatTime(targetTime)}!`, '✅');
          broadcastSyncState('caught_up', now);
        }
      }, 50);
      return;
    }

    // SCENARIO 2: Local user is ahead (localTime > targetTime) -> Remote is behind
    // Action: Local user pauses and waits while keeping friend's catch-up running!
    if (diff < -0.4) {
      ignoreLocalEventsUntil = Date.now() + 1500;
      simulateMediaControl('pause', localTime);
      showSyncAlert(`⏸️ Paused: Waiting for ${sender} to catch up (${Math.abs(diff).toFixed(1)}s behind)...`, '⏳');
      // Tell remote peer to catch up to our local position
      broadcastSyncState('request_catch_up', localTime);
    }
  }

  // Remote Sync Execution & Show Compatibility Check
  function handleRemoteSyncMessage(msg) {
    const action = msg.action;
    const time = msg.time;
    const sender = msg.userName || 'Friend';

    if (msg.videoId) {
      remoteVideoId = msg.videoId;
      remoteTitle = msg.title || 'Friend\'s Show';
      checkShowSync();
    }

    const video = document.querySelector('video');
    const localTime = video ? video.currentTime : lastKnownPlayerTime;

    if (action === 'pause') {
      currentRemoteTime = time;
      // If remote paused ahead of us by > 1.8s, catch up to their pause point!
      if (typeof time === 'number' && (time - localTime) > 1.8) {
        runCatchUpTo(time, 'pause', sender);
      } else {
        stopCatchUp();
        ignoreLocalEventsUntil = Date.now() + 1500;
        simulateMediaControl('pause', time);
        showSyncAlert(`${sender} paused at ${formatTime(time)}`, '⏸️');
      }
    } else if (action === 'play') {
      currentRemoteTime = time;
      // If remote played ahead of us by > 1.8s, catch up and continue playing
      if (typeof time === 'number' && (time - localTime) > 1.8) {
        runCatchUpTo(time, 'play', sender);
      } else {
        stopCatchUp();
        ignoreLocalEventsUntil = Date.now() + 1500;
        simulateMediaControl('play', time);
        showSyncAlert(`${sender} played at ${formatTime(time)}`, '▶️');
      }
    } else if (action === 'seek') {
      stopCatchUp();
      currentRemoteTime = time;
      ignoreLocalEventsUntil = Date.now() + 1500;
      simulateMediaControl('seek', time);
      showSyncAlert(`${sender} jumped to ${formatTime(time)}`, '⏩');
    } else if (action === 'request_catch_up') {
      if (typeof time === 'number') {
        runCatchUpTo(time, isPlayerPaused ? 'pause' : 'play', sender);
      }
    } else if (action === 'caught_up') {
      stopCatchUp();
      showSyncAlert(`🎯 ${sender} caught up! Both in sync at ${formatTime(time)}`, '✅');
    } else if (action === 'show_info') {
      checkShowSync();
    }
  }

  function checkShowSync() {
    const banner = document.getElementById('nps-show-banner');
    const text = document.getElementById('nps-show-text');
    const btn = document.getElementById('nps-jump-btn');
    if (!banner || !text || !btn) return;

    if (remoteVideoId && currentLocalVideoId && remoteVideoId !== currentLocalVideoId) {
      banner.classList.remove('hidden');
      banner.classList.add('mismatch');
      text.textContent = `⚠️ Friend watching: ${remoteTitle || 'Different Episode'}`;
      btn.style.display = 'block';
      btn.onclick = () => {
        window.location.href = `https://www.netflix.com/watch/${remoteVideoId}`;
      };
    } else if (currentLocalTitle) {
      banner.classList.remove('hidden');
      banner.classList.remove('mismatch');
      text.textContent = `🎬 ${currentLocalTitle}`;
      btn.style.display = 'none';
    }
  }

  function broadcastSyncState(action, time, extra = {}) {
    const payload = {
      type: 'sync',
      action: action,
      time: time,
      userName: userName,
      videoId: currentLocalVideoId,
      title: currentLocalTitle,
      timestamp: Date.now(),
      ...extra
    };

    // Priority 1: Send via WebRTC DataChannel (zero-latency P2P)
    if (dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(JSON.stringify(payload));
    }

    // Priority 2: Also relay via Serverless Cloud Signaling so both peers stay synced regardless of P2P state
    if (sigClient) {
      sigClient.send(payload);
    }
  }

  // Bridge Listener: State changes & User interactions reported by Netflix player
  window.addEventListener('message', (event) => {
    if (!event.data || event.data.source !== 'NETFLIX_PARTY_BRIDGE') return;

    if (event.data.type === 'time_update') {
      const { currentTime, duration, isPaused, metadata } = event.data;
      lastKnownPlayerTime = currentTime;
      isPlayerPaused = isPaused;

      if (metadata && metadata.videoId) {
        if (currentLocalVideoId !== metadata.videoId) {
          currentLocalVideoId = metadata.videoId;
          currentLocalTitle = metadata.title || '';
          checkShowSync();
          broadcastSyncState('show_info', currentTime);
        }
      }

      // Update UI readout only (never broadcasts to network)
      const timecode = document.getElementById('nps-timecode-label');
      const pillTime = document.getElementById('nps-pill-time');
      if (timecode) {
        timecode.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
      }
      if (pillTime) {
        pillTime.textContent = formatTime(currentTime);
      }
      return;
    }

    // Genuine user action inside Netflix player (Spacebar, Pause button, Play button, Timeline scrub)
    if (event.data.type === 'user_action') {
      // Guard against echoing remote executions
      if (Date.now() < ignoreLocalEventsUntil) {
        return;
      }

      const { action, time, metadata } = event.data;
      lastKnownPlayerTime = time;
      isPlayerPaused = (action === 'pause');

      if (metadata && metadata.videoId) {
        currentLocalVideoId = metadata.videoId;
        currentLocalTitle = metadata.title || '';
      }

      // Broadcast automatically to friend
      broadcastSyncState(action, time);
      showSyncAlert(action === 'pause' ? 'You paused' : (action === 'seek' ? 'You jumped' : 'You played'), 
                    action === 'pause' ? '⏸️' : (action === 'seek' ? '⏩' : '▶️'));
    }
  });

  // Storage / Settings initialization
  function loadConfigAndStart() {
    function onConfigLoaded(config) {
      if (config.roomId) roomId = config.roomId;
      if (config.serverUrl) serverWsUrl = config.serverUrl;
      if (config.userName) userName = config.userName;
      if (typeof config.audioEnabled === 'boolean') isAudioEnabled = config.audioEnabled;
      if (typeof config.videoEnabled === 'boolean') isVideoEnabled = config.videoEnabled;

      // Auto-detect ws vs wss and host if serverWsUrl is default localhost and page is loaded elsewhere
      if (serverWsUrl.includes('localhost') && window.location.hostname && window.location.hostname !== 'localhost') {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        serverWsUrl = `${proto}//${window.location.host}/ws`;
      }

      // Check URL query parameters for ?room=XYZ
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('room')) {
        roomId = urlParams.get('room').toUpperCase();
      }

      buildOverlayDOM();
      initLocalMedia().then(() => {
        initWebSocket();
      });
    }

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['roomId', 'serverUrl', 'userName', 'audioEnabled', 'videoEnabled'], (res) => {
        onConfigLoaded(res || {});
      });
    } else {
      // Standalone web mode fallback
      try {
        const saved = JSON.parse(localStorage.getItem('nps_config') || '{}');
        onConfigLoaded(saved);
      } catch (e) {
        onConfigLoaded({});
      }
    }
  }

  // Wait until document body is ready
  if (document.body) {
    loadConfigAndStart();
  } else {
    document.addEventListener('DOMContentLoaded', loadConfigAndStart);
  }
})();
