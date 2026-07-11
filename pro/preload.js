/**
 * preload — 렌더러(HTML)에서 안전하게 쓸 수 있는 네이티브 기능만 노출.
 * contextIsolation=true 이므로 window.terminusNative 로만 접근 가능.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('terminusNative', {
  // 네이티브 저장 대화상자. opts: {suggestedName, data:Uint8Array, filters:[{name,extensions:[...]}]}
  // 반환: {status:'saved'|'cancel'|'error', path?, msg?}
  saveFile: (opts) => ipcRenderer.invoke('terminus:saveFile', opts),
  // 앱 버전(package.json version)
  getVersion: () => ipcRenderer.invoke('terminus:getVersion'),
  // 네이티브 폴더 선택/조회 (실적관리 기존파일 선택, 저장 폴더 기억 등)
  // 반환: {canceled:true} | {canceled:false, path}
  selectFolder: () => ipcRenderer.invoke('terminus:selectFolder'),
  // opts: {folder, exts:['.xlsx',...]} → string[] (파일명 목록)
  listDirFiles: (opts) => ipcRenderer.invoke('terminus:listDirFiles', opts),
  // opts: {folder, name} → Uint8Array | null
  readFileFromDir: (opts) => ipcRenderer.invoke('terminus:readFileFromDir', opts),
  // opts: {folder, name, data:Uint8Array} → {ok, msg?}
  writeFileToDir: (opts) => ipcRenderer.invoke('terminus:writeFileToDir', opts),
  // YouTube 구독 게이트 (gate.html + 메인 앱 체험판 배너가 공용으로 사용)
  gateStatus: () => ipcRenderer.invoke('terminus:gate:status'),
  gateStart: () => ipcRenderer.invoke('terminus:gate:start'),
  gatePoll: (flowId) => ipcRenderer.invoke('terminus:gate:poll', flowId),
  gateRecheck: () => ipcRenderer.invoke('terminus:gate:recheck'),
  gateProceed: () => ipcRenderer.invoke('terminus:gate:proceed'),
  isDesktop: true,
});
