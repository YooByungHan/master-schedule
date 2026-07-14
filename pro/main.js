/**
 * Terminus MasterSchedule Pro — Electron 메인 프로세스
 *
 * 역할:
 *  1) Pro용 AI 분석 서버(ai-server.js)를 앱 내부에서 구동(localhost:3100) — Node 별도 설치 불필요
 *  2) 공정표 UI(Terminus_master_schedule.html)를 앱 자체 창에 로드
 *  3) 저장 시 네이티브 "다른 이름으로 저장" 대화상자 제공(IPC) — 매번 폴더 선택
 *  4) 실행 시 GitHub Release 확인 → 최신 버전 자동 업데이트(electron-updater)
 */
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// 개발(파일이 상위 폴더) vs 패키징(파일이 앱 루트) 경로 흡수
const BASE = app.isPackaged ? __dirname : path.join(__dirname, '..');

// 프롬프트/설정 등 쓰기가 필요한 파일은 쓰기 가능한 userData 폴더로
process.env.TERMINUS_DATA_DIR = app.getPath('userData');
process.env.AI_PORT = process.env.AI_PORT || '3100';

// AI 분석 서버를 이 프로세스 안에서 구동 (require 시 자동 listen)
try {
  require(path.join(BASE, 'ai-server.js'));
} catch (e) {
  console.error('[Pro] AI 서버 시작 실패:', e && e.message);
}

// ── YouTube 구독 게이트 (Device Flow) ───────────────────────────
// Pro는 1인 전용 설치이므로 세션 저장소에는 사실상 계정 1개만 쌓인다.
// 자격증명은 CI 빌드 시 GitHub Actions 시크릿으로 생성되는 oauth-config.json
// (커밋되지 않음, .gitignore, XOR+Base64로 가볍게 은폐됨) 을 읽는다.
// 없으면 게이트를 걸지 않는다(개발 중 실행).
const { createYoutubeGate } = require(path.join(BASE, 'youtube-gate.js'));
const { decode: decodeOAuthConfig } = require(path.join(BASE, 'oauth-obfuscate.js'));
function loadGoogleOAuthCreds() {
  try {
    const f = JSON.parse(fs.readFileSync(path.join(BASE, 'oauth-config.json'), 'utf8'));
    if (f.v === 2 && f.data) {
      const decoded = decodeOAuthConfig(f.data);
      if (decoded.clientId && decoded.clientSecret) return decoded;
    } else if (f.clientId && f.clientSecret) {
      return f; // 구버전(평문) 호환
    }
  } catch (e) {}
  return { clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '', clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '' };
}
const GATE_STORE_PATH = path.join(app.getPath('userData'), 'youtube_sessions.json');
const ytGate = createYoutubeGate({
  storePath: GATE_STORE_PATH,
  getCreds: loadGoogleOAuthCreds,
  channelId: process.env.YOUTUBE_CHANNEL_ID || 'UCN5pilUpAxWgfatwuKGx-LQ',
  trialDays: 30,
  cacheHours: 6,
});
const gateEnabled = !!loadGoogleOAuthCreds().clientId;

// Pro는 1인용이라 세션 저장소의 "가장 최근 세션"을 그대로 현재 사용자로 취급한다.
function getSoleSessionId() {
  try {
    const store = JSON.parse(fs.readFileSync(GATE_STORE_PATH, 'utf8'));
    const ids = Object.keys(store.sessions || {});
    if (!ids.length) return null;
    ids.sort((a, b) => new Date(store.sessions[b].last_checked_at || 0) - new Date(store.sessions[a].last_checked_at || 0));
    return ids[0];
  } catch (e) { return null; }
}
async function checkGateForLaunch() {
  if (!gateEnabled) return { allowed: true, reason: 'gate_disabled' };
  const sid = getSoleSessionId();
  if (!sid) return { allowed: false, reason: 'no_session' };
  return ytGate.checkGate(sid);
}

let mainWindow = null;
let gateWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'Terminus MasterSchedule Pro',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 상단 메뉴바 숨김(앱처럼 보이게). 필요 시 Alt 로 노출.
  mainWindow.setMenuBarVisibility(false);

  mainWindow.loadFile(path.join(BASE, 'Terminus_master_schedule.html'));

  // 외부 링크(mailto, http)는 기본 브라우저/메일 앱으로
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
}

