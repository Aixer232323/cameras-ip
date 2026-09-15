'use strict';

const net = require('net');
const dgram = require('dgram');
const os = require('os');
const crypto = require('crypto');

const CAMERA_PORTS = [80, 443, 554, 8000, 8080, 37777, 34567, 2020, 8899, 9000];
const TCP_TIMEOUT_MS = 600;
const CONCURRENCY = 64;

function getLocalSubnet() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const parts = iface.address.split('.');
        return { base: parts.slice(0, 3).join('.'), address: iface.address };
      }
    }
  }
  throw new Error("No s'ha pogut detectar cap interfície de xarxa IPv4 activa.");
}

function checkPort(host, port, timeout = TCP_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (open) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function scanHost(host, ports = CAMERA_PORTS) {
  const openPorts = [];
  for (const port of ports) {
    if (await checkPort(host, port)) openPorts.push(port);
  }
  return { host, openPorts };
}

async function scanSubnet(base, ports = CAMERA_PORTS) {
  const hosts = Array.from({ length: 254 }, (_, i) => `${base}.${i + 1}`);
  const results = [];
  let index = 0;

  async function worker() {
    while (index < hosts.length) {
      const host = hosts[index++];
      const { openPorts } = await scanHost(host, ports);
      if (openPorts.length > 0) results.push({ host, openPorts });
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results.sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }));
}

function onvifDiscovery(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const found = new Map();
    const socket = dgram.createSocket('udp4');
    const message = Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" ' +
        'xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" ' +
        'xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" ' +
        'xmlns:dn="http://www.onvif.org/ver10/network/wsdl">' +
        '<e:Header>' +
        `<w:MessageID>uuid:${crypto.randomUUID()}</w:MessageID>` +
        '<w:To e:mustUnderstand="1">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>' +
        '<w:Action e:mustUnderstand="1">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>' +
        '</e:Header>' +
        '<e:Body>' +
        '<d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe>' +
        '</e:Body>' +
        '</e:Envelope>'
    );

    socket.on('message', (msg, rinfo) => {
      if (found.has(rinfo.address)) return;
      const text = msg.toString('utf8');
      const xaddrMatch = text.match(/<[^:>]*:?XAddrs>([^<]*)</i);
      const xaddr = xaddrMatch ? xaddrMatch[1].trim().split(/\s+/)[0] : null;
      found.set(rinfo.address, { xaddr });
    });
    socket.on('error', () => {});

    socket.bind(() => {
      socket.send(message, 3702, '239.255.255.250');
    });

    setTimeout(() => {
      socket.close();
      resolve(found);
    }, timeoutMs);
  });
}

module.exports = { CAMERA_PORTS, getLocalSubnet, checkPort, scanSubnet, onvifDiscovery };
