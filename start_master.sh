#!/bin/bash
# 마스터공정표 서버 시작 — 바탕화면 아이콘(▶ 마스터공정표 시작)에서 실행됨.
# node server.js 를 백그라운드로 띄우고, 뜬 뒤 기본 브라우저로 자동 접속한다.
# Terminal=false(.desktop)로 실행되어 콘솔 창이 없으므로, 결과는 echo가 아니라
# 화면에 뜨는 데스크톱 알림(notify-send, 없으면 zenity 팝업)으로 안내한다.
cd "$(dirname "$0")"

PIDFILE="server.pid"
LOGFILE="server.log"

notify() {
  # $1=제목 $2=본문
  if command -v notify-send >/dev/null 2>&1; then
    notify-send "$1" "$2"
  elif command -v zenity >/dev/null 2>&1; then
    zenity --info --title="$1" --text="$2" --timeout=5 2>/dev/null &
  fi
  echo "[$1] $2" >> "$LOGFILE"
}

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  notify "마스터공정표" "이미 서버가 실행 중입니다 (PID: $(cat "$PIDFILE"))"
else
  nohup node server.js > "$LOGFILE" 2>&1 &
  NEWPID=$!
  echo "$NEWPID" > "$PIDFILE"
  sleep 1
  if kill -0 "$NEWPID" 2>/dev/null; then
    notify "마스터공정표" "서버가 시작되었습니다 (PID: $NEWPID)"
  else
    notify "마스터공정표 — 오류" "서버 시작에 실패했습니다. server.log 를 확인하세요."
    exit 1
  fi
fi

# certs/server.crt 가 있으면 HTTPS 로 자동 실행되므로(server.js 참고) 주소도 맞춰 연다.
if [ -f "certs/server.crt" ]; then
  URL="https://localhost:3000"
else
  URL="http://localhost:3000"
fi

xdg-open "$URL" >/dev/null 2>&1 &
