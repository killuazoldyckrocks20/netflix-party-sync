document.addEventListener('DOMContentLoaded', () => {
  const roomInput = document.getElementById('room-id');
  const passInput = document.getElementById('room-pass');
  const nameInput = document.getElementById('user-name');
  const serverInput = document.getElementById('server-url');
  const checkMic = document.getElementById('check-mic');
  const checkCam = document.getElementById('check-cam');
  const btnRandom = document.getElementById('btn-random');
  const btnSave = document.getElementById('btn-save');
  const statusMsg = document.getElementById('status-msg');

  // Load saved options
  chrome.storage.local.get(['roomId', 'roomPassword', 'userName', 'serverUrl', 'audioEnabled', 'videoEnabled'], (res) => {
    roomInput.value = res.roomId || 'PARTY77';
    if (passInput) passInput.value = res.roomPassword || '';
    nameInput.value = res.userName || 'Friend';
    serverInput.value = res.serverUrl || 'cloud';
    if (typeof res.audioEnabled === 'boolean') checkMic.checked = res.audioEnabled;
    if (typeof res.videoEnabled === 'boolean') checkCam.checked = res.videoEnabled;
  });

  // Random Room Code
  btnRandom.addEventListener('click', () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'NET-';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    roomInput.value = code;
  });

  // Save Settings
  btnSave.addEventListener('click', () => {
    const roomId = roomInput.value.trim().toUpperCase() || 'PARTY77';
    const roomPassword = passInput ? passInput.value.trim() : '';
    const userName = nameInput.value.trim() || 'Friend';
    const serverUrl = serverInput.value.trim() || 'cloud';
    const audioEnabled = checkMic ? checkMic.checked : true;
    const videoEnabled = checkCam ? checkCam.checked : true;

    chrome.storage.local.set({ roomId, roomPassword, userName, serverUrl, audioEnabled, videoEnabled }, () => {
      statusMsg.textContent = `✓ Saved! Room: ${roomId}${roomPassword ? ' (Protected)' : ''} (Mic: ${audioEnabled ? 'On' : 'Off'}, Cam: ${videoEnabled ? 'On' : 'Off'})`;
      setTimeout(() => {
        statusMsg.textContent = '';
      }, 3500);
    });
  });
});
