// server.js — Zero-dependency dashboard server
// Jalankan: node server.js
// Buka:     http://localhost:3333

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT        = process.env.PORT || 3333;
const REPORTS_DIR = process.env.REPORTS_DIR
  || path.join(__dirname, '..', 'locator-guard-reports');
const BASELINES_DIR = process.env.BASELINES_DIR
  || path.join(__dirname, '..', 'locator-guard-baselines');

// ── MIME types ────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

// ── Helpers ───────────────────────────────────────────────────────────────

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data, null, 2));
}

function readJSONFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json') && !f.includes('.backup'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')); }
      catch { return null; }
    })
    .filter(Boolean);
}

// ── Route handlers ────────────────────────────────────────────────────────

function handleAPI(req, res) {
  const url = req.url.split('?')[0];

  // GET /api/reports — semua report JSON dari output dir
  if (url === '/api/reports' && req.method === 'GET') {
    const reports = readJSONFiles(REPORTS_DIR)
      .sort((a, b) => (b.generatedAt || 0) - (a.generatedAt || 0));
    return json(res, reports);
  }

  // GET /api/baselines — list baseline files
  if (url === '/api/baselines' && req.method === 'GET') {
    const baselines = readJSONFiles(BASELINES_DIR).map(s => ({
      featureName:  s.featureName,
      url:          s.url,
      timestamp:    s.timestamp,
      guardVersion: s.guardVersion,
    }));
    return json(res, baselines);
  }

  // DELETE /api/baselines?name=X
  if (url === '/api/baselines' && req.method === 'DELETE') {
    const name = new URL(req.url, `http://localhost`).searchParams.get('name');
    if (!name) return json(res, { error: 'name param required' }, 400);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const file = path.join(BASELINES_DIR, `${slug}.baseline.json`);
    if (fs.existsSync(file)) { fs.unlinkSync(file); return json(res, { deleted: true }); }
    return json(res, { deleted: false }, 404);
  }

  // GET /api/status
  if (url === '/api/status' && req.method === 'GET') {
    const reports  = readJSONFiles(REPORTS_DIR);
    const baselines = readJSONFiles(BASELINES_DIR);
    return json(res, {
      reportsDir:   REPORTS_DIR,
      baselinesDir: BASELINES_DIR,
      reportCount:  reports.length,
      baselineCount: baselines.length,
      status: 'ok',
    });
  }

  return json(res, { error: 'Not found' }, 404);
}

// ── Main server ───────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,DELETE', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  // API routes
  if (req.url.startsWith('/api/')) return handleAPI(req, res);

  // Static files — serve from dashboard directory
  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);

  // Security: prevent path traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403); return res.end('Forbidden');
  }

  if (!fs.existsSync(filePath)) {
    // Fallback to index.html for SPA routing
    filePath = path.join(__dirname, 'index.html');
  }

  const ext  = path.extname(filePath);
  const mime = MIME[ext] || 'text/plain';

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(content);
  } catch {
    res.writeHead(500); res.end('Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('  🛡  DOM Locator Guard Dashboard');
  console.log('  ─────────────────────────────────────');
  console.log(`  URL         : http://localhost:${PORT}`);
  console.log(`  Reports dir : ${REPORTS_DIR}`);
  console.log(`  Baselines   : ${BASELINES_DIR}`);
  console.log('  ─────────────────────────────────────');
  console.log('  Press Ctrl+C to stop');
  console.log('');
});
