'use strict';

// Konten statis: dijawab langsung tanpa AI (hemat biaya, jawaban konsisten).
// Sumber kebenaran awal ada di file ini; saat start di-seed ke tabel static_content,
// lalu dibaca dari cache memori. Admin bisa mengedit lewat halaman admin
// (hasil edit tidak ditimpa oleh update bawaan). Naikkan `version` bila teks bawaan diubah.

const FOOTER_PROGRESS = (k) =>
    `\n\n✅ Sudah selesai? Ketik *selesai ${k}*\n⏳ Sedang diurus? Ketik *proses ${k}*\n❓ Bingung? Tulis saja pertanyaan Kakak, saya bantu jelaskan.`;

const DEFAULTS = {
    menu: {
        title: 'Menu utama',
        version: 1,
        body: `Halo Kak! 👋 Saya *Asisten UMKM Nagari Panti Selatan*. Saya bantu usaha makanan Kakak naik kelas dan siap jualan online.

*1* 📸 Cek produk (foto, kemasan, label)
*2* 📋 Perizinan: NIB, PIRT, Halal
*3* 🛒 Toko online: Shopee & TikTok Shop
*4* 💰 Catat keuangan & laporan PDF
*5* 📈 Progres usaha saya

Contoh mencatat: _"jual keripik 5 bungkus 75rb"_ atau _"beli plastik 50rb kemarin"_
Minta laporan: _"laporan PDF bulan ini"_

Ketik *menu* kapan saja. Ketik *reset* untuk menghapus riwayat obrolan (data usaha & keuangan tetap aman).`,
    },

    welcome_notice: {
        title: 'Pemberitahuan privasi (pesan pertama)',
        version: 1,
        body: `ℹ️ Catatan: percakapan di sini dapat dilihat oleh pengelola program Nagari Panti Selatan untuk membantu dan memantau perkembangan usaha Kakak. Jangan kirim data rahasia seperti PIN atau password ya.`,
    },

    perizinan_menu: {
        title: 'Menu perizinan',
        version: 1,
        body: `📋 *Panduan Perizinan Usaha Makanan*

Urutan yang disarankan:
1️⃣ *NIB* - identitas usaha (gratis, online)
2️⃣ *PIRT* - izin edar pangan rumahan
3️⃣ *Halal* - sertifikat halal (jalur pernyataan mandiri)

Ketik nama langkahnya: *nib*, *pirt*, atau *halal*.
Ketik *progres* untuk melihat sudah sampai mana.`,
    },

    nib: {
        title: 'Panduan NIB',
        version: 1,
        body: `🪪 *NIB (Nomor Induk Berusaha)*
Langkah paling awal, gratis, diurus online.

*Siapkan:*
- KTP (NIK) dan NPWP (jika ada)
- Email aktif & nomor HP
- Alamat tempat usaha
- Surat keterangan usaha/domisili dari kantor Wali Nagari (biasanya diminta sebagai kelengkapan, tanyakan ke kantor nagari)

*Langkah:*
1. Buka *oss.go.id*, pilih Daftar, buat akun dengan KTP & email.
2. Isi data pelaku usaha, lalu data usaha (nama usaha, alamat, modal).
3. Pilih skala *Usaha Mikro*, dan pilih KBLI sesuai produk (ketik kata kunci seperti "keripik" atau "kue" di kolom pencarian KBLI).
4. Setujui pernyataan, kirim. NIB terbit digital dan bisa diunduh.

💡 Simpan file NIB: dipakai untuk PIRT, halal, dan membuka toko bisnis di marketplace.
_Tampilan situs OSS bisa berubah; bila berbeda, tanyakan ke saya atau petugas pendamping._${FOOTER_PROGRESS('nib')}`,
    },

    pirt: {
        title: 'Panduan PIRT',
        version: 1,
        body: `🏠 *PIRT (Pangan Industri Rumah Tangga)*
Izin edar untuk makanan olahan rumahan berisiko rendah, misalnya keripik dan kue kering. Umumnya *tidak* untuk produk sangat cepat basi seperti kue basah, atau daging/susu olahan.

*Syarat awal:* sudah punya *NIB*.

*Langkah:*
1. Ikut *Penyuluhan Keamanan Pangan (PKP)* dari Dinas Kesehatan kabupaten. Tanyakan jadwalnya ke Dinkes, puskesmas, atau kantor nagari.
2. Ajukan PIRT lewat OSS (oss.go.id) dengan data produk, bahan, kemasan, dan contoh label.
3. Petugas Dinkes memeriksa tempat produksi (kebersihan dapur, alat, penyimpanan).
4. Jika lolos, terbit sertifikat dengan *nomor PIRT* (umumnya berlaku 5 tahun).
5. Cantumkan nomor PIRT di label kemasan.

*Persiapkan:* foto dapur/tempat produksi, daftar bahan, rancangan label, dan nama produk.
_Aturan teknis bisa berubah; konfirmasi persyaratan terbaru ke Dinkes._${FOOTER_PROGRESS('pirt')}`,
    },

    halal: {
        title: 'Panduan Halal',
        version: 1,
        body: `🕌 *Sertifikat Halal (BPJPH)*
Untuk usaha mikro-kecil dengan produk berisiko rendah dan bahan jelas halal, ada jalur *pernyataan mandiri (self-declare)* yang didampingi, biasanya tanpa biaya sertifikasi.

*Syarat awal:* sudah punya *NIB*.

*Langkah:*
1. Siapkan *daftar bahan* + bukti kehalalan tiap bahan (kemasan bahan, logo halal, atau keterangan produsen).
2. Siapkan uraian proses produksi dan foto produk.
3. Daftar lewat situs/aplikasi *SEHATI* (ptsp.halal.go.id). Anda didampingi *Pendamping Proses Produk Halal (PPH)*.
4. Pendamping memverifikasi data, lalu diajukan ke BPJPH untuk penetapan.
5. Sertifikat terbit; cantumkan *logo halal* di label.

⚠️ Pakai bahan yang jelas halal (hindari bahan meragukan). Cek *info.halal.go.id* untuk aturan & tenggat terbaru.${FOOTER_PROGRESS('halal')}`,
    },

    toko_menu: {
        title: 'Menu toko online',
        version: 1,
        body: `🛒 *Panduan Toko Online*

Ketik:
- *shopee* - membuka & mengoptimalkan toko Shopee
- *tiktok* - membuka & mengoptimalkan TikTok Shop
- *foto* - tips foto produk laku
- *kemasan* - kemasan aman & menarik
- *label* - label wajib di kemasan
- *checklist* - cek kesiapan produk sebelum jual

Mau dibuatkan judul & deskripsi produk? Tulis saja: _"buatkan deskripsi keripik singkong 250g rasa balado Rp 15.000"_.`,
    },

    shopee: {
        title: 'Panduan Shopee',
        version: 1,
        body: `🟠 *Membuka Toko di Shopee*

*Daftar:*
1. Unduh aplikasi Shopee, daftar dengan nomor HP/email, lalu pilih *Mulai Jual* / buka *seller.shopee.co.id*.
2. Isi nama toko, alamat pengambilan paket, dan opsi pengiriman.
3. Verifikasi identitas (KTP) dan isi rekening untuk pencairan dana.

*Isi produk:*
- Foto utama 1:1, latar bersih, terang. Tambah 5-9 foto (depan, label, isi, ukuran).
- Judul: *jenis + merek + varian + ukuran* (maks 120 karakter).
- Deskripsi: bahan, berat bersih, rasa, masa simpan, cara simpan, izin PIRT/halal bila ada.
- Atur berat & ukuran paket untuk ongkir, serta stok.

*Agar laku:* balas chat cepat, aktifkan promo/voucher toko, ikut program gratis ongkir bila memenuhi syarat, minta ulasan berfoto dari pembeli awal.

_Syarat & tampilan Shopee bisa berubah; cek Pusat Edukasi Penjual Shopee._
Ketik *foto*, *kemasan*, atau *label* untuk menyiapkan produknya.${FOOTER_PROGRESS('shopee')}`,
    },

    tiktok: {
        title: 'Panduan TikTok Shop',
        version: 1,
        body: `⚫ *Membuka TikTok Shop*

*Daftar:*
1. Buka *seller-id.tiktok.com* (TikTok Shop Seller Center) atau menu penjual di aplikasi TikTok.
2. Daftar dengan akun TikTok/nomor HP/email, pilih jenis penjual (individu atau bisnis).
3. Verifikasi identitas (KTP; untuk bisnis biasanya NIB), isi alamat pengambilan dan rekening.

*Isi produk:*
- Foto 1:1 yang jelas + *video 15-30 detik* (buka kemasan, suara kriuk, tekstur).
- Judul singkat dan menarik, deskripsi lengkap (bahan, berat, rasa, masa simpan).
- Harga sudah memperhitungkan komisi dan ongkir.

*Agar laku:* rutin posting video dan live, pakai hashtag relevan, ajak kreator/affiliate, balas komentar dan chat cepat.

_Syarat & fitur TikTok Shop bisa berubah; cek Pusat Akademi Penjual TikTok Shop._${FOOTER_PROGRESS('tiktok')}`,
    },

    foto: {
        title: 'Tips foto produk',
        version: 1,
        body: `📸 *Foto Produk yang Laku*

- *Cahaya:* dekat jendela di pagi/siang hari, tanpa flash. Hindari bayangan keras.
- *Latar:* kertas/kain putih atau polos. Singkirkan benda lain.
- *Foto utama:* rasio 1:1, produk memenuhi 70-80% bingkai, fokus tajam.
- *Tanpa* watermark, nomor HP, atau harga di foto utama.
- *Foto tambahan (5-9):* depan, belakang (label terbaca), isi/tekstur, perbandingan ukuran dengan tangan, disajikan, kemasan kirim.
- *TikTok Shop:* tambah video 15-30 detik.

🔍 Mau saya nilai? *Kirim foto produknya* ke sini.${FOOTER_PROGRESS('foto')}`,
    },

    kemasan: {
        title: 'Panduan kemasan',
        version: 1,
        body: `📦 *Kemasan Produk Kering & Kue*

- *Keripik/camilan renyah:* standing pouch berlapis (foil/metalized) + zip lock, segel rapi, sisakan udara agar tidak remuk.
- *Kue kering:* toples atau box food-grade, beri sekat/alas, tambah segel/stiker agar terlihat belum dibuka.
- *Kue basah:* box food-grade, tulis masa simpan (hari), cara simpan, sebaiknya kirim hari yang sama.
- *Pengiriman:* dus + bubble wrap/kertas, stiker "Fragile/Makanan".
- *Tampilan:* logo, nama produk, dan varian harus terbaca dari jauh; warna konsisten.

🔍 Mau saya nilai? *Kirim foto kemasannya* ke sini.${FOOTER_PROGRESS('kemasan')}`,
    },

    label: {
        title: 'Panduan label',
        version: 1,
        body: `🏷️ *Label Wajib di Kemasan*

1. Nama produk & merek
2. Daftar bahan (urut dari terbanyak)
3. Berat bersih (gram/ml)
4. Nama & alamat produsen
5. Logo/nomor *halal* (bila sudah ada)
6. Tanggal & kode produksi
7. Tanggal kedaluwarsa ("Baik digunakan sebelum ...")
8. Nomor *PIRT* (atau BPOM MD)
9. Info alergen (kacang, susu, telur, gluten) & cara simpan

🔍 Mau saya cek label Kakak? *Kirim foto bagian belakang kemasan*, pastikan tulisan terbaca.${FOOTER_PROGRESS('label')}`,
    },

    checklist: {
        title: 'Checklist kesiapan jual',
        version: 1,
        body: `✅ *Checklist Produk Siap Jual Online*

*Legalitas:* NIB · PIRT · Halal
*Foto:* foto utama 1:1 bersih · 5-9 foto · tanpa watermark/nomor HP
*Kemasan:* food-grade · tersegel · aman dikirim · merek terbaca
*Label:* nama, bahan, berat bersih, produsen, tanggal produksi & kedaluwarsa, PIRT, halal, alergen
*Listing:* judul jelas (jenis+merek+varian+ukuran) · deskripsi lengkap · harga sudah hitung HPP + biaya marketplace

Ketik *progres* untuk melihat sudah sampai mana, atau *nib* / *pirt* / *halal* untuk panduannya.`,
    },

    produk_howto: {
        title: 'Cara cek produk',
        version: 1,
        body: `📸 *Cek Produk*
Kirim *foto* ke sini, saya nilai dan beri saran perbaikan:
- *Foto produk/kemasan* (tampak depan, usahakan terang)
- *Foto label* (bagian belakang kemasan, tulisan terbaca)

Tulisan di caption foto boleh ditambahkan, misalnya nama produk.
Tips dulu? Ketik *foto*, *kemasan*, atau *label*.`,
    },

    keuangan_howto: {
        title: 'Cara pencatatan keuangan',
        version: 1,
        body: `💰 *Catat Keuangan*

Cukup ketik seperti ngobrol:
- _jual keripik 5 bungkus 75rb_
- _beli plastik kemasan 50 ribu kemarin_
- _bayar ongkir 12000_
Boleh beberapa sekaligus dalam satu pesan.

*Lihat & laporan:*
- _rekap bulan ini_ → ringkasan pemasukan, pengeluaran, laba
- _laporan PDF 1-30 Oktober_ → file PDF dikirim ke sini
- _hapus transaksi terakhir_ → bila salah catat

Data tersimpan aman dan terpisah untuk tiap pengguna.`,
    },

    bantu: {
        title: 'Bantuan lanjutan',
        version: 1,
        body: `Siap Kak 😊 Silakan tulis pertanyaannya langsung di sini, misalnya soal harga jual, bahan halal, kemasan, atau kendala saat daftar. Saya jawab satu per satu.`,
    },
};

// ---- Cache memori + sinkron ke database ----
let db = null;
const cache = new Map(Object.entries(DEFAULTS).map(([k, v]) => [k, v.body]));

async function load() {
    try {
        for (const r of await db.listContent()) cache.set(r.key, r.body);
    } catch (e) {
        console.error('[content] gagal memuat dari database, memakai cache lama:', e.message);
    }
}

async function init(database) {
    db = database;
    try {
        await db.seedContent(DEFAULTS);
    } catch (e) {
        console.error('[content] seed gagal (apakah schema.sql sudah dijalankan?):', e.message);
    }
    await load();
    setInterval(load, 10 * 60 * 1000).unref();
}

const get = (key) => cache.get(key) ?? DEFAULTS[key]?.body ?? null;
const refresh = load;

module.exports = { init, get, refresh, DEFAULTS };
