/**
 * MASTER SCHEDULE — 서버 v5 (개인 계정, 이름 자동 회사 배치)
 * 실행: node server.js
 */
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { WebSocketServer } = require('ws');

const PORT        = 3000;
const DATA_FILE   = path.join(__dirname, 'data.json');
const HTML_FILE   = path.join(__dirname, 'Terminus_master_schedule.html');
const CONFIG_FILE = path.join(__dirname, 'config.json'); // API키 등 민감 설정 (git 제외)
const INBOX_DIR   = path.join(__dirname, '하도업체', '접수'); // 메신저로 받은 하도 파일
const DIST_DIR    = path.join(__dirname, '하도업체', '배포'); // 회의 결과 배포 파일
// (구) 전역 접수/배포 자동생성 제거 — 현장별 폴더(하도업체/<공사명>/접수·보관)로 통일

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({companies:[],users:[],projects:{}},'utf8'));
}

// ── 서버 설정(config.json) 입출력 ───────────────────────────────
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return {}; }
}
function saveConfig(cfg) {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8'); }
  catch(e) { console.error('[CONFIG] 저장 실패:', e.message); }
}

// Claude API키: 환경변수 우선, 없으면 config.json, 없으면 빈 문자열
let _claudeApiKey = process.env.ANTHROPIC_API_KEY || loadConfig().claudeApiKey || '';
if (_claudeApiKey) console.log('[Claude] API Key 로드됨 (끝 4자리: ...'+_claudeApiKey.slice(-4)+')');

// Groq API키: 환경변수 우선, 없으면 config.json
let _groqApiKey = process.env.GROQ_API_KEY || loadConfig().groqApiKey || '';
if (_groqApiKey) console.log('[Groq]   API Key 로드됨 (끝 4자리: ...'+_groqApiKey.slice(-4)+')');

// ── 파일 입출력 ──────────────────────────────────────────────
let writing = false;
const writeQueue = [];
function writeData(data, cb) {
  writeQueue.push({data, cb});
  if (!writing) processQueue();
}
function processQueue() {
  if (!writeQueue.length) { writing = false; return; }
  writing = true;
  const {data, cb} = writeQueue.shift();
  fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8',
    err => { cb(err); processQueue(); });
}
function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return {companies:[], users:[], projects:{}}; }
}

