#!/usr/bin/env node
'use strict';

const { CAMERA_PORTS, getLocalSubnet, scanSubnet, onvifDiscovery } = require('./discovery');
const { getArpTable, lookupVendors } = require('./mac-vendor');
const { getDeviceInformation } = require('./onvif');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [key, inlineValue] = arg.slice(2).split('=');
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
    } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      args[key] = argv[++i];
    } else {
      args[key] = true;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const onvifUser = args.user || process.env.ONVIF_USER;
  const onvifPass = args.pass || process.env.ONVIF_PASS;

  const { base, address } = getLocalSubnet();
  console.log(`Interficie local: ${address}  |  Xarxa: ${base}.0/24\n`);

  console.log('Cercant dispositius ONVIF (WS-Discovery)...');
  const onvifResults = await onvifDiscovery();
  if (onvifResults.size === 0) {
    console.log('  Cap resposta ONVIF.\n');
  } else {
    for (const ip of onvifResults.keys()) console.log(`  ONVIF trobat a ${ip}`);

    if (!onvifUser || !onvifPass) {
      console.log("  (Sense credencials ONVIF: passa --user/--pass o ONVIF_USER/ONVIF_PASS per obtenir info del dispositiu)");
    }

    console.log('\nInformacio dels dispositius ONVIF:');
    for (const [ip, { xaddr }] of onvifResults) {
      if (!xaddr) {
        console.log(`  ${ip}: no s'ha pogut obtenir la XAddr del servei ONVIF.`);
        continue;
      }
      try {
        const info = await getDeviceInformation(xaddr, onvifUser, onvifPass);
        console.log(`  ${ip} (${xaddr})`);
        console.log(`    Fabricant: ${info.manufacturer || '-'}`);
        console.log(`    Model: ${info.model || '-'}`);
        console.log(`    Firmware: ${info.firmwareVersion || '-'}`);
        console.log(`    Numero de serie: ${info.serialNumber || '-'}`);
      } catch (err) {
        console.log(`  ${ip} (${xaddr}): no s'ha pogut obtenir informacio - ${err.message}`);
      }
    }
    console.log('');
  }

  console.log(`Escanejant ${base}.1-254 (ports: ${CAMERA_PORTS.join(', ')})...`);
  const results = await scanSubnet(base);

  if (results.length === 0) {
    console.log("No s'ha trobat cap dispositiu amb ports oberts habituals de camares IP.");
    return;
  }

  const arpTable = getArpTable();
  const macsToLookup = results
    .map(({ host }) => arpTable.get(host))
    .filter(Boolean);

  console.log(`\nIdentificant fabricant per MAC (${macsToLookup.length} dispositiu/s, via api.macvendors.com)...`);
  const vendors = await lookupVendors(macsToLookup);

  console.log('\nDispositius trobats:');
  for (const { host, openPorts } of results) {
    const onvifTag = onvifResults.has(host) ? '  [ONVIF]' : '';
    const mac = arpTable.get(host);
    const vendor = mac ? vendors.get(mac) || 'Fabricant desconegut' : 'MAC desconeguda';
    const macInfo = mac ? `${mac} (${vendor})` : vendor;
    console.log(`  ${host}  ->  ports: ${openPorts.join(', ')}  |  ${macInfo}${onvifTag}`);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
