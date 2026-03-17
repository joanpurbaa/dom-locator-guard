// DOM Locator Guard — Dashboard Server
// Dijalankan via: npx dlg dashboard
// Otomatis baca .dlg/reports dari folder proyek user

const http = require('http');
const fs   = require('fs');
const path = require('path');

// REPORTS_DIR: dari env variable, atau otomatis dari folder proyek user
const PORT        = process.env.PORT || 3333;
const REPORTS_DIR = process.env.REPORTS_DIR
  || path.join(process.cwd(), '.dlg', 'reports');
const BASELINES_DIR = process.env.BASELINES_DIR
  || path.join(process.cwd(), '.dlg', 'baselines');

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
};

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data, null, 2));
}

function readJSONFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json') && !f.includes('.backup'))
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')); } catch { return null; } })
    .filter(Boolean);
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
    return res.end();
  }

  const url = req.url.split('?')[0];

  // API routes
  if (url === '/api/reports' && req.method === 'GET') {
    const reports = readJSONFiles(REPORTS_DIR)
      .sort((a, b) => (b.generatedAt || 0) - (a.generatedAt || 0));
    return json(res, reports);
  }

  if (url === '/api/baselines' && req.method === 'GET') {
    const baselines = readJSONFiles(BASELINES_DIR).map(s => ({
      featureName: s.featureName, url: s.url, timestamp: s.timestamp,
    }));
    return json(res, baselines);
  }

  if (url === '/api/status') {
    return json(res, {
      reportsDir:   REPORTS_DIR,
      baselinesDir: BASELINES_DIR,
      reportCount:  readJSONFiles(REPORTS_DIR).length,
      status: 'ok',
    });
  }

  // Static files — serve dari folder dashboard (tempat file ini berada)
  const dashboardDir = __dirname;
  let filePath = path.join(dashboardDir, url === '/' ? 'index.html' : url);

  if (!filePath.startsWith(dashboardDir)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  if (!fs.existsSync(filePath)) {
    filePath = path.join(dashboardDir, 'index.html');
  }

  const ext  = path.extname(filePath);
  const mime = MIME[ext] || 'text/plain';

  try {
    res.writeHead(200, { 'Content-Type': mime });
    res.end(fs.readFileSync(filePath));
  } catch {
    res.writeHead(500); res.end('Error');
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('  🛡  DOM Locator Guard — Dashboard');
  console.log('  ───────────────────────────────────────');
  console.log(`  URL      : http://localhost:${PORT}`);
  console.log(`  Reports  : ${REPORTS_DIR}`);
  console.log(`  Baselines: ${BASELINES_DIR}`);
  console.log('  ───────────────────────────────────────');
  console.log('  Ctrl+C untuk stop');
  console.log('');
});