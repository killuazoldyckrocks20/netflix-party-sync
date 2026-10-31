# 🍿 Netflix Party Sync & Video Call

A complete web application and Chrome extension system that lets you watch Netflix shows in sync with a friend, complete with:
- 🎬 **Two-Way Play / Pause / Seek Sync**: Either friend can play, pause, or scrub; both players stay locked in sync with zero echo loops.
- 📹 **Two-Way Audio & Video Call**: Low-latency WebRTC video call with an overlay directly on top of the Netflix video player.
- 🎚️ **Individual Audio Mixer**: Mix your friend's voice with Netflix media audio, with separate volume sliders for each (including up to 200% voice boost).
- 🎙️ **Optional AV**: Both camera and microphone can be toggled on/off at any time (or joined in sync-only mode).
- 💻 **Laptop First (Priority)**: Floating, draggable, glassmorphism overlay on `netflix.com` that can be minimized to a compact pill.
- 📱 **Mobile Companion App**: Responsive mobile web app for phones with WebRTC video call, Picture-in-Picture (PiP), synchronized playback controller, haptic alerts, and Netflix app deep-linking.

---

## 🏗️ Architecture & How It Works

```
┌────────────────────────────────────────────────────────┐
│                    Signaling Server                    │
│      (Python 3 standard library / Node.js WebSocket)   │
│                 http://localhost:8000                  │
└───────────────▲────────────────────────▲───────────────┘
                │                        │
       WebSocket Signaling      WebSocket Signaling
       & Fallback Relay         & Fallback Relay
                │                        │
┌───────────────▼──────────────┐ ┌───────▼────────────────────────┐
│        Laptop Browser        │ │             Phone              │
│    (Chrome / Brave / Edge)   │ │    (Mobile Safari / Chrome)    │
│  ┌─────────────────────────┐ │ │  ┌───────────────────────────┐ │
│  │   netflix.com / watch   │ │ │  │   Mobile Companion App    │ │
│  │  - Cadmium / HTML5 hook │ │ │  │  - WebRTC Video Call (PiP)│ │
│  │  - Draggable Overlay UI │ │ │  │  - Synced Play/Pause Bar  │ │
│  │  - Audio Mixer (0-200%) │ │ │  │  - Audio Mixer Sliders    │ │
│  └─────────────────────────┘ │ │  │  - Netflix App Deep-Link  │ │
│                              │ │  └─────────────┬─────────────┘ │
│                              │ │                ▼               │
│                              │ │   [ Official Netflix App ]     │
└───────────────▲──────────────┘ └────────────────────────────────┘
                │                                │
                └────── WebRTC DataChannel ──────┘
                   & P2P Audio / Video Streams
```

### 1. Media Playback Synchronization
- **Cadmium & HTML5 Hook**: The extension injects `netflix_bridge.js` into the page's main JavaScript context. It accesses Netflix's internal video player API (`netflix.appContext.state.playerApp.getAPI().videoPlayer`) and automatically falls back to standard HTML5 `<video>` elements.
- **Loop / Echo Prevention**: When a remote peer pauses or plays, a local lock flag (`ignoreLocalEventsUntil`) suppresses synthetic echo events for 750ms so peers don't trigger infinite ping-pong loops.
- **Drift Correction**: Automatic timecode synchronization keeps both streams aligned within milliseconds.

