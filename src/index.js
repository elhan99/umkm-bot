'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

if (!process.env.ADMIN_PASSWORD) {
    console.error('ADMIN_PASSWORD wajib diisi di .env (untuk halaman scan QR).');
    process.exit(1);
}

const db = require('./db'); // validasi env Supabase saat dimuat
const agent = require('./agent');
const web = require('./web');
const content = require('./content');
const router = require('./router');
const progress = require('./progress');

const MAX_PER_HOUR = parseInt(process.env.MAX_REQUESTS_PER_HOUR || '30', 10);
const ALLOWED = (process.env.ALLOWED_NUMBERS || '').split(',').map((n) => n.trim()).filter(Boolean);

// ---------- Status WhatsApp (dibaca halaman admin) ----------
const status = { state: 'starting', qr: null, phone: null };

const client = new Client({
    authStrategy: new LocalAuth(),
    // Di server Linux: identitas browser harus KONSISTEN dengan browser aslinya (Chromium 156 di Linux),
    // kalau tidak WhatsApp bisa menolak penautan (LOGOUT). Bisa diganti lewat WA_USER_AGENT.
    // Di laptop dipakai bawaan library (terbukti jalan).
    ...(process.env.WA_USER_AGENT || process.platform === 'linux'
        ? { userAgent: process.env.WA_USER_AGENT || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36' }
        : {}),
    puppeteer: {
        headless: true,
        // Di Docker memakai Chromium sistem (PUPPETEER_EXECUTABLE_PATH); di laptop memakai Chrome bawaan Puppeteer.
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions'],
    },
});

client.on('qr', (qr) => { status.state = 'qr'; status.qr = qr; console.log('QR baru tersedia di halaman admin'); });
client.on('authenticated', () => { status.state = 'authenticated'; status.qr = null; console.log('Terautentikasi'); });
client.on('auth_failure', (m) => { status.state = 'disconnected'; console.error('Autentikasi gagal:', m); });
client.on('ready', () => { status.state = 'ready'; status.qr = null; status.phone = client.info?.wid?.user || null; console.log('Bot siap 🚀'); });
client.on('disconnected', (r) => { status.state = 'disconnected'; status.qr = null; status.phone = null; console.error('Terputus:', r); });

// Mulai WhatsApp dengan percobaan ulang: koneksi pertama di server bisa lambat (>30 dtk) dan
// tidak boleh membuat seluruh aplikasi mati.
// Chrome meninggalkan file kunci profil saat crash/restart (apalagi di Docker, hostname berubah
// tiap rebuild). Hanya satu proses yang memakai profil ini, jadi aman dihapus sebelum mulai.
function clearStaleBrowserLocks() {
    const dir = path.join(process.cwd(), '.wwebjs_auth', 'session');
    for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
        try { fs.rmSync(path.join(dir, f), { force: true }); } catch { /* abaikan */ }
    }
}

async function startClient(attempt = 1) {
    try {
        status.state = 'starting';
        clearStaleBrowserLocks();
        await client.initialize();
    } catch (err) {
        const wait = Math.min(60_000, 10_000 * attempt);
        console.error(`[wa] gagal memulai (percobaan ${attempt}): ${err?.message || err}. Coba lagi ${wait / 1000} dtk lagi.`);
        try { await client.destroy(); } catch { /* abaikan */ }
        setTimeout(() => startClient(attempt + 1), wait);
    }
}

async function relink() {
    try { await client.logout(); } catch (e) { console.error('logout:', e.message); }
    try { await client.destroy(); } catch (e) { console.error('destroy:', e.message); }
    status.qr = null; status.phone = null;
    startClient();
}

web.start({
    getStatus: () => status,
    logout: relink,
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '127.0.0.1',
    password: process.env.ADMIN_PASSWORD,
});

// ---------- Utilitas pesan ----------
async function send(to, content, opts = {}) {
    // sendSeen:false menghindari bug "markedUnread" pada chat @lid
    await client.sendMessage(to, content, { sendSeen: false, ...opts });
}