// ── 멀티현장: accounts.json(계정·현장·권한) + data/<siteId>.json(현장 스케줄) ──
const ACCOUNTS_FILE = path.join(__dirname, 'accounts.json');
const SITES_DIR = path.join(__dirname, 'data');
try { fs.mkdirSync(SITES_DIR, { recursive: true }); } catch(e) {}
function loadAccounts() {
  try { return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')); }
  catch { return { users: [], sites: [] }; }
}
function saveAccounts(a, cb) {
  fs.writeFile(ACCOUNTS_FILE, JSON.stringify(a, null, 2), 'utf8', cb || (function(){}));
}
function sitePath(siteId) { return path.join(SITES_DIR, path.basename(String(siteId)) + '.json'); }
const FILES_DIR = path.join(__dirname, '하도업체');
try { fs.mkdirSync(FILES_DIR, { recursive: true }); } catch(e) {}
function siteFolderName(siteId){
  try { const a=loadAccounts(); const st=(a.sites||[]).find(s=>s.id===siteId); const nm=(st&&st.name)||String(siteId); return (nm.replace(/[\/\\:*?"<>|]/g,'_').trim())||String(siteId); } catch(e){ return path.basename(String(siteId)); }
}
function siteFileDir(siteId, folder){
  const fld = (folder==='보관') ? '보관' : '접수';
  const dir = path.join(FILES_DIR, siteFolderName(siteId), fld);
  try { fs.mkdirSync(dir, { recursive: true }); } catch(e) {}
  return dir;
}
// ── 원도급 공정표 백업/복원 ──
const BACKUP_DIR = path.join(__dirname, '백업');
try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch(e) {}
function siteBackupDir(siteId){ const dir=path.join(BACKUP_DIR, siteFolderName(siteId)); try{ fs.mkdirSync(dir,{recursive:true}); }catch(e){} return dir; }
const aiCore = require('./ai-core');
try { aiCore.setKeys({ groq: _groqApiKey, claude: _claudeApiKey }); aiCore.setBackupDirResolver(siteBackupDir); } catch(e){ console.error('[ai-core] 주입 실패:', e.message); }
function backupLog(siteId, entry){ try{ fs.appendFileSync(path.join(siteBackupDir(siteId),'백업로그.jsonl'), JSON.stringify(Object.assign({t:new Date().toISOString()}, entry))+'\n','utf8'); }catch(e){} }
function isLocalReq(req){ const ip=(req.socket&&req.socket.remoteAddress)||''; return ip==='127.0.0.1'||ip==='::1'||ip==='::ffff:127.0.0.1'; }
function canBackup(a, userId, siteId){ const u=acctUser(a,userId); if(!u) return false; if(u.role==='master') return true; if(u.role==='manager' && (u.sites||[]).includes(siteId)) return true; return false; }
function _backupType(name){ if(name.indexOf('복원전')>=0) return '자동(복원전)'; if(name.indexOf('일일')>=0) return '자동(일일)'; return '수동'; }
function _bkSafe(x){ return String(x==null?'':x).replace(/[/:*?"<>|]/g,'_'); }
function _primarySnapshot(siteId){
  const a=loadAccounts(); const st=(a.sites||[]).find(s=>s.id===siteId); if(!st) return null;
  const data=readSite(siteId); const pid=st.primaryCompanyId; if(!pid) return null;
  const co=(data.companies||[]).find(c=>c.id===pid); const proj=(data.projects||{})[pid]; if(!proj) return null;
  return { companies: co?[co]:[{id:pid,name:(st.name||'원도급')}], projects:{[pid]:proj}, primaryId:pid, companyName:(co&&co.name)||st.name, _site:siteId, _siteName:st.name, backupAt:new Date().toISOString() };
}
function _latestBackupName(siteId){ try{ const dir=siteBackupDir(siteId); const fl=fs.readdirSync(dir).filter(f=>f.toLowerCase().endsWith('.json')); if(!fl.length)return null; fl.sort((x,y)=>fs.statSync(path.join(dir,y)).mtimeMs-fs.statSync(path.join(dir,x)).mtimeMs); return fl[0]; }catch(e){ return null; } }
function _sameAsLatest(siteId, snap){ const lf=_latestBackupName(siteId); if(!lf)return false; try{ const prev=JSON.parse(fs.readFileSync(path.join(siteBackupDir(siteId),lf),'utf8')); return JSON.stringify(prev.projects&&prev.projects[prev.primaryId])===JSON.stringify(snap.projects[snap.primaryId]); }catch(e){ return false; } }
function _pruneAuto(siteId){ try{ const dir=siteBackupDir(siteId); const autos=fs.readdirSync(dir).filter(f=>f.indexOf('자동백업')>=0&&f.endsWith('.json')).map(f=>({f,m:fs.statSync(path.join(dir,f)).mtimeMs})).sort((a,b)=>b.m-a.m); autos.slice(30).forEach(x=>{ try{ fs.unlinkSync(path.join(dir,x.f)); }catch(e){} }); }catch(e){} }
function _doBackup(siteId, kind, who){
  const snap=_primarySnapshot(siteId); if(!snap) return {ok:false,msg:'주 공정표 없음'};
  if(kind==='일일' && _sameAsLatest(siteId, snap)){ backupLog(siteId,{user:who||'system',action:'백업',type:kind,file:null,note:'변동없음-생략'}); return {ok:true,skipped:true}; }
  const now=new Date(), p=n=>String(n).padStart(2,'0');
  const ts=''+now.getFullYear()+p(now.getMonth()+1)+p(now.getDate())+'-'+p(now.getHours())+p(now.getMinutes());
  const tag = kind==='수동'?'백업' : (kind==='복원전'?'자동백업-복원전':'자동백업-일일');
  const base=_bkSafe(snap.companyName||siteFolderName(siteId));
  const fname=base+'_'+tag+'_'+ts+(kind==='수동'&&who?('_'+_bkSafe(who)):'')+'.json';
  const content=JSON.stringify(snap,null,2);
  try{ fs.writeFileSync(path.join(siteBackupDir(siteId), fname), content,'utf8'); }catch(e){ return {ok:false,msg:e.message}; }
  backupLog(siteId,{user:who||'system',action:'백업',type:kind,file:fname});
  _pruneAuto(siteId);
  return {ok:true,name:fname,content};
}
let _dailyMark={};
function _runDaily(){
  const now=new Date(); const h=now.getHours(); const day=now.toISOString().slice(0,10);
  if(h!==22 && h!==7) return;
  const a=loadAccounts();
  (a.sites||[]).forEach(st=>{
    if(h===22){ const k=day+'#22'; if(_dailyMark[st.id]===k) return; _dailyMark[st.id]=k; _doBackup(st.id,'일일','system'); }
    else { const k=day+'#07'; if(_dailyMark[st.id]===k) return; _dailyMark[st.id]=k;
      const y=new Date(now.getTime()-86400000), p=n=>String(n).padStart(2,'0');
      const ystr=''+y.getFullYear()+p(y.getMonth()+1)+p(y.getDate());
      let hasY=false; try{ hasY=fs.readdirSync(siteBackupDir(st.id)).some(f=>f.indexOf('자동백업-일일')>=0&&f.indexOf(ystr)>=0); }catch(e){}
      if(!hasY) _doBackup(st.id,'일일','system'); else backupLog(st.id,{user:'system',action:'백업',type:'일일',file:null,note:'전일백업존재-생략'});
    }
  });
}
setInterval(_runDaily, 5*60*1000);
function readSite(siteId) {
  try { return JSON.parse(fs.readFileSync(sitePath(siteId), 'utf8')); }
  catch { return { companies: [], projects: {} }; }
}
function _countSiteNodes(data){
  let n=0; const projs=(data&&data.projects)||{};
  for(const k in projs){ if(k==='__MEETING__')continue; const p=projs[k]; if(p&&p.sections){ try{ n+=flattenNodes(p.sections).size; }catch(e){} } }
  return n;
}
function writeSite(siteId, data, cb) {
  // 보호 가드: 기존에 공종이 있는데 빈 데이터로 덮어쓰려 하면 차단 + 보호 스냅샷
  try{
    const incoming=_countSiteNodes(data);
    let existing=0; try{ existing=_countSiteNodes(JSON.parse(fs.readFileSync(sitePath(siteId),'utf8'))); }catch(e){}
    if(existing>0 && incoming===0){
      try{ fs.copyFileSync(sitePath(siteId), sitePath(siteId)+'.protect_'+Date.now()); }catch(e){}
      try{ if(typeof backupLog==='function') backupLog(siteId,{user:'system',action:'쓰기차단',type:'보호',file:null,note:'빈 데이터 덮어쓰기 차단(기존 '+existing+'공종)'}); }catch(e){}
      console.warn('[보호] '+siteId+' 빈 데이터 덮어쓰기 차단 (기존 '+existing+' 공종) — 무시');
      if(cb) cb(null);
      return;
    }
  }catch(e){}
  fs.writeFile(sitePath(siteId), JSON.stringify(data, null, 2), 'utf8', cb || (function(){}));
}
function acctUser(a, userId) { return (a.users || []).find(u => u.id === userId) || null; }
function userCanAccessSite(u, siteId) {
  if (!u) return false;
  if (u.role === 'master') return true;
  return Array.isArray(u.sites) && u.sites.includes(siteId);
}
function sitesForUser(a, u) {
  if (!u) return [];
  if (u.role === 'master') return (a.sites || []);
  return (a.sites || []).filter(s => (u.sites || []).includes(s.id));
}
function isMaster(a, userId) { const u = acctUser(a, userId); return !!(u && u.role === 'master'); }
function getLastModified() {
  try { return fs.statSync(DATA_FILE).mtimeMs; } catch { return 0; }
}
function updateNodeInTree(nodes, nid, fields) {
  for (const n of nodes) {
    if (n.id === nid) { Object.assign(n, fields); return true; }
    if (n.ch && updateNodeInTree(n.ch, nid, fields)) return true;
  }
  return false;
}
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
  });
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function hpw(p) {
  let h = 0;
  for (let i = 0; i < p.length; i++) h = Math.imul(31, h) + p.charCodeAt(i) | 0;
  return h.toString(36);
}
function mkProj(coName) {
  return {
    projectName:'', companyName:coName,
    writeDate: new Date().toISOString().slice(0,10),
    totalBudget:0,
    sections:[
      {id:'s1',name:'대분류1',color:'#1c3a5e',open:true,nodes:[]},
      {id:'s2',name:'대분류2',color:'#2d6a4f',open:true,nodes:[]},
      {id:'s3',name:'대분류3',color:'#7b3f00',open:true,nodes:[]},
      {id:'s4',name:'대분류4',color:'#5b2d8e',open:true,nodes:[]}
    ],
    predLinks:[], events:[]
  };
}

// ════════════════════════════════════════════════════════════
// AI 분석 — 선후행 공정 분석(결정론적 계산) + Ollama/Claude 코멘트 생성
// ════════════════════════════════════════════════════════════
//
// 설계 원칙: "지연 공종"과 "선후행 충돌"은 날짜/숫자 비교만으로 100% 정확하게
// 판단할 수 있는 사실이므로 AI에게 판단을 맡기지 않고 서버에서 직접 계산한다.
// AI(로컬 Ollama 또는 Claude API)는 이 확정된 사실을 근거로 "만회 공정 제안"과
// "종합 의견" 같은 서술형 코멘트만 생성한다 — LLM이 날짜를 잘못 계산해서
// 현장에 잘못된 정보를 주는 위험을 원천적으로 막기 위함.

// ── 한국 표준시(KST = UTC+9) 기준 오늘 날짜 반환 ──────────────
// Node.js 기본 new Date()는 서버 시스템 시간 기준이므로
// 서버가 UTC나 다른 타임존에 있을 경우 날짜가 다를 수 있음.
// KST 오프셋(+9h)을 직접 더해 YYYY-MM-DD 반환.
function getKSTDateString() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000); // UTC+9
  return kst.toISOString().slice(0, 10);
}

function toDate(s) { return s ? new Date(s + 'T00:00:00') : null; }
function dayDiff(a, b) { // a가 b보다 늦으면 양수(며칠 늦었는지)
  const da = toDate(a), db = toDate(b);
  if (!da || !db) return 0;
  return Math.round((da - db) / 86400000);
}

// HTTPS/HTTP 공용 JSON GET
function httpGetJSON(urlStr, extraHeaders, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { reject(e); return; }
    const isHttps = u.protocol === 'https:';
    const mod = isHttps ? https : http;
    const opts = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + (u.search || ''),
      method: 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {}),
      timeout: timeoutMs || 15000
    };
    const req = mod.request(opts, res => {
      const _chunks = [];
      res.on('data', c => _chunks.push(c));
      res.on('end', () => {
        const data = Buffer.concat(_chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0,300)}`));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('응답 JSON 파싱 실패: ' + e.message)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('요청 시간 초과')));
    req.on('error', reject);
    req.end();
  });
}

// HTTPS/HTTP 공용 JSON POST (외부 라이브러리 없이 동작 — node-fetch 등 설치 불필요)
function httpPostJSON(urlStr, body, extraHeaders, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { reject(e); return; }
    const isHttps = u.protocol === 'https:';
    const mod = isHttps ? https : http;
    const payload = JSON.stringify(body);
    const opts = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + (u.search || ''),
      method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }, extraHeaders || {}),
      timeout: timeoutMs || 60000
    };
    const req = mod.request(opts, res => {
      const _chunks = [];
      res.on('data', c => _chunks.push(c));
      res.on('end', () => {
        const data = Buffer.concat(_chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0,300)}`));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('응답 JSON 파싱 실패: ' + e.message)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('요청 시간 초과')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// sections[].nodes(트리)를 id로 바로 찾을 수 있게 평탄화. predLinks가 어떤
// 레벨의 노드든 참조할 수 있으므로 leaf/parent 구분 없이 전부 맵에 담는다.
function flattenNodes(sections) {
  const map = new Map();
  (sections || []).forEach(sec => {
    (function walk(nodes, pathPrefix) {
      (nodes || []).forEach(n => {
        const p = pathPrefix ? pathPrefix + ' > ' + n.name : n.name;
        const isLeaf = !n.ch || n.ch.length === 0;
        map.set(n.id, { node: n, path: p, sectionName: sec.name, isLeaf });
        if (!isLeaf) walk(n.ch, p);
      });
    })(sec.nodes, '');
  });
  return map;
}

// 지연 공종 판단: ① 실적은 끝났지만 계획보다 늦게 끝난 경우(완료지연)
//               ② 아직 안 끝났는데 계획 종료일이 기준일을 이미 지난 경우(진행지연)
// 상위(집계) 노드는 하위 항목이 그대로 반영된 값이라 중복 노출되므로 leaf만 본다.
function computeDelays(nodeMap, baseDate) {
  const out = [];
  nodeMap.forEach(entry => {
    if (!entry.isLeaf) return;
    const n = entry.node;
    const planF = n.plan && n.plan.f;
    if (!planF) return; // 계획 종료일 미입력 — 판단 불가
    const actF = n.actual && n.actual.f;
    const actS = n.actual && n.actual.s;
    const planS = n.plan && n.plan.s;
    const rate = n.actRate || 0;

    if (actF && actF > planF) {
      out.push({
        id: n.id,
        name: entry.path, section: entry.sectionName, type: '완료지연',
        planEnd: planF, actualEnd: actF, progress: rate,
        daysLate: dayDiff(actF, planF)
      });
    } else if (!actF && rate < 100 && planF < baseDate) {
      out.push({
        id: n.id,
        name: entry.path, section: entry.sectionName, type: '진행지연',
        planEnd: planF, actualEnd: null, progress: rate,
        daysLate: dayDiff(baseDate, planF)
      });
    } else if (!actS && rate === 0 && planS && planS < baseDate) {
      out.push({
        id: n.id,
        name: entry.path, section: entry.sectionName, type: '시작지연',
        planEnd: planF, actualEnd: null, progress: rate,
        daysLate: dayDiff(baseDate, planS)
      });
    }
  });
  out.sort((a, b) => b.daysLate - a.daysLate);
  return out;
}

// 선후행 충돌: predLinks의 선행(srcId)이 아직 끝나지 않았는데(실적율<100, 실적종료일 없음)
// 후행(tgtIds) 중 이미 실적 시작일이 입력된 항목이 있으면 충돌로 본다.
function computeConflicts(nodeMap, predLinks) {
  const out = [];
  (predLinks || []).forEach(link => {
    const src = nodeMap.get(link.srcId);
    if (!src) return;
    // ★ 수정: actRate 100%만 완료로 판정.
    // actF(실적종료일)는 하도업체가 예정일로 입력하는 경우가 있어
    // actF 존재만으로 완료 판정 시 actRate<100인 공종도 완료로 오인됨.
    const srcFinished = (src.node.actRate || 0) >= 100;
    if (srcFinished) return;
    (link.tgtIds || []).forEach(tid => {
      const tgt = nodeMap.get(tid);
      if (!tgt) return;
      const tgtStarted = !!(tgt.node.actual && tgt.node.actual.s);
      if (tgtStarted) {
        out.push({
          predId: src.node.id,
          succId: tgt.node.id,
          predName: src.path,
          predProgress: src.node.actRate || 0,
          predPlanEnd: (src.node.plan && src.node.plan.f) || '',
          succName: tgt.path,
          succActualStart: tgt.node.actual.s
        });
      }
    });
  });
  return out;
}

// 전체 진행률: 섹션 1단계 자식 기준 가중평균(상위 노드는 이미 rollup으로 하위
// 실적이 반영된 amount/actRate를 갖고 있으므로 클라이언트 집계 방식과 동일하게 계산)

// ── P2-A: predLinks 역방향 탐색 — 특정 노드의 전체 후행 체인을 BFS로 탐색 ──
// srcId → 직접 후행 tgtIds → 그 후행의 후행 ... 재귀적으로 전부 수집
function buildSuccessorMap(predLinks) {
  // srcId → [tgtId, tgtId, ...] 정방향 맵
  const fwd = new Map();
  (predLinks || []).forEach(l => {
    if (!fwd.has(l.srcId)) fwd.set(l.srcId, []);
    (l.tgtIds || []).forEach(t => fwd.get(l.srcId).push(t));
  });
  return fwd;
}

// nodeId로부터 연쇄 후행 공종 전부 수집 (BFS, 순환 방지)
function getAllSuccessors(nodeId, fwdMap) {
  const visited = new Set();
  const queue = [nodeId];
  while (queue.length) {
    const cur = queue.shift();
    (fwdMap.get(cur) || []).forEach(t => {
      if (!visited.has(t)) { visited.add(t); queue.push(t); }
    });
  }
  visited.delete(nodeId); // 자기 자신 제외
  return visited; // Set<id>
}

// ── P2-A: 지연 무게 스코어 계산 ──────────────────────────────────
// 지연 무게 = 영향 후행 공종 수 × 해당 공종의 지연일
// CP 위 여부: 후행 체인이 프로젝트 최종 종료일(maxPlanF)까지 이어지는지 확인
function computeDelayWeights(delays, nodeMap, predLinks, sections) {
  const fwdMap = buildSuccessorMap(predLinks);

  // 프로젝트 최종 계획 종료일
  let maxPlanF = '';
  nodeMap.forEach(e => {
    const f = e.node.plan && e.node.plan.f;
    if (f && f > maxPlanF) maxPlanF = f;
  });

  return delays.map(d => {
    const successors = getAllSuccessors(d.id, fwdMap);
    const impactCount = successors.size;
    const weight = impactCount * d.daysLate;

    // 크리티컬 패스 위 여부: 후행 체인에 최종 종료일을 가진 공종이 있는가
    let isOnCriticalPath = false;
    if (maxPlanF) {
      for (const sid of successors) {
        const e = nodeMap.get(sid);
        if (e && e.node.plan && e.node.plan.f === maxPlanF) {
          isOnCriticalPath = true; break;
        }
      }
      // 본인이 직접 최종 종료일인 경우도 CP
      const self = nodeMap.get(d.id);
      if (self && self.node.plan && self.node.plan.f === maxPlanF) isOnCriticalPath = true;
    }

    return { ...d, impactCount, weight, isOnCriticalPath, successorIds: [...successors] };
  }).sort((a, b) => b.weight - a.weight || b.daysLate - a.daysLate);
}

// ── P2-C: TF(여유시간) 급감 공종 감지 ───────────────────────────
// 단순 TF 근사: 해당 공종 계획 종료일 ~ 후행 중 가장 이른 계획 시작일의 차이
// TF가 7일 이하이고 후행이 있는 공종을 "TF 급감" 으로 분류
function computeTfAlerts(nodeMap, predLinks, baseDate) {
  const fwdMap = buildSuccessorMap(predLinks);
  const alerts = [];

  nodeMap.forEach((entry, nodeId) => {
    if (!entry.isLeaf) return;
    const n = entry.node;
    const planF = n.plan && n.plan.f;
    if (!planF) return;

    const directSuccIds = fwdMap.get(nodeId) || [];
    if (!directSuccIds.length) return; // 후행 없으면 패스

    // 후행들 중 가장 이른 계획 시작일
    let earliestSuccStart = '';
    directSuccIds.forEach(sid => {
      const se = nodeMap.get(sid);
      if (!se) return;
      const ss = se.node.plan && se.node.plan.s;
      if (ss && (!earliestSuccStart || ss < earliestSuccStart)) earliestSuccStart = ss;
    });

    if (!earliestSuccStart) return;
    const tf = dayDiff(earliestSuccStart, planF); // planF → succStart 간격 (음수면 이미 Late Start)

    if (tf <= 7) {
      const actRate = n.actRate || 0;
      const isDelayed = planF < baseDate && actRate < 100;
      alerts.push({
        id: nodeId,
        name: entry.path,
        section: entry.sectionName,
        tf,
        planF,
        earliestSuccStart,
        actRate,
        isDelayed,
        succCount: directSuccIds.length
      });
    }
  });

  alerts.sort((a, b) => a.tf - b.tf); // TF 작은 순
  return alerts;
}

// ── P2-C: 안심/위험 공종 분류 ────────────────────────────────────
// 안심: 실적율 낮아 보이지만 후행 없고(또는 여유 충분) 전체 무해
// 위험: 실적율 높아 보이지만 후행 밀집 → 집중 관리 필요
function computeBlindSpots(nodeMap, predLinks, baseDate) {
  const fwdMap = buildSuccessorMap(predLinks);
  const safe = [], danger = [];

  nodeMap.forEach((entry, nodeId) => {
    if (!entry.isLeaf) return;
    const n = entry.node;
    const planF = n.plan && n.plan.f;
    const actRate = n.actRate || 0;
    if (!planF) return;

    const directSuccIds = fwdMap.get(nodeId) || [];
    const succCount = directSuccIds.length;
    const isOverdue = planF < baseDate && actRate < 100;

    // 안심 공종: 지연처럼 보이지만 후행이 없어 전체에 영향 없음
    if (isOverdue && succCount === 0) {
      safe.push({ id: nodeId, name: entry.path, section: entry.sectionName, actRate, planF, succCount });
    }

    // 위험 공종: 실적율이 80% 이상으로 거의 완료처럼 보이지만 후행이 3개 이상 대기 중이고 아직 100% 미만
    if (actRate >= 70 && actRate < 100 && succCount >= 3) {
      danger.push({ id: nodeId, name: entry.path, section: entry.sectionName, actRate, planF, succCount });
    }
  });

  return { safe, danger };
}

function computePlanRate(sections, baseDate) {
  let minS = '', maxF = '';
  function walk(nodes){ (nodes||[]).forEach(n=>{
    if (n.plan && n.plan.s && (!minS || n.plan.s < minS)) minS = n.plan.s;
    if (n.plan && n.plan.f && (!maxF || n.plan.f > maxF)) maxF = n.plan.f;
    if (n.ch && n.ch.length) walk(n.ch);
  }); }
  (sections||[]).forEach(sec => walk(sec.nodes));
  if (!minS || !maxF || baseDate < minS) return 0;
  const total = dayDiff(maxF, minS) || 1;
  const elapsed = Math.min(dayDiff(baseDate, minS), total);
  return Math.round(Math.min(elapsed/total*100, 100) * 10) / 10;
}

function computeOverallProgress(sections) {
  let totalAmt = 0, totalAct = 0;
  let noAmtCount = 0, noAmtRateSum = 0;

  // ★ 재귀 수집 — __MEETING__ 처럼 밴드 노드(amount=0)가 중간에 있어도
  //   잎 노드(ch 없음)까지 내려가서 amount/actRate를 집계
  function collectLeaves(nodes) {
    (nodes || []).forEach(n => {
      const isLeaf = !n.ch || n.ch.length === 0;
      if (isLeaf) {
        const a = n.amount || 0;
        if (a > 0) {
          totalAmt += a;
          totalAct += a * ((n.actRate || 0) / 100);
        } else {
          noAmtCount++;
          noAmtRateSum += (n.actRate || 0);
        }
      } else {
        // 중간 노드: amount가 있으면 집계, 없으면 자식으로 내려감
        const a = n.amount || 0;
        if (a > 0) {
          totalAmt += a;
          totalAct += a * ((n.actRate || 0) / 100);
        } else {
          collectLeaves(n.ch);
        }
      }
    });
  }

  (sections || []).forEach(sec => collectLeaves(sec.nodes || []));

  if (totalAmt > 0 && noAmtCount === 0) {
    return Math.round((totalAct / totalAmt) * 1000) / 10;
  }
  if (totalAmt > 0 && noAmtCount > 0) {
    const totalNodes = totalAmt / 1 + noAmtCount; // 근사: amount 있는 노드는 weight, 없는 건 count
    const weightedPart = totalAct / totalAmt;
    const simplePart   = noAmtRateSum / noAmtCount / 100;
    // 금액 기반 노드 비중(totalAmt)과 단순 카운트 비중(noAmtCount)으로 결합
    const wRatio = totalAmt / (totalAmt + noAmtCount * (totalAmt / Math.max(totalAmt / Math.max(1, (totalAmt > 0 ? 1 : 1)), 1)));
    return Math.round(((weightedPart * totalAmt + simplePart * noAmtCount) / (totalAmt + noAmtCount)) * 1000) / 10;
  }
  if (totalAmt === 0 && noAmtCount > 0) {
    return Math.round((noAmtRateSum / noAmtCount) * 10) / 10;
  }
  return 0;
}

const PROMPT_FILE = path.join(__dirname, 'prompts', 'Groq_Llama3.3-70B_작업지시서.md');
const AI_RESULT_SCHEMA_VERSION = 'ai-analysis.v2';
const AI_RESULT_SCHEMA_APPENDIX = [
  '',
  '[출력 계약]',
  '- 설명, 머리말, 코드블록 없이 JSON 객체 하나만 출력합니다.',
  '- 반드시 포함: summary, risk, recovery (문자열 3개)',
  '- 가능하면 포함: top3(배열), criticalPath(문자열), completionRisk(문자열), intent(문자열), confidence(0~100 정수: 데이터 충분도 기반 분석 신뢰도)',
  '',
  '[summary 작성 기준]',
  '- 전체 상황 2~4문장 요약',
  '- 실적/계획 진행률 수치와 기준일(한국시간 KST)을 반드시 언급',
  '- 준공일 위험 등급(riskLevel)을 한국어로 명시 (심각/높음/보통/낮음)',
  '',
  '[risk 작성 기준 — 가장 중요]',
  '- 반드시 CP 위 지연 공종을 우선 언급하고 지연일 수치를 포함할 것',
  '- "P3-C: CP 위 개별 위험 요인" 섹션의 항목을 근거로 서술할 것',
  '- 준공 슬립 예상일(estimatedSlip)을 명시할 것',
  '- 선후행 충돌이 있으면 충돌 건수와 대표 사례를 포함할 것',
  '- TF 급감 공종 중 ⚠지연중 항목이 있으면 언급할 것',
  '- 근거 데이터에 없는 원인 단정, 과장 표현 금지',
  '- CP 위 지연이 없으면 "크리티컬 패스 위 지연 없음"을 명시하고 비CP 지연 현황으로 대체',
  '',
  '[recovery 작성 기준]',
  '- 즉시(금주), 단기(2주 내), 중기(1개월 내) 시기를 구분해 조치를 제시',
  '- 병행 가능 공종 조합이 있으면 공기 단축 수단으로 우선 제안',
  '- 우선순위가 드러나는 실행 조치 2~4문장',
  '',
  '[top3 작성 기준]',
  '- 지연무게(weight) 상위 공종 중 CP 위 항목을 우선 선정',
  '- 최대 3개. 각 항목: {"rank":1,"name":"공종명","reason":"CP 위, N일 지연","recovery":"즉시 조치","delayDays":N}',
  '',
  '- 마크다운 표, 번호 목록, 백틱을 JSON 밖에 출력하지 않습니다.',
  `- schemaVersion이 필요하면 "${AI_RESULT_SCHEMA_VERSION}" 값을 사용합니다.`
].join('\n');
const DEFAULT_AI_INSTRUCTIONS = [
  '당신은 건설 공정관리 전문가입니다.',
  '분석 기준일은 한국 표준시(KST) 기준입니다.',
  '제공된 공정 현황 데이터(시스템 확정 사실)만 근거로 분석하십시오.',
  '근거 없는 추정, 데이터에 없는 원인 단정, 과장 표현을 금지합니다.',
  '지연이 없다면 risk에는 "크리티컬 패스 위 지연 없음"을 명확히 적고, recovery에는 예방 조치를 제시하십시오.',
  AI_RESULT_SCHEMA_APPENDIX
].join('\n');
function loadAiInstructions() {
  try {
    const prompt = fs.readFileSync(PROMPT_FILE, 'utf8');
    return prompt + '\n\n' + AI_RESULT_SCHEMA_APPENDIX;
  } catch {
    // 파일이 없으면 기본 내용으로 생성
    try {
      fs.mkdirSync(path.dirname(PROMPT_FILE), { recursive: true });
      fs.writeFileSync(PROMPT_FILE, DEFAULT_AI_INSTRUCTIONS, 'utf8');
      console.log('[AI] 작업지시서 파일 생성됨:', PROMPT_FILE);
    } catch (writeErr) {
      console.warn('[AI] 작업지시서 파일 생성 실패:', writeErr.message);
    }
    return DEFAULT_AI_INSTRUCTIONS;
  }
}

// 사용자 메시지(전처리 데이터)만 생성 — 역할/절차/출력형식은 지시서 파일(system 메시지)에 있음
// ════ A1 CPM / A2 EVM / A3 추세 (지표 보강) ════
function _addDays(dateStr, n){
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0,10);
}
function computeCPM(nodeMap, predLinks){
  const acts=[]; const byId={};
  nodeMap.forEach((e,id)=>{ if(!e.isLeaf) return; const n=e.node;
    if(!(n.plan&&n.plan.s&&n.plan.f)) return;
    const a={id,name:e.path,section:e.sectionName,s:n.plan.s,f:n.plan.f,dur:Math.max(1,dayDiff(n.plan.f,n.plan.s)+1),actRate:n.actRate||0,predId:n.predecessorId||''};
    acts.push(a); byId[id]=a;
  });
  if(acts.length<1) return null;
  const preds={},succs={}; acts.forEach(a=>{preds[a.id]=[];succs[a.id]=[];});
  const link=(sx,tx)=>{ if(byId[sx]&&byId[tx]){ preds[tx].push(sx); succs[sx].push(tx); } };
  (predLinks||[]).forEach(l=>{ (l.tgtIds||[]).forEach(t=>link(l.srcId,t)); });
  acts.forEach(a=>{ if(a.predId) link(a.predId,a.id); });
  const indeg={}; acts.forEach(a=>indeg[a.id]=preds[a.id].length);
  const q=acts.filter(a=>indeg[a.id]===0).map(a=>a.id); const order=[];
  while(q.length){ const id=q.shift(); order.push(id); succs[id].forEach(t=>{ if(--indeg[t]===0) q.push(t); }); }
  if(order.length!==acts.length) return {cyclic:true};
  const ES={},EF={};
  order.forEach(id=>{ const a=byId[id]; let es=a.s; preds[id].forEach(p=>{ const c=_addDays(EF[p],1); if(c>es) es=c; }); ES[id]=es; EF[id]=_addDays(es,a.dur-1); });
  const projFinish=Object.values(EF).sort().slice(-1)[0];
  const LF={},LS={};
  order.slice().reverse().forEach(id=>{ const a=byId[id]; let lf=projFinish; if(succs[id].length){ lf=null; succs[id].forEach(sc=>{ const c=_addDays(LS[sc],-1); if(lf===null||c<lf) lf=c; }); } LF[id]=lf; LS[id]=_addDays(lf,-(a.dur-1)); });
  const today=getKSTDateString();
  const rows=acts.map(a=>({name:a.name,section:a.section,tf:dayDiff(LS[a.id],ES[a.id]),planF:a.f,actRate:a.actRate}));
  const critical=rows.filter(r=>r.tf<=0).sort((x,y)=>x.planF<y.planF?-1:1);
  const lowFloat=rows.filter(r=>r.tf>0&&r.tf<=5).sort((x,y)=>x.tf-y.tf);
  const plannedFinish=acts.map(a=>a.f).sort().slice(-1)[0];
  return { projectFinish:projFinish, plannedFinish,
    criticalCount:critical.length,
    criticalPath:critical.slice(0,12).map(r=>r.name),
    criticalDelayed:critical.filter(r=>r.actRate<100&&r.planF<today).map(r=>({name:r.name,section:r.section,planF:r.planF,actRate:r.actRate})),
    lowFloat:lowFloat.slice(0,8).map(r=>({name:r.name,section:r.section,tf:r.tf,actRate:r.actRate})) };
}
function computeEVM(nodeMap, baseDate){
  let BAC=0,PV=0,EV=0;
  nodeMap.forEach(e=>{ if(!e.isLeaf) return; const n=e.node; const amt=n.amount||0; if(amt<=0) return;
    BAC+=amt; EV+=amt*((n.actRate||0)/100);
    const ps=n.plan&&n.plan.s, pf=n.plan&&n.plan.f;
    if(ps&&pf){ let pct; if(baseDate<ps) pct=0; else if(baseDate>=pf) pct=1; else { const tot=Math.max(1,dayDiff(pf,ps)); pct=Math.min(1,Math.max(0,dayDiff(baseDate,ps)/tot)); } PV+=amt*pct; }
  });
  if(BAC<=0) return null;
  const SPI=PV>0?Math.round(EV/PV*100)/100:null;
  return { BAC:Math.round(BAC),PV:Math.round(PV),EV:Math.round(EV),
    completionPct:Math.round(EV/BAC*1000)/10, plannedPct:Math.round(PV/BAC*1000)/10,
    SPI, scheduleVariancePct:Math.round((EV-PV)/BAC*1000)/10 };
}
function computeConfidence(nodeMap, predLinks){
  let leaves=0, withDates=0, withAmount=0;
  nodeMap.forEach(e=>{ if(!e.isLeaf) return; leaves++; const n=e.node;
    if(n.plan&&n.plan.s&&n.plan.f) withDates++;
    if((n.amount||0)>0) withAmount++;
  });
  if(!leaves) return 0;
  const datePct=withDates/leaves, amtPct=withAmount/leaves;
  const linkScore=Math.min(1,(predLinks||[]).length/Math.max(1,leaves*0.5));
  return Math.round((datePct*0.5 + amtPct*0.3 + linkScore*0.2)*100);
}
function computeVelocity(siteId){
  if(!siteId) return null;
  try{
    const dir=siteBackupDir(siteId);
    const files=fs.readdirSync(dir).filter(f=>f.toLowerCase().endsWith('.json'));
    if(files.length<2) return null;
    const snaps=files.map(f=>{ try{ const j=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')); const pid=j.primaryId; const proj=j.projects&&j.projects[pid]; if(!proj) return null; const t=(j.backupAt||new Date(fs.statSync(path.join(dir,f)).mtime).toISOString()).slice(0,10); return {t,prog:computeOverallProgress(proj.sections||[])}; }catch(e){ return null; } }).filter(Boolean);
    if(snaps.length<2) return null;
    snaps.sort((a,b)=>a.t<b.t?-1:1);
    const first=snaps[0],last=snaps[snaps.length-1];
    const days=Math.max(1,dayDiff(last.t,first.t));
    const perWeek=Math.round((last.prog-first.prog)/days*7*10)/10;
    const remaining=100-last.prog;
    const weeks=perWeek>0?Math.round(remaining/perWeek*10)/10:null;
    return { samples:snaps.length, spanDays:days, progressFrom:Math.round(first.prog*10)/10, progressTo:Math.round(last.prog*10)/10, velocityPerWeek:perWeek, forecastWeeksToFinish:weeks, stalled:perWeek<=0.1 };
  }catch(e){ return null; }
}

function buildAiPrompt({ baseDate, progressRate, planRate, delays, conflicts, predLinksText, tfAlerts, blindSpots, parallelCandidates, completionRiskScore, projectName, cpm, evm, velocity }) {
  // P2-A: 지연 무게 스코어 포함 테이블 (지연 무게 큰 순 정렬은 이미 computeDelayWeights에서 완료)
  const delayTable = delays.length
    ? ['| 순위 | 공종 | 구분 | 지연일 | 영향공종수 | 지연무게 | CP |', '|---|---|---|---|---|---|---|']
        .concat(delays.slice(0, 30).map((d, i) =>
          `| ${i+1} | ${d.section} > ${d.name} | ${d.type} | ${d.daysLate}일 | ${d.impactCount||0}개 | ${d.weight||0} | ${d.isOnCriticalPath?'✅':'-'} |`
        )).join('\n')
    : '(지연 공종 없음)';

  const conflictLines = conflicts.length
    ? conflicts.slice(0, 20).map(c =>
        `- 선행 [${c.predName}](진행 ${c.predProgress}%) 미완 → 후행 [${c.succName}]이 ${c.succActualStart}에 착수`
      ).join('\n')
    : '(선후행 충돌 없음)';

  // P2-C: TF 급감 공종
  const tfLines = (tfAlerts && tfAlerts.length)
    ? tfAlerts.slice(0, 15).map(t =>
        `- [${t.section}] ${t.name} | TF ${t.tf}일 | 후행 ${t.succCount}개 | 실적 ${t.actRate}% | 계획종료 ${t.planF}${t.isDelayed?' ⚠지연중':''}`
      ).join('\n')
    : '(TF 급감 공종 없음)';

  // P2-C: 안심/위험 분류
  const safeLines = (blindSpots && blindSpots.safe && blindSpots.safe.length)
    ? blindSpots.safe.slice(0, 10).map(s =>
        `- [${s.section}] ${s.name} | 실적 ${s.actRate}% | 후행 없음 → 전체 무해`
      ).join('\n')
    : '(해당 없음)';
  const dangerLines = (blindSpots && blindSpots.danger && blindSpots.danger.length)
    ? blindSpots.danger.slice(0, 10).map(d =>
        `- [${d.section}] ${d.name} | 실적 ${d.actRate}% | 후행 ${d.succCount}개 대기 → 완료 전 집중관리 필요`
      ).join('\n')
    : '(해당 없음)';

  // P3-B: 병행 가능 공종 조합
  const parallelLines = (parallelCandidates && parallelCandidates.length)
    ? parallelCandidates.slice(0, 5).map((p, i) =>
        `${i+1}. [${p.aSection}] ${p.aName} + [${p.bSection}] ${p.bName} (겹침 ${p.overlapDays}일, ${p.note})`
      ).join('\n')
    : '(병행 가능 조합 없음)';

  // P3-C: 준공일 위험 스코어 — 강화된 구조 활용
  const crScore = completionRiskScore || {};
  const crLine = crScore.riskLevel
    ? `위험 수준: ${(crScore.riskLabel||crScore.riskLevel).toUpperCase()} | CP 지연 ${crScore.cpDelayCount||0}건 | 최대 ${crScore.maxDelay}일 | 준공 슬립 예상 ${crScore.estimatedSlip}일`
    : '(산출 불가)';
  // 판정 근거 문장 (AI가 risk 필드에 직접 인용 가능)
  const crBasis = crScore.riskBasis || '';
  // CP 위 개별 위험 요인
  const crFactors = (crScore.riskFactors && crScore.riskFactors.length)
    ? crScore.riskFactors.slice(0, 5).map(f =>
        `- [${f.section}] ${f.name} | ${f.type} ${f.daysLate}일 | 영향 ${f.impactCount}개 공종 | 심각도: ${f.severity}`
      ).join('\n')
    : '(CP 위 지연 없음)';

  // A1 CPM / A2 EVM / A3 추세 섹션
  const cpmLines = (cpm && !cpm.cyclic && cpm.projectFinish)
    ? [`- CPM 예상 준공: ${cpm.projectFinish} / 계획 준공: ${cpm.plannedFinish} (슬립 ${dayDiff(cpm.projectFinish, cpm.plannedFinish)}일)`,
       `- 임계경로 ${cpm.criticalCount}개: ${cpm.criticalPath.join(' → ')||'(없음)'}`,
       (cpm.criticalDelayed&&cpm.criticalDelayed.length)?('- ⚠ CP 위 지연: '+cpm.criticalDelayed.map(d=>`${d.name}(실적 ${d.actRate}%, 계획종료 ${d.planF})`).join(', ')):'- CP 위 지연 없음',
       (cpm.lowFloat&&cpm.lowFloat.length)?('- 여유 임박(TF≤5일): '+cpm.lowFloat.map(r=>`${r.name}(TF ${r.tf}일)`).join(', ')):''
      ].filter(Boolean).join('\n')
    : (cpm&&cpm.cyclic?'(선후행 순환으로 CPM 산출 불가)':'(CPM 산출 불가 — 선후행/일자 부족)');
  const evmLines = evm
    ? `- 기성율(EV/BAC): ${evm.completionPct}% / 계획진척(PV/BAC): ${evm.plannedPct}% / 일정차이(SV): ${evm.scheduleVariancePct}%p${evm.SPI!=null?` / SPI(일정효율): ${evm.SPI} ${evm.SPI<1?'(지연)':'(정상/앞섬)'}`:''}\n  ※ 원가(실투입비) 미입력 → CPI/원가EAC 생략, 일정 기준 지표만 제공`
    : '(EVM 산출 불가 — 금액 미입력)';
  const velLines = velocity
    ? `- 최근 ${velocity.spanDays}일(${velocity.samples}개 스냅샷): ${velocity.progressFrom}% → ${velocity.progressTo}% (주당 ${velocity.velocityPerWeek}%p)${velocity.forecastWeeksToFinish!=null?`, 이 속도면 잔여 완료 약 ${velocity.forecastWeeksToFinish}주`:''}${velocity.stalled?' ⚠ 진척 정체':''}`
    : '(추세 산출 불가 — 백업 이력 부족)';
  return [
    '# 공정 현황 데이터 (시스템 확정 사실 — 수정 불가)',
    `- 프로젝트: ${projectName || '(미입력)'}`,
    `- 기준일: ${baseDate}`,
    `- 실적 진행률: ${progressRate}%  /  계획 진행률: ${planRate != null ? planRate : '-'}%`,
    '',
    '## 지연 공종 (지연 무게 큰 순 — P2-A 스코어)',
    '※ 지연 무게 = 영향 후행 공종 수 × 지연일 / CP = 크리티컬 패스 위 여부',
    delayTable,
    '',
    '## 선후행 충돌',
    conflictLines,
    '',
    '## TF 급감 공종 (여유시간 7일 이하)',
    tfLines,
    '',
    '## 블라인드 스팟 — 안심 공종',
    safeLines,
    '',
    '## 블라인드 스팟 — 위험 공종',
    dangerLines,
    '',
    '## P3-B: 병행 가능 공종 조합 (선후행 관계 없고 기간 겹치는 쌍)',
    '※ 이 조합들은 동시 진행 시 공기 단축 효과를 기대할 수 있는 후보입니다',
    parallelLines,
    '',
    '## P3-C: 준공일 위험 스코어',
    crLine,
    crBasis ? `※ 판정 근거: ${crBasis}` : '',
    '',
    '## P3-C: CP 위 개별 위험 요인 (risk 필드 작성 기준)',
    '※ 아래 항목은 준공일에 직접 영향을 미치는 크리티컬 패스 위 지연 공종입니다.',
    crFactors,
    '',
    '## 선후행 관계',
    predLinksText || '(없음)',
    '',
    '## A1: 정식 CPM (임계경로·여유시간 TF)',
    cpmLines,
    '',
    '## A2: 기성/EVM (일정 기준)',
    evmLines,
    '',
    '## A3: 실제 진척 추세 (백업 이력 기반)',
    velLines,
    '',
    '## 응답 작성 기준',
    '- summary: 전체 상황 요약 2~4문장',
    '- risk: 핵심 위험과 준공 영향 2~4문장',
    '- recovery: 우선순위가 드러나는 실행 조치 2~4문장',
    '- top3: 필요 시 최대 3개 공종만 선정 (name, reason, recovery 중심)',
    '- CPM 임계경로·슬립, EVM SPI/기성율, 진척 추세(주당 속도) 수치를 근거로 준공 영향을 정량적으로 서술할 것',
    '- 데이터에 없는 원인/수치는 추정하지 말 것',
    '',
    '위 데이터만 근거로, 지시서에 명시된 JSON 형식으로 분석 결과를 출력하세요.'
  ].join('\n');
}

// ── Ollama 호출 (로컬 또는 클라우드) ──────────────────────────
// OLLAMA_HOST=https://ollama.com + OLLAMA_API_KEY=xxx 로 클라우드 사용 가능
async function callOllama(system, user) {
  const model   = process.env.OLLAMA_MODEL   || 'qwen2.5:7b';
  const host    = process.env.OLLAMA_HOST    || 'http://localhost:11434';
  const apiKey  = process.env.OLLAMA_API_KEY || '';
  const isCloud = host.startsWith('https://');
  const extraHeaders = apiKey ? { 'Authorization': 'Bearer ' + apiKey } : {};
  const timeoutMs = isCloud ? 60000 : 120000; // 클라우드는 60초, 로컬은 120초

  // 클라우드(ollama.com)는 /api/chat 엔드포인트를 사용하고 messages 형식 필요
  if (isCloud) {
    const json = await httpPostJSON(host + '/api/chat', {
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      stream: false,
      options: { temperature: 0.3 }
    }, extraHeaders, timeoutMs);
    return (json && json.message && typeof json.message.content === 'string')
      ? json.message.content : '';
  } else {
    const json = await httpPostJSON(host + '/api/generate', {
      model, prompt: (system + '\n\n' + user), stream: false, options: { temperature: 0.3 }
    }, extraHeaders, timeoutMs);
    return (json && typeof json.response === 'string') ? json.response : '';
  }
}

// ── Groq API 호출 (무료 — 신용카드 불필요, 하루 1000~14400 요청) ──
// 모델: llama-3.3-70b-versatile (고품질, 하루 1000회)
//       llama-3.1-8b-instant    (고속, 하루 14400회)
async function callGroqApi(system, user) {
  const apiKey = _groqApiKey;
  if (!apiKey) throw new Error('Groq API Key가 설정되지 않았습니다 (관리자 탭 → Groq API Key에서 설정)');
  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  // Groq는 OpenAI 호환 API 사용
  const json = await httpPostJSON('https://api.groq.com/openai/v1/chat/completions', {
    model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    max_tokens: 2500,   // 상향: top3+서술형 3필드 모두 채워도 여유 있게
    temperature: 0.1    // 낮춤: 사실 기반 정형 출력에 일관성 확보
  }, {
    'Authorization': 'Bearer ' + apiKey
  }, 30000); // Groq는 매우 빠르므로 30초면 충분
  const choice = (json.choices || [])[0];
  return (choice && choice.message && choice.message.content) ? choice.message.content : '';
}

// ── Claude API 호출 (서버 측 — 키는 메모리/config.json에서 읽음, 브라우저에 노출 안 됨) ──
async function callClaudeApi(system, user) {
  const apiKey = _claudeApiKey; // 환경변수 또는 관리자 탭에서 설정한 키
  if (!apiKey) throw new Error('Claude API Key가 설정되지 않았습니다 (관리자 탭 → Claude API Key에서 설정)');
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
  const json = await httpPostJSON('https://api.anthropic.com/v1/messages', {
    model, max_tokens: 2000, system,
    messages: [{ role: 'user', content: user }]
  }, {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01'
  }, 60000);
  const block = (json.content || []).find(b => b.type === 'text');
  return block ? block.text : '';
}


// ════════════════════════════════════════════════════════════════
// Phase 3 — 멀티턴 분석 + 조합 최적화 + 공정회의 자동화
// ════════════════════════════════════════════════════════════════

// ── P3-A: 토큰 기반 분석 모드 결정 ──────────────────────────────
// 단일턴: 토큰 추정치 < 80K
// 멀티턴: 80K 이상 (대형 현장) → 3단계 파이프라인
const SINGLE_TURN_TOKEN_LIMIT = 80000;

// 토큰 수 추정 (단일턴/멀티턴 분기용) — ASCII ~4자/토큰, 한글 등 비ASCII ~1.5자/토큰
function estimateTokens(text) {
  if (!text) return 0;
  let ascii = 0, other = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 128) ascii++; else other++;
  }
  return Math.ceil(ascii / 4 + other / 1.5);
}

function shouldUseMultiTurn(userMsg) {
  return estimateTokens(userMsg) >= SINGLE_TURN_TOKEN_LIMIT;
}

// ── P3-A: 멀티턴 3단계 파이프라인 ──────────────────────────────
// 1단계: 전체 요약 → AI가 집중 대분류 선택
// 2단계: 선택 대분류 상세 분석
// 3단계: 종합 의견 + 만회 계획 통합
async function runMultiTurnAnalysis(instructions, analysisData, runProvider, onProgress) {
  const { baseDate, progressRate, planRate, delaysWeighted, conflicts,
          tfAlerts, blindSpots, predLinksText, projectName } = analysisData;

  // ── 1단계: 전체 요약 + 집중 대분류 선택 ──
  onProgress && onProgress(1, '1단계: 전체 공정 요약 분석 중...');

  const step1Sys = `당신은 건설 공정관리 전문 분석관입니다.
공정 현황을 빠르게 파악하고 가장 심각한 대분류(섹션) 2~3개를 선택하십시오.
출력: {"focusSections":["섹션명1","섹션명2"],"overallRisk":"전체 위험 수준 한 문장","topDelayIds":["nodeId1","nodeId2","nodeId3"]}
JSON만 출력하고 설명·코드블록·전문을 쓰지 마십시오.`;

  const step1User = [
    `# 공정 현황 요약 (기준일: ${baseDate})`,
    `- 프로젝트: ${projectName || '(미입력)'}`,
    `- 실적 진행률: ${progressRate}% / 계획: ${planRate != null ? planRate : '-'}%`,
    `- 지연 공종 수: ${delaysWeighted.length}건`,
    `- 선후행 충돌: ${conflicts.length}건`,
    `- TF 급감 공종: ${tfAlerts.length}건`,
    '',
    '## 지연 무게 Top 10 (지연 무게 큰 순)',
    delaysWeighted.slice(0, 10).map((d, i) =>
      `${i+1}. [${d.section}] ${d.name} | 지연 ${d.daysLate}일 | 영향 ${d.impactCount}개 | 무게 ${d.weight} | CP:${d.isOnCriticalPath?'Y':'N'}`
    ).join('\n') || '(없음)',
    '',
    '어떤 섹션을 집중 분석해야 합니까?'
  ].join('\n');

  let step1Raw = '';
  try { step1Raw = await runProvider(step1Sys, step1User); }
  catch(e) { throw new Error('1단계 실패: ' + e.message); }

  const step1 = parseAiJsonP3(step1Raw);
  const focusSections = (step1 && step1.focusSections) || [];
  const overallRisk = (step1 && step1.overallRisk) || '';

  // ── 2단계: 집중 섹션 상세 분석 ──
  onProgress && onProgress(2, `2단계: 집중 섹션 상세 분석 중... (${focusSections.join(', ') || '전체'})`);

  // 집중 섹션의 지연 공종만 추출
  const focusDelays = focusSections.length
    ? delaysWeighted.filter(d => focusSections.some(s => d.section && d.section.includes(s)))
    : delaysWeighted.slice(0, 15);

  const step2Sys = instructions; // 기존 작업지시서 그대로 활용

  const delayTable2 = focusDelays.length
    ? ['| 순위 | 공종 | 구분 | 지연일 | 영향공종수 | 지연무게 | CP |', '|---|---|---|---|---|---|---|']
        .concat(focusDelays.slice(0, 20).map((d, i) =>
          `| ${i+1} | ${d.section} > ${d.name} | ${d.type} | ${d.daysLate}일 | ${d.impactCount}개 | ${d.weight} | ${d.isOnCriticalPath?'✅':'-'} |`
        )).join('\n')
    : '(해당 없음)';

  const step2User = [
    `# 집중 분석 대상 (기준일: ${baseDate})`,
    `- 1단계 전체 위험 판단: ${overallRisk}`,
    `- 집중 섹션: ${focusSections.join(', ') || '전체'}`,
    '',
    '## 집중 섹션 지연 공종 (상세)',
    delayTable2,
    '',
    '## 선후행 충돌',
    conflicts.length
      ? conflicts.slice(0, 10).map(c => `- 선행 [${c.predName}] 미완 → 후행 [${c.succName}] ${c.succActualStart} 착수`).join('\n')
      : '(없음)',
    '',
    '## TF 급감 공종',
    tfAlerts.length
      ? tfAlerts.slice(0, 10).map(t => `- [${t.section}] ${t.name} TF ${t.tf}일`).join('\n')
      : '(없음)',
    '',
    '위 데이터로 지시서에 명시된 JSON 형식으로 분석 결과를 출력하십시오.'
  ].join('\n');

  let step2Raw = '';
  try { step2Raw = await runProvider(step2Sys, step2User); }
  catch(e) { throw new Error('2단계 실패: ' + e.message); }

  const step2 = parseAiJson(step2Raw);

  // ── 3단계: 종합 의견 + 만회 계획 통합 ──
  onProgress && onProgress(3, '3단계: 종합 의견 + 만회 계획 작성 중...');

  const step3Sys = `당신은 건설 공정관리 전문 분석관입니다.
1단계와 2단계 분석 결과를 종합하여 최종 의견과 만회 계획을 작성하십시오.
출력: {"finalSummary":"최종 종합 의견 3-5문장","riskSummary":"핵심 위험 2-4문장","completionRisk":"준공일 영향 예측","recoveryPlan":"만회 계획 2-3가지"}
JSON만 출력하십시오.`;

  const step3User = [
    '# 1단계 결과',
    `전체 위험: ${overallRisk}`,
    `집중 섹션: ${focusSections.join(', ')}`,
    '',
    '# 2단계 결과 요약',
    step2 ? [
      step2.intent && `설계 의도: ${step2.intent}`,
      step2.criticalPath && `크리티컬 패스: ${step2.criticalPath}`,
      step2.completionRisk && `준공 위험: ${step2.completionRisk}`,
    ].filter(Boolean).join('\n') : '(2단계 파싱 실패)',
    '',
    '위 내용을 종합하여 최종 의견을 작성하십시오.'
  ].join('\n');

  let step3Raw = '';
  try { step3Raw = await runProvider(step3Sys, step3User); }
  catch(e) { throw new Error('3단계 실패: ' + e.message); }

  const step3 = parseAiJsonP3(step3Raw);

  // 결과 병합 — step2(상세) + step3(최종) 통합
  const merged = {
    ...(step2 || {}),
    summary: (step3 && step3.finalSummary) || (step2 && step2.summary) || '',
    risk: (step3 && step3.riskSummary) || (step2 && (step2.risk || step2.completionRisk)) || overallRisk || '',
    completionRisk: (step3 && step3.completionRisk) || (step2 && step2.completionRisk) || '',
    recovery: (step3 && step3.recoveryPlan) || (step2 && step2.recovery) || '',
    schemaVersion: AI_RESULT_SCHEMA_VERSION,
    _multiTurn: true,
    _focusSections: focusSections,
    _overallRisk: overallRisk,
  };
  return { raw: step2Raw, parsed: merged };
}

// parseAiJson의 P3 전용 variant (recovery 필드 구조 차이 처리)
function parseAiJsonP3(raw) {
  if (!raw) return null;
  let text = raw.trim()
    .replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); }
  catch { return null; }
}

// ── P3-B: 병행 가능 공종 조합 탐색 ──────────────────────────────
// 선후행 관계가 없고 기간이 겹치는 공종들 중 동시 진행 가능한 조합 발굴
// 결과를 AI 프롬프트에 포함하여 만회 시나리오 제시에 활용
function computeParallelCandidates(nodeMap, predLinks, baseDate) {
  const fwdMap = buildSuccessorMap(predLinks);

  // 역방향 맵도 생성 (이 노드의 선행 집합)
  const bwdMap = new Map(); // tgtId → [srcId, ...]
  (predLinks || []).forEach(l => {
    (l.tgtIds || []).forEach(tid => {
      if (!bwdMap.has(tid)) bwdMap.set(tid, []);
      bwdMap.get(tid).push(l.srcId);
    });
  });

  // 지연 중인 leaf 노드만 대상
  const delayedLeafs = [];
  nodeMap.forEach((entry, nid) => {
    if (!entry.isLeaf) return;
    const n = entry.node;
    const planF = n.plan && n.plan.f;
    const actRate = n.actRate || 0;
    if (!planF || planF >= baseDate || actRate >= 100) return;
    delayedLeafs.push({ id: nid, entry, planS: n.plan.s, planF, actRate });
  });

  // 각 지연 공종에 대해 선후행 관계 없이 기간 겹치는 다른 공종 탐색
  const candidates = [];
  for (let i = 0; i < delayedLeafs.length; i++) {
    const a = delayedLeafs[i];
    const aSuccs = getAllSuccessors(a.id, fwdMap);
    const aPreds = new Set(bwdMap.get(a.id) || []);

    for (let j = i + 1; j < delayedLeafs.length; j++) {
      const b = delayedLeafs[j];
      // 선후행 관계가 있으면 제외
      if (aSuccs.has(b.id) || getAllSuccessors(b.id, fwdMap).has(a.id)) continue;
      if (aPreds.has(b.id) || (bwdMap.get(b.id) || []).includes(a.id)) continue;

      // 기간 겹침 확인
      if (!a.planS || !b.planS) continue;
      const overlapStart = a.planS > b.planS ? a.planS : b.planS;
      const overlapEnd   = a.planF < b.planF ? a.planF : b.planF;
      if (overlapStart > overlapEnd) continue; // 겹침 없음

      const overlapDays = dayDiff(overlapEnd, overlapStart);
      candidates.push({
        aId: a.id, aName: a.entry.path, aSection: a.entry.sectionName, aRate: a.actRate,
        bId: b.id, bName: b.entry.path, bSection: b.entry.sectionName, bRate: b.actRate,
        overlapDays,
        note: overlapDays > 14 ? '병행 효과 높음' : '단기 병행 가능'
      });
    }
  }

  // 겹침 기간 큰 순 정렬, 상위 10개
  candidates.sort((a, b) => b.overlapDays - a.overlapDays);
  return candidates.slice(0, 10);
}

// ── P3-C: 준공일 영향 예측 ────────────────────────────────────────
// CP 위 공종들의 총 지연일 합산 → 준공일 예측 이동량 산출
function computeCompletionRiskScore(delaysWeighted, baseDate) {
  const cpDelays = delaysWeighted.filter(d => d.isOnCriticalPath);

  // CP 외 지연도 risk 판정 보조 지표로 활용
  const nonCpDelays = delaysWeighted.filter(d => !d.isOnCriticalPath);
  const totalDelayCount = delaysWeighted.length;

  if (!cpDelays.length) {
    // CP 위 지연 없어도 전체 지연이 많으면 medium 이상
    const level = totalDelayCount > 10 ? 'medium' : totalDelayCount > 4 ? 'low' : 'low';
    return {
      riskLevel: level,
      maxDelay: 0,
      estimatedSlip: 0,
      cpDelayCount: 0,
      totalDelayCount,
      // 판정 근거 — AI가 risk 서술에 직접 활용
      riskBasis: totalDelayCount > 0
        ? `CP 위 지연 없음. 비CP 지연 ${totalDelayCount}건 존재하나 준공일 직접 영향은 낮음.`
        : '지연 공종 없음. 현재 공기 리스크 낮음.',
      riskFactors: [],
      nonCpSummary: nonCpDelays.slice(0, 3).map(d =>
        `[${d.section}] ${d.name} ${d.daysLate}일 지연 (영향 ${d.impactCount}개 공종)`
      )
    };
  }

  // CP 위 지연 상세 분석
  const maxDelay = Math.max(...cpDelays.map(d => d.daysLate));

  // 가중 평균 — 영향공종수×지연일 무게 반영
  const totalWeight = cpDelays.reduce((s, d) => s + (d.weight || 0), 0);
  const weightedAvg = totalWeight > 0
    ? cpDelays.reduce((s, d) => s + d.daysLate * (d.weight || 0), 0) / totalWeight : 0;
  const estimatedSlip = Math.round(weightedAvg);

  // 위험 등급 — 최대 CP 지연일 기준
  const riskLevel = maxDelay > 30 ? 'critical'
    : maxDelay > 14 ? 'high'
    : maxDelay > 7  ? 'medium'
    : 'low';

  // 위험 등급별 한국어 레이블
  const riskLabel = { critical: '심각', high: '높음', medium: '보통', low: '낮음' }[riskLevel];

  // AI가 risk 필드에 직접 인용할 수 있는 판정 근거 문장
  const topCp = cpDelays.slice(0, 3);
  const riskBasis = [
    `준공일 위험 등급: ${riskLabel}(${riskLevel.toUpperCase()}).`,
    `크리티컬 패스 위 지연 ${cpDelays.length}건, 최대 ${maxDelay}일 지연, 가중평균 준공 슬립 ${estimatedSlip}일 예상.`,
    topCp.map(d =>
      `[${d.section}] ${d.name}: ${d.type} ${d.daysLate}일 (영향 후행 ${d.impactCount}개 공종, 지연무게 ${d.weight})`
    ).join(' / ')
  ].join(' ');

  // 개별 위험 요인 목록 — AI top3 선정 보조
  const riskFactors = cpDelays.map(d => ({
    name: d.name,
    section: d.section,
    type: d.type,
    daysLate: d.daysLate,
    impactCount: d.impactCount,
    weight: d.weight,
    severity: d.daysLate > 30 ? '심각' : d.daysLate > 14 ? '위험' : d.daysLate > 7 ? '주의' : '관찰'
  }));

  return {
    riskLevel,
    riskLabel,
    maxDelay,
    estimatedSlip,
    cpDelayCount: cpDelays.length,
    totalDelayCount,
    riskBasis,      // AI가 risk 필드 작성 시 직접 인용
    riskFactors,    // CP 위 공종별 위험 상세
    nonCpSummary: nonCpDelays.slice(0, 3).map(d =>
      `[${d.section}] ${d.name} ${d.daysLate}일 지연`
    )
  };
}

// ── P3-C: 공정회의 안건 초안 생성 프롬프트 ──────────────────────
function buildMeetingAgendaPrompt(analysisData) {
  const { baseDate, progressRate, planRate, rateGap, delaysWeighted,
          conflicts, tfAlerts, blindSpots, parallelCandidates,
          completionRiskScore, projectName } = analysisData;

  const top3 = delaysWeighted.slice(0, 3);
  const cpDelays = delaysWeighted.filter(d => d.isOnCriticalPath).slice(0, 5);

  return [
    '# 공정회의 안건 초안 생성 요청',
    `- 프로젝트: ${projectName || '(미입력)'}`,
    `- 기준일: ${baseDate}`,
    `- 실적 진행률: ${progressRate}% (계획대비 ${rateGap > 0 ? '+' : ''}${rateGap}%)`,
    `- 준공일 위험: ${completionRiskScore.riskLevel.toUpperCase()} (CP 지연 최대 ${completionRiskScore.maxDelay}일, 예상 준공 슬립 ${completionRiskScore.estimatedSlip}일)`,
    '',
    '## 긴급 안건 후보 (CP 위 지연 공종)',
    cpDelays.length
      ? cpDelays.map((d, i) => `${i+1}. [${d.section}] ${d.name} — 지연 ${d.daysLate}일, 영향 ${d.impactCount}개 공종`).join('\n')
      : '(크리티컬 패스 위 지연 없음)',
    '',
    '## 만회 시나리오 후보 (병행 가능 조합)',
    parallelCandidates.length
      ? parallelCandidates.slice(0, 5).map((p, i) =>
          `${i+1}. [${p.aSection}]${p.aName} + [${p.bSection}]${p.bName} (겹침 ${p.overlapDays}일, ${p.note})`
        ).join('\n')
      : '(병행 가능 조합 없음)',
    '',
    '## 블라인드 스팟',
    (blindSpots.danger && blindSpots.danger.length)
      ? blindSpots.danger.slice(0,3).map(d => `⚠ [${d.section}] ${d.name} 실적 ${d.actRate}% 후행 ${d.succCount}개`).join('\n')
      : '(없음)',
    '',
    `아래 JSON 하나만 출력하십시오. 설명·코드블록 없이 JSON만 출력합니다.
{
  "meetingTitle": "공정회의 제목",
  "date": "${baseDate}",
  "completionForecast": "준공일 영향 예측 (구체적 날짜 또는 기간)",
  "agendaItems": [
    {"no":1,"title":"안건 제목","detail":"상세 내용","owner":"담당부서/담당자","deadline":"조치 기한"},
    {"no":2,"title":"...","detail":"...","owner":"...","deadline":"..."},
    {"no":3,"title":"...","detail":"...","owner":"...","deadline":"..."}
  ],
  "scenarios": [
    {"title":"시나리오 1 제목","description":"설명","expectedEffect":"예상 공기 단축 효과"},
    {"title":"시나리오 2 제목","description":"설명","expectedEffect":"예상 공기 단축 효과"}
  ],
  "conclusion": "종합 결론 2-3문장"
}`
  ].join('\n');
}

// AI가 코드블록이나 부가 설명을 덧붙여도 JSON 부분만 최대한 살려서 파싱
function parseAiJson(raw) {
  if (!raw) return null;
  let text = raw.trim();
  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); }
  catch { return null; }
}

