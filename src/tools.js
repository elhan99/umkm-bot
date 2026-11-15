'use strict';

const db = require('./db');
const { buildReportPdf, summarize, rp } = require('./report');

const PROGRESS_KEYS = ['nib', 'pirt', 'halal', 'foto_produk', 'kemasan', 'label', 'shopee', 'tiktok_shop'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const isDate = (s) => typeof s === 'string' && ISO.test(s) && !Number.isNaN(Date.parse(s));

const DEFINITIONS = [
    {
        name: 'simpan_profil_usaha',
        description: 'Simpan/perbarui profil usaha pengguna (nama usaha, jenis produk, nama pemilik). Isi hanya yang diketahui.',
        input_schema: {
            type: 'object',
            properties: {
                nama_usaha: { type: 'string' },
                jenis_produk: { type: 'string', description: 'mis. keripik pisang, kue kering' },
                nama_pemilik: { type: 'string' },
            },
        },
    },
    {
        name: 'update_progres',
        description: 'Catat status satu langkah progres usaha pengguna.',
        input_schema: {
            type: 'object',
            properties: {
                kunci: { type: 'string', enum: PROGRESS_KEYS },
                status: { type: 'string', enum: ['belum', 'proses', 'selesai'] },
                catatan: { type: 'string', description: 'catatan singkat, mis. nomor PIRT atau kendala' },
            },
            required: ['kunci', 'status'],
        },
    },
    {
        name: 'simpan_hasil_cek_produk',
        description: 'Simpan hasil pengecekan foto/kemasan/label produk dari foto yang dikirim pengguna.',
        input_schema: {
            type: 'object',
            properties: {
                jenis: { type: 'string', enum: ['foto', 'kemasan', 'label'] },
                nama_produk: { type: 'string' },
                skor: { type: 'integer', minimum: 0, maximum: 10 },
                ringkasan: { type: 'string', description: 'satu-dua kalimat' },
                perbaikan: { type: 'array', items: { type: 'string' }, description: 'daftar perbaikan prioritas' },
            },
            required: ['jenis', 'skor', 'ringkasan'],
        },
    },
    {
        name: 'catat_transaksi',
        description: 'Catat satu atau lebih transaksi keuangan (pemasukan/pengeluaran). Jumlah dalam rupiah penuh.',
        input_schema: {
            type: 'object',
            properties: {
                transaksi: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            tanggal: { type: 'string', description: 'YYYY-MM-DD; kosongkan = hari ini' },
                            jenis: { type: 'string', enum: ['pemasukan', 'pengeluaran'] },
                            jumlah: { type: 'integer', description: 'rupiah penuh, mis. 75000' },
                            kategori: { type: 'string', description: 'mis. Penjualan, Bahan baku, Kemasan, Ongkir, Iklan, Gaji, Lainnya' },
                            keterangan: { type: 'string' },
                        },
                        required: ['jenis', 'jumlah'],
                    },
                },
            },
            required: ['transaksi'],
        },
    },
    {
        name: 'daftar_transaksi',
        description: 'Tampilkan transaksi dalam rentang tanggal (untuk memeriksa atau mencari id sebelum menghapus).',
        input_schema: {
            type: 'object',
            properties: {
                dari: { type: 'string', description: 'YYYY-MM-DD' },
                sampai: { type: 'string', description: 'YYYY-MM-DD' },
                batas: { type: 'integer', description: 'maks baris (default 20, ambil yang terbaru)' },
            },
            required: ['dari', 'sampai'],
        },
    },
    {
        name: 'hapus_transaksi',
        description: 'Hapus satu transaksi berdasarkan id (hanya milik pengguna ini).',
        input_schema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    },
    {
        name: 'ringkasan_keuangan',
        description: 'Hitung total pemasukan, pengeluaran, laba dan rincian kategori pada rentang tanggal.',
        input_schema: {
            type: 'object',
            properties: { dari: { type: 'string', description: 'YYYY-MM-DD' }, sampai: { type: 'string', description: 'YYYY-MM-DD' } },
            required: ['dari', 'sampai'],
        },
    },
    {
        name: 'buat_laporan_pdf',
        description: 'Buat file PDF laporan keuangan untuk rentang tanggal; file otomatis dikirim ke pengguna setelah balasanmu.',
        input_schema: {
            type: 'object',
            properties: { dari: { type: 'string', description: 'YYYY-MM-DD' }, sampai: { type: 'string', description: 'YYYY-MM-DD' } },
            required: ['dari', 'sampai'],
        },
    },
];

function checkRange(i) {
    if (!isDate(i.dari) || !isDate(i.sampai)) throw new Error('Format tanggal harus YYYY-MM-DD.');
    if (i.dari > i.sampai) throw new Error('Tanggal awal lebih besar dari tanggal akhir.');
}

