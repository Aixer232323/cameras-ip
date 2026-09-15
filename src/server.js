#!/usr/bin/env node
'use strict';

const http = require('http');
const { spawn } = require('child_process');
const { onvifDiscovery } = require('./discovery');
const { getDeviceInformation, getRtspUri } = require('./onvif');

const PORT = process.env.PORT || 3000;
const ONVIF_USER = process.env.ONVIF_USER;
const ONVIF_PASS = process.env.ONVIF_PASS;
const DISCOVERY_CACHE_MS = 30000;

let discoveryCache = { time: 0, results: null };

async function getOnvifResultsCached() {
  const now = Date.now();
  if (discoveryCache.results && now - discoveryCache.time < DISCOVERY_CACHE_MS) {
    return discoveryCache.results;
  }
  const results = await onvifDiscovery();
  discoveryCache = { time: now, results };
  return results;
}

function withCredentials(rtspUri, username, password) {
  if (!username || !password) return rtspUri;
  const match = rtspUri.match(/^(rtsp:\/\/)(.*)$/i);
  if (!match) return rtspUri;
  return `${match[1]}${encodeURIComponent(username)}:${encodeURIComponent(password)}@${match[2]}`;
}

async function discoverCameras() {
  const onvifResults = await getOnvifResultsCached();
  const cameras = [];
  for (const [ip, { xaddr }] of onvifResults) {
    if (!xaddr) continue;
    const camera = { ip, xaddr };
    try {
      Object.assign(camera, await getDeviceInformation(xaddr, ONVIF_USER, ONVIF_PASS));
    } catch (err) {
      camera.error = err.message;
    }
    cameras.push(camera);
  }
  return cameras;
}

function streamMjpeg(rtspUri, res) {
  const ffmpeg = spawn('ffmpeg', [
    '-rtsp_transport', 'tcp',
    '-i', rtspUri,
    '-f', 'mpjpeg',
    '-q:v', '5',
    '-r', '10',
    'pipe:1',
  ]);

  res.setHeader('Content-Type', 'multipart/x-mixed-replace; boundary=ffmpeg');
  res.setHeader('Cache-Control', 'no-cache');

  ffmpeg.stdout.pipe(res);
  ffmpeg.stderr.resume();

  const cleanup = () => {
    if (!ffmpeg.killed) ffmpeg.kill('SIGKILL');
  };
  res.on('close', cleanup);
  ffmpeg.on('error', cleanup);
}

const INDEX_HTML = `<!doctype html>
<html lang="ca">
<head>
<meta charset="utf-8">
<title>Cameres IP</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; background: #111; color: #eee; }
  h1 { margin-bottom: 1rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.5rem; }
  .card { background: #1c1c1c; border-radius: 8px; overflow: hidden; }
  .card img { width: 100%; display: block; background: #000; aspect-ratio: 16/9; object-fit: contain; }
  .card .info { padding: 0.75rem 1rem; }
  .card h2 { margin: 0 0 0.25rem; font-size: 1rem; }
  .card p { margin: 0.1rem 0; font-size: 0.85rem; color: #aaa; }
  .status { padding: 1rem; color: #aaa; }
</style>
</head>
<body>
<h1>Cameres IP</h1>
<div id="status" class="status">Cercant cameres...</div>
<div id="grid" class="grid"></div>
<script>
async function load() {
  const status = document.getElementById('status');
  const grid = document.getElementById('grid');
  try {
    const res = await fetch('/api/cameras');
    const cameras = await res.json();
    if (cameras.length === 0) {
      status.textContent = "No s'ha trobat cap camera ONVIF a la xarxa.";
      return;
    }
    status.remove();
    for (const cam of cameras) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML =
        '<img loading="lazy" src="/stream/' + encodeURIComponent(cam.ip) + '" alt="' + cam.ip + '">' +
        '<div class="info">' +
        '<h2>' + cam.ip + '</h2>' +
        '<p>' + (cam.manufacturer || '-') + ' ' + (cam.model || '') + '</p>' +
        (cam.error ? '<p style="color:#f66">' + cam.error + '</p>' : '') +
        '</div>';
      grid.appendChild(card);
    }
  } catch (err) {
    status.textContent = 'Error carregant cameres: ' + err.message;
  }
}
load();
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/' && req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(INDEX_HTML);
    return;
  }

  if (url.pathname === '/api/cameras' && req.method === 'GET') {
    try {
      const cameras = await discoverCameras();
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(cameras));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  const streamMatch = url.pathname.match(/^\/stream\/([^/]+)$/);
  if (streamMatch && req.method === 'GET') {
    const ip = decodeURIComponent(streamMatch[1]);
    try {
      const onvifResults = await getOnvifResultsCached();
      const entry = onvifResults.get(ip);
      if (!entry || !entry.xaddr) {
        res.statusCode = 404;
        res.end('Camera no trobada');
        return;
      }
      const rtspUri = await getRtspUri(entry.xaddr, ONVIF_USER, ONVIF_PASS);
      streamMjpeg(withCredentials(rtspUri, ONVIF_USER, ONVIF_PASS), res);
    } catch (err) {
      res.statusCode = 500;
      res.end('Error: ' + err.message);
    }
    return;
  }

  res.statusCode = 404;
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Servidor web a http://localhost:${PORT}`);
  if (!ONVIF_USER || !ONVIF_PASS) {
    console.log('(Sense credencials ONVIF: passa ONVIF_USER/ONVIF_PASS si les cameres en requereixen)');
  }
});
