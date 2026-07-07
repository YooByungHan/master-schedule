# Terminus MasterSchedule Pro (데스크톱 앱)

개인용 공정표 앱을 **설치형 Windows 앱(.exe)**으로 배포하기 위한 Electron 패키지.
`.bat`·Node.js 설치 없이 더블클릭으로 실행되고, 실행 시 **GitHub Release를 확인해 자동 업데이트**한다.

## 구성

| 파일 | 역할 |
|---|---|
| `main.js` | Electron 메인. AI 서버(`ai-server.js`) 내장 구동 + 창 로드 + 네이티브 저장 + 자동업데이트 |
| `preload.js` | 렌더러에 `window.terminusNative`(저장창·버전) 안전 노출 |
| `package.json` | 앱 이름/버전 + electron-builder 빌드 설정 |

상위 폴더의 `Terminus_master_schedule.html`, `ai-server.js`, `ai-core.js`, 간트 템플릿(`.xlsb`)을
빌드 시 함께 패키징한다(중복 보관 없음).

## 로컬에서 실행/빌드 (개발자)

```bash
cd pro
npm install
npm start        # 개발 실행 (Electron 창)
npm run pack     # 설치 없이 폴더형 빌드(dist/win-unpacked) — 빠른 확인용
npm run dist     # 설치파일(.exe) 빌드 + GitHub Release 업로드 (GH_TOKEN 필요)
```

## 자동 배포 (권장 흐름)

1. `pro/package.json`의 `version`을 올린다 (예: `0.1.0` → `0.2.0`).
2. 커밋/푸시 후 태그를 만든다: `git tag pro-v0.2.0 && git push origin pro-v0.2.0`
   - 또는 GitHub → Actions → **Build Pro Desktop App** → **Run workflow** 로 수동 실행.
3. GitHub Actions가 Windows에서 빌드 → **Release 초안**에 `.exe`와 `latest.yml`을 올린다.
4. Release 초안을 확인하고 **Publish** 하면 배포 완료. 사용자 앱이 다음 실행 때 자동 감지·업데이트.

## 사용자 경험

- 설치: `Terminus MasterSchedule Pro Setup x.y.z.exe` 더블클릭 → 설치 → 시작메뉴/바탕화면 아이콘.
- 저장(엑셀/PDF/PNG): 매번 **네이티브 "다른 이름으로 저장"** 창 → 원하는 폴더 선택.
- AI 분석: 상단 사용자 이름 클릭 → API 키 입력(앞 글자로 Claude/Groq 자동 구분). 키는 로컬 보관.
- 업데이트: 실행 시 새 버전이 있으면 백그라운드 다운로드 후 "재시작하여 설치" 안내.

## 알아둘 점

- **코드 서명 미적용**: 서명 인증서가 없으면 설치 시 SmartScreen 경고("고급→실행")가 한 번 뜬다.
  상업 배포 수준으로 없애려면 코드 서명 인증서가 필요하다(추후).
- **아이콘 미지정**: 현재 기본 Electron 아이콘. `build.win.icon`에 `.ico`를 지정하면 교체된다.
- 앱 데이터(프롬프트 등 쓰기 파일)는 사용자별 `userData` 폴더에 저장되어 업데이트해도 보존된다.
