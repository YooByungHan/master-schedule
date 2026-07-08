#!/bin/bash
# 마스터공정표 서버 종료 — 바탕화면 아이콘(■ 마스터공정표 종료)에서 실행됨.
cd "$(dirname "$0")"

PIDFILE="server.pid"

if [ -f "$PIDFILE" ]; then
  PID=$(cat "$PIDFILE")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    echo "서버 종료됨 (PID: $PID)"
  else
    echo "이미 종료된 서버입니다 (PID: $PID)"
  fi
  rm -f "$PIDFILE"
else
  # PID 파일이 없을 때(예: start_master.sh 없이 수동 실행한 경우) 이름으로 찾아 종료
  PIDS=$(pgrep -f "node .*server\.js" 2>/dev/null)
  if [ -n "$PIDS" ]; then
    kill $PIDS
    echo "서버 종료됨 (PID: $PIDS)"
  else
    echo "실행 중인 서버를 찾지 못했습니다"
  fi
fi
