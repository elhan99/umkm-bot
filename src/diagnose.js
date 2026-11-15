'use strict';
// Diagnostik koneksi WhatsApp Web dari server. Jalankan:
//   sudo docker compose stop bot
//   sudo docker compose run --rm bot node src/diagnose.js
// Tidak memakai sesi/QR dan tidak mengirim data apa pun.
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s]`, ...a);

(async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-'));
    const browser = await puppeteer.launch({
        headless: true,
        userDataDir,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions'],
    });
    log('browser:', await browser.version());
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

    let failed = 0;
    page.on('requestfailed', (r) => { if (failed++ < 15) log('REQUEST GAGAL', r.url().slice(0, 100), '-', r.failure()?.errorText); });
    page.on('pageerror', (e) => log('PAGE ERROR', String(e).slice(0, 150)));
    let cons = 0;
    page.on('console', (m) => { if (m.type() === 'error' && cons++ < 10) log('CONSOLE ERROR', m.text().slice(0, 150)); });

    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    cdp.on('Network.webSocketCreated', (e) => log('WS DIBUAT', e.url));
    cdp.on('Network.webSocketHandshakeResponseReceived', (e) => log('WS HANDSHAKE', e.response.status, e.response.statusText));
    cdp.on('Network.webSocketFrameError', (e) => log('WS ERROR', e.errorMessage));
    cdp.on('Network.webSocketClosed', () => log('WS DITUTUP'));

    log('membuka https://web.whatsapp.com/ ...');
    try {
        await page.goto('https://web.whatsapp.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        log('halaman terbuka, judul:', await page.title());
    } catch (e) {
        log('GAGAL membuka halaman:', e.message);
    }

    for (let i = 0; i < 9; i++) {
        await new Promise((r) => setTimeout(r, 7000));
        const info = await page.evaluate(() => ({
            version: window.Debug?.VERSION || null,
            socket: window.require?.('WAWebSocketModel')?.Socket?.state || null,
            hasQr: !!document.querySelector('canvas, [data-ref]'),
            online: navigator.onLine,
        })).catch((e) => ({ error: e.message }));
        log('status:', JSON.stringify(info));
        if (info.socket && !['OPENING', 'UNLAUNCHED', 'PAIRING'].includes(info.socket)) { log('BERHASIL: koneksi siap'); break; }
    }
    const mem = process.memoryUsage().rss / 1e6;
    log(`selesai. total request gagal: ${failed}. memori proses node: ${mem.toFixed(0)} MB`);
    await browser.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
})().catch((e) => { console.error('diagnostik error:', e); process.exit(1); });
