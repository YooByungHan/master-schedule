/**
 * ai-server.js — Pro 사용자용 초경량 AI 분석 서버
 * 실행: node ai-server.js   (기본 포트 3100, AI_PORT 로 변경 가능)
 * 데이터는 브라우저가 inlineProj 로 전송, 개인 API 키도 요청에 포함(로컬 보관).
 * 서버(Enterprise)와 동일한 ai-core.js 를 사용 → 분석 결과 100% 동일.
 */
const http = require('http');
const aiCore = require('./ai-core');
const fs = require('fs');
const path = require('path');

aiCore.ensurePromptFiles();  // 최초 실행 시 prompts/Groq·Claude 지시서 자동 생성

const PORT = process.env.AI_PORT || 3100;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = req.url.split('?')[0];

  if (req.method === 'GET' && url === '/api/version') {
    let _v=''; try { _v = require('./package.json').version || ''; } catch(e) {}
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify({ version:_v }));
    return;
  }
  if (req.method === 'GET' && url === '/api/template') {
    // 템플릿: template/ 우선, 없으면 루트에서 탐색(패키징 환경 대응)
    const _cands = [ path.join(__dirname,'template','마스터공정표_간트차트_템플릿.xlsb'),
                     path.join(__dirname,'마스터공정표_간트차트_템플릿.xlsb') ];
    const _f = _cands.find(p=>{ try{ return fs.existsSync(p); }catch(e){ return false; } });
    if (_f) { res.writeHead(200, {'Content-Type':'application/vnd.ms-excel.sheet.binary.macroEnabled.12', 'Access-Control-Allow-Origin':'*'}); res.end(fs.readFileSync(_f)); }
    else { res.writeHead(404); res.end('template not found'); }
    return;
  }
  if (req.method === 'GET' && (url === '/' || url === '/health')) {
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({ ok:true, service:'ai-server', msg:'POST /api/ai/analyze {inlineProj, baseDate, provider, apiKey}' }));
    return;
  }

  if (req.method === 'POST' && url === '/api/ai/analyze') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const proj = (body.inlineProj && body.inlineProj.sections) ? body.inlineProj : null;
        if (!proj) { res.writeHead(400, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify({ok:false, msg:'inlineProj(공정 데이터)가 필요합니다'})); return; }
        const out = await aiCore.analyze(proj, { baseDate: body.baseDate, provider: body.provider, apiKey: body.apiKey, lang: body.lang });
        res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
        res.end(JSON.stringify(out));
      } catch (e) {
        console.error('[ai-server] 오류:', e.message);
        res.writeHead(500, {'Content-Type':'application/json; charset=utf-8'});
        res.end(JSON.stringify({ ok:false, msg:'AI 분석 오류: ' + e.message }));
      }
    });
    return;
  }

  res.writeHead(404, {'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify({ ok:false, msg:'AI 분석 서버 — POST /api/ai/analyze 만 지원' }));
});

server.listen(PORT, () => {
  console.log('====================================');
  console.log(' Pro AI 분석 서버 (ai-server.js)');
  console.log(' 주소: http://localhost:' + PORT);
  console.log(' 엔드포인트: POST /api/ai/analyze');
  console.log('====================================');
});
