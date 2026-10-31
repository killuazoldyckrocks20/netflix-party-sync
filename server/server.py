#!/usr/bin/env python3
"""
Netflix Party Sync & Video Call - Signaling & Web Server
Pure Python 3 standard library implementation (Zero external dependencies).
Provides:
  1. RFC 6455 WebSocket server for real-time WebRTC signaling and playback sync.
  2. HTTP static file server with CORS for the companion web app & test player.
  3. Room management with multi-client broadcasting.
"""

import asyncio
import base64
import hashlib
import json
import mimetypes
import os
import socket
import struct
import sys
import urllib.parse

PORT = 8000
PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

# In-memory rooms: roomId -> dict(peerId -> ClientConnection)
rooms = {}

class ClientConnection:
    def __init__(self, reader, writer, client_ip):
        self.reader = reader
        self.writer = writer
        self.client_ip = client_ip
        self.room_id = None
        self.peer_id = None
        self.user_name = "Guest"
        self.is_closed = False

    async def send_text(self, text):
        if self.is_closed:
            return
        try:
            payload = text.encode("utf-8")
            header = bytearray()
            header.append(0x80 | 0x01)  # FIN + Text Opcode
            length = len(payload)
            if length <= 125:
                header.append(length)
            elif length <= 65535:
                header.append(126)
                header.extend(struct.pack("!H", length))
            else:
                header.append(127)
                header.extend(struct.pack("!Q", length))
            self.writer.write(bytes(header) + payload)
            await self.writer.drain()
        except Exception:
            self.is_closed = True

    async def send_json(self, data):
        await self.send_text(json.dumps(data))

    async def send_pong(self, payload=b""):
        try:
            header = bytearray([0x80 | 0x0A, len(payload)])
            self.writer.write(bytes(header) + payload)
            await self.writer.drain()
        except Exception:
            self.is_closed = True

    async def close(self):
        if self.is_closed:
            return
        self.is_closed = True
        try:
            # Send Close Frame
            self.writer.write(bytes([0x80 | 0x08, 0x00]))
            await self.writer.drain()
            self.writer.close()
            await self.writer.wait_closed()
        except Exception:
            pass


async def read_ws_frame(reader):
    """Reads a single RFC 6455 WebSocket frame from reader."""
    try:
        header = await reader.readexactly(2)
    except (asyncio.IncompleteReadError, ConnectionResetError):
        return None, None
    b0, b1 = header[0], header[1]
    fin = bool(b0 & 0x80)
    opcode = b0 & 0x0F
    has_mask = bool(b1 & 0x80)
    payload_len = b1 & 0x7F

    if payload_len == 126:
        ext = await reader.readexactly(2)
        payload_len = struct.unpack("!H", ext)[0]
    elif payload_len == 127:
        ext = await reader.readexactly(8)
        payload_len = struct.unpack("!Q", ext)[0]

    mask = await reader.readexactly(4) if has_mask else None
    data = await reader.readexactly(payload_len)
    if mask:
        data = bytearray(b ^ mask[i % 4] for i, b in enumerate(data))
    return opcode, bytes(data)


async def handle_ws_client(client):
    """Main message loop for an active WebSocket client."""
    print(f"[WS] Client connected from {client.client_ip}")
    try:
        while not client.is_closed:
            opcode, data = await read_ws_frame(client.reader)
            if opcode is None or opcode == 0x08:  # Close frame or EOF
                break
            elif opcode == 0x09:  # Ping frame
                await client.send_pong(data)
                continue
            elif opcode == 0x0A:  # Pong frame
                continue
            elif opcode == 0x01:  # Text frame
                try:
                    msg = json.loads(data.decode("utf-8"))
                    await handle_room_message(client, msg)
                except Exception as e:
                    print(f"[WS] Error processing message: {e}")
    finally:
        await remove_client_from_room(client)
        await client.close()
        print(f"[WS] Client disconnected: {client.peer_id or client.client_ip}")


