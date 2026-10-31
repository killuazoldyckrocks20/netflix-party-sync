/**
 * Netflix Party Sync - Universal Serverless Cloud & Local Signaling Client
 * 
 * Automatically connects via:
 * 1. Serverless Cloud Broker (wss://broker.emqx.io:8084/mqtt) when hosted on GitHub Pages
 *    or when no local server is running (ZERO local servers needed!)
 * 2. Standard WebSocket Server (ws://localhost:8000/ws) if explicitly configured.
 */

class UniversalSignalingClient {
  constructor(options = {}) {
    this.roomId = (options.roomId || 'PARTY77').trim().toUpperCase();
    this.roomPassword = (options.roomPassword || '').trim();
    this.peerId = options.peerId || 'peer-' + Math.random().toString(36).substring(2, 9);
    this.userName = options.userName || 'Guest';
    this.serverUrl = options.serverUrl || 'cloud';

    this.onMessage = options.onMessage || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onLog = options.onLog || console.log;

    this.ws = null;
    this.isMqtt = false;
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.isClosed = false;
    this.knownPeers = new Map(); // peerId -> userName

    // Public 24/7 free brokers (zero server required)
    this.cloudBrokers = [
      'wss://broker.hivemq.com:8884/mqtt',
      'wss://broker.emqx.io:8084/mqtt',
      'wss://test.mosquitto.org:8081'
    ];
    this.cloudBrokerIdx = 0;
  }

  hashPassword(pass) {
    if (!pass) return '';
    let h = 0x811c9dc5;
    for (let i = 0; i < pass.length; i++) {
      h ^= pass.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  }

  getRoomTopic() {
    const passHash = this.hashPassword(this.roomPassword);
    return passHash ? `nps-party-v1/${this.roomId}-${passHash}` : `nps-party-v1/${this.roomId}`;
  }

  isCloudMode() {
    if (!this.serverUrl || this.serverUrl === 'cloud' || this.serverUrl === 'default') {
      return true;
    }
    if (this.serverUrl.includes('emqx') || this.serverUrl.includes('mosquitto') || this.serverUrl.includes('hivemq')) {
      return true;
    }
    // If loaded on GitHub Pages or any https domain without explicit ws:// URL
    if (typeof window !== 'undefined' && window.location) {
      if (window.location.hostname.includes('github.io')) {
        return true;
      }
    }
    return false;
  }

  connect() {
    this.isClosed = false;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pingTimer);

    if (this.isCloudMode()) {
      this.connectCloudMqtt();
    } else {
      this.connectStandardWs();
    }
  }

  /* ================= SERVERLESS CLOUD MQTT BROKER ================= */
  connectCloudMqtt() {
    this.isMqtt = true;
    const brokerUrl = this.cloudBrokers[this.cloudBrokerIdx % this.cloudBrokers.length];
    this.onLog(`[Signaling] Connecting to Serverless Cloud Broker: ${brokerUrl}`);
    this.onStatusChange('connecting');

    try {
      this.ws = new WebSocket(brokerUrl, ['mqtt']);
      this.ws.binaryType = 'arraybuffer';
    } catch (e) {
      this.onLog(`[Signaling] WebSocket constructor error: ${e}`);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.onLog('[Signaling] Cloud socket open. Sending MQTT CONNECT packet...');
      const connectPkt = this.buildMqttConnect(this.peerId);
      this.ws.send(connectPkt);
    };

    this.ws.onmessage = async (event) => {
      try {
        let arrayBuf;
        if (event.data instanceof ArrayBuffer) {
          arrayBuf = event.data;
        } else if (event.data instanceof Blob) {
          arrayBuf = await event.data.arrayBuffer();
        } else if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data);
            if (msg.senderId && msg.senderId === this.peerId) return;
            this.handleIncomingMessage(msg);
          } catch (e) {}
          return;
        } else {
          return;
        }
        const buf = new Uint8Array(arrayBuf);
        if (buf.length < 2) return;
        const ptype = buf[0] & 0xF0;

