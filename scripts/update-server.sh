#!/bin/bash
# master-schedule 서버 최신화 스크립트 (일상적인 업데이트용).
#
# 전제: 이 스크립트는 "이미 git clone 으로 설치된" 저장소 안에서만 실행한다.
#       최초 설치(아직 폴더가 없을 때)는 이 스크립트를 쓰지 않고 아래를 한 번 실행한다:
#         git clone https://github.com/YooByungHan/master-schedule.git
#
# 이 스크립트는 절대 폴더를 삭제하지 않는다. 항상 먼저 백업 → git pull → npm install 순서.
#
# 사용법: 저장소 루트에서  bash scripts/update-server.sh
set -e
cd "$(dirname "$0")/.."

if [ ! -d ".git" ]; then
  echo "⚠ 이 폴더는 git 저장소가 아닙니다."
  echo "  최초 설치는 아래 명령으로 새로 clone 해주세요(현재 폴더를 지우지 않습니다):"
  echo "  git clone https://github.com/YooByungHan/master-schedule.git"
  exit 1
fi

echo "=== 1) 실데이터 백업 ==="
bash scripts/backup-data.sh

echo "=== 2) 최신 코드 받기 (git pull) ==="
git pull origin main

echo "=== 3) 의존성 설치 (npm install) ==="
npm install

echo "--------------------------------------"
echo "완료. 서버를 재시작해주세요:"
echo "  (기존 node server.js 를 Ctrl+C로 종료 후) node server.js"
