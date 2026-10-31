# Minimal Dockerfile for Netflix Party Sync Signaling Server
FROM python:3.11-slim

WORKDIR /app
COPY server /app/server

EXPOSE 8000

ENV PORT=8000
CMD ["python", "server/server.py"]