function _normAiText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return v.map(_normAiText).filter(Boolean).join('\n');
  if (typeof v === 'object') {
    return String(v.text || v.summary || v.message || v.reason || v.value || '').trim();
  }
  return String(v).trim();
}

function _normAiTop3(top3) {
  if (!Array.isArray(top3)) return [];
  return top3.slice(0, 3).map((item, idx) => {
    const o = (item && typeof item === 'object') ? item : { name: item };
    return {
      rank: Number(o.rank) || (idx + 1),
      name: _normAiText(o.name || o.task || o.nodeName || o.title),
      reason: _normAiText(o.reason || o.risk || o.issue),
      recovery: _normAiText(o.recovery || o.action || o.mitigation),
      delayDays: Number(o.delayDays ?? o.delay_days ?? o.daysLate ?? 0) || 0,
      impactCount: Number(o.impactCount ?? o.impact_count ?? 0) || 0,
      weight: Number(o.weight ?? o.score ?? 0) || 0,
      isOnCriticalPath: !!(o.isOnCriticalPath ?? o.onCriticalPath ?? o.cp)
    };
  }).filter(x => x.name);
}

function normalizeAiPayload(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const summary = _normAiText(parsed.summary || parsed.finalSummary || parsed.overallSummary);
  const risk = _normAiText(parsed.risk || parsed.riskSummary || parsed.mainRisk || parsed.completionRisk || parsed.overallRisk);
  const recovery = _normAiText(parsed.recovery || parsed.recoveryPlan || parsed.actions || parsed.mitigation);
  const top3 = _normAiTop3(parsed.top3 || parsed.focusTop3 || parsed.topRisks || parsed.delaysTop3);
  const criticalPath = _normAiText(parsed.criticalPath || parsed.critical_path);
  const completionRisk = _normAiText(parsed.completionRisk || parsed.completion_risk);
  const intent = _normAiText(parsed.intent || parsed.analysisIntent || parsed.executiveIntent);
  const blindSpots = parsed.blindSpots && typeof parsed.blindSpots === 'object' ? parsed.blindSpots : null;
  return {
    schemaVersion: _normAiText(parsed.schemaVersion) || AI_RESULT_SCHEMA_VERSION,
    summary,
    risk,
    recovery,
    top3,
    criticalPath,
    completionRisk,
    intent,
    blindSpots
  };
}

