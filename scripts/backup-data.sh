#!/bin/bash
# 실데이터(계정/현장 데이터/설정/백업/하도사파일) 스냅샷 백업.
# 저장소 "바깥"(../master-schedule_backups) 에 보관한다 — 저장소 폴더 자체가
# 통째로 삭제/재설치되는 사고가 나도 백업은 영향받지 않도록 하기 위함.
#
# 사용법: 저장소 루트에서  bash scripts/backup-data.sh
# update-server.sh 가 업데이트 직전 자동으로 호출한다. 필요하면 단독 실행도 가능.
set -e
cd "$(dirname "$0")/.."

BACKUP_ROOT="../master-schedule_backups"
TS=$(date +%Y%m%d_%H%M%S)
DEST="$BACKUP_ROOT/$TS"
mkdir -p "$DEST"

# git이 추적하지 않는(=GitHub에는 없는) 실데이터·민감파일만 백업 대상으로 삼는다.
ITEMS="data.json accounts.json config.json google-oauth.json data 백업 하도업체 certs"
copied=0
for item in $ITEMS; do
  if [ -e "$item" ]; then
    cp -r "$item" "$DEST/" 2>/dev/null && copied=$((copied+1))
  fi
done

if [ "$copied" -eq 0 ]; then
  rmdir "$DEST" 2>/dev/null || true
  echo "[백업] 대상 파일이 아직 없습니다(신규 설치 등) — 건너뜀"
else
  echo "[백업] 완료: $DEST ($copied 개 항목)"
fi

# 오래된 백업은 최근 30개만 남기고 자동 정리(디스크 무한 증가 방지)
if [ -d "$BACKUP_ROOT" ]; then
  cd "$BACKUP_ROOT"
  ls -1t 2>/dev/null | tail -n +31 | xargs -r -I{} rm -rf "{}"
fi