async def handle_room_message(client, msg):
    """Processes signaling and sync messages inside rooms."""
    msg_type = msg.get("type")

    if msg_type == "join":
        room_id = str(msg.get("roomId", "default")).strip().upper()
        peer_id = str(msg.get("peerId", ""))
        user_name = str(msg.get("userName", "Friend"))
        client.room_id = room_id
        client.peer_id = peer_id
        client.user_name = user_name

        if room_id not in rooms:
            rooms[room_id] = {}

        # Get existing peers before adding this one
        existing_peers = [
            {"peerId": pid, "userName": c.user_name}
            for pid, c in rooms[room_id].items()
            if pid != peer_id and not c.is_closed
        ]

        rooms[room_id][peer_id] = client

        # Acknowledge join to current client
        await client.send_json({
            "type": "joined",
            "roomId": room_id,
            "peerId": peer_id,
            "peers": existing_peers
        })

        # Broadcast to other members in the room that a new peer joined
        await broadcast_to_room(room_id, {
            "type": "peer-joined",
            "roomId": room_id,
            "peerId": peer_id,
            "userName": user_name
        }, exclude_peer_id=peer_id)
        print(f"[Room {room_id}] Peer {peer_id} ({user_name}) joined. Total members: {len(rooms[room_id])}")

    elif msg_type == "signal":
        # Forward WebRTC signaling (offer, answer, candidate)
        target_id = msg.get("targetId")
        room_id = client.room_id
        if room_id and room_id in rooms:
            if target_id and target_id in rooms[room_id]:
                target = rooms[room_id][target_id]
                await target.send_json({
                    "type": "signal",
                    "senderId": client.peer_id,
                    "targetId": target_id,
                    "signal": msg.get("signal")
                })
            else:
                # If targetId is not specified, broadcast to others
                await broadcast_to_room(room_id, {
                    "type": "signal",
                    "senderId": client.peer_id,
                    "signal": msg.get("signal")
                }, exclude_peer_id=client.peer_id)

    elif msg_type == "sync":
        # Media sync action: play, pause, seek, heartbeat
        room_id = client.room_id
        if room_id:
            await broadcast_to_room(room_id, {
                "type": "sync",
                "action": msg.get("action"),
                "time": msg.get("time", 0.0),
                "senderId": client.peer_id,
                "userName": client.user_name,
                "timestamp": msg.get("timestamp")
            }, exclude_peer_id=client.peer_id)

    elif msg_type == "chat":
        room_id = client.room_id
        if room_id:
            await broadcast_to_room(room_id, {
                "type": "chat",
                "text": msg.get("text", ""),
                "senderId": client.peer_id,
                "userName": client.user_name
            })

    elif msg_type == "ping":
        await client.send_json({"type": "pong"})


async def broadcast_to_room(room_id, message_dict, exclude_peer_id=None):
    if room_id not in rooms:
        return
    stale_peers = []
    for pid, c in rooms[room_id].items():
        if pid == exclude_peer_id:
            continue
        if c.is_closed:
            stale_peers.append(pid)
        else:
            await c.send_json(message_dict)
    for pid in stale_peers:
        rooms[room_id].pop(pid, None)


async def remove_client_from_room(client):
    room_id = client.room_id
    peer_id = client.peer_id
    if room_id and room_id in rooms:
        if peer_id and peer_id in rooms[room_id]:
            rooms[room_id].pop(peer_id, None)
            await broadcast_to_room(room_id, {
                "type": "peer-left",
                "peerId": peer_id,
                "userName": client.user_name
            })
            print(f"[Room {room_id}] Peer {peer_id} left. Remaining: {len(rooms[room_id])}")
        if len(rooms[room_id]) == 0:
            rooms.pop(room_id, None)


