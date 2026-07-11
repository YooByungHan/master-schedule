/**
 * youtube-gate.js — YouTube 구독 게이트 (Device Flow) 공용 모듈
 *
 * Pro(Electron 내장 실행)와 Server(사내 LAN) 양쪽에서 동일하게 사용한다.
 * 차이는 저장 경로(storePath)와 자격증명 소스뿐 — 로직은 100% 동일.
 *
 * 세션 저장은 SQLite 대신 JSON 파일로 구현했다(요청 스펙의 테이블 구조를
 * 필드 그대로 유지). 이유: Electron이 내장하는 Node 버전은 `node:sqlite`
 * (Node 22.5+ 실험적 기능)를 지원하지 않고, `better-sqlite3` 같은 네이티브
 * 모듈은 electron-builder 패키징 시 ABI 재빌드 문제를 일으킨다. 이 저장소는
 * 원래도 SQLite 없이 JSON 파일로만 데이터를 다뤄왔으므로(README/CLAUDE.md
 * 참고) 그 방식과도 일관된다.
 *
 * 세션 레코드(요청 스펙의 sessions 테이블과 동일한 필드):
 *   { session_id, google_account_id, refresh_token, subscribed,
 *     trial_started_at, last_checked_at }
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GOOGLE_DEVICE_CODE_URL = 'https://oauth2.googleapis.com/device/code';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const YOUTUBE_SUBSCRIPTIONS_URL = 'https://www.googleapis.com/youtube/v3/subscriptions';
const SCOPE = 'openid https://www.googleapis.com/auth/youtube.readonly';

const DAY_MS = 24 * 60 * 60 * 1000;

// 채널 소유자 예외: 이 목록의 google_account_id는 구독 여부 확인 없이 항상 통과한다.
// 우선순위: createYoutubeGate({ownerAccountIds}) 명시 > 환경변수 OWNER_ACCOUNT_IDS(콤마구분) > 기본값.
// 향후 소유자가 여러 명이면 환경변수(OWNER_ACCOUNT_IDS="id1,id2") 또는 ownerAccountIds 배열에 추가하면 된다.
const DEFAULT_OWNER_ACCOUNT_IDS = ['114743380484253120154']; // 채널 소유자 본인 계정
function resolveOwnerAccountIds(opts) {
  if (Array.isArray(opts.ownerAccountIds) && opts.ownerAccountIds.length) return opts.ownerAccountIds;
  const envVal = process.env.OWNER_ACCOUNT_IDS;
  if (envVal) return envVal.split(',').map((s) => s.trim()).filter(Boolean);
  return DEFAULT_OWNER_ACCOUNT_IDS;
}

function httpJson(url, { method = 'GET', headers = {}, form, json } = {}) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    let body = null;
    const h = Object.assign({}, headers);
    if (form) {
      body = new URLSearchParams(form).toString();
      h['Content-Type'] = 'application/x-www-form-urlencoded';
      h['Content-Length'] = Buffer.byteLength(body);
    } else if (json) {
      body = JSON.stringify(json);
      h['Content-Type'] = 'application/json';
      h['Content-Length'] = Buffer.byteLength(body);
    }
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method, headers: h,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function nowIso() { return new Date().toISOString(); }
function daysSince(iso) { if (!iso) return Infinity; return (Date.now() - new Date(iso).getTime()) / DAY_MS; }
function hoursSince(iso) { if (!iso) return Infinity; return (Date.now() - new Date(iso).getTime()) / (60 * 60 * 1000); }

/**
 * @param {object} opts
 * @param {string} opts.storePath   세션 JSON 파일 경로 (폴더는 자동 생성)
 * @param {() => {clientId:string, clientSecret:string}} opts.getCreds
 * @param {string} opts.channelId  구독 확인 대상 채널 ID
 * @param {number} [opts.trialDays=30]
 * @param {number} [opts.cacheHours=6]
 */
