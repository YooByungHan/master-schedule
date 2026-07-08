# Terminus MasterSchedule Server (데스크톱 트레이 앱)

사내 LAN 서버(`server.js`)를 **설치형 Windows 앱(.exe)**으로 배포하기 위한 Electron 패키지.
Node.js 설치·명령 프롬프트·배치파일 없이 더블클릭 한 번으로 실행되고, 시스템 트레이
아이콘으로 상태 확인·관리한다.

## 구성

| 파일 | 역할 |
|---|---|
| `main.js` | Electron 메인. `server.js`를 앱 내부에서 백그라운드로 구동, 트레이 메뉴, 자동업데이트 |
| `package.json` | 앱 이름/버전 + electron-builder 빌드 설정 |

`server.js`, `ai-core.js`, `youtube-gate.js`, `oauth-obfuscate.js`, `oauth-default.json`,
`cert-gen.js`, `gate.html`, `Terminus_master_schedule.html`, 간트 템플릿(`.xlsb`)을
빌드 시 함께 패키징한다(중복 보관 없음, git-clone 배포와 소스 공유).

## 데이터 저장 위치

설치 폴더(exe 옆)의 `data/` 폴더에 실데이터(계정·현장데이터·설정·백업·인증서 등)를
저장한다 — git-clone 배포의 "코드 옆 데이터" 방식과 동일한 감각. 앱 폴더째 백업/이동하면
데이터도 함께 옮겨진다.

## 로컬에서 실행/빌드 (개발자)

```bash
cd server-app
npm install
npm start        # 개발 실행(트레이 아이콘 생김, 저장소 루트를 데이터 폴더로 사용)
npm run pack      # 설치 없이 폴더형 빌드(dist/win-unpacked) — 빠른 확인용
npm run dist      # 설치파일(.exe) 빌드 + GitHub Release 업로드 (GH_TOKEN 필요)
```

## 자동 배포 (권장 흐름)

1. `server-app/package.json`의 `version`을 올린다.
2. 커밋/푸시 후 태그를 만든다: `git tag server-v1.1.0 && git push origin server-v1.1.0`
   - 또는 GitHub → Actions → **Build Server Desktop App** → **Run workflow** 로 수동 실행.
3. GitHub Actions가 Windows에서 빌드 → **Release 초안**에 `.exe`를 올린다.
4. Release 초안을 확인하고 **Publish** 하면 배포 완료. 이미 설치된 서버 앱이 다음 실행 때
   자동 감지·업데이트한다.

Pro EXE와 달리 OAuth 자격증명 생성 단계가 없다 — `server.js`가 저장소에 커밋된
`oauth-default.json`(난독화된 공용 기본값)을 자동으로 읽으므로 별도 시크릿 주입이
필요 없다. 다른 채널로 게이트하고 싶으면 데이터 폴더에 `google-oauth.json`을
직접 만들면 우선 적용된다.

## 사용자(관리자) 경험

- 설치: `Terminus MasterSchedule Server Setup x.y.z.exe` 더블클릭 → 설치 → 트레이 아이콘 생성.
- 트레이 아이콘 메뉴: 상태 확인, 브라우저로 열기, 직원 접속 주소 복사, HTTPS 인증서
  생성/재생성, 데이터 폴더 열기, 재시작, 종료.
- HTTPS: 트레이 메뉴에서 "HTTPS 인증서 생성" → 재시작하면 자동으로 HTTPS 전환(폴더
  선택 저장 등 활성화). 자세한 배경은 `HTTPS_설정.md` 참고.
- 업데이트: 실행 시 새 버전이 있으면 백그라운드 다운로드 후 "재시작하여 설치" 안내.

## 알아둘 점

- **코드 서명 미적용**: 서명 인증서가 없으면 설치 시 SmartScreen 경고("고급→실행")가 한 번 뜬다.
- **아이콘**: 트레이 아이콘은 별도 파일 없이 `main.js`에 32x32 단색 PNG(브랜드색)를
  base64로 내장. 나중에 제대로 된 아이콘으로 교체 가능.
- 버전 표시(`/api/version`)는 `TERMINUS_SERVER_VERSION` 환경변수(main.js가 자신의
  `package.json` 버전으로 설정)를 우선 사용한다 — git-clone 실행 시에는 저장소 루트
  `package.json`의 버전을 그대로 읽는다.