async def handle_http_request(reader, writer, request_line, headers):
    """Serves static files and CORS responses for web clients and extension."""
    parts = request_line.split()
    if len(parts) < 2:
        writer.close()
        return
    method, raw_path = parts[0], parts[1]
    parsed_url = urllib.parse.urlparse(raw_path)
    clean_path = parsed_url.path

    cors_headers = (
        "Access-Control-Allow-Origin: *\r\n"
        "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        "Access-Control-Allow-Headers: *\r\n"
    )

    if method == "OPTIONS":
        response = f"HTTP/1.1 204 No Content\r\n{cors_headers}\r\n"
        writer.write(response.encode("utf-8"))
        await writer.drain()
        writer.close()
        return

    # Check for room-specific routing: e.g. /room/ABCD -> serve index.html
    if clean_path.startswith("/room/"):
        clean_path = "/index.html"
    elif clean_path == "/" or clean_path == "":
        clean_path = "/index.html"

    # Normalize safe path inside PUBLIC_DIR
    target_path = os.path.normpath(os.path.join(PUBLIC_DIR, clean_path.lstrip("/")))
    if not target_path.startswith(PUBLIC_DIR) or not os.path.exists(target_path) or os.path.isdir(target_path):
        not_found = (
            f"HTTP/1.1 404 Not Found\r\n"
            f"{cors_headers}"
            f"Content-Type: text/plain\r\n"
            f"Content-Length: 9\r\n\r\nNot Found"
        )
        writer.write(not_found.encode("utf-8"))
        await writer.drain()
        writer.close()
        return

    mime_type, _ = mimetypes.guess_type(target_path)
    if not mime_type:
        if target_path.endswith(".js"):
            mime_type = "application/javascript"
        elif target_path.endswith(".css"):
            mime_type = "text/css"
        elif target_path.endswith(".json"):
            mime_type = "application/json"
        else:
            mime_type = "application/octet-stream"

    try:
        with open(target_path, "rb") as f:
            content = f.read()
        header = (
            f"HTTP/1.1 200 OK\r\n"
            f"{cors_headers}"
            f"Content-Type: {mime_type}\r\n"
            f"Content-Length: {len(content)}\r\n"
            f"Cache-Control: no-cache\r\n"
            f"\r\n"
        )
        writer.write(header.encode("utf-8") + content)
        await writer.drain()
    except Exception as e:
        print(f"[HTTP] Error reading {target_path}: {e}")
    finally:
        writer.close()


async def handle_connection(reader, writer):
    """Dispatches between WebSocket upgrade and static HTTP requests."""
    peer_addr = writer.get_extra_info("peername")
    client_ip = peer_addr[0] if peer_addr else "unknown"

    request_lines = []
    while True:
        try:
            line = await reader.readline()
            if not line or line == b"\r\n":
                break
            request_lines.append(line.decode("utf-8", errors="ignore").rstrip("\r\n"))
        except Exception:
            writer.close()
            return

    if not request_lines:
        writer.close()
        return

    request_line = request_lines[0]
    headers = {}
    for line in request_lines[1:]:
        if ":" in line:
            k, v = line.split(":", 1)
            headers[k.strip().lower()] = v.strip()

    # Detect WebSocket Upgrade
    if headers.get("upgrade", "").lower() == "websocket" and "sec-websocket-key" in headers:
        key = headers["sec-websocket-key"]
        accept_token = base64.b64encode(
            hashlib.sha1((key + WS_GUID).encode("utf-8")).digest()
        ).decode("utf-8")

        response = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept_token}\r\n"
            "\r\n"
        )
        writer.write(response.encode("utf-8"))
        await writer.drain()

        client = ClientConnection(reader, writer, client_ip)
        await handle_ws_client(client)
    else:
        # Standard HTTP file request
        await handle_http_request(reader, writer, request_line, headers)


def get_local_ip():
    """Detects local LAN IP for easy mobile phone testing."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


async def main():
    server = await asyncio.start_server(handle_connection, "0.0.0.0", PORT)
    local_ip = get_local_ip()
    print("=" * 65)
    print(f"🎬 Netflix Party Sync & Video Call Server running!")
    print(f"💻 Laptop (Localhost):   http://localhost:{PORT}")
    print(f"📱 Phone (Same Wi-Fi):   http://{local_ip}:{PORT}")
    print(f"🔌 WebSocket Endpoint:   ws://localhost:{PORT}/ws")
    print(f"🎯 Test Player:          http://localhost:{PORT}/test_player.html")
    print("=" * 65)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nServer stopped.")
