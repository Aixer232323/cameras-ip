'use strict';

const https = require('https');
const { execSync } = require('child_process');

const MAC_LINE_RE = /(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-fA-F]{2}(?:-[0-9a-fA-F]{2}){5})/;

function getArpTable() {
  let output;
  try {
    output = execSync('arp -a', { encoding: 'utf8' });
  } catch {
    return new Map();
  }

  const table = new Map();
  for (const line of output.split('\n')) {
    const match = line.match(MAC_LINE_RE);
    if (match) table.set(match[1], match[2].toUpperCase());
  }
  return table;
}

function lookupVendor(mac, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const request = https.get(`https://api.macvendors.com/${mac}`, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(null);
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data.trim() || null));
    });
    request.on('error', () => resolve(null));
    request.on('timeout', () => request.destroy());
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// L'API pública gratuita limita aproximadament 1 petició/segon.
async function lookupVendors(macs) {
  const results = new Map();
  const uniqueMacs = [...new Set(macs)];
  for (let i = 0; i < uniqueMacs.length; i++) {
    const mac = uniqueMacs[i];
    results.set(mac, await lookupVendor(mac));
    if (i < uniqueMacs.length - 1) await sleep(1100);
  }
  return results;
}

module.exports = { getArpTable, lookupVendor, lookupVendors };
