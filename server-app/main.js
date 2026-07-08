/**
 * Terminus MasterSchedule Server — Electron 트레이 앱
 *
 * 역할:
 *  1) server.js를 앱 내부에서 백그라운드로 구동(Node 별도 설치 불필요, 콘솔창/배치파일 없음)
 *  2) 시스템 트레이 아이콘으로 상태 확인 · 브라우저 열기 · 직원용 주소 복사 ·
 *     HTTPS 인증서 생성 · 재시작 · 종료
 *  3) 실데이터(계정/현장데이터/설정/백업 등)는 설치 폴더 옆 data 폴더에 저장
 *     (TERMINUS_SERVER_DATA_DIR) — git-clone 방식과 같은 "코드 옆 데이터" 감각 유지.
 *  4) 실행 시 GitHub Release 확인 → 최신 버전 자동 업데이트(electron-updater)
 */
const { app, Tray, Menu, shell, dialog, nativeImage, clipboard } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

// 중복 실행 방지(포트 3000 충돌 방지)
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {

// 개발(파일이 상위 폴더) vs 패키징(파일이 앱 루트) 경로 흡수
const BASE = app.isPackaged ? __dirname : path.join(__dirname, '..');

// 데이터 폴더: 패키징 시 설치 폴더(exe) 옆의 data/, 개발 중엔 저장소 루트 그대로.
const DATA_DIR = app.isPackaged
  ? path.join(path.dirname(app.getPath('exe')), 'data')
  : BASE;
process.env.TERMINUS_SERVER_DATA_DIR = DATA_DIR;
// server.js의 /api/version이 이 값을 우선 사용(패키징 시 루트 package.json을
// 번들하면 Electron 앱 매니페스트와 경로가 겹치므로, 버전은 env로 전달한다).
process.env.TERMINUS_SERVER_VERSION = app.getVersion();

// 32x32 브랜드색(#1c3a5e) 단색 PNG — 별도 아이콘 파일 없이 코드에 내장.
const TRAY_ICON_B64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGOQsYqjKWIYtWDUglELRi0YtWDUglELRi0YtWDUglELhooFAAPj0B9sBqIJAAAAAElFTkSuQmCC';

let serverStarted = false;
function startServer() {
  if (serverStarted) return;
  try {
    require(path.join(BASE, 'server.js'));
    serverStarted = true;
  } catch (e) {
    dialog.showErrorBox('Terminus MasterSchedule Server', '서버 시작 실패: ' + (e && e.message));
  }
}

function getLanIPs() {
  const ips = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const ni of ifs[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address);
    }
  }
  return ips;
}

function hasCert() {
  try { return fs.existsSync(path.join(DATA_DIR, 'certs', 'server.crt')); }
  catch (e) { return false; }
}
function scheme() { return hasCert() ? 'https' : 'http'; }

async function onGenCert() {
  try {
    const { generateCert } = require(path.join(BASE, 'cert-gen.js'));
    const result = generateCert(path.join(DATA_DIR, 'certs'));
    await dialog.showMessageBox({
      type: 'info',
      title: 'Terminus MasterSchedule Server',
      message: 'HTTPS 인증서를 생성했습니다. 적용하려면 서버를 재시작해야 합니다.\n'
        + '포함된 접속 주소: localhost, 127.0.0.1' + (result.ips.length ? ', ' + result.ips.join(', ') : ''),
    });
    refreshTrayMenu();
  } catch (e) {
    dialog.showErrorBox('인증서 생성 실패', (e && e.message) || String(e));
  }
}

function restartApp() {
  app.relaunch();
  app.exit(0);
}

let tray = null;
function buildMenu() {
  const ips = getLanIPs();
  const sch = scheme();
  const localUrl = `${sch}://localhost:3000`;
  const staffItems = ips.map((ip) => ({
    label: `직원 접속 주소 복사 (${ip})`,
    click: () => clipboard.writeText(`${sch}://${ip}:3000`),
  }));
  return Menu.buildFromTemplate([
    { label: `● 서버 실행 중  [${sch.toUpperCase()}]`, enabled: false },
    { type: 'separator' },
    { label: '브라우저로 열기 (내 PC)', click: () => shell.openExternal(localUrl) },
    ...(staffItems.length ? staffItems : [{ label: '(사내 네트워크 IP 감지 안 됨)', enabled: false }]),
    { type: 'separator' },
    { label: hasCert() ? 'HTTPS 인증서 재생성' : 'HTTPS 인증서 생성 (폴더 선택 저장 활성화)', click: onGenCert },
    { label: '데이터 폴더 열기', click: () => shell.openPath(DATA_DIR) },
    { type: 'separator' },
    { label: '서버 재시작', click: restartApp },
    { label: '종료', click: () => app.quit() },
  ]);
}
function refreshTrayMenu() {
  if (tray) tray.setContextMenu(buildMenu());
}

function setupAutoUpdate() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); }
  catch (e) { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-downloaded', async () => {
    const r = await dialog.showMessageBox({
      type: 'info',
      buttons: ['지금 재시작하여 업데이트', '나중에'],
      defaultId: 0,
      cancelId: 1,
      title: 'Terminus MasterSchedule Server',
      message: '새 버전을 내려받았습니다. 지금 재시작하여 설치할까요?\n(실행 중이던 서버 접속이 잠시 끊깁니다)',
    });
    if (r.response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on('error', (err) => console.warn('[update]', err && err.message));
  try { autoUpdater.checkForUpdates(); } catch (e) { /* 오프라인 등 무시 */ }
}

app.whenReady().then(() => {
  startServer();
  tray = new Tray(nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_B64, 'base64')));
  tray.setToolTip('Terminus MasterSchedule Server');
  tray.setContextMenu(buildMenu());
  tray.on('click', refreshTrayMenu); // 클릭 때마다 IP/상태 최신화
  setupAutoUpdate();
});

app.on('second-instance', () => {
  // 이미 실행 중일 때 다시 실행하면 트레이 메뉴만 새로고침
  refreshTrayMenu();
});

}
