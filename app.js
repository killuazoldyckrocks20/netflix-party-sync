/**
 * Netflix Party Sync - Mobile Companion & Web App
 * Handles WebRTC 2-way AV call, Master Playback Controller, and Audio Mixer
 */

(function () {
  'use strict';

  // DOM Elements
  const joinCard = document.getElementById('join-card');
  const partyView = document.getElementById('party-view');
  const inputRoom = document.getElementById('input-room');
  const inputName = document.getElementById('input-name');
  const btnJoin = document.getElementById('btn-join');
  const roomTag = document.getElementById('room-tag');
  const statusDot = document.getElementById('status-dot');
  const roomCodeDisplay = document.getElementById('room-code-display');

  const remoteVideo = document.getElementById('remote-video');
  const localVideo = document.getElementById('local-video');
  const avatarView = document.getElementById('avatar-view');
  const avatarCircle = document.getElementById('avatar-circle');
  const avatarName = document.getElementById('avatar-name');
  const btnPip = document.getElementById('btn-pip');

  const syncBanner = document.getElementById('sync-banner');
  const syncBannerIcon = document.getElementById('sync-banner-icon');
  const syncBannerText = document.getElementById('sync-banner-text');

  const timecodeDisplay = document.getElementById('timecode-display');
  const syncStatePill = document.getElementById('sync-state-pill');
  const btnMasterPlayPause = document.getElementById('btn-master-playpause');
  const playPauseIcon = document.getElementById('playpause-icon');
  const playPauseLabel = document.getElementById('playpause-label');
  const btnSeekBack = document.getElementById('btn-seek-back');
  const btnSeekFwd = document.getElementById('btn-seek-fwd');
  const btnOpenNetflix = document.getElementById('btn-open-netflix');

  const friendVolSlider = document.getElementById('friend-vol-slider');
  const friendVolVal = document.getElementById('friend-vol-val');
  const netflixVolSlider = document.getElementById('netflix-vol-slider');
  const netflixVolVal = document.getElementById('netflix-vol-val');

  const btnMic = document.getElementById('btn-mic');
  const btnCam = document.getElementById('btn-cam');
  const btnShare = document.getElementById('btn-share');
  const btnLeave = document.getElementById('btn-leave');

  // State
  let sigClient = null;
  let pc = null;
  let dataChannel = null;
  let localStream = null;
  let remoteStream = null;
  let audioCtx = null;
  let friendGain = null;

  let roomId = 'PARTY77';
  let peerId = 'peer-' + Math.random().toString(36).substring(2, 9);
  let userName = 'Friend';
  let isPlaying = false;
  let currentTime = 0;
  let isMicActive = true;
  let isCamActive = true;

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // Pre-fill room code from URL params
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('room')) {
    inputRoom.value = urlParams.get('room').toUpperCase();
  } else {
    inputRoom.value = 'PARTY77';
  }
  inputName.value = 'Mobile ' + Math.floor(Math.random() * 90 + 10);

  // Synced Media Player Element (for in-browser synced test playback)
  const syncMediaPlayer = document.getElementById('sync-media-player');
  let ignoreLocalMediaEvents = 0;

  if (syncMediaPlayer) {
    syncMediaPlayer.addEventListener('play', () => {
      if (Date.now() < ignoreLocalMediaEvents) return;
      isPlaying = true;
      currentTime = syncMediaPlayer.currentTime;
      updatePlayPauseUI();
      broadcastAction('play', currentTime);
      showBanner('Playing synced media', '▶️');
    });

    syncMediaPlayer.addEventListener('pause', () => {
      if (Date.now() < ignoreLocalMediaEvents) return;
      isPlaying = false;
      currentTime = syncMediaPlayer.currentTime;
      updatePlayPauseUI();
      broadcastAction('pause', currentTime);
      showBanner('Paused synced media', '⏸️');
    });

    syncMediaPlayer.addEventListener('timeupdate', () => {
      currentTime = syncMediaPlayer.currentTime;
      timecodeDisplay.textContent = formatTime(currentTime);
    });

    syncMediaPlayer.addEventListener('seeked', () => {
      if (Date.now() < ignoreLocalMediaEvents) return;
      currentTime = syncMediaPlayer.currentTime;
      broadcastAction('seek', currentTime);
      showBanner(`Jumped to ${formatTime(currentTime)}`, '⏩');
    });
  }

  // Time Formatter
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

  function showBanner(text, icon = '🎬') {
    syncBannerIcon.textContent = icon;
    syncBannerText.textContent = text;
    syncBanner.classList.remove('hidden');

    // Haptic feedback on mobile if supported
    if ('vibrate' in navigator) {
      try { navigator.vibrate(80); } catch (e) {}
    }

    clearTimeout(syncBanner.__timer);
    syncBanner.__timer = setTimeout(() => {
      syncBanner.classList.add('hidden');
    }, 3000);
  }

  // Join Button
  btnJoin.addEventListener('click', async () => {
    roomId = inputRoom.value.trim().toUpperCase() || 'PARTY77';
    userName = inputName.value.trim() || 'Mobile User';

    joinCard.classList.add('hidden');
    partyView.classList.remove('hidden');
    roomCodeDisplay.textContent = roomId;

    updatePlayPauseUI();
    if (syncMediaPlayer) {
      try { syncMediaPlayer.load(); } catch (e) {}
    }
    await initMedia();
    initWebSocket();
  });

  // Media Permissions & Stream Setup (Optional AV)
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
      const fillEl = document.getElementById('mic-meter-fill');

      if (micMeterInterval) clearInterval(micMeterInterval);
      micMeterInterval = setInterval(() => {
        if (!fillEl || !isMicActive) {
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

  let activePhoneMicId = null;

  async function getPhoneAudioInputs() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(d => d.kind === 'audioinput');
    } catch (e) {
      return [];
    }
  }

  function pickBestPhoneMic(inputs) {
    if (!inputs || inputs.length === 0) return null;
    const builtInPatterns = [/built-in/i, /internal/i, /phone/i, /bottom/i, /default/i];
    for (const pat of builtInPatterns) {
      const found = inputs.find(d => pat.test(d.label));
      if (found) return found;
    }
    const btPatterns = [/bluetooth/i, /airpods/i, /headset/i, /buds/i];
    const nonBt = inputs.find(d => !btPatterns.some(p => p.test(d.label)));
    if (nonBt) return nonBt;
    return inputs[0];
  }

  function populatePhoneMicSelect(inputs, selectedId) {
    const select = document.getElementById('phone-mic-select');
    if (!select || !inputs || inputs.length === 0) return;
    select.innerHTML = '';
    inputs.forEach((d, idx) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Mic ${idx + 1}`;
      if (d.deviceId === selectedId) opt.selected = true;
      select.appendChild(opt);
    });

    select.onchange = async () => {
      await switchPhoneMic(select.value);
    };
  }

  async function switchPhoneMic(deviceId) {
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
      activePhoneMicId = deviceId;
      showBanner('Switched to: ' + (newTrack.label || 'Mic'), '🎙️');
    } catch (e) {
      console.warn('[PhoneMixer] Failed to switch microphone:', e);
    }
  }

  async function initMedia() {
    localStream = new MediaStream();

    // 1. Prompt for Microphone permission FIRST
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,    // Eliminates acoustic leakage from loud headphones
          noiseSuppression: true,    // Cuts fan hum, AC hum, keyboard clicks
          autoGainControl: true,     // Balances voice level
          sampleRate: { ideal: 48000 },
          channelCount: { ideal: 2 }
        }
      });
      const aTrack = audioStream.getAudioTracks()[0];
      if (aTrack) {
        localStream.addTrack(aTrack);
        isMicActive = true;
        btnMic.classList.remove('off');
        btnMic.textContent = '🎙️';
      }
    } catch (audioErr) {
      console.warn('[Media] Microphone permission blocked or unavailable:', audioErr);
      isMicActive = false;
      btnMic.classList.add('off');
      btnMic.textContent = '🔇';
    }

    // 2. Prompt for Camera permission SECOND (one after another)
    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
      });
      const vTrack = videoStream.getVideoTracks()[0];
      if (vTrack) {
        localStream.addTrack(vTrack);
        isCamActive = true;
        btnCam.classList.remove('off');
        btnCam.textContent = '📹';
        localVideo.classList.remove('hidden');
      }
    } catch (videoErr) {
      console.warn('[Media] Camera permission blocked or unavailable:', videoErr);
      isCamActive = false;
      btnCam.classList.add('off');
      btnCam.textContent = '🚫';
      localVideo.classList.add('hidden');
    }

    // Configure Built-in mic isolation if audio is available
    if (isMicActive && localStream.getAudioTracks().length > 0) {
      try {
        const inputs = await getPhoneAudioInputs();
        const best = pickBestPhoneMic(inputs);
        if (best && best.deviceId) {
          activePhoneMicId = best.deviceId;
          const currentLabel = localStream.getAudioTracks()[0]?.label || '';
          const btKeywords = [/airpods/i, /bluetooth/i, /headset/i, /buds/i];
          if (btKeywords.some(p => p.test(currentLabel)) && best.deviceId !== localStream.getAudioTracks()[0]?.getSettings()?.deviceId) {
            await switchPhoneMic(best.deviceId);
          }
          populatePhoneMicSelect(inputs, activePhoneMicId);
        } else {
          populatePhoneMicSelect(inputs, localStream.getAudioTracks()[0]?.getSettings()?.deviceId);
        }
        setupLocalMicMeter(localStream);
      } catch (e) {
        console.warn('[Media] Mic setup error:', e);
      }
    }

    localVideo.srcObject = localStream;
  }

  // Web Audio Mixer for Friend's Voice
  function attachFriendAudio(stream) {
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') {
        const resume = () => {
          audioCtx.resume();
          window.removeEventListener('touchstart', resume);
          window.removeEventListener('click', resume);
        };
        window.addEventListener('touchstart', resume);
        window.addEventListener('click', resume);
      }
      if (stream.getAudioTracks().length > 0) {
        const source = audioCtx.createMediaStreamSource(stream);
        friendGain = audioCtx.createGain();
        friendGain.gain.value = parseInt(friendVolSlider.value, 10) / 100;
        source.connect(friendGain);
        friendGain.connect(audioCtx.destination);
      }
    } catch (err) {
      console.warn('[AudioMixer] Web Audio error:', err);
    }
  }

  // WebRTC Peer Connection
  async function createPeerConnection(isInitiator, targetPeerId) {
    if (pc) pc.close();

    pc = new RTCPeerConnection(rtcConfig);

    if (localStream) {
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    }

    if (isInitiator) {
      dataChannel = pc.createDataChannel('sync-channel', { ordered: true });
      setupDataChannel(dataChannel);
    } else {
      pc.ondatachannel = (e) => {
        dataChannel = e.channel;
        setupDataChannel(dataChannel);
      };
    }

    pc.ontrack = (event) => {
      remoteStream = event.streams[0] || new MediaStream([event.track]);
      remoteVideo.srcObject = remoteStream;
      remoteVideo.classList.remove('hidden');
      avatarView.classList.add('hidden');

      if (event.track.kind === 'audio') {
        attachFriendAudio(remoteStream);
      }
    };

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
    dc.onopen = () => console.log('[DataChannel] Mobile P2P Connected');
    dc.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleSyncMessage(msg);
      } catch (e) {}
    };
  }

  // Universal Cloud & Local Signaling Connection
  function initWebSocket() {
    if (sigClient) {
      try { sigClient.close(); } catch (e) {}
    }

    let serverMode = 'cloud';
    const host = window.location.host;
    if (host.includes('localhost') || host.includes('127.0.0.1')) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      serverMode = `${protocol}//${host}/ws`;
    }

    sigClient = new UniversalSignalingClient({
      roomId: roomId,
      peerId: peerId,
      userName: userName,
      serverUrl: serverMode,
      onStatusChange: (status) => {
        statusDot.className = status === 'connected' ? 'status-dot connected' : 'status-dot disconnected';
      },
      onMessage: async (msg) => {
        try {
          if (msg.type === 'joined') {
            if (msg.peers && msg.peers.length > 0) {
              const peer = msg.peers[0];
              updateFriendInfo(peer.userName);
              await createPeerConnection(true, peer.peerId);
              broadcastAction('request_state', currentTime);
            }
          } else if (msg.type === 'peer-joined') {
            updateFriendInfo(msg.userName);
            showBanner(`${msg.userName} joined!`, '👋');
            await createPeerConnection(false, msg.peerId);
            setTimeout(() => {
              broadcastAction(isPlaying ? 'play' : 'pause', currentTime);
            }, 600);
          } else if (msg.type === 'signal') {
            handleSignaling(msg.signal, msg.senderId);
          } else if (msg.type === 'sync') {
            handleSyncMessage(msg);
          } else if (msg.type === 'peer-left') {
            showBanner(`${msg.userName || 'Friend'} disconnected`, '👋');
            remoteVideo.srcObject = null;
            remoteVideo.classList.add('hidden');
            avatarView.classList.remove('hidden');
            updateFriendInfo('Friend left');
          }
        } catch (e) {
          console.error('[Signaling Parse]', e);
        }
      }
    });

    sigClient.connect();
  }

  async function handleSignaling(signal, senderId) {
    if (!pc) await createPeerConnection(false, senderId);

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
      } catch (e) {}
    }
  }

  function updateFriendInfo(name) {
    avatarName.textContent = name || 'Friend';
    avatarCircle.textContent = (name || 'F').charAt(0).toUpperCase();
  }

  // Playback Synchronization Logic & Real-time Clock Ticker
  let playbackTicker = null;

  function startPlaybackTicker() {
    if (playbackTicker) clearInterval(playbackTicker);
    let lastTick = performance.now();
    playbackTicker = setInterval(() => {
      if (!isPlaying) {
        stopPlaybackTicker();
        return;
      }
      const now = performance.now();
      const delta = (now - lastTick) / 1000;
      lastTick = now;
      currentTime += delta;
      timecodeDisplay.textContent = formatTime(currentTime);
    }, 200);
  }

  function stopPlaybackTicker() {
    if (playbackTicker) {
      clearInterval(playbackTicker);
      playbackTicker = null;
    }
  }

  let catchUpInterval = null;

  function stopCatchUp() {
    if (catchUpInterval) {
      clearInterval(catchUpInterval);
      catchUpInterval = null;
    }
  }

  function runCatchUpTo(targetTime, desiredAction = 'pause', sender = 'Friend') {
    stopCatchUp();
    stopPlaybackTicker();
    const diff = targetTime - currentTime;

    if (Math.abs(diff) <= 0.4) {
      currentTime = targetTime;
      isPlaying = (desiredAction === 'play');
      timecodeDisplay.textContent = formatTime(currentTime);
      updatePlayPauseUI();
      showBanner(`🎯 In sync with ${sender}! (${formatTime(targetTime)})`, desiredAction === 'pause' ? '⏸️' : '▶️');
      return;
    }

    if (diff > 0.4) {
      isPlaying = true;
      updatePlayPauseUI();
      showBanner(`⏩ Catching up to ${sender} (${diff.toFixed(1)}s behind)...`, '⚡');

      catchUpInterval = setInterval(() => {
        currentTime += 0.25;
        timecodeDisplay.textContent = formatTime(currentTime);
        if (currentTime >= targetTime - 0.25 || currentTime > targetTime) {
          stopCatchUp();
          currentTime = targetTime;
          isPlaying = (desiredAction === 'play');
          timecodeDisplay.textContent = formatTime(currentTime);
          updatePlayPauseUI();
          showBanner(`🎯 Caught up to ${sender} at ${formatTime(targetTime)}!`, '✅');
          broadcastAction('caught_up', currentTime);
        }
      }, 50);
    } else {
      isPlaying = false;
      updatePlayPauseUI();
      showBanner(`⏸️ Paused: Waiting for ${sender} to catch up (${Math.abs(diff).toFixed(1)}s behind)...`, '⏳');
      broadcastAction('request_catch_up', currentTime);
    }
  }

  function handleSyncMessage(msg) {
    const action = msg.action;
    const time = msg.time;
    const sender = msg.userName || 'Friend';

    if (msg.title) {
      const banner = document.getElementById('mobile-show-banner');
      const titleSpan = document.getElementById('mobile-show-title');
      if (banner && titleSpan) {
        titleSpan.textContent = `🎬 ${msg.title}`;
        banner.style.display = 'block';
      }
    }

    if (action === 'time_heartbeat') {
      if (typeof time === 'number') {
        if (Math.abs(currentTime - time) > 1.2 || !isPlaying) {
          currentTime = time;
          timecodeDisplay.textContent = formatTime(currentTime);
          if (syncMediaPlayer && Math.abs(syncMediaPlayer.currentTime - time) > 1.5) {
            ignoreLocalMediaEvents = Date.now() + 1000;
            syncMediaPlayer.currentTime = time;
          }
        }
        if (msg.isPaused !== undefined && msg.isPaused !== !isPlaying) {
          isPlaying = !msg.isPaused;
          updatePlayPauseUI();
          if (syncMediaPlayer) {
            ignoreLocalMediaEvents = Date.now() + 1000;
            if (isPlaying && syncMediaPlayer.paused) syncMediaPlayer.play().catch(() => {});
            if (!isPlaying && !syncMediaPlayer.paused) syncMediaPlayer.pause();
          }
        }
      }
      return;
    }

    if (action === 'pause') {
      if (typeof time === 'number' && (time - currentTime) > 1.8) {
        runCatchUpTo(time, 'pause', sender);
      } else {
        stopCatchUp();
        if (typeof time === 'number') currentTime = time;
        timecodeDisplay.textContent = formatTime(currentTime);
        isPlaying = false;
        updatePlayPauseUI();
        if (syncMediaPlayer && !syncMediaPlayer.paused) {
          ignoreLocalMediaEvents = Date.now() + 1500;
          if (typeof time === 'number') syncMediaPlayer.currentTime = time;
          syncMediaPlayer.pause();
        }
        showBanner(`${sender} paused at ${formatTime(time)}`, '⏸️');
      }
    } else if (action === 'play') {
      if (typeof time === 'number' && (time - currentTime) > 1.8) {
        runCatchUpTo(time, 'play', sender);
      } else {
        stopCatchUp();
        if (typeof time === 'number') currentTime = time;
        timecodeDisplay.textContent = formatTime(currentTime);
        isPlaying = true;
        updatePlayPauseUI();
        if (syncMediaPlayer && syncMediaPlayer.paused) {
          ignoreLocalMediaEvents = Date.now() + 1500;
          if (typeof time === 'number') syncMediaPlayer.currentTime = time;
          syncMediaPlayer.play().catch(() => {});
        }
        showBanner(`${sender} played at ${formatTime(time)}`, '▶️');
      }
    } else if (action === 'seek') {
      stopCatchUp();
      if (typeof time === 'number') currentTime = time;
      timecodeDisplay.textContent = formatTime(currentTime);
      if (syncMediaPlayer && typeof time === 'number') {
        ignoreLocalMediaEvents = Date.now() + 1500;
        syncMediaPlayer.currentTime = time;
      }
      showBanner(`${sender} jumped to ${formatTime(time)}`, '⏩');
    } else if (action === 'jump_forward') {
      currentTime += 10;
      timecodeDisplay.textContent = formatTime(currentTime);
      if (syncMediaPlayer) {
        ignoreLocalMediaEvents = Date.now() + 1500;
        syncMediaPlayer.currentTime = currentTime;
      }
      showBanner(`${sender} skipped +10s`, '⏩');
    } else if (action === 'jump_back') {
      currentTime = Math.max(0, currentTime - 10);
      timecodeDisplay.textContent = formatTime(currentTime);
      if (syncMediaPlayer) {
        ignoreLocalMediaEvents = Date.now() + 1500;
        syncMediaPlayer.currentTime = currentTime;
      }
      showBanner(`${sender} rewound -10s`, '⏪');
    } else if (action === 'skip_intro') {
      showBanner(`${sender} skipped intro`, '⏭️');
    } else if (action === 'next_episode') {
      showBanner(`${sender} next episode`, '⏭️');
    } else if (action === 'request_state') {
      broadcastAction(isPlaying ? 'play' : 'pause', currentTime);
    } else if (action === 'request_catch_up') {
      if (typeof time === 'number') {
        runCatchUpTo(time, isPlaying ? 'play' : 'pause', sender);
      }
    } else if (action === 'caught_up') {
      stopCatchUp();
      showBanner(`🎯 ${sender} caught up! In sync at ${formatTime(time)}`, '✅');
    }
  }

  function broadcastAction(action, time) {
    const payload = {
      type: 'sync',
      action: action,
      time: time,
      userName: userName,
      timestamp: Date.now()
    };

    if (dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(JSON.stringify(payload));
    }
    if (sigClient) {
      sigClient.send(payload);
    }
  }

  function updatePlayPauseUI() {
    if (isPlaying) {
      startPlaybackTicker();
      syncStatePill.textContent = 'PLAYING';
      syncStatePill.className = 'sync-state-pill playing';
      btnMasterPlayPause.className = 'big-sync-btn playing';
      playPauseIcon.textContent = '⏸️';
      playPauseLabel.textContent = 'Tap to Pause Sync';
    } else {
      stopPlaybackTicker();
      syncStatePill.textContent = 'PAUSED';
      syncStatePill.className = 'sync-state-pill paused';
      btnMasterPlayPause.className = 'big-sync-btn';
      playPauseIcon.textContent = '▶️';
      playPauseLabel.textContent = 'Tap to Play Sync';
    }
  }

  // Master Play / Pause Button Click
  btnMasterPlayPause.addEventListener('click', () => {
    isPlaying = !isPlaying;
    updatePlayPauseUI();
    const action = isPlaying ? 'play' : 'pause';

    if (syncMediaPlayer) {
      ignoreLocalMediaEvents = Date.now() + 1500;
      if (isPlaying) {
        syncMediaPlayer.play().catch(() => {});
      } else {
        syncMediaPlayer.pause();
      }
      currentTime = syncMediaPlayer.currentTime;
    }

    broadcastAction(action, currentTime);
    showBanner(`You ${action}ed playback`, isPlaying ? '▶️' : '⏸️');
  });

  const btnMobileCatchup = document.getElementById('btn-mobile-catchup');
  if (btnMobileCatchup) {
    btnMobileCatchup.addEventListener('click', () => {
      broadcastAction('request_catch_up', currentTime);
      showBanner('🎯 Sent catch-up request to friend', '📡');
    });
  }

  // Fast Forward / Rewind (NetflixController remote shortcuts)
  btnSeekBack.addEventListener('click', () => {
    currentTime = Math.max(0, currentTime - 10);
    timecodeDisplay.textContent = formatTime(currentTime);
    if (syncMediaPlayer) {
      ignoreLocalMediaEvents = Date.now() + 1500;
      syncMediaPlayer.currentTime = currentTime;
    }
    broadcastAction('jump_back', currentTime);
    showBanner('Rewound 10s', '⏪');
  });

  btnSeekFwd.addEventListener('click', () => {
    currentTime += 10;
    timecodeDisplay.textContent = formatTime(currentTime);
    if (syncMediaPlayer) {
      ignoreLocalMediaEvents = Date.now() + 1500;
      syncMediaPlayer.currentTime = currentTime;
    }
    broadcastAction('jump_forward', currentTime);
    showBanner('Forward 10s', '⏩');
  });

  // Netflix Remote Buttons (Skip Intro & Next Episode)
  const btnSkipIntro = document.getElementById('btn-skip-intro');
  if (btnSkipIntro) {
    btnSkipIntro.addEventListener('click', () => {
      broadcastAction('skip_intro', currentTime);
      showBanner('⏭️ Skipped Intro on Netflix');
    });
  }

  const btnNextEp = document.getElementById('btn-next-ep');
  if (btnNextEp) {
    btnNextEp.addEventListener('click', () => {
      broadcastAction('next_episode', currentTime);
      showBanner('⏭️ Next Episode on Netflix');
    });
  }

  // Individual Volume Sliders
  friendVolSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    friendVolVal.textContent = `${val}%`;
    if (friendGain) {
      friendGain.gain.value = val / 100;
    }
  });

  netflixVolSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    netflixVolVal.textContent = `${val}%`;
    // Broadcast requested netflix volume adjustment to laptop
    if (sigClient) {
      sigClient.send({
        type: 'sync',
        action: 'volume',
        time: val / 100,
        userName: userName
      });
    }
  });

  // Mobile Picture-in-Picture
  btnPip.addEventListener('click', async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (remoteVideo.requestPictureInPicture) {
        await remoteVideo.requestPictureInPicture();
      } else if (remoteVideo.webkitSetPresentationMode) {
        // iOS Safari Picture in Picture support
        remoteVideo.webkitSetPresentationMode('picture-in-picture');
      } else {
        alert('Picture-in-Picture is not supported on this browser.');
      }
    } catch (e) {
      console.warn('[PiP] Error:', e);
    }
  });

  // AV Toggles (Independent & On-Demand Request)
  btnMic.addEventListener('click', async () => {
    const audioTracks = localStream ? localStream.getAudioTracks() : [];
    if (audioTracks.length === 0) {
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: { ideal: 48000 },
            channelCount: { ideal: 2 }
          }
        });
        const newTrack = audioStream.getAudioTracks()[0];
        if (newTrack) {
          localStream.addTrack(newTrack);
          if (pc) {
            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
            if (sender) {
              await sender.replaceTrack(newTrack);
            } else {
              pc.addTrack(newTrack, localStream);
            }
            applyHighBitrateSenders();
          }
          isMicActive = true;
          setupLocalMicMeter(localStream);
          btnMic.classList.remove('off');
          btnMic.textContent = '🎙️';
          showBanner('Microphone Active', '🎙️');
          return;
        }
      } catch (e) {
        showBanner('Microphone blocked by browser', '🚫');
        return;
      }
    }

    isMicActive = !isMicActive;
    localStream.getAudioTracks().forEach(t => t.enabled = isMicActive);
    btnMic.classList.toggle('off', !isMicActive);
    btnMic.textContent = isMicActive ? '🎙️' : '🔇';
    showBanner(isMicActive ? 'Mic Active' : 'Mic Muted', isMicActive ? '🎙️' : '🔇');
  });

  btnCam.addEventListener('click', async () => {
    const videoTracks = localStream ? localStream.getVideoTracks() : [];
    if (videoTracks.length === 0) {
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
        });
        const newTrack = videoStream.getVideoTracks()[0];
        if (newTrack) {
          localStream.addTrack(newTrack);
          localVideo.srcObject = localStream;
          localVideo.classList.remove('hidden');
          if (pc) {
            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) {
              await sender.replaceTrack(newTrack);
            } else {
              pc.addTrack(newTrack, localStream);
            }
          }
          isCamActive = true;
          btnCam.classList.remove('off');
          btnCam.textContent = '📹';
          showBanner('Camera Active', '📹');
          return;
        }
      } catch (e) {
        showBanner('Camera blocked by browser', '🚫');
        return;
      }
    }

    isCamActive = !isCamActive;
    localStream.getVideoTracks().forEach(t => t.enabled = isCamActive);
    btnCam.classList.toggle('off', !isCamActive);
    btnCam.textContent = isCamActive ? '📹' : '🚫';
    localVideo.classList.toggle('hidden', !isCamActive);
    showBanner(isCamActive ? 'Camera Active' : 'Camera Disabled', isCamActive ? '📹' : '🚫');
  });

  // Share Room Link
  btnShare.addEventListener('click', async () => {
    const shareUrl = `${window.location.origin}/?room=${roomId}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join my Netflix Party!',
          text: `Watch Netflix with me in sync! Room: ${roomId}`,
          url: shareUrl
        });
      } catch (e) {}
    } else {
      navigator.clipboard.writeText(shareUrl).then(() => {
        showBanner('🔗 Room link copied!');
      });
    }
  });

  // Leave Room
  btnLeave.addEventListener('click', () => {
    if (confirm('Leave Netflix Watch Party?')) {
      window.location.reload();
    }
  });
})();
