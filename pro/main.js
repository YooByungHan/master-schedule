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
// (커밋되지 않음, .gitignore) 을 읽는다. 없으면 게이트를 걸지 않는다(개발 중 실행).
const { createYoutubeGate } = require(path.join(BASE, 'youtube-gate.js'));
function loadGoogleOAuthCreds() {
  try {
    const f = JSON.parse(fs.readFileSync(path.join(BASE, 'oauth-config.json'), 'utf8'));
    if (f.clientId && f.clientSecret) return f;
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
    width: 460, height: 420, resizable: false, title: 'Terminus MasterSchedule Pro',
    backgroundColor: '#0f1720',
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

// 앱 버전 조회(렌더러가 화면에 자동 표기)
ipcMain.handle('terminus:getVersion', () => app.getVersion());

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
