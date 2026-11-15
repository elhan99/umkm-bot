'use strict';

const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const path = require('path');
const db = require('./db');
const content = require('./content');

function safeEqual(a, b) {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
}

function start({ getStatus, logout, port, host, password }) {
    const app = express();
    app.disable('x-powered-by');

    // HTTP Basic Auth (pasang HTTPS di depan saat di server!)
    app.use((req, res, next) => {
        const [scheme, encoded] = (req.headers.authorization || '').split(' ');
        if (scheme === 'Basic' && encoded) {
            const pass = Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':');
            if (safeEqual(pass, password)) return next();
        }
        res.set('WWW-Authenticate', 'Basic realm="Asisten UMKM Admin"').status(401).send('Autentikasi diperlukan');
    });

    app.use(express.json({ limit: '200kb' }));

    // Perlindungan CSRF: aksi tulis wajib membawa header kustom (tidak bisa dikirim form lintas-situs).
    app.use((req, res, next) => {
        if (['POST', 'PUT', 'DELETE'].includes(req.method) && req.get('X-Requested-With') !== 'admin') {
            return res.status(403).json({ error: 'forbidden' });
        }
        next();
    });

    app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', maxAge: 0 }));

    const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error('[web]', e.message); res.status(500).json({ error: 'server error' }); });
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const str = (v, max = 100) => (typeof v === 'string' ? v.slice(0, max) : undefined);

    let statsCache = { at: 0, value: null };
    app.get('/api/status', wrap(async (_req, res) => {
        const st = getStatus();
        const qr = st.qr ? await QRCode.toDataURL(st.qr, { width: 560, margin: 1 }) : null;
        if (Date.now() - statsCache.at > 10000) {
            statsCache = { at: Date.now(), value: await db.stats().catch(() => null) };
        }
        res.set('Cache-Control', 'no-store').json({ state: st.state, qr, phone: st.phone, stats: statsCache.value });
    }));

    app.get('/api/users', wrap(async (req, res) => {
        res.set('Cache-Control', 'no-store').json(await db.listUserOverview(str(req.query.q)));
    }));

    app.get('/api/users/:id', wrap(async (req, res) => {
        if (!UUID.test(req.params.id)) return res.status(400).json({ error: 'id tidak valid' });
        res.set('Cache-Control', 'no-store').json(await db.getUserDetail(req.params.id));
    }));

    app.get('/api/messages', wrap(async (req, res) => {
        const userId = str(req.query.user_id);
        if (userId && !UUID.test(userId)) return res.status(400).json({ error: 'user_id tidak valid' });
        const source = ['static', 'ai', 'system', 'error'].includes(req.query.source) ? req.query.source : undefined;
        const before = parseInt(req.query.before, 10) || undefined;
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
        res.set('Cache-Control', 'no-store').json(await db.listMessages({ userId, q: str(req.query.q), source, before, limit }));
    }));

    app.get('/api/content', wrap(async (_req, res) => {
        res.set('Cache-Control', 'no-store').json(await db.listContent());
    }));

    app.put('/api/content/:key', wrap(async (req, res) => {
        const body = str(req.body?.body, 6000);
        if (!body || !body.trim()) return res.status(400).json({ error: 'isi tidak boleh kosong' });
        const row = await db.saveContent(req.params.key, body);
        if (!row) return res.status(404).json({ error: 'kunci tidak ditemukan' });
        await content.refresh(); // berlaku langsung di bot
        res.json({ ok: true });
    }));

    app.post('/api/logout', wrap(async (_req, res) => {
        await logout();
        res.json({ ok: true });
    }));

    app.listen(port, host, () => console.log(`Halaman admin: http://${host}:${port}`));
}

module.exports = { start };
