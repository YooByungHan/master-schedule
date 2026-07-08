[README.md](https://github.com/user-attachments/files/29480606/README.md)
# 📊 Terminus — CPM 공정표

> **“Terminus — The end of Excel, the beginning of freedom.”**
>
> 건설현장 공무직 실무자가 직접 만든 **웹 기반 CPM 공정표** (Critical Path Method Gantt Chart)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![HTML5](https://img.shields.io/badge/HTML5-Single%20File-orange)](Terminus_master_schedule.html)
[![Node.js](https://img.shields.io/badge/Node.js-Server-green)](server.js)

> 메인 앱 파일명은 `Terminus_master_schedule.html` 입니다.

---

## ✨ 주요 기능

### 공정표 작성
- **CPM 공정표** — 계획(P) / 실적(A) 이중 바 차트
- **Total Float 시각화** — 꺾인 기준선(Progress Line)
- **선후행 연결선** — 선행/후행 연결 화살표
- **대분류 / 중분류 / 하위 공종** — 무제한 계층 구조 (잘라내기·복사·붙여넣기로 행 이동)
- **물량 · 단위 · 금액 · 실적율** — 수량 관리 통합 (금액·이벤트 열은 기본 접힘)
- **이벤트 노드** — 마름모 / 빨강마름모 / 원 도형 이벤트 표시
- **일 / 주(5일) / 10일 단위** 차트 전환, 기간 범위 설정, 공휴일 반영, 그레이(흑백) 모드
- **PDF / PNG / Excel 출력**

### 🤖 AI 분석 (강화됨)
단순 서술이 아니라 **계산된 근거로 분석**합니다. 서버·Pro 모두 **동일한 엔진(`ai-core.js`)** 을 사용합니다.

- **정식 CPM** — 선후행+기간 전·후진 패스로 공종별 여유(Total Float), 진짜 임계경로, 예상 준공일·슬립(일) 산출
- **기성고/EVM** — 기성율(EV/BAC)·계획진척(PV/BAC)·SPI(일정효율)·일정차이(SV)
- **실제 진척 추세** — 백업 스냅샷 비교로 주당 진척 속도 + 잔여 완료 예상 + 정체 감지
- **지연 무게·선후행 충돌·TF 급감·블라인드 스팟·병행 가능 조합·준공 위험 스코어**
- **신뢰도(confidence)** — 데이터 충실도 기반 자동 산출
- **자기검증 2차 패스** — 초안→검증→확정으로 환각 억제·정확도 향상
- **분석 패널 숫자 카드** — SPI·기성율·임계경로·예상준공/슬립·주당 진척·신뢰도를 카드로 표시 (모바일 2열)
- **공급자별 정밀 지시서** — `prompts/Groq_*.md`(무료·빠름) / `prompts/Claude_*.md`(정밀) 자동 선택
- 지연·충돌 등 결정론적 분석은 **AI 키가 없어도** 항상 표시

### 멀티 현장 · 권한 (서버 모드)
- **현장(공사)별 데이터 분리**, **역할 기반 권한**(마스터 / 담당관리자 / 직원)
- 마스터: 전 현장 + 계정·현장 관리 + 백업/복원 / 담당관리자: 배정 현장 관리 + 백업/복원 / 직원: 보기·편집·공정회의
- **관리자 탭 접근 코드**(계정별), 상단 **🌐 서버 / 💻 로컬** 모드 배지

### 하도사 파일 · 공정회의
- **현장별 파일함** `하도업체/<현장>/접수·보관`, **취합 탭 2단 파일함**
- **공정회의(통합 비교)** — 적층 비교 → AI 간섭분석 → 배포 (직원도 사용 가능)

### 백업 / 복원 (서버 모드)
- `백업/<현장>/` 자동 저장, 자동 백업(복원 직전·매일 22:00), 🛡️ 빈 데이터 덮어쓰기 차단 가드

---

## 🆚 두 가지 버전 — Pro vs 서버(Enterprise)

| 구분 | Pro (개인·로컬) | 서버 (Enterprise) |
|------|----------------|-------------------|
| 데이터 저장 | 브라우저 + JSON 파일 | 현장별 서버 저장 + 실시간 동기화 |
| 사용 인원 | 개인 1인 | 다인원·다현장 + 권한 |
| 실행 방법 | **설치형 앱(.exe) 더블클릭** — Node.js 설치 불필요 | `node server.js` 실행 (관리자 PC) |
| AI 분석 | 앱 내장 AI 서버 자동 구동 (개인 키) | `node server.js` 내장 (서버 키) |
| AI 분석 엔진 | `ai-core.js` (서버와 **동일**) | `ai-core.js` (Pro와 **동일**) |
| 업데이트 | 실행 시 자동 확인·설치 | 관리자가 최신 소스 재배포 |

> AI 분석 로직은 **`ai-core.js` 한 파일**에만 있습니다 → 한 곳만 고치면 Pro·서버 양쪽에 동일 적용됩니다.

---
<img width="1918" height="959" alt="image" src="https://github.com/user-attachments/assets/6ca7db4b-fc8c-487a-aa09-4824794b46f8" />
<img width="1904" height="952" alt="image" src="https://github.com/user-attachments/assets/76d99054-7edd-4bde-90ca-7aa4b2c38ccd" />

## 👤 Pro 사용자 가이드 (중요 · 헷갈리지 않게)

### 1) 설치

**[Releases 페이지](../../releases)** 에서 최신 `Terminus.MasterSchedule.Pro.Setup.x.y.z.exe` 를
다운로드해 실행하세요. 설치 후 시작메뉴/바탕화면에 **Terminus MasterSchedule Pro** 아이콘이 생깁니다.

- Node.js 설치 **불필요** — AI 분석 서버가 앱 안에 내장되어 자동으로 함께 실행됩니다.
- 검은 콘솔 창 **없음** — 일반 프로그램처럼 자체 창으로 실행됩니다.
- 실행할 때마다 새 버전이 있는지 자동으로 확인해 **자동 업데이트**됩니다.
- 서명되지 않은 앱이라 첫 설치 시 Windows/백신 경고가 뜰 수 있습니다 → "추가 정보 → 실행"으로 진행하면 됩니다.

### 2) AI 분석 켜는 법

앱 실행 → 상단 **사용자 이름 클릭** → **개인 API 키 입력** (`gsk_`=Groq 무료 / `sk-ant`=Claude, 앞 글자로 자동 구분) → AI 분석 버튼 사용.

> 동작 방식: 앱 내부 AI 서버가 **공정 데이터와 개인 키를 자신의 PC(localhost) 안에서만** 주고받습니다. 데이터·키는 **내 PC 밖으로 나가지 않습니다**(LLM 호출 제외). 결과(CPM·EVM·추세·신뢰도)는 서버 버전과 **완전히 동일**합니다(`ai-core.js` 공유).

> AI 없이 작성·저장만 할 거면 API 키를 입력하지 않고 그대로 사용해도 됩니다.

### 3) (개발자용) 소스에서 직접 실행하고 싶다면

앱 대신 소스 파일로 직접 돌리려면 `Terminus_master_schedule.html`, `ai-core.js`, `ai-server.js` 를
한 폴더에 두고 `node ai-server.js` 실행 후 `Terminus_master_schedule.html` 을 더블클릭하세요.
(`prompts/` 폴더는 첫 실행 시 자동 생성됩니다. `server.js`·`npm install` 은 불필요합니다.)

---

## 🚀 빠른 시작 (서버/Enterprise)

### 최초 설치 (한 번만)
```bash
git clone https://github.com/YooByungHan/master-schedule.git
cd master-schedule
npm install
node server.js
```
브라우저에서 `http://localhost:3000` 접속.
- 관리자 탭 → API 키(Groq 무료 / Claude) 등록 시 AI 분석 사용(직원 포함 전원).
- Windows 자동시작: `자동시작_설치.bat` 실행.

### 이후 업데이트 (평소에는 이것만)
```bash
bash scripts/update-server.sh
```
실데이터(`accounts.json`/`data/`/`백업/`/`하도업체/` 등)를 저장소 **바깥**
(`../master-schedule_backups/`)에 자동 백업한 뒤 `git pull` + `npm install`을
진행합니다. 저장소 폴더 자체를 절대 삭제하지 않으며, 만에 하나 폴더가 통째로
사라지는 사고가 나도 바깥의 백업은 영향받지 않습니다. 완료 후 `node server.js`를
재시작해주세요.

> ⚠️ 파일을 GitHub에서 하나씩 내려받아 수동으로 교체하는 예전 방식은 더 이상
> 쓰지 마세요. 위 두 단계(최초 1회 `git clone`, 이후 `update-server.sh`)만
> 사용합니다.

---

## 📁 파일 구성

| 파일 | 설명 |
|------|------|
| `Terminus_master_schedule.html` | 공정표 메인 앱 (단일 HTML) |
| `ai-core.js` | **AI 분석 엔진(단일 소스)** — server.js·ai-server.js 공용 |
| `ai-server.js` | **Pro용 초경량 AI 서버** (`node ai-server.js`, 포트 3100) |
| `server.js` | Node.js 서버 (멀티 현장·권한·파일함·백업/복원·AI는 ai-core 위임) |
| `package.json` | Node.js 패키지 정보 |
| `scripts/update-server.sh` | 서버 최신화(백업 → git pull → npm install) — 평소 업데이트는 이것만 실행 |
| `scripts/backup-data.sh` | 실데이터를 저장소 바깥에 스냅샷 백업(update-server.sh가 자동 호출) |
| `prompts/Groq_Llama3.3-70B_작업지시서.md` | Groq용 AI 지시서 (없으면 자동 생성) |
| `prompts/Claude_작업지시서.md` | Claude용 정밀 분석 지시서 (없으면 자동 생성) |
| `자동시작_설치.bat` / `자동시작_제거.bat` | Windows 서버 자동시작 등록/제거 |
| `schedule_tray.ps1` / `schedule_tray.vbs` | 트레이 아이콘 스크립트 |
| `accounts.json` | (자동 생성) 계정·역할·현장 — *업로드 금지* |
| `data/<siteId>.json` | (자동 생성) 현장별 공정표 — *업로드 금지* |
| `config.json` | (자동 생성) API 키 — *업로드 금지* |

---

## 🔒 보안 요약

| 저장 위치 | 보안 수준 |
|---|---|
| Pro(로컬) | 브라우저/파일 저장 — 데이터·키는 내 PC에 보관 |
| 서버(Enterprise) | 계정 로그인 + 사내망 — 가장 안전 |

**민감 파일(절대 GitHub 업로드 금지 · `.gitignore` 처리)**
- `config.json` — API 키 / `accounts.json` — 계정·비밀번호 / `data/`·`하도업체/`·`백업/` — 실데이터

---

## 🖥️ 사용 환경
- **브라우저**: Chrome / Edge 권장
- **Node.js**: v18 이상 (서버·Pro AI 모드)
- **무료 AI 키**: [console.groq.com](https://console.groq.com) 에서 `gsk_` 키 발급

---

## 💡 개발 배경
건설현장 공무팀 실무 경험을 바탕으로, **프리마베라(P6) 수준의 CPM 기능**을 **별도 설치 없이 브라우저 하나로** 쓸 수 있게 만들었습니다.

> **Terminus — The end of Excel, the beginning of freedom.**

---

## 📦 사용 라이브러리
| 라이브러리 | 버전 | 용도 | 라이선스 |
|---|---|---|---|
| [SheetJS (xlsx)](https://sheetjs.com) | 0.18.5 | Excel 출력 | Apache 2.0 |
| [html2canvas](https://html2canvas.hertzen.com) | 1.4.1 | PNG 출력 | MIT |
| [jsPDF](https://github.com/parallax/jsPDF) | 2.5.1 | PDF 출력 | MIT |

서버/Pro AI: [Groq](https://groq.com) (Llama 3.3 70B) · [Claude](https://www.anthropic.com) · Ollama(로컬) 선택.

---

## 📄 라이선스
MIT License — 자유롭게 사용, 수정, 배포 가능합니다.