async function sendText(to, text) {
    const LIMIT = 3500;
    let rest = text;
    while (rest.length > LIMIT) {
        let cut = rest.lastIndexOf('\n\n', LIMIT);
        if (cut < LIMIT / 2) cut = rest.lastIndexOf('\n', LIMIT);
        if (cut < LIMIT / 2) cut = LIMIT;
        await send(to, rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
    }
    if (rest) await send(to, rest);
}

// Pembatas biaya sederhana (per pengguna per jam) di memori.
const hits = new Map();
function allowRequest(id) {
    const cutoff = Date.now() - 3600_000;
    const list = (hits.get(id) || []).filter((t) => t > cutoff);
    if (list.length >= MAX_PER_HOUR) { hits.set(id, list); return false; }
    list.push(Date.now());
    hits.set(id, list);
    return true;
}

// Pesan dari pengguna yang sama diproses berurutan (hindari balapan data).
const queues = new Map();
function enqueue(id, task) {
    const prev = queues.get(id) || Promise.resolve();
    const next = prev.catch(() => {}).then(task);
    queues.set(id, next);
    next.finally(() => { if (queues.get(id) === next) queues.delete(id); });
    return next;
}

// ---------- Penanganan pesan ----------
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

// Cari nomor telepon asli di balik ID @lid (di latar belakang, sekali per pengguna).
async function enrichPhone(user) {
    try {
        if (user.phone || !user.wa_id.endsWith('@lid')) {
            if (!user.phone && user.wa_id.endsWith('@c.us')) await db.setPhone(user.id, user.wa_id.split('@')[0]);
            return;
        }
        const [res] = await withTimeout(client.getContactLidAndPhone([user.wa_id]), 8000);
        const phone = res?.pn?.split('@')[0];
        if (phone && /^\d{8,15}$/.test(phone)) await db.setPhone(user.id, phone);
    } catch (e) {
        console.log('[phone] gagal:', e.message);
    }
}

// Catat balasan ke log admin lalu kirim.
async function reply(user, to, text, source, extra = {}) {
    await sendText(to, text);
    await db.logMessage(user.id, { direction: 'out', body: text, source, ...extra });
}

async function handle(msg) {
    const to = msg.from;
    const user = await db.upsertUser(to, msg._data?.notifyName);
    const body = (msg.body || '').trim();
    const isImage = msg.hasMedia && msg.type === 'image';

    // Log pesan masuk lebih dulu agar tetap terlacak walau pemrosesan gagal.
    await db.logMessage(user.id, {
        direction: 'in',
        type: isImage ? 'image' : msg.hasMedia ? 'other' : 'text',
        body: isImage ? `[foto]${body ? ' ' + body : ''}` : msg.hasMedia ? `[${msg.type}]` : body,
    });
    if (!user.phone) enrichPhone(user); // tanpa await

    // Pemberitahuan privasi sekali saja, pada kontak pertama.
    if (!user.welcomed) {
        await reply(user, to, content.get('welcome_notice'), 'system');
        await db.markWelcomed(user.id);
    }

    if (msg.hasMedia && !isImage) return reply(user, to, 'Saat ini saya baru bisa membaca *foto* dan teks ya Kak 🙏', 'system');

    // ---- Jalur statis (tanpa AI) ----
    const route = isImage ? null : router.match(body);
    if (route) {
        let text;
        if (route.type === 'reset') {
            await db.clearHistory(user.id);
            text = 'Siap, riwayat obrolan dihapus ✨ (profil, progres & catatan keuangan tetap tersimpan)\n\n' + content.get('menu');
        } else if (route.type === 'progress_view') {
            text = await progress.renderProgress(user);
        } else if (route.type === 'progress_set') {
            text = await progress.applyProgress(user, route.key, route.status);
        } else {
            text = content.get(route.key);
            if (route.key === 'menu') {
                const biz = await db.getBusiness(user.id);
                if (route.greeting === 'islam') text = 'Waalaikumsalam warahmatullahi wabarakatuh 🙏\n\n' + text;
                if (!biz?.name && !biz?.product_type) {
                    text += '\n\nBoleh tahu *nama usaha* dan *produk* Kakak? Balas saja, misalnya: _Keripik Sanjai Bu Ani, keripik singkong_.';
                }
            }
        }
        if (route.type !== 'reset') await db.addMessages(user.id, body, text); // konteks untuk pertanyaan lanjutan ke AI
        console.log(`[statis] user=${user.id.slice(0, 8)} ${route.type}:${route.key || ''} "${body.slice(0, 30)}"`);
        return reply(user, to, text, 'static');
    }

    // ---- Jalur AI ----
    if (!allowRequest(to)) return reply(user, to, 'Kakak sudah banyak bertanya jam ini 😊 Coba lagi sebentar lagi ya.', 'system');

    let text = body;
    let image = null;
    if (isImage) {
        const media = await msg.downloadMedia();
        if (!media) return reply(user, to, 'Fotonya gagal terunduh Kak, coba kirim ulang ya.', 'system');
        image = { mimetype: media.mimetype, data: media.data };
        text = body ? `Pengguna mengirim foto dengan keterangan: ${body}` : 'Pengguna mengirim foto ini. Nilai sesuai pedoman.';
    }
    if (!text) return;

    console.log(`[ai] user=${user.id.slice(0, 8)} ${image ? '(foto) ' : ''}"${text.slice(0, 50)}"`);
    const out = await agent.respond({ user, text, image });
    await reply(user, to, out.text, 'ai', { tokensIn: out.usage.input, tokensOut: out.usage.output });
    for (const f of out.attachments) {
        await send(to, new MessageMedia('application/pdf', f.buffer.toString('base64'), f.filename), { caption: '📄 Laporan keuangan Kakak' });
        await db.logMessage(user.id, { direction: 'out', type: 'other', body: `[PDF] ${f.filename}`, source: 'ai' });
    }
}

client.on('message', (msg) => {
    // Hanya chat pribadi (@c.us atau @lid); abaikan grup, status, dan pesan sendiri.
    const isPrivate = msg.from.endsWith('@c.us') || msg.from.endsWith('@lid');
    if (msg.fromMe || msg.isStatus || !isPrivate || msg.type === 'e2e_notification') return;
    console.log(`[masuk] dari=${msg.from} tipe=${msg.type}`);

    enqueue(msg.from, async () => {
        try {
            if (ALLOWED.length) {
                const contact = await msg.getContact();
                const number = contact.number || msg.from.split('@')[0];
                if (!ALLOWED.some((n) => number.startsWith(n))) return console.log(`[diabaikan] ${number}`);
            }
            await handle(msg);
        } catch (err) {
            const friendly = err instanceof agent.UserFacingError ? err.message : 'Maaf Kak, ada kendala teknis. Coba lagi ya 🙏';
            console.error('[error]', err instanceof agent.UserFacingError ? err.message : err);
            await sendText(msg.from, friendly).catch(() => {});
            const u = await db.upsertUser(msg.from).catch(() => null);
            if (u) await db.logMessage(u.id, { direction: 'out', body: friendly, source: 'error' });
        }
    });
});

content.init(db).then(() => startClient());
