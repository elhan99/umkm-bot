'use strict';

const db = require('./db');
const { summarize, rp } = require('./report');

const STEPS = [
    ['nib', 'NIB', 'nib'],
    ['pirt', 'PIRT', 'pirt'],
    ['halal', 'Halal', 'halal'],
    ['kemasan', 'Kemasan', 'kemasan'],
    ['label', 'Label', 'label'],
    ['foto_produk', 'Foto produk', 'foto'],
    ['shopee', 'Toko Shopee', 'shopee'],
    ['tiktok_shop', 'Toko TikTok Shop', 'tiktok'],
];
const ICON = { belum: '⬜', proses: '🟨', selesai: '✅' };

const todayWIB = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

function nextStepLine(byKey) {
    const next = STEPS.find(([k]) => (byKey[k]?.status || 'belum') !== 'selesai');
    if (!next) return '🎉 Semua langkah sudah selesai. Hebat, Kak! Tinggal perbanyak penjualan.';
    return `👉 *Langkah berikutnya:* ${next[1]}. Ketik *${next[2]}* untuk panduannya.`;
}

async function byKeyFor(userId) {
    return Object.fromEntries((await db.getProgress(userId)).map((p) => [p.key, p]));
}

/** Tampilan progres + ringkasan keuangan bulan ini, tanpa AI. */
async function renderProgress(user) {
    const [byKey, biz] = await Promise.all([byKeyFor(user.id), db.getBusiness(user.id)]);
    const lines = STEPS.map(([k, label]) => `${ICON[byKey[k]?.status || 'belum']} ${label}${byKey[k]?.note ? ` _(${byKey[k].note})_` : ''}`);
    const done = STEPS.filter(([k]) => byKey[k]?.status === 'selesai').length;

    const today = todayWIB();
    const monthStart = today.slice(0, 8) + '01';
    const txs = await db.listTransactions(user.id, monthStart, today);
    let money = '_Belum ada catatan keuangan bulan ini._ Ketik *4* untuk cara mencatat.';
    if (txs.length) {
        const s = summarize(txs);
        money = `Pemasukan ${rp(s.income)}\nPengeluaran ${rp(s.expense)}\n${s.profit >= 0 ? 'Laba' : 'Rugi'} ${rp(Math.abs(s.profit))}`;
    }
    return `📈 *Progres Usaha${biz?.name ? ` - ${biz.name}` : ''}*\nSelesai ${done} dari ${STEPS.length} langkah\n\n${lines.join('\n')}\n\n💰 *Keuangan bulan ini*\n${money}\n\n${nextStepLine(byKey)}`;
}

async function applyProgress(user, key, status) {
    await db.setProgress(user.id, key, status);
    const byKey = await byKeyFor(user.id);
    const label = STEPS.find(([k]) => k === key)?.[1] || key;
    const head = {
        selesai: `✅ Mantap, *${label}* ditandai *selesai*! 🎉`,
        proses: `🟨 Oke, *${label}* ditandai *sedang diproses*. Semangat, Kak!`,
        belum: `⬜ *${label}* dikembalikan ke status *belum*.`,
    }[status];
    return `${head}\n\n${nextStepLine(byKey)}\nKetik *progres* untuk melihat semuanya.`;
}

module.exports = { renderProgress, applyProgress };