const HANDLERS = {
    async simpan_profil_usaha(i, ctx) {
        const b = await db.saveBusiness(ctx.user.id, {
            name: i.nama_usaha, product_type: i.jenis_produk, owner_name: i.nama_pemilik,
        });
        return `Profil tersimpan: ${JSON.stringify({ nama: b.name, produk: b.product_type, pemilik: b.owner_name })}`;
    },

    async update_progres(i, ctx) {
        if (!PROGRESS_KEYS.includes(i.kunci)) throw new Error('Kunci progres tidak dikenal.');
        await db.setProgress(ctx.user.id, i.kunci, i.status, i.catatan);
        return `Progres ${i.kunci} = ${i.status}`;
    },

    async simpan_hasil_cek_produk(i, ctx) {
        const score = Math.max(0, Math.min(10, Math.round(Number(i.skor))));
        await db.saveProductCheck(ctx.user.id, {
            kind: i.jenis, product_name: i.nama_produk, score, summary: i.ringkasan, improvements: i.perbaikan,
        });
        // Tandai langkah terkait minimal "proses" (tidak menurunkan status yang sudah selesai).
        const key = { foto: 'foto_produk', kemasan: 'kemasan', label: 'label' }[i.jenis];
        const current = (await db.getProgress(ctx.user.id)).find((p) => p.key === key);
        if (!current || current.status === 'belum') await db.setProgress(ctx.user.id, key, 'proses', `Skor terakhir ${score}/10`);
        return `Hasil cek ${i.jenis} tersimpan (skor ${score}/10).`;
    },

    async catat_transaksi(i, ctx) {
        if (!Array.isArray(i.transaksi) || !i.transaksi.length) throw new Error('Tidak ada transaksi.');
        if (i.transaksi.length > 30) throw new Error('Maksimal 30 transaksi sekali catat.');
        const rows = i.transaksi.map((t, n) => {
            const amount = Math.round(Number(t.jumlah));
            if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Transaksi #${n + 1}: jumlah tidak valid.`);
            if (!['pemasukan', 'pengeluaran'].includes(t.jenis)) throw new Error(`Transaksi #${n + 1}: jenis tidak valid.`);
            const date = t.tanggal || ctx.today;
            if (!isDate(date)) throw new Error(`Transaksi #${n + 1}: tanggal harus YYYY-MM-DD.`);
            if (date > ctx.today) throw new Error(`Transaksi #${n + 1}: tanggal ${date} belum terjadi.`);
            return { tx_date: date, type: t.jenis, amount, category: t.kategori, note: t.keterangan };
        });
        const saved = await db.addTransactions(ctx.user.id, rows);
        return 'Tercatat:\n' + saved.map((t) => `id ${t.id}: ${t.tx_date} ${t.type} ${rp(t.amount)} (${t.category || '-'}) ${t.note || ''}`).join('\n');
    },

    async daftar_transaksi(i, ctx) {
        checkRange(i);
        const all = await db.listTransactions(ctx.user.id, i.dari, i.sampai);
        const limit = Math.min(Math.max(i.batas || 20, 1), 50);
        const shown = all.slice(-limit);
        if (!shown.length) return 'Tidak ada transaksi pada rentang itu.';
        return `Menampilkan ${shown.length} dari ${all.length} transaksi:\n` +
            shown.map((t) => `id ${t.id}: ${t.tx_date} ${t.type} ${rp(t.amount)} (${t.category || '-'}) ${t.note || ''}`).join('\n');
    },

    async hapus_transaksi(i, ctx) {
        const ok = await db.deleteTransaction(ctx.user.id, i.id);
        return ok ? `Transaksi id ${i.id} dihapus.` : `Transaksi id ${i.id} tidak ditemukan.`;
    },

    async ringkasan_keuangan(i, ctx) {
        checkRange(i);
        const txs = await db.listTransactions(ctx.user.id, i.dari, i.sampai);
        if (!txs.length) return `Belum ada transaksi pada ${i.dari} s/d ${i.sampai}.`;
        const s = summarize(txs);
        const lines = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  - ${k}: ${rp(v)}`).join('\n');
        return [
            `Periode ${i.dari} s/d ${i.sampai} (${txs.length} transaksi)`,
            `Pemasukan: ${rp(s.income)}`,
            `Pengeluaran: ${rp(s.expense)}`,
            `${s.profit >= 0 ? 'Laba' : 'Rugi'}: ${rp(Math.abs(s.profit))}`,
            `Pemasukan per kategori:\n${lines(s.byCategory.pemasukan) || '  -'}`,
            `Pengeluaran per kategori:\n${lines(s.byCategory.pengeluaran) || '  -'}`,
        ].join('\n');
    },

    async buat_laporan_pdf(i, ctx) {
        checkRange(i);
        const txs = await db.listTransactions(ctx.user.id, i.dari, i.sampai);
        if (!txs.length) return `Belum ada transaksi pada ${i.dari} s/d ${i.sampai}, jadi PDF tidak dibuat.`;
        const biz = await db.getBusiness(ctx.user.id);
        const buffer = await buildReportPdf({
            businessName: biz?.name, ownerName: biz?.owner_name || ctx.user.name, from: i.dari, to: i.sampai, transactions: txs,
        });
        ctx.attachments.push({ buffer, filename: `Laporan-Keuangan_${i.dari}_sd_${i.sampai}.pdf` });
        return `PDF laporan (${txs.length} transaksi) berhasil dibuat dan akan dikirim otomatis setelah pesanmu.`;
    },
};

async function runTool(name, input, ctx) {
    const handler = HANDLERS[name];
    if (!handler) return { content: `Alat ${name} tidak dikenal.`, is_error: true };
    try {
        return { content: await handler(input || {}, ctx) };
    } catch (err) {
        console.error(`[tool ${name}]`, err.message);
        return { content: `Gagal: ${err.message}`, is_error: true };
    }
}

module.exports = { DEFINITIONS, runTool };
