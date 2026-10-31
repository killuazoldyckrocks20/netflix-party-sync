# 🍿 Netflix Party Sync & 2-Way Video Call

> Watch Netflix in perfect real-time sync with friends, featuring an integrated 2-way audio/video call overlay, individual audio volume mixing, and remote Netflix playback controls.

[![Live Web App](https://img.shields.io/badge/Live%20Web%20App-GitHub%20Pages-brightgreen?logo=github)](https://killuazoldyckrocks20.github.io/netflix-party-sync/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Chrome%20Extension-Manifest%20V3-yellow.svg)](extension/manifest.json)
[![WebRTC](https://img.shields.io/badge/Call-WebRTC%20E2EE-red.svg)](app.js)
[![Zero Server Required](https://img.shields.io/badge/Serverless-Cloud%20MQTT%20Signaling-orange.svg)](signaling.js)

---

## 🌟 Quick Links
* **Live Web App (Instant in-browser co-watch & remote):** [killuazoldyckrocks20.github.io/netflix-party-sync/](https://killuazoldyckrocks20.github.io/netflix-party-sync/)
* **Default Test Room:** `PARTY77` (or append `?room=YOUR_CODE&pass=SECRET` to the URL)
* **Instant Resync Keyboard Shortcut:** `Alt + S` (or `Option + S` on Mac / `Alt + R` / `Ctrl + Shift + S`)
* **GitHub Repository:** [github.com/killuazoldyckrocks20/netflix-party-sync](https://github.com/killuazoldyckrocks20/netflix-party-sync)

---

## 📖 Table of Contents
1. [Two Ways to Use This Project](#-two-ways-to-use-this-project)
   - [Mode 1: Live Web App (No installation needed)](#mode-1-live-web-app-no-installation-needed)
   - [Mode 2: Chrome Extension on Netflix.com](#mode-2-chrome-extension-on-netflixcom)
2. [How Playback Sync Works (NetflixController Pattern)](#-how-playback-sync-works-netflixcontroller-pattern)
3. [Installing the Extension on a Laptop (Mac / Windows / Linux)](#-installing-the-extension-on-a-laptop-mac--windows--linux)
4. [Using on Phones & Tablets (iOS & Android)](#-using-on-phones--tablets-ios--android)
5. [Publishing to the Chrome Web Store & Edge Store](#-publishing-to-the-chrome-web-store--edge-store)
6. [Security, Privacy & Encryption](#-security-privacy--encryption)
7. [Architecture Diagram](#-architecture-diagram)
8. [Optional Local Server Setup](#-optional-local-server-setup)

---

## 💡 Two Ways to Use This Project

### Mode 1: Live Web App (No installation needed)
You and your friend can open **[https://killuazoldyckrocks20.github.io/netflix-party-sync/](https://killuazoldyckrocks20.github.io/netflix-party-sync/)** on any phone, tablet, or laptop browser.

* **What it does:**
  * **2-Way Audio & Video Call:** Low-latency WebRTC call so you can see and hear each other.
  * **Audio Mixer:** Boost friend voice volume up to 200% so you never miss dialogue.
  * **Synced Open Media Player:** An embedded movie player (*Tears of Steel*) that stays in sync across both devices.
  * **Handheld Netflix Remote:** If one user is watching Netflix on a laptop/TV, the other user can use their phone as a wireless remote control to Play, Pause, Rewind 10s, and Skip Intro.
* **Limitation:** Does **not** stream DRM-protected Netflix movies directly inside the webpage (Netflix strictly blocks third-party websites from embedding its player).

### Mode 2: Chrome Extension on Netflix.com
To watch actual Netflix movies (*Stranger Things*, *Squid Game*, etc.) together in sync, both users install the extension on their laptops:
* Injects a floating, draggable glassmorphism video call overlay directly onto `netflix.com/watch/...`.
* Controls Netflix's internal video player automatically: Play, Pause, Seek, Skip Intro, and Next Episode sync bidirectionally in real time.
* If one user buffers or is ahead, **Catch-Up Sync** pauses the ahead user until the behind user aligns.

---

## 🎮 How Playback Sync Works (NetflixController Pattern)

This project follows the architecture pioneered by [`FThompson/NetflixController`](https://github.com/FThompson/NetflixController) by directly interfacing with Netflix's internal player engine (Cadmium Player API) in the page's `MAIN` JavaScript world.

```javascript
// Netflix Cadmium API Hook (netflix_bridge.js)
const videoPlayerAPI = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
const sessionIds = videoPlayerAPI.getAllPlayerSessionIds();
const player = videoPlayerAPI.getVideoPlayerBySessionId(sessionIds[sessionIds.length - 1]);

// 1. Precise Millisecond Seeking & Playback
player.play();
player.pause();
player.seek(milliseconds); // e.g. 142000 for 02:22
player.getCurrentTime();   // Returns exact position in ms
player.getDuration();      // Returns media length

// 2. Fallback to Native Controls
// Netflix UI buttons: [data-uia="control-play-pause-play"], [data-uia="player-skip-intro"], [data-uia="control-next"]
// Key emulation: MediaPlayPause (179), Space (32), ArrowLeft (37), ArrowRight (39)
```

### Remote Control & Echo Prevention
* When User A clicks Play or Pause, a command is dispatched across the WebRTC DataChannel (P2P zero-latency) with Serverless Cloud MQTT fallback.
* The receiving side sets a temporary suppression lock (`ignoreLocalEventsUntil = Date.now() + 1500`) to execute the remote command without bouncing synthetic echo events back.

### ⌨️ Instant Resync Shortcut (`Alt + S` / `Option + S`)
If playback ever falls slightly out of alignment due to network lag or buffering:
* Press **`Alt + S`** (or **`Option + S`** on Mac, or **`Alt + R`**, or **`Ctrl + Shift + S`**).
* An instant on-screen alert appears (`🎯 [Alt+S] Triggered Instant Resync!`), and your player automatically performs Catch-Up Sync to align to your friend's exact millisecond.

---

## 💻 Installing the Extension on a Laptop (Mac / Windows / Linux)

Both users on any laptop running Chrome, Brave, Edge, or Opera can install the extension in under 60 seconds:

### Step 1: Download the Extension
* **Option A (From GitHub ZIP):**
  1. Visit: [https://github.com/killuazoldyckrocks20/netflix-party-sync](https://github.com/killuazoldyckrocks20/netflix-party-sync)
  2. Click the green **Code** button ➔ **Download ZIP**.
  3. Extract the downloaded `netflix-party-sync-main.zip`.
* **Option B (Using Git):**
  ```bash
  git clone https://github.com/killuazoldyckrocks20/netflix-party-sync.git
  ```

### Step 2: Load into Chrome
1. Open Google Chrome and enter `chrome://extensions` in the address bar.
2. In the top-right corner, toggle **Developer mode** to **ON**.
3. In the top-left corner, click **Load unpacked**.
4. Select the **`extension/`** folder inside the extracted project.
5. The extension is now active!

### Step 3: Start Watching Together
1. Both friends open the same title on [netflix.com](https://www.netflix.com).
2. The floating overlay appears in the corner.
3. Make sure both have the same Room Code (default: `PARTY77`).
4. Allow microphone & camera permissions when prompted.
5. Any play, pause, rewind, or skip intro action taken by either user will immediately sync to the other!

---

## 📱 Using on Phones & Tablets (iOS & Android)

### Why the official Netflix mobile app cannot be directly controlled:
On iOS and Android, the official Netflix app is a sandboxed binary with Apple FairPlay / Widevine DRM. Mobile operating systems strictly prohibit any third-party app or web page from injecting scripts or clicking buttons inside another native app.

### Two Solutions for Mobile Users:

#### Solution 1: Mobile Browsers with Chrome Extension Support (Fully Automated Sync)
* **iPhone / iPad:** Install **[Orion Browser](https://kagi.com/orion/)** (Free on iOS App Store). Orion natively supports Chrome extensions on iOS! Load our `extension/` folder into Orion, open `netflix.com`, and watch with full automated sync.
* **Android Phones / Tablets:** Install **[Kiwi Browser](https://kiwibrowser.com/)** (Free on Google Play Store). Open `chrome://extensions` in Kiwi, load our extension, and watch on `netflix.com` in desktop mode.

#### Solution 2: Mobile Companion Mode (Side-by-Side with the Netflix App)
1. Open the official Netflix mobile app to your show.
2. Open [https://killuazoldyckrocks20.github.io/netflix-party-sync/](https://killuazoldyckrocks20.github.io/netflix-party-sync/) in Safari/Chrome.
3. Tap **🪟 PiP** to float your friend's video call over the screen.
4. When either user pauses on the companion, both phones trigger an alert banner and haptic vibration. When resuming, a synchronized audio cue keeps you aligned.

---

## 🚀 Publishing to the Chrome Web Store & Edge Store

### Chrome Web Store ($5 one-time developer fee)
1. Create a developer account on the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Pay Google's one-time $5 verification fee.
3. Package the extension:
   ```bash
   cd extension
   zip -r ../netflix-party-sync.zip *
   ```
4. Click **+ New Item**, upload `netflix-party-sync.zip`, add description & 1 screenshot (`1280x800 px`), and submit for review (approved in 24–72 hours).

### Microsoft Edge Add-ons ($0 Free — 1-Click Install for Mac & Windows)
* The **[Microsoft Edge Partner Center](https://partner.microsoft.com/dashboard/microsoftedge)** has **$0 registration fee**.
* Microsoft Edge uses the Chromium engine and accepts the exact same `netflix-party-sync.zip` without any modifications!
* Once approved, anyone on Windows or Mac can install it directly from the Edge Store with 1 click.

---

## 🔒 Security, Privacy & Encryption

* **End-to-End Encryption (E2EE):** Video and voice streams use WebRTC with mandatory **DTLS-SRTP** hardware-level encryption. Streams travel directly peer-to-peer and are never routed through or stored on any server.
* **Zero Logging:** The Serverless Cloud MQTT Signaling brokers (`broker.hivemq.com`, `broker.emqx.io`) only relay transient ephemeral JSON handshakes (`offer`, `answer`, `ice-candidate`, `sync`). No accounts, passwords, Netflix credentials, or viewing histories are ever collected or stored.
* **Password-Protected Private Rooms:** In addition to the Room Code, you can set a secret **Room Password**. The password hashes into the signaling topic, creating an isolated, private channel that completely blocks unauthorized eavesdroppers or intruders.
* **Sequential & Independent AV Permissions:** Microphone and camera are prompted sequentially one after another. You can allow one (e.g. microphone) while blocking the other (e.g. camera), or toggle either on/off independently at any time.

---

## 🏗️ Architecture Diagram

```
┌────────────────────────────────────────────────────────┐
│           Serverless Cloud MQTT Broker                 │
│    (wss://broker.hivemq.com:8884/mqtt - Zero Local Server) │
└───────────────▲────────────────────────▲───────────────┘
                │                        │
       Ephemeral Signaling      Ephemeral Signaling
       (Room Handshake)         (Room Handshake)
                │                        │
┌───────────────▼──────────────┐ ┌───────▼────────────────────────┐
│        Laptop Browser        │ │      Phone / 2nd Laptop        │
│   (Chrome / Brave / Edge)    │ │    (Mobile Companion / Web)    │
│  ┌─────────────────────────┐ │ │  ┌───────────────────────────┐ │
│  │   netflix.com / watch   │ │ │  │   Live Companion Web App  │ │
│  │  - Cadmium Main Bridge  │ │ │  │  - WebRTC Video Call (PiP)│ │
│  │  - Draggable Overlay UI │ │ │  │  - Master Play/Pause Sync │ │
│  │  - Voice Boost (0-200%) │ │ │  │  - Synced Media Player    │ │
│  └─────────────────────────┘ │ │  └───────────────────────────┘ │
└───────────────▲──────────────┘ └───────────────▲────────────────┘
                │                                │
                └────── WebRTC DataChannel ──────┘
                   & E2EE P2P Audio / Video Call
```

---

## 🛠️ Optional Local Server Setup

If you prefer hosting your own private signaling server on your home network instead of the cloud broker:

```bash
# Clone the repository
git clone https://github.com/killuazoldyckrocks20/netflix-party-sync.git
cd netflix-party-sync

# Start with Python 3 (Zero external pip dependencies required)
python3 server/server.py

# Or start with Node.js
npm install --prefix server && npm start --prefix server
```

The local server will run at `http://localhost:8000` with WebSocket signaling on `ws://localhost:8000/ws`.

---

## 📄 License
MIT License. Built for seamless, private, synchronized movie nights with friends.
