'use strict';

// Router tanpa AI: mengenali perintah/kata kunci yang jawabannya statis.
// Mengembalikan null bila pesan perlu dijawab asisten AI.

const GREETINGS = new Set([
    'menu', 'halo', 'hallo', 'hai', 'hi', 'hello', 'start', 'mulai', 'p', 'ping', 'test', 'tes',
    'assalamualaikum', 'assalamu alaikum', 'assalamualaikum wr wb', 'assalamualaikum warahmatullahi wabarakatuh',
    'selamat pagi', 'selamat siang', 'selamat sore', 'selamat malam', 'permisi',
]);

const NUMBERS = { '1': 'produk_howto', '2': 'perizinan_menu', '3': 'toko_menu', '4': 'keuangan_howto' };

const TOPICS = {
    nib: 'nib', pirt: 'pirt', 'p irt': 'pirt', halal: 'halal', 'sertifikat halal': 'halal',
    shopee: 'shopee', 'toko shopee': 'shopee', tiktok: 'tiktok', 'tiktok shop': 'tiktok', 'toko tiktok': 'tiktok', tokopedia: null,
    foto: 'foto', 'foto produk': 'foto', kemasan: 'kemasan', packaging: 'kemasan', label: 'label',
    checklist: 'checklist', 'check list': 'checklist',
    izin: 'perizinan_menu', perizinan: 'perizinan_menu', 'izin usaha': 'perizinan_menu', legalitas: 'perizinan_menu',
    'toko online': 'toko_menu', toko: 'toko_menu', marketplace: 'toko_menu', 'jualan online': 'toko_menu',
    keuangan: 'keuangan_howto', 'catat keuangan': 'keuangan_howto', pencatatan: 'keuangan_howto',
    'cek produk': 'produk_howto', produk: 'produk_howto',
    bantu: 'bantu', bantuan: 'bantu', tanya: 'bantu', help: 'bantu',
};
delete TOPICS.tokopedia;

const FILLER = new Set([
    'cara', 'syarat', 'persyaratan', 'panduan', 'langkah', 'info', 'informasi', 'apa', 'itu', 'bagaimana', 'gimana',
    'mengurus', 'urus', 'membuat', 'buat', 'daftar', 'mendaftar', 'bikin', 'membuka', 'buka', 'tentang', 'soal',
    'mau', 'ingin', 'minta', 'tolong', 'dong', 'ya', 'sih', 'kak', 'aja', 'saja', 'dulu', 'lihat', 'tampilkan',
]);

const PROGRESS_KEY = {
    nib: 'nib', pirt: 'pirt', halal: 'halal', foto: 'foto_produk', 'foto produk': 'foto_produk',
    kemasan: 'kemasan', label: 'label', shopee: 'shopee', tiktok: 'tiktok_shop', 'tiktok shop': 'tiktok_shop',
};
const PROGRESS_STATUS = {
    sudah: 'selesai', selesai: 'selesai', udah: 'selesai', beres: 'selesai',
    proses: 'proses', sedang: 'proses', lagi: 'proses', belum: 'belum',
};

const normalize = (t) =>
    t.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

function match(raw) {
    const text = normalize(raw || '');
    if (!text || text.length > 60) return null;

    if (text === 'reset') return { type: 'reset' };
    if (text === 'progres' || text === 'progress' || text === '5' || text === 'progres usaha' || text === 'progres saya') return { type: 'progress_view' };
    if (GREETINGS.has(text)) return { type: 'static', key: 'menu', greeting: text.startsWith('assalam') ? 'islam' : 'umum' };
    if (NUMBERS[text]) return { type: 'static', key: NUMBERS[text] };

    // "sudah nib", "proses pirt", "belum halal", "selesai urus nib"
    const m = text.match(/^(sudah|selesai|udah|beres|proses|sedang|lagi|belum)(?: (?:mengurus|urus|buat|membuat|daftar|bikin|mendaftar))? (.+?)(?: ya| kak| nih)?$/);
    if (m && PROGRESS_KEY[m[2]] && PROGRESS_STATUS[m[1]]) {
        return { type: 'progress_set', key: PROGRESS_KEY[m[2]], status: PROGRESS_STATUS[m[1]] };
    }

    // "pirt", "cara mengurus nib", "mau shopee", "info halal"
    const words = text.split(' ');
    const core = words.filter((w) => !FILLER.has(w)).join(' ');
    if (core && Object.hasOwn(TOPICS, core) && words.length <= 6) return { type: 'static', key: TOPICS[core] };
    return null;
}

module.exports = { match, normalize };