// ════════════════════════════════════════════════════════════
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = req.url.split('?')[0];

  // ── HTML 서빙 ─────────────────────────────────────────────
  if (req.method === 'POST' && url === '/api/save-xlsb') {
    try {
      const _bd = await parseBody(req);
      const _nm = String(_bd.name || 'output.xlsb').replace(/[\/\\:*?"<>|]/g, '_');
      const _dir = path.join(__dirname, '출력'); try { fs.mkdirSync(_dir, { recursive: true }); } catch(e) {}
      const _fp = path.join(_dir, _nm);
      fs.writeFileSync(_fp, Buffer.from(_bd.b64 || '', 'base64'));
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify({ ok:true, path:_fp }));
    } catch(e) { res.writeHead(500, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify({ ok:false, msg:e.message })); }
    return;
  }
  if (req.method === 'GET' && url === '/api/template') {
    try { const _b = fs.readFileSync(path.join(__dirname, 'template', '마스터공정표_간트차트_템플릿.xlsb'));
      res.writeHead(200, {'Content-Type':'application/vnd.ms-excel.sheet.binary.macroEnabled.12', 'Access-Control-Allow-Origin':'*'}); res.end(_b);
    } catch(e){ res.writeHead(404); res.end('template not found'); }
    return;
  }
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    try {
      const html = fs.readFileSync(HTML_FILE, 'utf8');
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
      res.end(html);
    } catch { res.writeHead(404); res.end('HTML 파일을 찾을 수 없습니다.'); }
    return;
  }

  // ── POST /api/login ───────────────────────────────────────
  // body: { userName, pw, adminCode? }
  // 이름으로 users에서 찾고 → 소속 회사 자동 반환
  if (req.method === 'POST' && url === '/api/login') {
    try {
      const { userName, pw, adminCode } = await parseBody(req);
      // 새 계정 체계(accounts.json) 우선 — 마스터가 등록한 계정 로그인 (이름+비번)
      const _acc = loadAccounts();
      const _au = (_acc.users || []).find(u => u.name === userName && u.pw === hpw(pw));
      if (_au) {
        const _isAdmin = (_au.role === 'master' || _au.role === 'manager');
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok:true, user:{ id:_au.id, companyId:_au.id, companyName:(_au.company||_au.name), company:(_au.company||''), userName:_au.name, isAdmin:_isAdmin, canAdmin:false } }));
        return;
      }
      const d = readData();
      const users = d.users || [];

      // 이름 + 비밀번호 일치하는 계정 검색 (동명이인 대비: 이름 완전 일치)
      const user = users.find(u => u.name === userName && u.pw === hpw(pw));
      if (!user) {
        res.writeHead(401, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false, msg:'이름 또는 비밀번호가 올바르지 않습니다'}));
        return;
      }
      const company = (d.companies||[]).find(c => c.id === user.companyId);
      if (!company) {
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false, msg:'소속 회사를 찾을 수 없습니다. 관리자에게 문의하세요.'}));
        return;
      }

      // 관리자 코드 검증
      let isAdmin = false;
      if (adminCode && adminCode.trim() !== '') {
        if (user.isAdmin && user.adminCode === hpw(adminCode.trim())) {
          isAdmin = true;
        } else {
          res.writeHead(401, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ok:false, msg:'관리자 코드가 올바르지 않습니다'}));
          return;
        }
      }

      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({
        ok: true,
        user: {
          id: user.id,
          companyId: company.id,
          companyName: company.name,
          userName: user.name,
          isAdmin,
          canAdmin: user.isAdmin
        }
      }));
    } catch(e) { res.writeHead(400); res.end('bad json: ' + e.message); }
    return;
  }

  // ── POST /api/register — 관리자가 직원 계정 생성 ─────────────
  if (req.method === 'POST' && url === '/api/register') {
    try {
      const { companyId, adminUserId, newUser } = await parseBody(req);
      const d = readData();
      const requester = (d.users||[]).find(u => u.id === adminUserId && u.isAdmin && u.companyId === companyId);
      if (!requester) {
        res.writeHead(403, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false, msg:'관리자 권한이 없습니다'}));
        return;
      }
      // 이름 중복 확인 (전체 users에서 — 동명이인 방지)
      const dup = (d.users||[]).find(u => u.name === newUser.name);
      if (dup) {
        res.writeHead(409, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false, msg:`"${newUser.name}" 이름이 이미 등록되어 있습니다. 이름 뒤에 _부서명 등으로 구분해주세요.`}));
        return;
      }
      const created = {
        id: uid(),
        companyId,
        name: newUser.name,
        pw: hpw(newUser.pw),
        isAdmin: !!newUser.isAdmin,
        adminCode: (newUser.isAdmin && newUser.adminCode) ? hpw(newUser.adminCode) : ''
      };
      if (!d.users) d.users = [];
      d.users.push(created);
      writeData(d, err => {
        if (err) { res.writeHead(500); res.end('error'); return; }
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true, id:created.id}));
      });
    } catch(e) { res.writeHead(400); res.end('bad json: ' + e.message); }
    return;
  }

  // ── POST /api/user/delete ─────────────────────────────────
  if (req.method === 'POST' && url === '/api/user/delete') {
    try {
      const { companyId, adminUserId, targetUserId } = await parseBody(req);
      const d = readData();
      const requester = (d.users||[]).find(u => u.id === adminUserId && u.isAdmin && u.companyId === companyId);
      if (!requester) { res.writeHead(403); res.end(JSON.stringify({ok:false,msg:'관리자 권한 없음'})); return; }
      if (targetUserId === adminUserId) { res.writeHead(400); res.end(JSON.stringify({ok:false,msg:'자신의 계정은 삭제할 수 없습니다'})); return; }
      d.users = d.users.filter(u => u.id !== targetUserId);
      writeData(d, err => {
        if (err) { res.writeHead(500); res.end('error'); return; }
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true}));
      });
    } catch(e) { res.writeHead(400); res.end('bad json: ' + e.message); }
    return;
  }

  // ── POST /api/user/pw — 비밀번호 변경 ────────────────────────
  if (req.method === 'POST' && url === '/api/user/pw') {
    try {
      const { userId, oldPw, newPw } = await parseBody(req);
      const a = loadAccounts();
      const user = (a.users||[]).find(u => u.id === userId);
      if (!user || user.pw !== hpw(oldPw)) {
        res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false, msg:'현재 비밀번호가 올바르지 않습니다'})); return;
      }
      user.pw = hpw(newPw);
      saveAccounts(a, err => {
        if (err) { res.writeHead(500); res.end('error'); return; }
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true}));
      });
    } catch(e) { res.writeHead(400); res.end('bad json: ' + e.message); }
    return;
  }

  // ── GET /api/users?companyId= — 직원 목록 (관리자 탭용) ──────
  if (req.method === 'GET' && url.startsWith('/api/users')) {
    const params = new URLSearchParams(req.url.split('?')[1]||'');
    const companyId = params.get('companyId');
    const d = readData();
    const list = (d.users||[])
      .filter(u => u.companyId === companyId)
      .map(u => ({id:u.id, name:u.name, isAdmin:u.isAdmin}));
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify(list));
    return;
  }

  // ── POST /api/company — 최초 회사+관리자 생성 (마스터코드 필요) ──
  if (req.method === 'POST' && url === '/api/company') {
    try {
      const { companyName, adminName, pw, adminCode, masterCode } = await parseBody(req);
      const DEFAULT_MASTER = 'wuablj'; // hpw('dbqudgks54692208')
      if (hpw(masterCode||'') !== DEFAULT_MASTER) {
        res.writeHead(403, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false, msg:'마스터 코드가 올바르지 않습니다'}));
        return;
      }
      // 이름 중복 확인
      const d = readData();
      const dup = (d.users||[]).find(u => u.name === adminName);
      if (dup) {
        res.writeHead(409, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false, msg:`"${adminName}" 이름이 이미 등록되어 있습니다`}));
        return;
      }
      const company = { id: uid(), name: companyName };
      if (!d.companies) d.companies = [];
      d.companies.push(company);
      const adminUser = {
        id: uid(), companyId: company.id,
        name: adminName, pw: hpw(pw),
        isAdmin: true, adminCode: hpw(adminCode)
      };
      if (!d.users) d.users = [];
      d.users.push(adminUser);
      if (!d.projects) d.projects = {};
      d.projects[company.id] = mkProj(companyName);
      // 멀티현장 부트스트랩: accounts.json에 마스터 계정 생성(없으면) → 현장·계정 관리 사용 가능
      try {
        const _acc = loadAccounts(); _acc.users = _acc.users || []; _acc.sites = _acc.sites || [];
        if (!_acc.users.some(u => u.name === adminName)) {
          _acc.users.push({ id: uid(), name: adminName, pw: hpw(pw), role: 'master', company: companyName, sites: [], adminCode: hpw(adminCode||'') });
        }
        if (_acc.defaultManagerCode === undefined) _acc.defaultManagerCode = '';
        saveAccounts(_acc, ()=>{});
      } catch(e) { console.error('[setup] accounts master 생성 실패:', e.message); }
      writeData(d, err => {
        if (err) { res.writeHead(500); res.end('error'); return; }
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true, companyId:company.id, userId:adminUser.id}));
      });
    } catch(e) { res.writeHead(400); res.end('bad json: ' + e.message); }
    return;
  }

  // ── GET /api/inbox — 접수 폴더 .json 목록 ──────────────────
  if (req.method === 'GET' && url === '/api/inbox') {
    try {
      const files = fs.readdirSync(INBOX_DIR)
        .filter(f => f.toLowerCase().endsWith('.json'))
        .map(f => { const st = fs.statSync(path.join(INBOX_DIR, f)); return { name: f, size: st.size, mtime: st.mtimeMs }; })
        .sort((a, b) => b.mtime - a.mtime);
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify({ ok: true, files }));
    } catch (e) {
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ ok: false, msg: e.message, files: [] }));
    }
    return;
  }

  // ── GET /api/inbox/file?name= — 접수 파일 내용 ──────────────
  if (req.method === 'GET' && url === '/api/inbox/file') {
    try {
      const params = new URLSearchParams(req.url.split('?')[1] || '');
      const name = path.basename(params.get('name') || '');
      const content = fs.readFileSync(path.join(INBOX_DIR, name), 'utf8');
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify({ ok: true, content }));
    } catch (e) {
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ ok: false, msg: e.message }));
    }
    return;
  }

  // ── POST /api/distribute — 배포 폴더에 파일 저장 ────────────
  if (req.method === 'POST' && url === '/api/distribute') {
    try {
      const { filename, content } = await parseBody(req);
      const name = path.basename(filename || ('배포_' + Date.now() + '.json'));
      fs.writeFileSync(path.join(DIST_DIR, name), content || '', 'utf8');
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ ok: true, name }));
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ ok: false, msg: e.message })); }
    return;
  }

  // ── GET /api/distribute/list — 배포 폴더 목록 ──────────────
  if (req.method === 'GET' && url === '/api/distribute/list') {
    try {
      const files = fs.readdirSync(DIST_DIR)
        .filter(f => f.toLowerCase().endsWith('.json'))
        .map(f => { const st = fs.statSync(path.join(DIST_DIR, f)); return { name: f, size: st.size, mtime: st.mtimeMs }; })
        .sort((a, b) => b.mtime - a.mtime);
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify({ ok: true, files }));
    } catch (e) {
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ ok: false, msg: e.message, files: [] }));
    }
    return;
  }

  // ── GET /api/distribute/file?name= — 배포 파일 내용(다운로드용) ──
  if (req.method === 'GET' && url === '/api/distribute/file') {
    try {
      const params = new URLSearchParams(req.url.split('?')[1] || '');
      const name = path.basename(params.get('name') || '');
      const content = fs.readFileSync(path.join(DIST_DIR, name), 'utf8');
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify({ ok: true, content }));
    } catch (e) {
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ ok: false, msg: e.message }));
    }
    return;
  }

  // ── GET /api/data ─────────────────────────────────────────
  if (req.method === 'GET' && url === '/api/data') {
    try {
      const _site = (new URLSearchParams(req.url.split('?')[1]||'')).get('site');
      const raw = _site ? fs.readFileSync(sitePath(_site), 'utf8') : fs.readFileSync(DATA_FILE, 'utf8');
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
      res.end(raw);
    } catch { res.writeHead(500); res.end('{}'); }
    return;
  }

  // ── POST /api/data ────────────────────────────────────────
  if (req.method === 'POST' && url === '/api/data') {
    try {
      const parsed = await parseBody(req);
      const _site = parsed.site;
      if (_site) {
        writeSite(_site, { companies: parsed.companies || [], projects: parsed.projects || {} }, err => {
          if (err) { res.writeHead(500); res.end('error'); return; }
          let t = 0; try { t = fs.statSync(sitePath(_site)).mtimeMs; } catch (e) {}
          wss.clients.forEach(ws => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({type:'reload', site:_site, t})); });
          res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true, t}));
        });
        return;
      }
      // ★ 보호: users, companies는 클라이언트가 덮어쓰지 못하게
      // 서버의 기존 users/companies를 유지하고 projects만 병합
      const current = readData();
      const merged = {
        ...parsed,
        users: current.users || [],           // 서버 users 유지
        companies: current.companies || [],   // 서버 companies 유지
      };
      writeData(merged, err => {
        if (err) { res.writeHead(500); res.end('error'); return; }
        const t = getLastModified();
        wss.clients.forEach(ws => {
          if (ws.readyState === ws.OPEN)
            ws.send(JSON.stringify({type:'reload', t}));
        });
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true, t}));
      });
    } catch { res.writeHead(400); res.end('bad json'); }
    return;
  }

  // ── POST /api/node ────────────────────────────────────────
  if (req.method === 'POST' && url === '/api/node') {
    try {
      const {companyId, secId, nodeId, fields, site} = await parseBody(req);
      const current = site ? readSite(site) : readData();
      const proj = current.projects && current.projects[companyId];
      if (!proj) { res.writeHead(404); res.end('project not found'); return; }
      const sec = proj.sections && proj.sections.find(s => s.id === secId);
      if (!sec) { res.writeHead(404); res.end('section not found'); return; }
      updateNodeInTree(sec.nodes, nodeId, fields);
      const _done = err => {
        if (err) { res.writeHead(500); res.end('error'); return; }
        let t = 0; try { t = site ? fs.statSync(sitePath(site)).mtimeMs : getLastModified(); } catch (e) {}
        wss.clients.forEach(ws => {
          if (ws.readyState === ws.OPEN)
            ws.send(JSON.stringify({type:'patch', companyId, secId, nodeId, fields, site, t}));
        });
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true, t}));
      };
      if (site) writeSite(site, current, _done); else writeData(current, _done);
    } catch(e) { res.writeHead(400); res.end('bad json: '+e.message); }
    return;
  }

  // ── GET /api/ai/models — 모델 목록 반환 ─────────────────────
  if (req.method === 'GET' && url === '/api/ai/models') {
    try {
      const host   = process.env.OLLAMA_HOST   || 'http://localhost:11434';
      const apiKey = process.env.OLLAMA_API_KEY || '';
      const extraHeaders = apiKey ? { 'Authorization': 'Bearer ' + apiKey } : {};

      // Groq 사용 중이면 Groq 모델 목록 바로 반환 (Ollama 조회 불필요)
      const aiProvider = process.env.AI_PROVIDER || 'groq';
      if (aiProvider === 'groq' || _groqApiKey) {
        const groqModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
        res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
        res.end(JSON.stringify({ ok: true, models: [groqModel], provider: 'groq' }));
        return;
      }

      const json = await httpGetJSON(host + '/api/tags', extraHeaders, 10000);
      const models = (json.models || []).map(m => m.name || m.model || '').filter(Boolean);
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify({ ok: true, models }));
    } catch (e) {
      console.error('[AI/models] 모델 목록 조회 실패:', e.message);
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify({ ok: false, models: [], error: e.message }));
    }
    return;
  }

  // ── POST /api/ai/analyze — 선후행 공정 분석 + AI(Ollama/Claude) 코멘트 ──
  // body: { companyId, baseDate?(YYYY-MM-DD, 기본값 오늘), provider?('ollama'|'claude') }
  if (req.method === 'POST' && url === '/api/ai/analyze') {
    try {
      const body = await parseBody(req);
      const companyId = body.companyId;
      let proj;
      if (body.inlineProj && body.inlineProj.sections) { proj = body.inlineProj; }
      else { const d = body.site ? readSite(body.site) : readData(); proj = d.projects && d.projects[companyId]; }
      if (!proj) { res.writeHead(404, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false, msg:'프로젝트를 찾을 수 없습니다'})); return; }
      // ── 분석은 ai-core.js 단일 소스로 위임 (Pro: ai-server.js 와 동일) ──
      const out = await aiCore.analyze(proj, { baseDate: body.baseDate, provider: body.provider, apiKey: body.apiKey, site: body.site });
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify(out));
    } catch (e) {
      console.error("[AI/analyze] 오류:", e.message);
      res.writeHead(500, {"Content-Type":"application/json; charset=utf-8"});
      res.end(JSON.stringify({ ok: false, msg: "AI 분석 중 오류가 발생했습니다: " + e.message }));
    }
    return;
  }


  // ── POST /api/ai/meeting-agenda — P3-C 공정회의 안건 초안 자동 생성 ──
  if (req.method === 'POST' && url === '/api/ai/meeting-agenda') {
    try {
      const body = await parseBody(req);
      const companyId = body.companyId;
      const baseDate = body.baseDate || getKSTDateString(); // 한국 표준시(KST) 기준 오늘
      const reqProvider = body.provider;

      let proj;
      if (body.inlineProj && body.inlineProj.sections) {
        proj = body.inlineProj;
      } else {
        const d = body.site ? readSite(body.site) : readData();
        proj = d.projects && d.projects[companyId];
      }
      if (!proj) {
        res.writeHead(404, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false, msg:'프로젝트를 찾을 수 없습니다'}));
        return;
      }

      // 분석 데이터 준비
      const nodeMap = flattenNodes(proj.sections || []);
      const delays = computeDelays(nodeMap, baseDate);
      const conflicts = computeConflicts(nodeMap, proj.predLinks || []);
      const progressRate = computeOverallProgress(proj.sections || []);
      const planRate = computePlanRate(proj.sections || [], baseDate);
      const delaysWeighted = computeDelayWeights(delays, nodeMap, proj.predLinks || [], proj.sections || []);
      const tfAlerts = computeTfAlerts(nodeMap, proj.predLinks || [], baseDate);
      const blindSpots = computeBlindSpots(nodeMap, proj.predLinks || [], baseDate);
      const parallelCandidates = computeParallelCandidates(nodeMap, proj.predLinks || [], baseDate);
      const completionRiskScore = computeCompletionRiskScore(delaysWeighted, baseDate);
      const rateGap = Math.round((progressRate - planRate) * 10) / 10;

      const agendaPrompt = buildMeetingAgendaPrompt({
        baseDate, progressRate, planRate, rateGap,
        delaysWeighted, conflicts, tfAlerts, blindSpots,
        parallelCandidates, completionRiskScore,
        projectName: proj.projectName
      });

      const defaultProvider = process.env.AI_PROVIDER || 'groq';
      const primary = (['claude','ollama','groq'].includes(reqProvider)) ? reqProvider : defaultProvider;
      const fallbackOrder = ['groq','ollama','claude'].filter(p => p !== primary);
      const callP = name => name === 'claude'
        ? callClaudeApi('당신은 건설 공정관리 전문가입니다. 요청한 JSON만 출력하십시오.', agendaPrompt)
        : name === 'groq'
          ? callGroqApi('당신은 건설 공정관리 전문가입니다. 요청한 JSON만 출력하십시오.', agendaPrompt)
          : callOllama('당신은 건설 공정관리 전문가입니다. 요청한 JSON만 출력하십시오.', agendaPrompt);

      let agendaRaw = null, agendaError = null;
      try { agendaRaw = await callP(primary); }
      catch(e1) {
        try { agendaRaw = await callP(fallbackOrder[0]); }
        catch(e2) {
          try { agendaRaw = await callP(fallbackOrder[1]); }
          catch(e3) { agendaError = e3.message; }
        }
      }

      const agenda = agendaRaw ? (parseAiJson(agendaRaw) || { raw: agendaRaw.trim() }) : null;

      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify({
        ok: true, baseDate, progressRate, rateGap,
        completionRiskScore, parallelCandidates,
        agenda, agendaError
      }));
    } catch(e) {
      console.error("[AI/meeting-agenda] 오류:", e.message);
      res.writeHead(500, {"Content-Type":"application/json; charset=utf-8"});
      res.end(JSON.stringify({ ok: false, msg: "공정회의 안건 생성 중 오류: " + e.message }));
    }
    return;
  }

  // ── GET /api/admin/claude-key/status ─────────────────────────
  // 키 설정 여부만 반환 — 실제 키는 절대 브라우저로 내려보내지 않음
  if (req.method === 'GET' && url === '/api/admin/claude-key/status') {
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({
      set: !!_claudeApiKey,
      masked: _claudeApiKey ? ('sk-ant-...' + _claudeApiKey.slice(-4)) : '',
      groqSet: !!_groqApiKey,
      groqMasked: _groqApiKey ? ('gsk_...' + _groqApiKey.slice(-4)) : ''
    }));
    return;
  }

  // ── POST /api/admin/groq-key — Groq API Key 설정 ──────────────
  if (req.method === 'POST' && url === '/api/admin/groq-key') {
    try {
      const body = await parseBody(req);
      const { adminUserId, companyId, apiKey } = body;
      const a = loadAccounts();
      const adminUser = acctUser(a, adminUserId);
      if (!adminUser || (adminUser.role !== 'master' && adminUser.role !== 'manager')) {
        res.writeHead(403, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false, msg:'관리자 권한이 필요합니다'}));
        return;
      }
      _groqApiKey = (apiKey || '').trim();
      try{ aiCore.setKeys({ groq: _groqApiKey }); }catch(e){}
      const cfg = loadConfig();
      if (_groqApiKey) cfg.groqApiKey = _groqApiKey;
      else delete cfg.groqApiKey;
      saveConfig(cfg);
      console.log('[Groq] API Key ' + (_groqApiKey ? '설정됨 (...'+_groqApiKey.slice(-4)+')' : '삭제됨'));
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok:true, set: !!_groqApiKey}));
    } catch(e) { res.writeHead(400); res.end('bad json: ' + e.message); }
    return;
  }

  // ── POST /api/admin/claude-key ────────────────────────────────
  // body: { adminUserId, companyId, apiKey }
  // 관리자만 호출 가능. 키는 서버 메모리 + config.json에 저장, 브라우저에 반환 안 함
  if (req.method === 'POST' && url === '/api/admin/claude-key') {
    try {
      const body = await parseBody(req);
      const { adminUserId, companyId, apiKey } = body;

      // 관리자 권한 검증
      const a = loadAccounts();
      const adminUser = acctUser(a, adminUserId);
      if (!adminUser || (adminUser.role !== 'master' && adminUser.role !== 'manager')) {
        res.writeHead(403, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false, msg:'관리자 권한이 필요합니다'}));
        return;
      }

      // 메모리 업데이트
      _claudeApiKey = (apiKey || '').trim();
      try{ aiCore.setKeys({ claude: _claudeApiKey }); }catch(e){}

      // config.json 영구 저장
      const cfg = loadConfig();
      if (_claudeApiKey) cfg.claudeApiKey = _claudeApiKey;
      else delete cfg.claudeApiKey;
      saveConfig(cfg);

      console.log('[Claude] API Key ' + (_claudeApiKey ? '설정됨 (...'+_claudeApiKey.slice(-4)+')' : '삭제됨'));
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok:true, set: !!_claudeApiKey}));
    } catch(e) { res.writeHead(400); res.end('bad json: ' + e.message); }
    return;
  }

  // ════ 멀티현장 API (병렬 — 기존 엔드포인트 영향 없음) ════
  // POST /api/login2 — accounts.json 기반 로그인 → 접근가능 현장 반환
  if (req.method === 'POST' && url === '/api/login2') {
    try {
      const { userName, pw } = await parseBody(req);
      const a = loadAccounts();
      const user = (a.users || []).find(u => u.name === userName && u.pw === hpw(pw));
      if (!user) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false, msg:'이름 또는 비밀번호가 올바르지 않습니다'})); return; }
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify({ ok:true, user:{ id:user.id, name:user.name, role:user.role }, sites: sitesForUser(a, user).map(s => ({id:s.id, name:s.name})) }));
    } catch (e) { res.writeHead(400); res.end('bad json: ' + e.message); }
    return;
  }
  // GET /api/site/list?userId= — 접근 가능한 현장 목록
  if (req.method === 'GET' && url === '/api/site/list') {
    const params = new URLSearchParams(req.url.split('?')[1] || '');
    const a = loadAccounts();
    const u = acctUser(a, params.get('userId'));
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({ ok:true, role: u ? u.role : null, sites: sitesForUser(a, u).map(s => ({id:s.id, name:s.name, primaryCompanyId:s.primaryCompanyId||null})) }));
    return;
  }
  // GET /api/site/data?site=&userId= — 현장 데이터 (권한 검사)
  if (req.method === 'GET' && url === '/api/site/data') {
    const params = new URLSearchParams(req.url.split('?')[1] || '');
    const siteId = params.get('site');
    const a = loadAccounts();
    const u = acctUser(a, params.get('userId'));
    if (!userCanAccessSite(u, siteId)) { res.writeHead(403, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false, msg:'이 현장에 접근 권한이 없습니다'})); return; }
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({ ok:true, data: readSite(siteId) }));
    return;
  }
  // POST /api/site/data {site,userId,data} — 현장 데이터 저장 (권한 검사)
  if (req.method === 'POST' && url === '/api/site/data') {
    try {
      const { site, userId, data } = await parseBody(req);
      const a = loadAccounts();
      const u = acctUser(a, userId);
      if (!userCanAccessSite(u, site)) { res.writeHead(403, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false, msg:'권한 없음'})); return; }
      writeSite(site, { companies: (data && data.companies) || [], projects: (data && data.projects) || {} }, err => {
        if (err) { res.writeHead(500); res.end('error'); return; }
        let t = 0; try { t = fs.statSync(sitePath(site)).mtimeMs; } catch (e) {}
        wss.clients.forEach(ws => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({type:'reload', site, t})); });
        res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true, t}));
      });
    } catch (e) { res.writeHead(400); res.end('bad json: ' + e.message); }
    return;
  }

  // ════ 마스터 관리 API (master 전용) ════
  // GET /api/admin/overview?userId= → 전사 계정 + 현장 목록
  if (req.method === 'GET' && url === '/api/admin/overview') {
    const params = new URLSearchParams(req.url.split('?')[1] || '');
    const a = loadAccounts();
    if (!isMaster(a, params.get('userId'))) { res.writeHead(403, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'마스터 권한 필요'})); return; }
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({ ok:true,
      defaultManagerCode: a.defaultManagerCode||'',
      users: (a.users||[]).map(u => ({id:u.id, name:u.name, role:u.role, company:u.company||'', sites:u.sites||[]})),
      sites: (a.sites||[]).map(s => ({id:s.id, name:s.name, managerIds:s.managerIds||[], primaryCompanyId:s.primaryCompanyId||null})) }));
    return;
  }
  // POST /api/admin/user-add {userId, name, pw, role}
  if (req.method === 'POST' && url === '/api/admin/user-add') {
    try {
      const { userId, name, pw, role, adminCode, company } = await parseBody(req);
      const a = loadAccounts();
      if (!isMaster(a, userId)) { res.writeHead(403,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'마스터 권한 필요'})); return; }
      if (!name || !pw) { res.writeHead(400,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'이름/비번 필요'})); return; }
      if ((a.users||[]).find(u => u.name === name)) { res.writeHead(409,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'이미 있는 이름'})); return; }
      const _role = (['master','manager','staff'].includes(role)?role:'staff');
      const _ac = (_role==='manager') ? (a.defaultManagerCode ? hpw(a.defaultManagerCode) : (adminCode?hpw(adminCode):'')) : (adminCode ? hpw(adminCode) : '');
      const nu = { id: uid(), name, pw: hpw(pw), role: _role, company: (company||''), sites: [], adminCode: _ac };
      if (!a.users) a.users = []; a.users.push(nu);
      saveAccounts(a, err => { if(err){res.writeHead(500);res.end('error');return;} res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true, id:nu.id})); });
    } catch(e){ res.writeHead(400); res.end('bad json: '+e.message); }
    return;
  }
  // POST /api/admin/site-create {userId, name}
  if (req.method === 'POST' && url === '/api/admin/site-create') {
    try {
      const { userId, name } = await parseBody(req);
      const a = loadAccounts();
      if (!isMaster(a, userId)) { res.writeHead(403,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'마스터 권한 필요'})); return; }
      const sid = 'site_' + Date.now().toString(36);
      const coId = 'co_' + sid;
      writeSite(sid, { companies: [{ id: coId, name: (name||'원도급사') }], projects: { [coId]: mkProj(name||'원도급사') } }, () => {});
      if (!a.sites) a.sites = [];
      a.sites.push({ id: sid, name: name||sid, managerIds: [], primaryCompanyId: coId, createdAt: new Date().toISOString().slice(0,10) });
      saveAccounts(a, err => { if(err){res.writeHead(500);res.end('error');return;} try { siteFileDir(sid,'접수'); siteFileDir(sid,'보관'); siteBackupDir(sid); } catch(e) {} res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true, id:sid})); });
    } catch(e){ res.writeHead(400); res.end('bad json: '+e.message); }
    return;
  }
  // POST /api/admin/site-assign {userId, siteId, memberIds:[], managerIds:[]}
  if (req.method === 'POST' && url === '/api/admin/site-assign') {
    try {
      const { userId, siteId, memberIds, managerIds } = await parseBody(req);
      const a = loadAccounts();
      if (!isMaster(a, userId)) { res.writeHead(403,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'마스터 권한 필요'})); return; }
      const site = (a.sites||[]).find(s => s.id === siteId);
      if (!site) { res.writeHead(404,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'현장 없음'})); return; }
      site.managerIds = managerIds || [];
      const allow = new Set([...(memberIds||[]), ...(managerIds||[])]);
      (a.users||[]).forEach(u => {
        u.sites = u.sites || [];
        const has = u.sites.includes(siteId);
        if (allow.has(u.id) && !has) u.sites.push(siteId);
        if (!allow.has(u.id) && has) u.sites = u.sites.filter(x => x !== siteId);
      });
      saveAccounts(a, err => { if(err){res.writeHead(500);res.end('error');return;} res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true})); });
    } catch(e){ res.writeHead(400); res.end('bad json: '+e.message); }
    return;
  }

  if (req.method === 'POST' && url === '/api/account/verify-code') {
    try { const { userId, code } = await parseBody(req); const a = loadAccounts(); const u = acctUser(a, userId);
      const ok = !!u && (!u.adminCode || u.adminCode === hpw(code||''));
      res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok})); } catch(e){ res.writeHead(400); res.end('bad json'); } return;
  }
  if (req.method === 'POST' && url === '/api/account/set-code') {
    try { const { userId, code } = await parseBody(req); const a = loadAccounts(); const u = acctUser(a, userId);
      if (!u) { res.writeHead(404,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'계정 없음'})); return; }
      if (u.role === 'staff') { res.writeHead(403,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'권한 없음'})); return; }
      u.adminCode = code ? hpw(code) : '';
      saveAccounts(a, ()=>{ res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true})); }); } catch(e){ res.writeHead(400); res.end('bad json'); } return;
  }
  if (req.method === 'POST' && url === '/api/admin/site-rename') {
    try { const { userId, siteId, name } = await parseBody(req); const a = loadAccounts();
      if (!isMaster(a, userId)) { res.writeHead(403); res.end('{"ok":false}'); return; }
      const st = (a.sites||[]).find(s=>s.id===siteId); if(!st){res.writeHead(404);res.end('{"ok":false}');return;}
      const _ofn=((st.name||String(siteId)).replace(/[\/\\:*?"<>|]/g,'_').trim())||String(siteId);
      st.name = name || st.name;
      const _nfn=((st.name||String(siteId)).replace(/[\/\\:*?"<>|]/g,'_').trim())||String(siteId);
      try { if(_ofn!==_nfn){ const op=path.join(FILES_DIR,_ofn), np=path.join(FILES_DIR,_nfn); if(fs.existsSync(op)) fs.renameSync(op,np); const ob=path.join(BACKUP_DIR,_ofn), nb=path.join(BACKUP_DIR,_nfn); if(fs.existsSync(ob)) fs.renameSync(ob,nb); } } catch(e){}
      saveAccounts(a, ()=>{ res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true})); }); } catch(e){ res.writeHead(400); res.end('bad json'); } return;
  }
  if (req.method === 'POST' && url === '/api/admin/site-delete') {
    try { const { userId, siteId } = await parseBody(req); const a = loadAccounts();
      if (!isMaster(a, userId)) { res.writeHead(403); res.end('{"ok":false}'); return; }
      a.sites = (a.sites||[]).filter(s=>s.id!==siteId);
      (a.users||[]).forEach(u=>{ if(Array.isArray(u.sites)) u.sites=u.sites.filter(x=>x!==siteId); });
      try { fs.unlinkSync(sitePath(siteId)); } catch(e) {}
      saveAccounts(a, ()=>{ res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true})); }); } catch(e){ res.writeHead(400); res.end('bad json'); } return;
  }
  if (req.method === 'POST' && url === '/api/admin/user-rename') {
    try { const { userId, targetId, name, company } = await parseBody(req); const a = loadAccounts();
      if (!isMaster(a, userId)) { res.writeHead(403); res.end('{"ok":false}'); return; }
      const u = acctUser(a, targetId); if(!u){res.writeHead(404);res.end('{"ok":false}');return;}
      if (name && (a.users||[]).find(x=>x.name===name && x.id!==targetId)) { res.writeHead(409,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'이미 있는 이름'})); return; }
      if (name) u.name = name; if (company!==undefined) u.company = company; saveAccounts(a, ()=>{ res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true})); }); } catch(e){ res.writeHead(400); res.end('bad json'); } return;
  }
  if (req.method === 'POST' && url === '/api/admin/user-delete') {
    try { const { userId, targetId } = await parseBody(req); const a = loadAccounts();
      if (!isMaster(a, userId)) { res.writeHead(403); res.end('{"ok":false}'); return; }
      if (targetId === userId) { res.writeHead(400,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'본인 삭제 불가'})); return; }
      a.users = (a.users||[]).filter(u=>u.id!==targetId);
      (a.sites||[]).forEach(st=>{ if(Array.isArray(st.managerIds)) st.managerIds=st.managerIds.filter(x=>x!==targetId); });
      saveAccounts(a, ()=>{ res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true})); }); } catch(e){ res.writeHead(400); res.end('bad json'); } return;
  }
  if (req.method === 'GET' && url === '/api/site/members') {
    const params = new URLSearchParams(req.url.split('?')[1] || '');
    const siteId = params.get('site'); const a = loadAccounts();
    const u = acctUser(a, params.get('userId'));
    const site = (a.sites||[]).find(s=>s.id===siteId);
    const canManage = !!u && (u.role==='master' || (u.role==='manager' && (u.sites||[]).includes(siteId)));
    if (!canManage) { res.writeHead(403,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'권한 없음'})); return; }
    const members = (a.users||[]).filter(x=>(x.sites||[]).includes(siteId)).map(x=>({id:x.id,name:x.name,role:x.role,isManager:(site&&(site.managerIds||[]).includes(x.id))}));
    const unassigned = (a.users||[]).filter(x=>x.role!=='master' && (!x.sites||x.sites.length===0)).map(x=>({id:x.id,name:x.name,role:x.role}));
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify({ok:true, members, unassigned})); return;
  }
  if (req.method === 'POST' && url === '/api/site/add-staff') {
    try { const { userId, site, staffId } = await parseBody(req); const a = loadAccounts(); const u = acctUser(a, userId);
      const canManage = !!u && (u.role==='master' || (u.role==='manager' && (u.sites||[]).includes(site)));
      if (!canManage) { res.writeHead(403,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'권한 없음'})); return; }
      const t = acctUser(a, staffId); if(!t){res.writeHead(404);res.end('{"ok":false}');return;}
      t.sites = t.sites||[]; if(!t.sites.includes(site)) t.sites.push(site);
      saveAccounts(a, ()=>{ res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true})); }); } catch(e){ res.writeHead(400); res.end('bad json'); } return;
  }
  if (req.method === 'POST' && url === '/api/site/remove-staff') {
    try { const { userId, site, staffId } = await parseBody(req); const a = loadAccounts(); const u = acctUser(a, userId);
      const canManage = !!u && (u.role==='master' || (u.role==='manager' && (u.sites||[]).includes(site)));
      if (!canManage) { res.writeHead(403,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'권한 없음'})); return; }
      const t = acctUser(a, staffId); if(t && Array.isArray(t.sites)) t.sites=t.sites.filter(x=>x!==site);
      saveAccounts(a, ()=>{ res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true})); }); } catch(e){ res.writeHead(400); res.end('bad json'); } return;
  }

  if (req.method === 'POST' && url === '/api/admin/set-default-code') {
    try { const { userId, code } = await parseBody(req); const a = loadAccounts();
      if (!isMaster(a, userId)) { res.writeHead(403); res.end('{"ok":false}'); return; }
      a.defaultManagerCode = code||'';
      saveAccounts(a, ()=>{ res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true})); }); } catch(e){ res.writeHead(400); res.end('bad json'); } return;
  }

  // ── 현장 파일함 (접수/보관): 모든 구성원 업로드·조회·이동 ──
  if (req.method === 'POST' && url === '/api/files/upload') {
    try { const { userId, site, name, content, folder } = await parseBody(req); const a = loadAccounts(); const u = acctUser(a, userId);
      if (!userCanAccessSite(u, site)) { res.writeHead(403,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'권한 없음'})); return; }
      const fn = path.basename(String(name||('파일_'+Date.now()+'.json')));
      fs.writeFileSync(path.join(siteFileDir(site, folder==='보관'?'보관':'접수'), fn), content||'', 'utf8');
      res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true, name:fn}));
    } catch(e){ res.writeHead(400); res.end('bad json'); } return;
  }
  if (req.method === 'GET' && url === '/api/files/list') {
    const params = new URLSearchParams(req.url.split('?')[1]||''); const a = loadAccounts(); const u = acctUser(a, params.get('userId'));
    const site = params.get('site'), folder = params.get('folder');
    if (!userCanAccessSite(u, site)) { res.writeHead(403,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'권한 없음'})); return; }
    let files=[]; try { const dir=siteFileDir(site,folder); files=fs.readdirSync(dir).filter(f=>f.toLowerCase().endsWith('.json')).map(f=>{const st=fs.statSync(path.join(dir,f));return {name:f,size:st.size,mtime:st.mtimeMs};}).sort((x,y)=>y.mtime-x.mtime); } catch(e){}
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify({ok:true, files})); return;
  }
  if (req.method === 'GET' && url === '/api/files/get') {
    const params = new URLSearchParams(req.url.split('?')[1]||''); const a = loadAccounts(); const u = acctUser(a, params.get('userId'));
    const site=params.get('site'), folder=params.get('folder'), name=path.basename(String(params.get('name')||''));
    if (!userCanAccessSite(u, site)) { res.writeHead(403,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'권한 없음'})); return; }
    try { const content=fs.readFileSync(path.join(siteFileDir(site,folder), name),'utf8'); res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify({ok:true, name, content})); }
    catch(e){ res.writeHead(404,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'파일 없음'})); } return;
  }
  if (req.method === 'POST' && url === '/api/files/move') {
    try { const { userId, site, name, from, to } = await parseBody(req); const a = loadAccounts(); const u = acctUser(a, userId);
      if (!userCanAccessSite(u, site)) { res.writeHead(403,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'권한 없음'})); return; }
      const fn=path.basename(String(name||'')); const src=path.join(siteFileDir(site,from),fn); const dst=path.join(siteFileDir(site,to),fn);
      fs.renameSync(src,dst); res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true}));
    } catch(e){ res.writeHead(400,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:e.message})); } return;
  }
  if (req.method === 'POST' && url === '/api/files/delete') {
    try { const { userId, site, folder, name } = await parseBody(req); const a = loadAccounts(); const u = acctUser(a, userId);
      if (!userCanAccessSite(u, site)) { res.writeHead(403,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'권한 없음'})); return; }
      try { fs.unlinkSync(path.join(siteFileDir(site,folder), path.basename(String(name||'')))); } catch(e){}
      res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true}));
    } catch(e){ res.writeHead(400); res.end('bad json'); } return;
  }

  if (req.method === 'GET' && url === '/api/files/companies') {
    const params=new URLSearchParams(req.url.split('?')[1]||''); const a=loadAccounts(); const u=acctUser(a,params.get('userId')); const site=params.get('site');
    if(!userCanAccessSite(u,site)){ res.writeHead(403,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'권한 없음'})); return; }
    function rd(folder){ const out=[]; try{ const dir=siteFileDir(site,folder); fs.readdirSync(dir).filter(f=>f.toLowerCase().endsWith('.json')).forEach(f=>{ let company=''; try{ const d=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')); company=(d.companies&&d.companies[0]&&d.companies[0].name)||d.companyName||''; }catch(e){} if(!company) company=f.replace(/_배포.*$/,'').replace(/\.json$/i,''); out.push({file:f, company}); }); }catch(e){} return out; }
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify({ok:true, inbox:rd('접수'), archive:rd('보관')})); return;
  }

  if (req.method === 'POST' && url === '/api/backup/create') {
    try { const { userId, site } = await parseBody(req); const a=loadAccounts();
      if(!canBackup(a,userId,site)){ res.writeHead(403,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'권한 없음'})); return; }
      const r=_doBackup(site,'수동', (acctUser(a,userId)||{}).name||'');
      res.writeHead(r.ok?200:500,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(r));
    } catch(e){ res.writeHead(400); res.end('bad json'); } return;
  }
  if (req.method === 'GET' && url === '/api/backup/list') {
    const params=new URLSearchParams(req.url.split('?')[1]||''); const a=loadAccounts(); const site=params.get('site');
    if(!canBackup(a,params.get('userId'),site)){ res.writeHead(403,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'권한 없음'})); return; }
    let files=[]; try{ const dir=siteBackupDir(site); files=fs.readdirSync(dir).filter(f=>f.toLowerCase().endsWith('.json')).map(f=>{ const st=fs.statSync(path.join(dir,f)); return {name:f, size:st.size, mtime:st.mtimeMs, type:_backupType(f)}; }).sort((x,y)=>y.mtime-x.mtime); }catch(e){}
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify({ok:true, files, canDelete:isLocalReq(req)})); return;
  }
  if (req.method === 'GET' && url === '/api/backup/get') {
    const params=new URLSearchParams(req.url.split('?')[1]||''); const a=loadAccounts(); const site=params.get('site');
    if(!canBackup(a,params.get('userId'),site)){ res.writeHead(403,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'권한 없음'})); return; }
    try{ const content=fs.readFileSync(path.join(siteBackupDir(site), path.basename(String(params.get('name')||''))),'utf8'); res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify({ok:true, content})); }
    catch(e){ res.writeHead(404,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'파일 없음'})); } return;
  }
  if (req.method === 'POST' && url === '/api/backup/restore') {
    try { const { userId, site, name } = await parseBody(req); const a=loadAccounts();
      if(!canBackup(a,userId,site)){ res.writeHead(403,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'권한 없음'})); return; }
      const who=(acctUser(a,userId)||{}).name||'';
      _doBackup(site,'복원전', who); // 복원 직전 자동백업
      let snap; try{ snap=JSON.parse(fs.readFileSync(path.join(siteBackupDir(site), path.basename(String(name||''))),'utf8')); }catch(e){ res.writeHead(404,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'백업 파일 없음'})); return; }
      const data=readSite(site); const pid=snap.primaryId;
      if(pid && snap.projects && snap.projects[pid]){
        data.projects=data.projects||{}; data.projects[pid]=snap.projects[pid];
        data.companies=data.companies||[]; const c=data.companies.find(x=>x.id===pid);
        if(c){ if(snap.companies&&snap.companies[0]) c.name=snap.companies[0].name; } else if(snap.companies&&snap.companies[0]) data.companies.push(snap.companies[0]);
      }
      writeSite(site, data, err=>{ if(err){ res.writeHead(500); res.end('error'); return; }
        backupLog(site,{user:who,action:'복원',type:_backupType(String(name||'')),file:name});
        let t=0; try{ t=fs.statSync(sitePath(site)).mtimeMs; }catch(e){}
        wss.clients.forEach(ws=>{ if(ws.readyState===ws.OPEN) ws.send(JSON.stringify({type:'reload', site, t})); });
        res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true}));
      });
    } catch(e){ res.writeHead(400); res.end('bad json'); } return;
  }
  if (req.method === 'POST' && url === '/api/backup/delete') {
    try { const { userId, site, name } = await parseBody(req); const a=loadAccounts();
      if(!isLocalReq(req)){ res.writeHead(403,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'삭제는 서버 PC에서만 가능'})); return; }
      if(!canBackup(a,userId,site)){ res.writeHead(403,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,msg:'권한 없음'})); return; }
      try{ fs.unlinkSync(path.join(siteBackupDir(site), path.basename(String(name||'')))); }catch(e){}
      backupLog(site,{user:(acctUser(a,userId)||{}).name||'',action:'삭제',type:_backupType(String(name||'')),file:name});
      res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true}));
    } catch(e){ res.writeHead(400); res.end('bad json'); } return;
  }

  res.writeHead(404); res.end('not found');
});

// ── WebSocket ─────────────────────────────────────────────
const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  console.log('[WS] 접속 — 현재 '+wss.clients.size+'명');
  ws.send(JSON.stringify({type:'connected', clients: wss.clients.size}));
  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type === 'ping') ws.send(JSON.stringify({type:'pong'}));
    } catch {}
  });
  ws.on('close', () => console.log('[WS] 퇴장 — 현재 '+wss.clients.size+'명'));
  ws.on('error', (err) => console.error('[WS] 오류:', err.message));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('====================================');
  console.log(' MASTER SCHEDULE 서버 v5');
  console.log('====================================');
  console.log(' 내 PC 접속: http://localhost:'+PORT);
  console.log(' 직원 접속:  http://10.10.152.16:'+PORT);
  console.log('------------------------------------');
  console.log(' 종료: Ctrl + C');
  console.log('====================================');
});
