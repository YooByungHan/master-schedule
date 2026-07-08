/**
 * 자체 서명 HTTPS 인증서 생성 로직 (사내/사설망 전용).
 * scripts/gen-cert.js(CLI)와 server-app/main.js(Server EXE 트레이 메뉴)가 공용으로 쓴다.
 *
 * 왜 필요한가:
 *   브라우저의 "폴더 선택 저장"(File System Access API)은 보안 컨텍스트
 *   (https 또는 localhost)에서만 동작한다. 사내에서 http://서버IP 로 접속하면
 *   이 기능이 막혀 저장 위치를 매번 고를 수 없다. 서버를 HTTPS로 켜면 해결된다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

// outDir: 인증서(server.key/server.crt)를 저장할 폴더(certs/ 자체 경로, 그 상위 아님)
// 반환: { ips: string[] } — 인증서에 포함된 사내 IP 목록(안내 문구용)
function generateCert(outDir) {
  const selfsigned = require('selfsigned');

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
    ...ips.map((ip) => ({ type: 7, ip })),
  ];

  const attrs = [{ name: 'commonName', value: ips[0] || 'localhost' }];
  const pems = selfsigned.generate(attrs, {
    keySize: 2048,
    days: 3650, // 10년
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames }],
  });

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'server.key'), pems.private, 'utf8');
  fs.writeFileSync(path.join(outDir, 'server.crt'), pems.cert, 'utf8');

  return { ips };
}

module.exports = { generateCert };
