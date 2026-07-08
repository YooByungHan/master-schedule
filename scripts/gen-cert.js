/**
 * 자체 서명 HTTPS 인증서 생성기 (CLI) — 실제 로직은 cert-gen.js 공용 모듈 사용.
 *
 * 실행:  node scripts/gen-cert.js
 * 결과:  certs/server.key  (개인키)
 *        certs/server.crt  (인증서)
 *
 * 참고:
 *   사설망 전용 "자체 서명" 인증서이므로 브라우저가 첫 접속 시 "안전하지 않음"
 *   경고를 띄운다. "고급 > 계속 진행"으로 넘어가면 정상 사용된다.
 *   (자세한 안내는 HTTPS_설정.md)
 */
const path = require('path');

let generateCert;
try {
  ({ generateCert } = require('../cert-gen'));
} catch (e) {
  console.error('[cert] cert-gen.js 로드 실패:', e.message);
  process.exit(1);
}

let result;
try {
  result = generateCert(path.join(__dirname, '..', 'certs'));
} catch (e) {
  console.error('[cert] "selfsigned" 모듈이 없을 수 있습니다. 먼저 설치하세요:');
  console.error('       npm install');
  console.error('[cert] 오류:', e.message);
  process.exit(1);
}

console.log('[cert] 생성 완료:');
console.log('       certs/server.key');
console.log('       certs/server.crt');
console.log('[cert] 인증서에 포함된 접속 주소: localhost, 127.0.0.1'
  + (result.ips.length ? ', ' + result.ips.join(', ') : ''));
console.log('[cert] 이제 서버를 다시 시작하면 자동으로 HTTPS로 실행됩니다.');
