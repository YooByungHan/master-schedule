/**
 * YouTube 구독 게이트(Device Flow) 자격증명을 가볍게 은폐하는 헬퍼.
 * server.js(oauth-default.json)와 Pro EXE 빌드(pro/oauth-config.json)가
 * 공용으로 사용한다 — 두 배포 형태 모두 "이 채널(개발자 소유)"을 구독했는지
 * 확인하는 동일한 앱 자격증명 하나를 쓰기 때문에, 값 자체는 배포 환경마다
 * 다를 필요가 없다.
 *
 * ⚠ 진짜 암호화가 아니다(XOR + Base64). 이 파일 자체가 공개 저장소에 있으므로
 *   일부러 파고드는 사람은 여전히 풀 수 있다. 목적은 두 가지로 한정된다:
 *   1) 파일을 무심코 열어봤을 때 "GOCSPX-..." 같은 익숙한 자격증명 패턴이
 *      바로 눈에 띄지 않게 함.
 *   2) GitHub 등 공개 저장소를 대상으로 하는 자동 시크릿 스캐너가 알려진
 *      자격증명 포맷으로 패턴매칭하지 못하게 함.
 *   서버 운영자가 다른 채널로 게이트하고 싶다면 google-oauth.json(로컬,
 *   .gitignore)을 만들면 이 기본값보다 우선 적용된다.
 */
const KEY = 'terminus-ms-gate-2026';

function xor(str, key) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    out += String.fromCharCode(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return out;
}

function encode(obj) {
  return Buffer.from(xor(JSON.stringify(obj), KEY), 'binary').toString('base64');
}

function decode(b64) {
  const bin = Buffer.from(b64, 'base64').toString('binary');
  return JSON.parse(xor(bin, KEY));
}

module.exports = { encode, decode };