function createYoutubeGate(opts) {
  const storePath = opts.storePath;
  const getCreds = opts.getCreds;
  const channelId = opts.channelId;
  const trialDays = opts.trialDays || 30;
  const cacheHours = opts.cacheHours != null ? opts.cacheHours : 6;
  const ownerAccountIds = resolveOwnerAccountIds(opts);
  const isOwner = (googleAccountId) => !!googleAccountId && ownerAccountIds.includes(googleAccountId);

  let writing = false;
  const writeQueue = [];
  function loadStore() {
    try { return JSON.parse(fs.readFileSync(storePath, 'utf8')); }
    catch (e) { return { byAccount: {}, sessions: {} }; }
  }
  function flushQueue() {
    if (writing || !writeQueue.length) return;
    writing = true;
    const data = writeQueue.shift();
    try { fs.mkdirSync(path.dirname(storePath), { recursive: true }); } catch (e) {}
    // 임시파일에 먼저 쓰고 rename으로 교체 — rename은 원자적이라, 동시에 loadStore()가
    // 읽어도 "쓰다 만 파일"을 볼 일이 없다(쓰기 도중 읽기 경합으로 세션이 사라지는 문제 방지).
    const tmp = storePath + '.tmp';
    fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8', (err) => {
      if (err) { writing = false; flushQueue(); return; }
      fs.rename(tmp, storePath, () => { writing = false; flushQueue(); });
    });
  }
  function saveStore(data) { writeQueue.push(data); flushQueue(); }

  // ── Device Flow 시작: Google에 device_code 요청 ──
  async function startDeviceFlow() {
    const { clientId } = getCreds();
    const r = await httpJson(GOOGLE_DEVICE_CODE_URL, { method: 'POST', form: { client_id: clientId, scope: SCOPE } });
    if (r.status !== 200) throw new Error('device_code 요청 실패: ' + JSON.stringify(r.data));
    return {
      deviceCode: r.data.device_code,
      userCode: r.data.user_code,
      verificationUrl: r.data.verification_url || r.data.verification_uri,
      expiresIn: r.data.expires_in,
      interval: r.data.interval || 5,
    };
  }

  // ── Device Flow 폴링 1회 (호출부가 interval 간격을 지켜서 반복 호출) ──
  // 반환: {status:'pending'|'slow_down'|'expired'|'denied'|'complete', session?, trialDaysLeft?}
  async function pollDeviceFlow(deviceCode) {
    const { clientId, clientSecret } = getCreds();
    const r = await httpJson(GOOGLE_TOKEN_URL, {
      method: 'POST',
      form: {
        client_id: clientId, client_secret: clientSecret, device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      },
    });
    if (r.status === 200 && r.data.access_token) {
      const session = await completeAuth(r.data.access_token, r.data.refresh_token);
      return Object.assign({ status: 'complete' }, session);
    }
    const err = (r.data && r.data.error) || '';
    if (err === 'authorization_pending') return { status: 'pending' };
    if (err === 'slow_down') return { status: 'slow_down' };
    if (err === 'expired_token') return { status: 'expired' };
    if (err === 'access_denied') return { status: 'denied' };
    return { status: 'pending' };
  }

  // ── 인증 완료 처리: sub 조회 → 구독 확인 → 세션 생성/갱신 ──
  async function completeAuth(accessToken, refreshToken) {
    const who = await httpJson(GOOGLE_USERINFO_URL, { headers: { Authorization: 'Bearer ' + accessToken } });
    const googleAccountId = who.data && who.data.sub;
    if (!googleAccountId) throw new Error('구글 계정 식별 실패(sub 없음)');
    const subscribed = await checkSubscription(accessToken);

    const store = loadStore();
    let sessionId = store.byAccount[googleAccountId];
    const isNew = !sessionId;
    if (isNew) sessionId = crypto.randomUUID();
    const prev = store.sessions[sessionId] || {};
    store.sessions[sessionId] = {
      session_id: sessionId,
      google_account_id: googleAccountId,
      // refresh_token은 최초 인증 시에만 발급됨 — 재인증 시 Google이 안 줄 수 있어 기존 값 보존
      refresh_token: refreshToken || prev.refresh_token || null,
      subscribed,
      // UNIQUE 제약 취지: 같은 계정이면 기존 trial_started_at을 그대로 유지(재시작 방지)
      trial_started_at: prev.trial_started_at || nowIso(),
      last_checked_at: nowIso(),
    };
    store.byAccount[googleAccountId] = sessionId;
    saveStore(store);

    return gateResultFor(store.sessions[sessionId]);
  }

  async function checkSubscription(accessToken) {
    const url = `${YOUTUBE_SUBSCRIPTIONS_URL}?part=snippet&mine=true&forChannelId=${encodeURIComponent(channelId)}`;
    const r = await httpJson(url, { headers: { Authorization: 'Bearer ' + accessToken } });
    if (r.status !== 200) return false;
    return Array.isArray(r.data.items) && r.data.items.length > 0;
  }

  async function refreshAccessToken(refreshToken) {
    const { clientId, clientSecret } = getCreds();
    const r = await httpJson(GOOGLE_TOKEN_URL, {
      method: 'POST',
      form: { client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' },
    });
    if (r.status !== 200 || !r.data.access_token) return null;
    return r.data.access_token;
  }

  function gateResultFor(session) {
    const trialDaysLeft = Math.max(0, Math.ceil(trialDays - daysSince(session.trial_started_at)));
    // 이미 구독 중이면 체험판 기간이 남아 있어도 'trial'이 아니라 'subscribed'로 알려야
    // 클라이언트의 체험판 배너가 즉시 사라진다(구독자에게 "체험판 D-n일" 표시되는 버그 방지).
    if (session.subscribed) {
      return { allowed: true, reason: 'subscribed', trialDaysLeft, subscribed: true, sessionId: session.session_id };
    }
    if (trialDaysLeft > 0) {
      return { allowed: true, reason: 'trial', trialDaysLeft, subscribed: false, sessionId: session.session_id };
    }
    return { allowed: false, reason: 'blocked', trialDaysLeft: 0, subscribed: false, sessionId: session.session_id };
  }

  // ── 게이트 확인 (미들웨어에서 매 요청/앱시작 시 호출) ──
  // 체험판 기간 이내 → 통과. 종료 후에는 6시간 캐시, 만료 시 refresh_token으로 조용히 재검증.
  async function checkGate(sessionId) {
    if (!sessionId) return { allowed: false, reason: 'no_session' };
    const store = loadStore();
    const session = store.sessions[sessionId];
    if (!session) return { allowed: false, reason: 'no_session' };

    // 채널 소유자는 구독 확인 없이 즉시 통과
    if (isOwner(session.google_account_id)) {
      return { allowed: true, reason: 'owner', trialDaysLeft: null, subscribed: true };
    }

    // 구독 중이거나 체험판 기간 이내면 즉시 통과(구독 중이면 'subscribed'로 응답해
    // 클라이언트 체험판 배너가 뜨지 않도록 한다 — gateResultFor()와 동일 규칙).
    if (session.subscribed) {
      const trialDaysLeft = Math.max(0, Math.ceil(trialDays - daysSince(session.trial_started_at)));
      return { allowed: true, reason: 'subscribed', trialDaysLeft, subscribed: true };
    }
    const trialDaysLeft = Math.max(0, Math.ceil(trialDays - daysSince(session.trial_started_at)));
    if (trialDaysLeft > 0) {
      return { allowed: true, reason: 'trial', trialDaysLeft, subscribed: false };
    }
    if (hoursSince(session.last_checked_at) < cacheHours) {
      return { allowed: false, reason: 'cache', trialDaysLeft: 0, subscribed: false };
    }
    return forceRecheck(sessionId);
  }

  // ── 캐시 무시하고 즉시 재검증 ("지금 구독 확인하기" 버튼) ──
  async function forceRecheck(sessionId) {
    const store = loadStore();
    const session = store.sessions[sessionId];
    if (!session) return { allowed: false, reason: 'no_session' };

    // 채널 소유자는 구독 확인 없이 즉시 통과 (refresh_token 호출 자체를 생략)
    if (isOwner(session.google_account_id)) {
      return { allowed: true, reason: 'owner', trialDaysLeft: null, subscribed: true };
    }

    if (!session.refresh_token) {
      session.last_checked_at = nowIso();
      saveStore(store);
      return { allowed: false, reason: 'no_refresh_token', trialDaysLeft: 0, subscribed: false };
    }
    const accessToken = await refreshAccessToken(session.refresh_token);
    const subscribed = accessToken ? await checkSubscription(accessToken) : false;
    session.subscribed = subscribed;
    session.last_checked_at = nowIso();
    saveStore(store);
    const trialDaysLeft = Math.max(0, Math.ceil(trialDays - daysSince(session.trial_started_at)));
    if (subscribed) return { allowed: true, reason: 'subscribed', trialDaysLeft, subscribed: true };
    if (trialDaysLeft > 0) return { allowed: true, reason: 'trial', trialDaysLeft, subscribed: false };
    return { allowed: false, reason: 'blocked', trialDaysLeft: 0, subscribed: false };
  }

  return { startDeviceFlow, pollDeviceFlow, checkGate, forceRecheck };
}

module.exports = { createYoutubeGate };
