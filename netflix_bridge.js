/**
 * Netflix Party Sync - Main World Bridge Script
 * Injected into window context to interface directly with Netflix's internal Cadmium Player API,
 * native React controls, and standard HTML5 <video> elements.
 */
(function () {
  'use strict';

  if (window.__nps_bridge_loaded) return;
  window.__nps_bridge_loaded = true;

  console.log('[NetflixSyncBridge] Initialized in page context.');

  function getNetflixPlayer() {
    try {
      const netflixObj = window.netflix;
      if (netflixObj && netflixObj.appContext && netflixObj.appContext.state) {
        const playerApp = netflixObj.appContext.state.playerApp;
        if (playerApp && playerApp.getAPI) {
          const videoPlayerAPI = playerApp.getAPI().videoPlayer;
          if (videoPlayerAPI && videoPlayerAPI.getAllPlayerSessionIds) {
            const sessionIds = videoPlayerAPI.getAllPlayerSessionIds();
            if (sessionIds && sessionIds.length > 0) {
              return videoPlayerAPI.getVideoPlayerBySessionId(sessionIds[sessionIds.length - 1]);
            }
          }
        }
      }
    } catch (e) {}
    return null;
  }

  function getVideoElement() {
    return document.querySelector('video');
  }

  function simulateMediaKeys(action) {
    const target = document.querySelector('.watch-video--player-view') || document.querySelector('video') || document.body;
    
    // 1. MediaPlayPause (KeyCode 179)
    try {
      target.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'MediaPlayPause',
        code: 'MediaPlayPause',
        keyCode: 179,
        which: 179,
        bubbles: true,
        cancelable: true
      }));
    } catch (e) {}

    // 2. Spacebar (KeyCode 32)
    try {
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
    } catch (e) {}
  }

  function playVideo() {
    const player = getNetflixPlayer();
    const video = getVideoElement();

    // 1. Cadmium player API
    if (player && typeof player.play === 'function') {
      try { player.play(); } catch (e) {}
    }
    // 2. HTML5 Video Element
    if (video && video.paused) {
      try {
        const p = video.play();
        if (p && p.catch) p.catch(() => {});
      } catch (e) {}
    }
    // 3. Netflix UI Control Buttons
    const playBtn = document.querySelector('[data-uia="control-play-pause-play"], button[aria-label="Play"], .button-nfplayerPlay');
    if (playBtn) {
      try { playBtn.click(); } catch (e) {}
    } else if (video && video.paused) {
      simulateMediaKeys('play');
    }
  }

  function pauseVideo() {
    const player = getNetflixPlayer();
    const video = getVideoElement();

    // 1. Cadmium player API
    if (player && typeof player.pause === 'function') {
      try { player.pause(); } catch (e) {}
    }
    // 2. HTML5 Video Element
    if (video && !video.paused) {
      try { video.pause(); } catch (e) {}
    }
    // 3. Netflix UI Control Buttons
    const pauseBtn = document.querySelector('[data-uia="control-play-pause-pause"], button[aria-label="Pause"], .button-nfplayerPause');
    if (pauseBtn) {
      try { pauseBtn.click(); } catch (e) {}
    } else if (video && !video.paused) {
      simulateMediaKeys('pause');
    }
  }

  function seekVideo(seconds) {
    if (typeof seconds !== 'number' || isNaN(seconds)) return;
    const player = getNetflixPlayer();
    const video = getVideoElement();

    if (player && typeof player.seek === 'function') {
      try { player.seek(Math.round(seconds * 1000)); } catch (e) {}
    }
    if (video) {
      try {
        if (Math.abs(video.currentTime - seconds) > 0.4) {
          video.currentTime = seconds;
        }
      } catch (e) {}
    }
  }

  function setVolume(vol) {
    if (typeof vol !== 'number') return;
    const clamped = Math.max(0, Math.min(1, vol));
    const player = getNetflixPlayer();
    const video = getVideoElement();

    if (player && typeof player.setVolume === 'function') {
      try { player.setVolume(clamped); } catch (e) {}
    }
    if (video) {
      try { video.volume = clamped; } catch (e) {}
    }
  }

  function getCurrentTime() {
    const player = getNetflixPlayer();
    if (player && typeof player.getCurrentTime === 'function') {
      try { return (player.getCurrentTime() || 0) / 1000; } catch (e) {}
    }
    const video = getVideoElement();
    return video ? video.currentTime : 0;
  }

  function getIsPaused() {
    const player = getNetflixPlayer();
    if (player && typeof player.isPaused === 'function') {
      try { return player.isPaused(); } catch (e) {}
    }
    const video = getVideoElement();
    return video ? video.paused : true;
  }

  function getDuration() {
    const player = getNetflixPlayer();
    if (player && typeof player.getDuration === 'function') {
      try { return (player.getDuration() || 0) / 1000; } catch (e) {}
    }
    const video = getVideoElement();
    return video ? video.duration || 0 : 0;
  }

  function getShowMetadata() {
    let videoId = null;
    const match = window.location.pathname.match(/\/watch\/(\d+)/);
    if (match) videoId = match[1];

    let title = document.title ? document.title.replace(/\s*[-|]\s*Netflix.*$/i, '').trim() : '';
    const titleEl = document.querySelector('.ellipsize-text, [data-uia="video-title"], .ltr-17st35p');
    if (titleEl && titleEl.textContent) {
      title = titleEl.textContent.trim();
    }
    return { videoId, title };
  }

  // Tracking State & Echo Prevention
  let isExecutingRemote = false;
  let remoteExecuteTimer = null;
  let currentIsPaused = true;

  function markRemoteExecution() {
    isExecutingRemote = true;
    clearTimeout(remoteExecuteTimer);
    remoteExecuteTimer = setTimeout(() => {
      isExecutingRemote = false;
    }, 1500);
  }

  function notifyUserAction(action, time) {
    if (isExecutingRemote) {
      return; // Do not bounce remote commands back!
    }
    window.postMessage({
      source: 'NETFLIX_PARTY_BRIDGE',
      type: 'user_action',
      action: action,
      time: time,
      metadata: getShowMetadata()
    }, '*');
  }

  // Receive commands from content.js (sent from friend)
  window.addEventListener('message', (event) => {
    if (!event.data || event.data.source !== 'NETFLIX_PARTY_CONTENT') return;
    const { action, time, volume } = event.data;

    try {
      if (action === 'play') {
        markRemoteExecution();
        if (typeof time === 'number') {
          const curr = getCurrentTime();
          if (Math.abs(curr - time) > 1.5) {
            seekVideo(time);
          }
        }
        playVideo();
        currentIsPaused = false;
      } else if (action === 'pause') {
        markRemoteExecution();
        if (typeof time === 'number') {
          const curr = getCurrentTime();
          if (Math.abs(curr - time) > 1.5) {
            seekVideo(time);
          }
        }
        pauseVideo();
        currentIsPaused = true;
      } else if (action === 'seek') {
        markRemoteExecution();
        seekVideo(time);
      } else if (action === 'volume') {
        setVolume(volume);
      }
    } catch (e) {
      console.warn('[Bridge] Command execution error:', action, e);
    }
  });

  // Hook native video events directly
  function hookVideoEvents() {
    const video = getVideoElement();
    if (!video || video.__nps_hooked) return;
    video.__nps_hooked = true;

    currentIsPaused = video.paused;

    video.addEventListener('pause', () => {
      currentIsPaused = true;
      notifyUserAction('pause', video.currentTime);
    });

    video.addEventListener('play', () => {
      currentIsPaused = false;
      notifyUserAction('play', video.currentTime);
    });

    video.addEventListener('seeked', () => {
      if (!isExecutingRemote) {
        notifyUserAction('seek', video.currentTime);
      }
    });
  }

  // Periodic polling for controls, show title, and timecode UI updates
  setInterval(() => {
    hookVideoEvents();
    const paused = getIsPaused();
    const time = getCurrentTime();
    const dur = getDuration();

    // Catch cases where Cadmium flipped pause state without standard HTML5 event
    if (paused !== currentIsPaused) {
      currentIsPaused = paused;
      if (!isExecutingRemote) {
        notifyUserAction(paused ? 'pause' : 'play', time);
      }
    }

    // Emit gentle time_update for UI timecode display (NEVER triggers network sync broadcast)
    window.postMessage({
      source: 'NETFLIX_PARTY_BRIDGE',
      type: 'time_update',
      currentTime: time,
      duration: dur,
      isPaused: paused,
      metadata: getShowMetadata()
    }, '*');
  }, 350);

})();