        if (ptype === 0x20) {
          // CONNACK packet: successfully connected to cloud broker!
          this.onLog('[Signaling] Cloud MQTT Connected! Subscribing to room topic...');
          this.onStatusChange('connected');
          const topic = this.getRoomTopic();
          this.ws.send(this.buildMqttSubscribe(topic, 1));

          // Start heartbeat ping every 25 seconds
          if (this.pingTimer) clearInterval(this.pingTimer);
          this.pingTimer = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.send(new Uint8Array([0xC0, 0x00])); // PINGREQ
            }
          }, 25000);

          // Broadcast Join announcement to everyone in the room
          setTimeout(() => {
            this.send({
              type: 'join',
              roomId: this.roomId,
              peerId: this.peerId,
              userName: this.userName
            });
          }, 300);

        } else if (ptype === 0x30) {
          // PUBLISH packet: incoming room message!
          const parsed = this.parseMqttPublish(buf);
          if (parsed && parsed.payload) {
            try {
              const msg = JSON.parse(parsed.payload.trim());
              // Ignore messages echoed back from self
              if (msg.senderId && msg.senderId === this.peerId) {
                return;
              }
              this.handleIncomingMessage(msg);
            } catch (err) {
              this.onLog(`[Signaling] JSON Parse error: ${err}`);
            }
          }
        }
      } catch (err) {
        this.onLog(`[Signaling] Packet processing error: ${err}`);
      }
    };

    this.ws.onclose = () => {
      this.onLog('[Signaling] Cloud socket closed.');
      this.onStatusChange('disconnected');
      if (!this.isClosed) {
        this.cloudBrokerIdx++;
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (err) => {
      this.onLog('[Signaling] Cloud socket error.');
    };
  }

  /* ================= STANDARD LOCAL WEBSOCKET ================= */
  connectStandardWs() {
    this.isMqtt = false;
    let url = this.serverUrl;
    if (url.startsWith('http://')) url = url.replace('http://', 'ws://');
    if (url.startsWith('https://')) url = url.replace('https://', 'wss://');
    if (!url.endsWith('/ws')) url = url.replace(/\/+$/, '') + '/ws';

    this.onLog(`[Signaling] Connecting to local/private WebSocket: ${url}`);
    this.onStatusChange('connecting');

    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.onLog('[Signaling] Local WebSocket connected!');
      this.onStatusChange('connected');
      this.sendRaw({
        type: 'join',
        roomId: this.roomId,
        peerId: this.peerId,
        userName: this.userName
      });
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.onMessage(msg);
      } catch (e) {}
    };

    this.ws.onclose = () => {
      this.onStatusChange('disconnected');
      if (!this.isClosed) this.scheduleReconnect();
    };

    this.ws.onerror = () => {};
  }

  /* ================= PROTOCOL LOGIC & PEER HANDSHAKE ================= */
  handleIncomingMessage(msg) {
    // Password validation if room requires one
    if (this.roomPassword) {
      const expectedHash = this.hashPassword(this.roomPassword);
      if (msg.passHash && msg.passHash !== expectedHash) {
        this.onMessage({ type: 'auth-error', error: 'Incorrect room password' });
        return;
      }
    }

    if (msg.type === 'join') {
      // Another peer just joined the room!
      const newPeerId = msg.peerId;
      const newUserName = msg.userName || 'Friend';
      this.knownPeers.set(newPeerId, newUserName);

      // Reply with welcome so the new peer knows we exist
      this.send({
        type: 'peer-welcome',
        targetId: newPeerId,
        peerId: this.peerId,
        userName: this.userName
      });

      // Notify consumer that peer joined
      this.onMessage({
        type: 'peer-joined',
        peerId: newPeerId,
        userName: newUserName
      });

    } else if (msg.type === 'peer-welcome') {
      // Existing peer replied to our join message!
      if (!msg.targetId || msg.targetId === this.peerId) {
        this.knownPeers.set(msg.peerId, msg.userName || 'Friend');
        this.onMessage({
          type: 'joined',
          roomId: this.roomId,
          peerId: this.peerId,
          peers: [{ peerId: msg.peerId, userName: msg.userName || 'Friend' }]
        });
      }

    } else if (msg.type === 'signal') {
      // Only process signals meant for us or broadcast
      if (!msg.targetId || msg.targetId === this.peerId) {
        this.onMessage(msg);
      }

    } else {
      // sync, chat, ping, etc.
      this.onMessage(msg);
    }
  }

  send(data) {
    data.senderId = this.peerId;
    data.roomId = this.roomId;
    if (this.roomPassword) {
      data.passHash = this.hashPassword(this.roomPassword);
    }
    if (!data.userName) data.userName = this.userName;
    this.sendRaw(data);
  }

  sendRaw(data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      if (this.isMqtt) {
        const topic = this.getRoomTopic();
        const jsonStr = JSON.stringify(data);
        const pkt = this.buildMqttPublish(topic, jsonStr);
        this.ws.send(pkt);
      } else {
        this.ws.send(JSON.stringify(data));
      }
    } catch (e) {
      this.onLog(`[Signaling] Send error: ${e}`);
    }
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pingTimer);
    if (this.isClosed) return;
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, 4000);
  }

  close() {
    this.isClosed = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pingTimer);
    if (this.ws) {
      try {
        this.send({ type: 'peer-left', peerId: this.peerId, userName: this.userName });
        this.ws.close();
      } catch (e) {}
    }
  }

  /* ================= PURE JAVASCRIPT MQTT 3.1.1 ENCODER/PARSER ================= */
  encodeString(s) {
    const utf8 = new TextEncoder().encode(s);
    const buf = new Uint8Array(2 + utf8.length);
    buf[0] = (utf8.length >> 8) & 0xFF;
    buf[1] = utf8.length & 0xFF;
    buf.set(utf8, 2);
    return buf;
  }

  buildMqttConnect(clientId) {
    const protoName = this.encodeString('MQTT');
    const protoLevel = new Uint8Array([0x04]); // 3.1.1
    const flags = new Uint8Array([0x02]); // Clean session
    const keepAlive = new Uint8Array([0x00, 0x3C]); // 60s
    const payload = this.encodeString(clientId);

    const varHeaderLen = protoName.length + 1 + 1 + 2;
    const remLen = varHeaderLen + payload.length;

    const pkt = new Uint8Array(2 + remLen);
    pkt[0] = 0x10; // CONNECT
    pkt[1] = remLen;
    let offset = 2;

    pkt.set(protoName, offset); offset += protoName.length;
    pkt.set(protoLevel, offset); offset += 1;
    pkt.set(flags, offset); offset += 1;
    pkt.set(keepAlive, offset); offset += 2;
    pkt.set(payload, offset);

    return pkt;
  }

  buildMqttSubscribe(topic, msgId = 1) {
    const topicBytes = this.encodeString(topic);
    const varHeader = new Uint8Array([(msgId >> 8) & 0xFF, msgId & 0xFF]);
    const qos = new Uint8Array([0x00]);

    const remLen = varHeader.length + topicBytes.length + qos.length;
    const pkt = new Uint8Array(2 + remLen);
    pkt[0] = 0x82; // SUBSCRIBE
    pkt[1] = remLen;
    let offset = 2;

    pkt.set(varHeader, offset); offset += varHeader.length;
    pkt.set(topicBytes, offset); offset += topicBytes.length;
    pkt.set(qos, offset);

    return pkt;
  }

  buildMqttPublish(topic, messageStr) {
    const topicBytes = this.encodeString(topic);
    const msgBytes = new TextEncoder().encode(messageStr);
    const remLen = topicBytes.length + msgBytes.length;

    // Remaining length varint
    const remBytes = [];
    let val = remLen;
    do {
      let digit = val % 128;
      val = Math.floor(val / 128);
      if (val > 0) digit |= 0x80;
      remBytes.push(digit);
    } while (val > 0);

    const headerLen = 1 + remBytes.length;
    const pkt = new Uint8Array(headerLen + remLen);
    pkt[0] = 0x30; // PUBLISH QoS 0
    pkt.set(remBytes, 1);

    let offset = headerLen;
    pkt.set(topicBytes, offset); offset += topicBytes.length;
    pkt.set(msgBytes, offset);

    return pkt;
  }

  parseMqttPublish(buf) {
    let idx = 1;
    let multiplier = 1;
    let remLen = 0;
    while (idx < buf.length) {
      const b = buf[idx++];
      remLen += (b & 0x7F) * multiplier;
      multiplier *= 128;
      if ((b & 0x80) === 0) break;
    }

    if (idx + 2 > buf.length) return null;
    const topicLen = (buf[idx] << 8) | buf[idx + 1];
    idx += 2;

    const topicBytes = buf.subarray(idx, idx + topicLen);
    const topic = new TextDecoder().decode(topicBytes);
    idx += topicLen;

    const qos = (buf[0] & 0x06) >> 1;
    if (qos > 0 && idx + 2 <= buf.length) {
      idx += 2; // Skip 2-byte Packet Identifier for QoS 1 & 2
    }

    const payloadBytes = buf.subarray(idx);
    const payload = new TextDecoder().decode(payloadBytes);

    return { topic, payload };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { UniversalSignalingClient };
}
