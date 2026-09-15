'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  }[c]));
}

function buildSecurityHeader(username, password) {
  const nonceBuf = crypto.randomBytes(16);
  const created = new Date().toISOString();
  const digest = crypto
    .createHash('sha1')
    .update(Buffer.concat([nonceBuf, Buffer.from(created, 'utf8'), Buffer.from(password, 'utf8')]))
    .digest('base64');

  return `
    <Security xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:u="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
      <UsernameToken>
        <Username>${escapeXml(username)}</Username>
        <Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</Password>
        <Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonceBuf.toString('base64')}</Nonce>
        <u:Created>${created}</u:Created>
      </UsernameToken>
    </Security>`;
}

function buildEnvelope(username, password) {
  const header = username && password ? buildSecurityHeader(username, password) : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
  <s:Header>${header}</s:Header>
  <s:Body>
    <tds:GetDeviceInformation/>
  </s:Body>
</s:Envelope>`;
}

function soapRequest(xaddr, body, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(xaddr);
    } catch {
      return reject(new Error('XAddr invalida'));
    }
    const transport = url.protocol === 'https:' ? https : http;
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname || '/onvif/device_service',
      method: 'POST',
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Timeout en connectar amb el servei ONVIF')));
    req.write(body);
    req.end();
  });
}

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<[^:>]*:?${tag}[^>]*>([^<]*)</[^:>]*:?${tag}>`, 'i'));
  return match ? match[1].trim() : null;
}

async function getDeviceInformation(xaddr, username, password) {
  const body = buildEnvelope(username, password);
  const xml = await soapRequest(xaddr, body);

  if (/<[^:>]*:?Fault>/i.test(xml)) {
    const reason = extractTag(xml, 'Text') || extractTag(xml, 'Reason') || 'Fault ONVIF (credencials incorrectes o no proporcionades?)';
    throw new Error(reason);
  }

  return {
    manufacturer: extractTag(xml, 'Manufacturer'),
    model: extractTag(xml, 'Model'),
    firmwareVersion: extractTag(xml, 'FirmwareVersion'),
    serialNumber: extractTag(xml, 'SerialNumber'),
    hardwareId: extractTag(xml, 'HardwareId'),
  };
}

module.exports = { getDeviceInformation };
