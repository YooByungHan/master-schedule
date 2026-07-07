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
  isDesktop: true,
});
