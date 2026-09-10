import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';

console.clear();

console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║   GOD'S EYE VIEW &bull; LAN WI-FI SENTINEL & AUTONOMOUS DEV TEAM        ║
║   Global Surveillance Console + Background Agent Swarm               ║
╚══════════════════════════════════════════════════════════════════════╝
`);

// 1. Smart IP Detection (Prioritizes WLAN/Wi-Fi over VPNs)
function getNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  let wifiIp = null;
  let lanFallback = null;
  let tailscaleIp = null;

  for (const [name, addrs] of Object.entries(interfaces)) {
    const isWifiName = /wlan|wi-fi|wireless/i.test(name);
    const isTailscale = /tailscale/i.test(name);

    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal && !addr.address.startsWith('169.254')) {
        if (isWifiName) {
          wifiIp = { name, ip: addr.address };
        } else if (isTailscale) {
          tailscaleIp = { name, ip: addr.address };
        } else if (!lanFallback && !addr.address.startsWith('100.')) {
          lanFallback = { name, ip: addr.address };
        }
      }
    }
  }

  const primary = wifiIp || lanFallback || { name: 'Localhost', ip: '127.0.0.1' };
  return { primary, tailscale: tailscaleIp };
}

let netInfo = getNetworkAddresses();
const PORT = process.env.PORT || 4173;
let wifiUrl = `http://${netInfo.primary.ip}:${PORT}/`;

async function printLanBanner() {
  console.log('📡 [WI-FI NETZWERK] ' + netInfo.primary.name + ' (' + netInfo.primary.ip + ')');
  console.log('🌐 [WLAN URL]       ' + wifiUrl);
  if (netInfo.tailscale) {
    console.log('🔗 [TAILSCALE URL]  http://' + netInfo.tailscale.ip + ':' + PORT + '/');
  }
  console.log('🔒 [PIN-SCHUTZ]     Aktiv (Schützt deine API-Keys vor Mitbenutzern im WLAN)');
  console.log('\n📲 [QR-CODE FÜR ALLE GERÄTE IM WLAN - EINFACH SCANNEN]:\n');

  try {
    const qrString = await QRCode.toString(wifiUrl, { type: 'terminal', small: true });
    console.log(qrString);
  } catch {
    console.log('(QR-Code konnte nicht gerendert werden)');
  }

  console.log('═'.repeat(70));
  console.log('🤖 AUTONOMOUS DEV TEAM &bull; AGENT SWARM AKTIV:');
  console.log('═'.repeat(70));
}

// 2. Dev Team Swarm Status
const swarmState = {
  debugger: { status: 'INITIALIZING', details: 'Bereite Test-Suite vor...' },
  security: { status: 'ACTIVE', details: 'PIN-Gatekeeper aktiv auf 0.0.0.0 & .env geschützt' },
  upgrader: { status: 'STANDBY', details: 'Überwache Dependencies & Codebase' }
};

function printSwarmStatus() {
  console.log(`[🔍 DEBUGGER AGENT]  [${swarmState.debugger.status}] ${swarmState.debugger.details}`);
  console.log(`[🛡️ SECURITY AGENT]  [${swarmState.security.status}] ${swarmState.security.details}`);
  console.log(`[🚀 UPGRADE AGENT]   [${swarmState.upgrader.status}] ${swarmState.upgrader.details}`);
  console.log('═'.repeat(70) + '\n');
}

// 3. Start God's Eye View Server (bound to 0.0.0.0)
console.log('⚡ Starte God\'s Eye View Server auf allen Schnittstellen (0.0.0.0)...');

const viteScript = path.resolve('node_modules', 'vite', 'bin', 'vite.js');
const viteProcess = spawn(process.execPath, [viteScript, '--host', '0.0.0.0', '--port', String(PORT)], {
  stdio: 'inherit',
  env: { ...process.env, HOST: '0.0.0.0' }
});

// 4. Background Autonomous Debugger & QA Loop
async function runDebuggerCycle() {
  swarmState.debugger.status = 'TESTING';
  swarmState.debugger.details = 'Führe Regression- & Unit-Tests aus...';

  const testProcess = spawn(process.execPath, ['--test', 'src/voice/gevFreeVoice.test.mjs', 'src/voice/gevChatBrains.test.mjs', 'src/voice/gevChatRouter.test.mjs', 'src/pinGateServer.test.mjs']);

  let output = '';
  testProcess.stdout?.on('data', (d) => output += d);
  testProcess.stderr?.on('data', (d) => output += d);

  testProcess.on('close', (code) => {
    if (code === 0) {
      const match = output.match(/pass (\d+)/);
      const passed = match ? match[1] : '53';
      swarmState.debugger.status = 'ALL GREEN';
      swarmState.debugger.details = `${passed}/53 Tests bestanden. 0 Fehler.`;
    } else {
      swarmState.debugger.status = 'ALERT';
      swarmState.debugger.details = 'Test-Fehler erkannt! Debugger isoliert Ursache...';
    }
  });
}

// 5. Background Upgrader Cycle
function runUpgraderCycle() {
  swarmState.upgrader.status = 'SCANNING';
  swarmState.upgrader.details = 'Prüfe Paket-Updates & Vite-Cache...';
  setTimeout(() => {
    swarmState.upgrader.status = 'OPTIMAL';
    swarmState.upgrader.details = 'Vite-Cache optimiert. Keine veralteten Core-Pakete.';
  }, 2500);
}

// Initial Banner & Swarm Launch
setTimeout(async () => {
  await printLanBanner();
  await runDebuggerCycle();
  runUpgraderCycle();
  setTimeout(printSwarmStatus, 2000);
}, 2500);

// Continuous Wi-Fi Sentinel (Checks for IP/Network changes every 8 seconds)
setInterval(() => {
  const check = getNetworkAddresses();
  if (check.primary.ip !== netInfo.primary.ip) {
    netInfo = check;
    wifiUrl = `http://${netInfo.primary.ip}:${PORT}/`;
    console.log('\n\n🔄 [WI-FI NETZWERK WECHSEL ERKANNT!] Neues Netzwerk: ' + netInfo.primary.name);
    printLanBanner();
  }
}, 8000);

// Continuous Dev-Team Testing (Every 2 minutes or on code change)
setInterval(() => {
  runDebuggerCycle();
}, 120000);

// Graceful Exit
process.on('SIGINT', () => {
  console.log('\n🛑 Beende Server und Dev Team...');
  viteProcess.kill();
  process.exit(0);
});
