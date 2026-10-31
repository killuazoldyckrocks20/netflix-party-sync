const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 8000;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/room/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map(); // roomId -> Map(peerId -> { ws, userName })

function broadcast(roomId, message, excludePeerId = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  const payload = JSON.stringify(message);
  for (const [peerId, client] of room.entries()) {
    if (peerId !== excludePeerId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

wss.on('connection', (ws) => {
  let clientRoomId = null;
  let clientPeerId = null;
  let clientUserName = 'Friend';

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'join') {
        clientRoomId = (msg.roomId || 'DEFAULT').trim().toUpperCase();
        clientPeerId = msg.peerId || `peer-${Date.now()}`;
        clientUserName = msg.userName || 'Friend';

        if (!rooms.has(clientRoomId)) {
          rooms.set(clientRoomId, new Map());
        }
        const room = rooms.get(clientRoomId);

        const existingPeers = [];
        for (const [pid, c] of room.entries()) {
          if (pid !== clientPeerId) {
            existingPeers.push({ peerId: pid, userName: c.userName });
          }
        }

        room.set(clientPeerId, { ws, userName: clientUserName });

        ws.send(JSON.stringify({
          type: 'joined',
          roomId: clientRoomId,
          peerId: clientPeerId,
          peers: existingPeers
        }));

        broadcast(clientRoomId, {
          type: 'peer-joined',
          roomId: clientRoomId,
          peerId: clientPeerId,
          userName: clientUserName
        }, clientPeerId);
      } else if (msg.type === 'signal') {
        const room = rooms.get(clientRoomId);
        if (room && msg.targetId && room.has(msg.targetId)) {
          const target = room.get(msg.targetId);
          if (target.ws.readyState === WebSocket.OPEN) {
            target.ws.send(JSON.stringify({
              type: 'signal',
              senderId: clientPeerId,
              targetId: msg.targetId,
              signal: msg.signal
            }));
          }
        } else if (clientRoomId) {
          broadcast(clientRoomId, {
            type: 'signal',
            senderId: clientPeerId,
            signal: msg.signal
          }, clientPeerId);
        }
      } else if (msg.type === 'sync') {
        if (clientRoomId) {
          broadcast(clientRoomId, {
            type: 'sync',
            action: msg.action,
            time: msg.time,
            senderId: clientPeerId,
            userName: clientUserName,
            timestamp: msg.timestamp
          }, clientPeerId);
        }
      } else if (msg.type === 'chat') {
        if (clientRoomId) {
          broadcast(clientRoomId, {
            type: 'chat',
            text: msg.text,
            senderId: clientPeerId,
            userName: clientUserName
          });
        }
      } else if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (e) {
      console.error('[WS Parse Error]', e);
    }
  });

  ws.on('close', () => {
    if (clientRoomId && rooms.has(clientRoomId)) {
      const room = rooms.get(clientRoomId);
      room.delete(clientPeerId);
      broadcast(clientRoomId, {
        type: 'peer-left',
        peerId: clientPeerId,
        userName: clientUserName
      });
      if (room.size === 0) {
        rooms.delete(clientRoomId);
      }
    }
  });
});

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIp();
  console.log(`🎬 Server running at http://localhost:${PORT} and http://${ip}:${PORT}`);
});