function createGateWindow() {
  gateWindow = new BrowserWindow({
    // gate.html이 좌(로그인)+우(기능 소개) 2단 구성이라 폭이 필요함(밝은 배경으로 변경됨).
    // 높이는 실측(콘텐츠 ~515px + 여백)에 여유를 더해 스크롤 없이 한 화면에 들어오게 함.
    width: 820, height: 640, resizable: false, title: 'Terminus MasterSchedule Pro',
    backgroundColor: '#f0ede8',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  gateWindow.setMenuBarVisibility(false);
  gateWindow.loadFile(path.join(BASE, 'gate.html'));
  gateWindow.on('closed', () => { gateWindow = null; if (!mainWindow) app.quit(); });
}

// ── YouTube 구독 게이트 IPC (gate.html이 window.terminusNative 로 호출) ──
ipcMain.handle('terminus:gate:status', async () => checkGateForLaunch());
ipcMain.handle('terminus:gate:start', async () => {
  const f = await ytGate.startDeviceFlow();
  return { flowId: f.deviceCode, userCode: f.userCode, verificationUrl: f.verificationUrl, expiresIn: f.expiresIn, interval: f.interval };
});
ipcMain.handle('terminus:gate:poll', async (evt, flowId) => {
  const r = await ytGate.pollDeviceFlow(flowId);
  return { status: r.status === 'slow_down' ? 'pending' : r.status, trialDaysLeft: r.trialDaysLeft };
});
ipcMain.handle('terminus:gate:recheck', async () => {
  const sid = getSoleSessionId();
  if (!sid) return { allowed: false, reason: 'no_session' };
  return ytGate.forceRecheck(sid);
});
ipcMain.handle('terminus:gate:proceed', () => {
  createWindow();
  if (gateWindow) { const w = gateWindow; gateWindow = null; w.close(); }
});
// 설정 > 구독 탭 최신 영상 썸네일용
ipcMain.handle('terminus:gate:videos', async () => {
  const sid = getSoleSessionId();
  if (!sid) return { videos: [] };
  return ytGate.getRecentVideos(sid);
});

// ── 네이티브 저장 대화상자 (렌더러 → 메인) ─────────────────────
// 렌더러의 saveWithPicker()가 window.terminusNative.saveFile 를 우선 사용한다.
ipcMain.handle('terminus:saveFile', async (evt, opts) => {
  opts = opts || {};
  const win = BrowserWindow.fromWebContents(evt.sender) || mainWindow;
  const filters = Array.isArray(opts.filters) && opts.filters.length ? opts.filters
    : [{ name: '모든 파일', extensions: ['*'] }];
  const ret = await dialog.showSaveDialog(win, {
    defaultPath: opts.suggestedName || 'untitled',
    filters,
  });
  if (ret.canceled || !ret.filePath) return { status: 'cancel' };
  try {
    const buf = Buffer.from(opts.data); // opts.data: Uint8Array (구조화 복제로 전달됨)
    fs.writeFileSync(ret.filePath, buf);
    return { status: 'saved', path: ret.filePath };
  } catch (e) {
    return { status: 'error', msg: e && e.message };
  }
});

// ── 네이티브 폴더 선택/조회 (렌더러 → 메인) ───────────────────
// Electron 렌더러에는 showDirectoryPicker가 없으므로, 폴더를 기억해 두고
// 반복 저장/기존 파일 조회(실적관리 등)에 재사용할 수 있도록 IPC로 제공한다.
ipcMain.handle('terminus:selectFolder', async (evt) => {
  const win = BrowserWindow.fromWebContents(evt.sender) || mainWindow;
  const ret = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (ret.canceled || !ret.filePaths || !ret.filePaths[0]) return { canceled: true };
  return { canceled: false, path: ret.filePaths[0] };
});
ipcMain.handle('terminus:listDirFiles', (evt, opts) => {
  opts = opts || {};
  try {
    const exts = (opts.exts || []).map((e) => String(e).toLowerCase());
    const names = fs.readdirSync(opts.folder).filter((n) => {
      if (!exts.length) return true;
      const lower = n.toLowerCase();
      return exts.some((e) => lower.endsWith(e));
    });
    return names;
  } catch (e) {
    return [];
  }
});
ipcMain.handle('terminus:readFileFromDir', (evt, opts) => {
  opts = opts || {};
  try {
    const buf = fs.readFileSync(path.join(opts.folder, opts.name));
    return new Uint8Array(buf);
  } catch (e) {
    return null;
  }
});
ipcMain.handle('terminus:writeFileToDir', (evt, opts) => {
  opts = opts || {};
  try {
    const buf = Buffer.from(opts.data);
    fs.writeFileSync(path.join(opts.folder, opts.name), buf);
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: e && e.message };
  }
});

// 앱 버전 조회(렌더러가 화면에 자동 표기)
ipcMain.handle('terminus:getVersion', () => app.getVersion());

// 완전 종료 — 트레이 아이콘이 없어 "창 닫기(X)"만으로는 완전히 꺼졌는지 사용자가
// 확신하기 어려웠음(업데이트 설치 시 "앱이 실행 중" 오류로 이어짐). 설정 모달에
// 명시적인 "종료" 버튼을 두고 여기서 app.quit()을 직접 호출한다.
ipcMain.handle('terminus:quitApp', () => { app.quit(); });

// ── 자동 업데이트 ──────────────────────────────────────────────
function setupAutoUpdate() {
  if (!app.isPackaged) return; // 개발 중엔 건너뜀
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); }
  catch (e) { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-downloaded', async () => {
    const r = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['지금 재시작하여 업데이트', '나중에'],
      defaultId: 0,
      cancelId: 1,
      title: '업데이트 준비 완료',
      message: '새 버전을 내려받았습니다. 지금 재시작하여 설치할까요?',
    });
    if (r.response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on('error', (err) => console.warn('[update] ', err && err.message));
  try { autoUpdater.checkForUpdates(); } catch (e) { /* 오프라인 등 무시 */ }
}

app.whenReady().then(async () => {
  const gate = await checkGateForLaunch().catch(() => ({ allowed: true, reason: 'gate_error' }));
  if (gate.allowed) { createWindow(); } else { createGateWindow(); }
  setupAutoUpdate();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) { createWindow(); }
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
