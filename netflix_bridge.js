/**
 * Netflix Party Sync - Main World Bridge Script
 * Injected into window context to interface directly with Netflix's internal Cadmium Player API
 * with automatic fallback to standard HTML5 <video> elements.
 */
(function () {
  'use strict';

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
    } catch (e) {
      // In case of API changes or obfuscation
    }
    return null;
  }

  function getVideoElement() {
    return document.querySelector('video');
  }

  // Receive commands from content.js
  window.addEventListener('message', (event) => {
    if (!event.data || event.data.source !== 'NETFLIX_PARTY_CONTENT') return;

    const { action, time, volume } = event.data;
    const player = getNetflixPlayer();
    const video = getVideoElement();

    try {
      if (action === 'play') {
        if (player && typeof player.play === 'function') {
          player.play();
        } else if (video) {
          const playPromise = video.play();
          if (playPromise !== undefined) {
            playPromise.catch((err) => console.warn('[Bridge] Video play thwarted:', err));
          }
        }
      } else if (action === 'pause') {
        if (player && typeof player.pause === 'function') {
          player.pause();
        } else if (video) {
          video.pause();
        }
      } else if (action === 'seek') {
        if (typeof time === 'number') {
          if (player && typeof player.seek === 'function') {
            player.seek(Math.round(time * 1000));
          } else if (video) {
            video.currentTime = time;
          }
        }
      } else if (action === 'volume') {
        if (typeof volume === 'number') {
          const clamped = Math.max(0, Math.min(1, volume));
          if (player && typeof player.setVolume === 'function') {
            player.setVolume(clamped);
          }
          if (video) {
            video.volume = clamped;
          }
        }
      }
    } catch (err) {
      console.error('[Bridge] Command execution error:', action, err);
    }
  });

  // Track player state and broadcast changes
  let lastPaused = true;
  let lastTime = 0;

  function reportState() {
    const player = getNetflixPlayer();
    const video = getVideoElement();

    if (!player && !video) return;

    let currentTime = 0;
    let isPaused = true;
    let duration = 0;

    if (player) {
      try {
        currentTime = (player.getCurrentTime() || 0) / 1000;
        isPaused = player.isPaused();
        duration = (player.getDuration() || 0) / 1000;
      } catch (e) {
        if (video) {
          currentTime = video.currentTime;
          isPaused = video.paused;
          duration = video.duration || 0;
        }
      }
    } else if (video) {
      currentTime = video.currentTime;
      isPaused = video.paused;
      duration = video.duration || 0;
    }

    const stateChanged = isPaused !== lastPaused || Math.abs(currentTime - lastTime) > 1.2;

    if (stateChanged) {
      lastPaused = isPaused;
      lastTime = currentTime;

      window.postMessage({
        source: 'NETFLIX_PARTY_BRIDGE',
        type: 'state',
        isPaused: isPaused,
        currentTime: currentTime,
        duration: duration
      }, '*');
    }
  }

  // Periodic polling for player state + fallback video listeners
  setInterval(reportState, 250);

  // Direct video element event listeners as backup
  function attachVideoListeners() {
    const video = getVideoElement();
    if (video && !video.__sync_attached) {
      video.__sync_attached = true;
      ['play', 'pause', 'seeked'].forEach(evt => {
        video.addEventListener(evt, () => {
          setTimeout(reportState, 50);
        });
      });
    }
  }

  setInterval(attachVideoListeners, 1000);
})();
