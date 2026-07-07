/**
 * 자체 서명 HTTPS 인증서 생성기 (사내/사설망 전용)
 *
 * 실행:  node scripts/gen-cert.js
 * 결과:  certs/server.key  (개인키)
 *        certs/server.crt  (인증서)
 *
 * 왜 필요한가:
 *   브라우저의 "폴더 선택 저장"(File System Access API)은 보안 컨텍스트
 *   (https 또는 localhost)에서만 동작한다. 사내에서 http://서버IP 로 접속하면
 *   이 기능이 막혀 저장 위치를 매번 고를 수 없다. 서버를 HTTPS로 켜면 해결된다.
 *
 * 참고:
 *   사설망 전용 "자체 서명" 인증서이므로 브라우저가 첫 접속 시 "안전하지 않음"
 *   경고를 띄운다. "고급 > 계속 진행"으로 넘어가면 정상 사용된다.
 *   (자세한 안내는 HTTPS_설정.md)
 */
const fs   = require('fs');
const os   = require('os');
const path = require('path');

let selfsigned;
try {
  selfsigned = require('selfsigned');
} catch (e) {
  console.error('[cert] "selfsigned" 모듈이 없습니다. 먼저 설치하세요:');
  console.error('       npm install');
  process.exit(1);
}

// 이 PC의 모든 IPv4 주소를 수집 → 인증서 SAN(주체 대체 이름)에 넣는다.
// 그래야 localhost 뿐 아니라 사내 IP(예: 10.10.152.16)로 접속해도 인증서가 맞는다.
const ips = [];
const ifs = os.networkInterfaces();
for (const name of Object.keys(ifs)) {
  for (const ni of ifs[name] || []) {
    if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address);
  }
}

const altNames = [
  { type: 2, value: 'localhost' }, // type 2 = DNS
  { type: 7, ip: '127.0.0.1' },    // type 7 = IP
  ...ips.map(ip => ({ type: 7, ip })),
];

const attrs = [{ name: 'commonName', value: ips[0] || 'localhost' }];
const pems = selfsigned.generate(attrs, {
  keySize: 2048,
  days: 3650, // 10년
  algorithm: 'sha256',
  extensions: [{ name: 'subjectAltName', altNames }],
});

const outDir = path.join(__dirname, '..', 'certs');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'server.key'), pems.private, 'utf8');
fs.writeFileSync(path.join(outDir, 'server.crt'), pems.cert, 'utf8');

console.log('[cert] 생성 완료:');
console.log('       certs/server.key');
console.log('       certs/server.crt');
console.log('[cert] 인증서에 포함된 접속 주소: localhost, 127.0.0.1'
  + (ips.length ? ', ' + ips.join(', ') : ''));
console.log('[cert] 이제 서버를 다시 시작하면 자동으로 HTTPS로 실행됩니다.');
