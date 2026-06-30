[README.md](https://github.com/user-attachments/files/29480606/README.md)
# 📊 Terminus — CPM 공정표

> **“Terminus — The end of Excel, the beginning of freedom.”**
>
> 건설현장 공무직 실무자가 직접 만든 **웹 기반 CPM 공정표** (Critical Path Method Gantt Chart)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![HTML5](https://img.shields.io/badge/HTML5-Single%20File-orange)](Terminus_master_schedule.html)
[![Node.js](https://img.shields.io/badge/Node.js-Server-green)](server.js)

> 메인 앱 파일명은 `Terminus_master_schedule.html` 입니다. (구 `master_schedule_v62.html`에서 변경)

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
| AI 분석 | **`node ai-server.js` 실행 후 사용** (개인 키) | `node server.js` 내장 (서버 키) |
| AI 분석 엔진 | `ai-core.js` (서버와 **동일**) | `ai-core.js` (Pro와 **동일**) |

> AI 분석 로직은 **`ai-core.js` 한 파일**에만 있습니다 → 한 곳만 고치면 Pro·서버 양쪽에 동일 적용됩니다.

---
<img width="1918" height="959" alt="image" src="https://github.com/user-attachments/assets/6ca7db4b-fc8c-487a-aa09-4824794b46f8" />

## 👤 Pro 사용자 가이드 (중요 · 헷갈리지 않게)

### 1) 다운로드해야 할 파일 — 아래 **4개(+1)**

```
Terminus_master_schedule.html   ← 메인 앱 (브라우저로 여는 파일) [필수]
ai-core.js                      ← AI 분석 엔진 [필수]
ai-server.js                    ← Pro용 AI 실행기 [필수]
Terminus_Pro_Start.bat           ← 더블클릭 한 번으로 AI서버+앱 실행 [권장]
prompts/  (폴더)                ← 다운로드 불필요 — 첫 실행 시 자동 생성됨
```

> ⚠️ Pro는 **`server.js` 불필요**, **`npm install` 불필요**입니다. (ai-core/ai-server는 Node 내장 모듈만 사용 — Node.js만 설치돼 있으면 끝)

### 2) 폴더 구조 (이대로 한 폴더에 두세요)

```
내폴더/
├── Terminus_master_schedule.html
├── ai-core.js
├── ai-server.js
├── Terminus_Pro_Start.bat            (더블클릭 런처)
└── prompts/                         (자동 생성 — 받을 필요 없음)
    ├── Groq_Llama3.3-70B_작업지시서.md
    └── Claude_작업지시서.md
```

### 3) AI 분석 켜는 법

전제: PC에 **Node.js(v18+)** 설치 ([nodejs.org](https://nodejs.org)). 그 외 설치 없음.

**쉬운 방법 (권장)** — `Terminus_Pro_Start.bat` **더블클릭**
→ AI 서버(localhost:3100)가 자동 시작되고(첫 실행 시 `prompts/` 지시서 자동 생성) 메인 앱이 브라우저로 열립니다. 앱에서 **개인 API 키 입력**(`gsk_`=Groq 무료 / `sk-ant`=Claude) → AI 분석 버튼 사용. *(AI 서버 검은 창은 분석 쓰는 동안 켜 두세요.)*

**수동 방법** — 폴더에서 `node ai-server.js` 실행 후, `Terminus_master_schedule.html` 더블클릭.

> ❓ HTML만 열면 자동으로 AI 서버가 뜨나요? → **아니요.** 브라우저는 보안상 서버를 못 띄웁니다. 위 `.bat` 또는 `node ai-server.js`로 한 번 켜야 합니다. (`192.168.0.1:3000` 같은 주소 입력은 **서버/Enterprise 사용자용** — Pro는 그냥 HTML 파일을 엽니다. 단, Pro 사용자가 Ai분석을 사용하기 위해서는 ai-core.js, ai-server.js를 동일한 폴더에 다운받고 Terminus_Pro_Start.bat을 실행해야 합니다.)

> 동작 방식: 브라우저가 **공정 데이터(inlineProj)와 개인 키를 localhost:3100 로만** 보냅니다. 데이터·키는 **내 PC 밖으로 나가지 않습니다**(LLM 호출 제외). 결과(CPM·EVM·추세·신뢰도)는 서버 버전과 **완전히 동일**합니다.

> AI 없이 작성·저장만 할 거면 아무것도 실행 없이 `Terminus_master_schedule.html` 만 더블클릭해도 됩니다.

---

## 🚀 빠른 시작 (서버/Enterprise)

```bash
npm install
node server.js
```
브라우저에서 `http://localhost:3000` 접속.
- 관리자 탭 → API 키(Groq 무료 / Claude) 등록 시 AI 분석 사용(직원 포함 전원).
- Windows 자동시작: `자동시작_설치.bat` 실행.

---

## 📁 파일 구성

| 파일 | 설명 |
|------|------|
| `Terminus_master_schedule.html` | 공정표 메인 앱 (단일 HTML) |
| `ai-core.js` | **AI 분석 엔진(단일 소스)** — server.js·ai-server.js 공용 |
| `ai-server.js` | **Pro용 초경량 AI 서버** (`node ai-server.js`, 포트 3100) |
| `server.js` | Node.js 서버 (멀티 현장·권한·파일함·백업/복원·AI는 ai-core 위임) |
| `package.json` | Node.js 패키지 정보 |
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
