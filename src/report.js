'use strict';

const PDFDocument = require('pdfkit');

const rp = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');
const fmtDate = (iso) => {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
};

function summarize(txs) {
    const s = { income: 0, expense: 0, byCategory: { pemasukan: {}, pengeluaran: {} } };
    for (const t of txs) {
        const amt = Number(t.amount);
        const cat = t.category || 'Lainnya';
        if (t.type === 'pemasukan') s.income += amt;
        else s.expense += amt;
        const bucket = s.byCategory[t.type];
        bucket[cat] = (bucket[cat] || 0) + amt;
    }
    s.profit = s.income - s.expense;
    return s;
}

/** Hasilkan PDF laporan keuangan sebagai Buffer. */
function buildReportPdf({ businessName, ownerName, from, to, transactions }) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
        const chunks = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const L = doc.page.margins.left;
        const W = doc.page.width - L - doc.page.margins.right;
        const sum = summarize(transactions);

        // Header
        doc.fillColor('#111').font('Helvetica-Bold').fontSize(20).text('Laporan Keuangan', L, 40);
        doc.font('Helvetica').fontSize(11).fillColor('#444');
        doc.text(businessName || 'Usaha Saya');
        if (ownerName) doc.text(`Pemilik: ${ownerName}`);
        doc.text(`Periode: ${fmtDate(from)} - ${fmtDate(to)}`);
        doc.text(`Dibuat: ${new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'long', year: 'numeric' })}`);
        doc.moveDown(0.8);

        // Ringkasan
        const boxY = doc.y;
        const colW = W / 3;
        const cards = [
            ['Total Pemasukan', rp(sum.income), '#0a7d3b'],
            ['Total Pengeluaran', rp(sum.expense), '#b3261e'],
            [sum.profit >= 0 ? 'Laba Bersih' : 'Rugi Bersih', rp(Math.abs(sum.profit)), sum.profit >= 0 ? '#0a7d3b' : '#b3261e'],
        ];
        cards.forEach(([label, value, color], i) => {
            const x = L + i * colW;
            doc.roundedRect(x + 2, boxY, colW - 4, 52, 6).fill('#f3f4f6');
            doc.fillColor('#555').font('Helvetica').fontSize(9).text(label, x + 12, boxY + 10, { width: colW - 24 });
            doc.fillColor(color).font('Helvetica-Bold').fontSize(13).text(value, x + 12, boxY + 27, { width: colW - 24 });
        });
        doc.y = boxY + 68;

        // Rincian per kategori
        const section = (title) => {
            if (doc.y > doc.page.height - 120) doc.addPage();
            doc.fillColor('#111').font('Helvetica-Bold').fontSize(12).text(title, L, doc.y);
            doc.moveDown(0.3);
        };
        for (const [type, label] of [['pemasukan', 'Pemasukan per Kategori'], ['pengeluaran', 'Pengeluaran per Kategori']]) {
            const entries = Object.entries(sum.byCategory[type]).sort((a, b) => b[1] - a[1]);
            if (!entries.length) continue;
            section(label);
            doc.font('Helvetica').fontSize(10).fillColor('#222');
            for (const [cat, val] of entries) {
                if (doc.y > doc.page.height - 60) doc.addPage();
                const y = doc.y;
                doc.text(cat, L + 8, y, { width: W - 140 });
                doc.text(rp(val), L + W - 130, y, { width: 130, align: 'right' });
            }
            doc.moveDown(0.8);
        }

        // Tabel transaksi
        section('Rincian Transaksi');
        const cols = [
            { h: 'Tanggal', w: 62 },
            { h: 'Keterangan', w: W - 62 - 80 - 90 - 90 },
            { h: 'Kategori', w: 80 },
            { h: 'Pemasukan', w: 90, right: true },
            { h: 'Pengeluaran', w: 90, right: true },
        ];
        const header = () => {
            const y = doc.y;
            doc.rect(L, y - 2, W, 18).fill('#111');
            let x = L;
            doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9);
            for (const c of cols) {
                doc.text(c.h, x + 4, y + 2, { width: c.w - 8, align: c.right ? 'right' : 'left' });
                x += c.w;
            }
            doc.y = y + 20;
        };
        header();
        doc.font('Helvetica').fontSize(9);
        transactions.forEach((t, i) => {
            const note = t.note || '-';
            const noteH = doc.heightOfString(note, { width: cols[1].w - 8 });
            const rowH = Math.max(14, noteH + 4);
            if (doc.y + rowH > doc.page.height - 60) {
                doc.addPage();
                header();
                doc.font('Helvetica').fontSize(9);
            }
            const y = doc.y;
            if (i % 2 === 0) doc.rect(L, y - 1, W, rowH).fill('#f9fafb');
            doc.fillColor('#222');
            let x = L;
            const cells = [
                fmtDate(t.tx_date),
                note,
                t.category || '-',
                t.type === 'pemasukan' ? rp(t.amount) : '',
                t.type === 'pengeluaran' ? rp(t.amount) : '',
            ];
            cells.forEach((txt, ci) => {
                doc.text(txt, x + 4, y + 1, { width: cols[ci].w - 8, align: cols[ci].right ? 'right' : 'left', lineBreak: ci === 1 });
                x += cols[ci].w;
            });
            doc.y = y + rowH;
        });
        if (!transactions.length) doc.fillColor('#777').text('Tidak ada transaksi pada periode ini.', L + 4, doc.y + 4);

        // Footer nomor halaman
        const range = doc.bufferedPageRange();
        for (let i = 0; i < range.count; i++) {
            doc.switchToPage(range.start + i);
            doc.fillColor('#888').font('Helvetica').fontSize(8)
                .text(`Halaman ${i + 1} dari ${range.count}  |  Dibuat oleh Asisten UMKM`, L, doc.page.height - 30, { width: W, align: 'center', lineBreak: false });
        }
        doc.end();
    });
}

module.exports = { buildReportPdf, summarize, rp };
