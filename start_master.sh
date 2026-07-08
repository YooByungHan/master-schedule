#!/bin/bash
# 마스터공정표 서버 시작 — 바탕화면 아이콘(▶ 마스터공정표 시작)에서 실행됨.
# node server.js 를 백그라운드로 띄우고, 뜬 뒤 기본 브라우저로 자동 접속한다.
cd "$(dirname "$0")"

PIDFILE="server.pid"
LOGFILE="server.log"

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "이미 서버가 실행 중입니다 (PID: $(cat "$PIDFILE"))"
else
  nohup node server.js > "$LOGFILE" 2>&1 &
  echo $! > "$PIDFILE"
  echo "서버 시작됨 (PID: $!)"
fi

# certs/server.crt 가 있으면 HTTPS 로 자동 실행되므로(server.js 참고) 주소도 맞춰 연다.
sleep 2
if [ -f "certs/server.crt" ]; then
  URL="https://localhost:3000"
else
  URL="http://localhost:3000"
fi

xdg-open "$URL" >/dev/null 2>&1 &
