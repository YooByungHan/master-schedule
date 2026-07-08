#!/bin/bash
# 마스터공정표 서버 종료 — 바탕화면 아이콘(■ 마스터공정표 종료)에서 실행됨.
# Terminal=false(.desktop)로 실행되어 콘솔 창이 없으므로, 결과는 echo가 아니라
# 화면에 뜨는 데스크톱 알림(notify-send, 없으면 zenity 팝업)으로 안내한다.
cd "$(dirname "$0")"

PIDFILE="server.pid"
LOGFILE="server.log"

notify() {
  if command -v notify-send >/dev/null 2>&1; then
    notify-send "$1" "$2"
  elif command -v zenity >/dev/null 2>&1; then
    zenity --info --title="$1" --text="$2" --timeout=5 2>/dev/null &
  fi
  echo "[$1] $2" >> "$LOGFILE"
}

if [ -f "$PIDFILE" ]; then
  PID=$(cat "$PIDFILE")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    notify "마스터공정표" "서버를 종료했습니다 (PID: $PID)"
  else
    notify "마스터공정표" "이미 종료된 서버입니다 (PID: $PID)"
  fi
  rm -f "$PIDFILE"
else
  # PID 파일이 없을 때(예: start_master.sh 없이 수동 실행한 경우) 이름으로 찾아 종료
  PIDS=$(pgrep -f "node .*server\.js" 2>/dev/null)
  if [ -n "$PIDS" ]; then
    kill $PIDS
    notify "마스터공정표" "서버를 종료했습니다 (PID: $PIDS)"
  else
    notify "마스터공정표" "실행 중인 서버를 찾지 못했습니다"
  fi
fi
