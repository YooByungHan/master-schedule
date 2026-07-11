/**
 * CI 전용: electron-builder가 만든 draft GitHub Release의 "제목(name)"만 바꾼다.
 * 태그(vX.Y.Z)는 electron-updater가 semver로 파싱해야 하므로 절대 건드리지 않는다 —
 * 화면에 보이는 제목만 "Terminus MasterSchedule Pro/Server vX.Y.Z"로 바꿔서
 * GitHub Releases 목록에서 두 앱을 한눈에 구분할 수 있게 한다.
 *
 * 사용: node scripts/set-release-name.js <label> <version>
 *   label: "Pro" | "Server"
 *   env: GH_TOKEN, GH_REPO(owner/repo) 필요
 */
const https = require('https');

const [, , label, version] = process.argv;
if (!label || !version) {
  console.error('사용법: node set-release-name.js <label> <version>');
  process.exit(1);
}

const token = process.env.GH_TOKEN;
const [owner, repo] = String(process.env.GH_REPO || '').split('/');
const tag = 'v' + version;

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.github.com',
        path,
        method,
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'terminus-release-namer',
          'Content-Type': 'application/json',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, json: data ? JSON.parse(data) : null }));
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  // electron-builder가 방금 만든 release가 목록 API에 바로 안 잡히는 경우가 있어
  // (GitHub 쪽 반영 지연) 몇 초 간격으로 재시도한다.
  let rel = null;
  for (let attempt = 1; attempt <= 5 && !rel; attempt++) {
    const list = await api('GET', `/repos/${owner}/${repo}/releases?per_page=30`);
    rel = (list.json || []).find((r) => r.tag_name === tag);
    if (!rel && attempt < 5) {
      console.log(`릴리즈를 아직 못 찾음(태그: ${tag}, 시도 ${attempt}/5) — 3초 후 재시도`);
      await sleep(3000);
    }
  }
  if (!rel) {
    console.log(`릴리즈를 찾지 못함(태그: ${tag}) — 건너뜀`);
    return;
  }
  const name = `Terminus MasterSchedule ${label} v${version}`;
  const upd = await api('PATCH', `/repos/${owner}/${repo}/releases/${rel.id}`, { name });
  console.log('release name 설정:', upd.status, name);
})();