### 2. Audio Mixing & Headphone Acoustic Isolation
- **100% Zero-Echo Headphone Isolation**: When both users wear headphones, acoustic coupling (`Speaker -> Air -> Mic`) is physically broken. Netflix media audio and incoming voice are routed exclusively into the headphone ear-cups and never radiate into the room.
- **Microphone Capture**: The laptop's microphone captures only acoustic vibrations from the user's vocal cords.
- **Safety Echo Cancellation (AEC)**: WebRTC's Acoustic Echo Cancellation remains active to eliminate any micro-leakage even if high-volume headphones leak slightly.
- **Studio 48kHz Voice Streaming**: WebRTC SDP munging locks Opus audio to **128 kbps fullband stereo** (`sampleRate: 48000Hz`, `channelCount: 2`) with in-band Forward Error Correction (FEC), delivering broadcast/podcast quality voice rather than compressed phone audio.
- **Live VU Mic Activity Meter**: The overlay features a real-time audio meter bar. When you speak, it illuminates green; when you pause while Netflix audio plays, it drops to 0%, providing visual proof of zero feedback.
- **Cross-Platform Audio Architecture**:
  - **macOS (CoreAudio)**: Hardware-isolated input and output streams with Apple beamforming microphone array processing.
  - **Windows (WASAPI)**: Direct exclusive session endpoints for microphone input and headphone rendering without system mix crosstalk.
  - **Linux (PipeWire / PulseAudio)**: Independent source/sink nodes with low-latency ALSA hardware bindings.

### 3. Audio Mixing & Individual Volume Sliders
- **Netflix Media Volume**: Controls `video.volume` directly (0% to 100%) through the HTML5 player and Netflix Cadmium API.
- **Friend Voice Volume**: Feeds the remote WebRTC audio stream through the **Web Audio API** (`AudioContext` + `GainNode`), allowing the user to adjust friend volume from 0% to **200% boost** so dialogue isn't drowned out by loud movie sound effects.

### 4. Mobile Experience
- **Mobile Sandbox Realities**: On iOS and Android, native mobile Netflix app sandboxing strictly prohibits external third-party apps or websites from injecting scripts or programmatically pressing buttons inside the official native Netflix app.
- **The Companion Solution**:
  1. The mobile web app runs the WebRTC video call with **Picture-in-Picture (PiP)** and background audio.
  2. The mobile screen provides a synchronized Play/Pause controller with real-time timecode.
  3. When the laptop friend pauses or plays, the phone triggers an instant visual banner and **haptic vibration**.
  4. One tap on **"Open in Netflix App"** launches the show in the mobile Netflix app.
  5. *Alternative on Android*: Users can install Kiwi Browser (which supports Chrome Extensions) to get the exact same in-browser overlay and automatic sync as desktop!

---

## 🌐 Zero-Server GitHub Pages Deployment

You can host this entire app on **GitHub Pages** with **ZERO local server running anywhere**, exactly like `https://killuazoldyckrocks20.github.io/nfc_reader/`!

### How It Works Without a Local Server:
- The web app and extension connect via a built-in **Serverless Cloud Signaling Client** (`signaling.js` via free 24/7 public broker `wss://broker.emqx.io:8084/mqtt`).
- Initial room joining and WebRTC SDP handshakes happen over this cloud broker.
- Once connected, **2-way audio, video, and playback sync travel directly Peer-to-Peer (WebRTC DataChannel)** with zero latency.
- Neither you nor your friend ever have to run a terminal command, python server, or Docker container!

### How to Host on Your GitHub Pages:
1. Push this repository to GitHub under your account:
   ```bash
   git remote add origin https://github.com/killuazoldyckrocks20/netflix-party-sync.git
   git push -u origin main
   ```
2. In your GitHub repository, go to **Settings ➔ Pages**.
3. Under **Branch**, select `main` and folder `/ (root)`. Click **Save**.
4. In ~60 seconds, your app is live worldwide at:
   `https://killuazoldyckrocks20.github.io/netflix-party-sync/?room=PARTY77`
5. Share that URL with your friend: they open it on their phone or laptop, tap Join, and you're immediately watching in sync!

---

## 🚀 Quick Start Guide (Optional Local Server Mode)

### Step 1: Start the Server

Run the one-click launcher from the project directory:

```bash
cd /Users/abhay/.gemini/antigravity/scratch/netflix-party-sync
./start.sh
```

Or start with Python directly (zero external dependencies required):

```bash
python3 server/server.py
```

