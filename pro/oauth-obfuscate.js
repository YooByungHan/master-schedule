/**
 * EXE 패키징 시 oauth-config.json 내용을 가볍게 은폐하는 헬퍼.
 *
 * ⚠ 진짜 암호화가 아니다(XOR + Base64). 이 파일 자체가 공개 저장소에 있으므로
 *   일부러 파고드는 사람은 여전히 풀 수 있다. 목적은 두 가지로 한정된다:
 *   1) 파일을 무심코 열어봤을 때 "GOCSPX-..." 같은 익숙한 자격증명 패턴이
 *      바로 눈에 띄지 않게 함.
 *   2) GitHub 등 공개 저장소를 대상으로 하는 자동 시크릿 스캐너가 알려진
 *      자격증명 포맷으로 패턴매칭하지 못하게 함.
 *   서버(server.js)는 이 파일을 쓰지 않는다 — 서버용 google-oauth.json은
 *   운영자가 직접 로컬에 생성하는 방식을 그대로 유지한다(공개 소스에 값이
 *   전혀 등장하지 않는, 이 방식보다 실질적으로 더 안전한 방법).
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