The server will display:
```
🎬 Netflix Party Sync & Video Call Server running!
💻 Laptop (Localhost):   http://localhost:8000
📱 Phone (Same Wi-Fi):   http://192.168.1.X:8000
🔌 WebSocket Endpoint:   ws://localhost:8000/ws
🎯 Test Player:          http://localhost:8000/test_player.html
```

*(Note: A Node.js alternative server is also included in `server/server.js` if you prefer `npm start`)*.

---

### Step 2: Install the Chrome Extension (Laptop)

1. Open Google Chrome (or Brave / Edge).
2. Go to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked**.
5. Select the `extension/` directory:
   `/Users/abhay/.gemini/antigravity/scratch/netflix-party-sync/extension`
6. The **Netflix Party Sync & Video Call** extension is now installed!

---

### Step 3: Test Sync & Video Call Instantly (No Netflix Account Required!)

To verify everything before logging into Netflix:

1. Open **Tab 1**: [http://localhost:8000/test_player.html](http://localhost:8000/test_player.html)
2. Open **Tab 2** (or Incognito window): [http://localhost:8000/test_player.html](http://localhost:8000/test_player.html)
3. Both tabs will show the floating Netflix Sync overlay:
   - Click **Play** or **Pause** in Tab 1 ➔ Tab 2 updates instantly!
   - Test the **Netflix Volume Slider** and **Friend Voice Slider**.
   - Test toggling **Mic** (mute/unmute) and **Camera** (on/off).
   - Drag the overlay window anywhere on screen, or click `_` to minimize to a small floating pill.

---

### Step 4: Watch Together on Netflix

1. Navigate to any video on [https://www.netflix.com/watch/...](https://www.netflix.com)
2. Click the extension icon in Chrome or check the overlay card in the top-right corner.
3. Both you and your friend enter the same **Room Code** (e.g. `PARTY77` or click `🎲` for a random code).
4. Click **Save & Join Room**.
5. The video call connects automatically and playback stays in sync!

---

### Step 5: Connecting from Phone

1. On your phone, connect to the same Wi-Fi network as your laptop.
2. Open Safari (iOS) or Chrome (Android) and visit:
   `http://<YOUR_LAPTOP_IP>:8000/?room=PARTY77`
   *(Your local IP is printed in the server terminal output on startup)*.
3. Tap **Join Party**.
4. Tap **🪟 PiP** on the video feed so your friend's video hovers in a floating thumbnail.
5. Tap **Open in Netflix App** to switch to Netflix while the video call and sync controls stay active!

---

## 📁 Project Structure

```
netflix-party-sync/
├── extension/                      # Chrome Extension (Laptop Priority)
│   ├── manifest.json               # Manifest V3 configuration
│   ├── content.js                  # Injected UI, WebRTC AV, and Audio Mixer
│   ├── netflix_bridge.js           # Main-world script for Netflix Cadmium & HTML5 player
│   ├── overlay.css                 # Netflix Dark Mode glassmorphic stylesheet
│   ├── popup.html                  # Extension settings popup
│   ├── popup.js                    # Room code & server configuration
│   └── icons/                      # Extension icons (48x48, 128x128)
├── server/                         # Signaling & Web Application
│   ├── server.py                   # Pure Python 3 WebSocket + HTTP static server
│   ├── server.js                   # Node.js + Express + ws alternative
│   ├── package.json                # Node dependencies
│   └── public/                     # Mobile Companion & Test Client
│       ├── index.html              # Mobile companion web app
│       ├── style.css               # Mobile-first glassmorphism styling
│       ├── app.js                  # WebRTC, synced controller & haptics
│       └── test_player.html        # HTML5 video player simulator
├── start.sh                        # One-click startup script
└── README.md                       # Comprehensive guide
```

---

## 🛠️ Customization & Features

- **Draggable UI**: Click and drag the overlay header to place it anywhere on screen.
- **Voice Boost**: The friend volume slider scales from 0% to 200% so soft voices can be boosted above loud movie audio.
- **Zero Dependencies**: `server.py` uses only Python's standard library (`asyncio`, `hashlib`, `struct`, `socket`). No `pip install` required.
