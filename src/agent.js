'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const db = require('./db');
const { PERSONA } = require('./prompts');
const { DEFINITIONS, runTool } = require('./tools');

const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-5-5';
const client = new Anthropic(); // ANTHROPIC_API_KEY atau profil `ant auth login`
const MAX_STEPS = 6;
const SUPPORTED_IMAGES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

class UserFacingError extends Error {}

const todayWIB = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()); // YYYY-MM-DD

const STATUS_ICON = { belum: '⬜ belum', proses: '🟨 proses', selesai: '✅ selesai' };
const PROGRESS_LABEL = {
    nib: 'NIB', pirt: 'PIRT', halal: 'Halal', foto_produk: 'Foto produk', kemasan: 'Kemasan',
    label: 'Label', shopee: 'Toko Shopee', tiktok_shop: 'Toko TikTok Shop',
};

async function buildSystem(user, today) {
    const [biz, progress, checks] = await Promise.all([db.getBusiness(user.id), db.getProgress(user.id), db.latestChecks(user.id, 3)]);
    const byKey = Object.fromEntries(progress.map((p) => [p.key, p]));
    const progressText = Object.entries(PROGRESS_LABEL)
        .map(([k, label]) => `- ${label}: ${STATUS_ICON[byKey[k]?.status || 'belum']}${byKey[k]?.note ? ` (${byKey[k].note})` : ''}`)
        .join('\n');
    const bizText = biz?.name || biz?.product_type
        ? `Nama usaha: ${biz.name || '-'}; produk: ${biz.product_type || '-'}; pemilik: ${biz.owner_name || user.name || '-'}`
        : '(KOSONG - pengguna baru, lakukan onboarding)';
    const checkText = checks.length
        ? checks.map((c) => `- ${c.kind} ${c.product_name || ''}: skor ${c.score}/10 - ${c.summary}`).join('\n')
        : '- belum ada';

    return `${PERSONA}

## Data pengguna ini (privat, hanya untuk dia)
Nama WhatsApp: ${user.name || '-'}
Profil usaha: ${bizText}
Progres saat ini:
${progressText}
Hasil cek produk terakhir:
${checkText}

Tanggal hari ini: ${today} (zona waktu WIB).`;
}

function translateError(err) {
    if (err instanceof Anthropic.RateLimitError) return new UserFacingError('Lagi ramai nih Kak 🙏 Coba kirim lagi dalam 1 menit ya.');
    if (err instanceof Anthropic.AuthenticationError) {
        console.error('Kredensial Anthropic tidak valid:', err.message);
        return new UserFacingError('Maaf Kak, layanan sedang ada gangguan konfigurasi. Admin akan memperbaiki.');
    }
    if (err instanceof Anthropic.APIError) {
        console.error(`Anthropic API error ${err.status}:`, err.message);
        return new UserFacingError('Maaf Kak, saya lagi error sebentar. Coba lagi ya 🙏');
    }
    return err;
}

/**
 * Satu giliran percakapan: riwayat dari DB + pesan baru -> loop tool -> teks balasan.
 * image: { mimetype, data } opsional. Mengembalikan { text, attachments }.
 */
async function respond({ user, text, image }) {
    if (image && !SUPPORTED_IMAGES.has(image.mimetype)) {
        throw new UserFacingError('Format file ini belum bisa saya baca Kak. Kirim sebagai foto (JPG/PNG) ya.');
    }
    const today = todayWIB();
    const [system, history] = await Promise.all([buildSystem(user, today), db.getHistory(user.id)]);
    const ctx = { user, today, attachments: [] };

    const content = image
        ? [{ type: 'image', source: { type: 'base64', media_type: image.mimetype, data: image.data } }, { type: 'text', text }]
        : text;
    const messages = [...history, { role: 'user', content }];

    let finalText = '';
    const usage = { input: 0, output: 0, steps: 0 };
    for (let step = 0; step < MAX_STEPS; step++) {
        let res;
        try {
            res = await client.messages.create({
                model: MODEL,
                max_tokens: 4000,
                system,
                tools: DEFINITIONS,
                messages,
                output_config: { effort: 'low' },
            });
        } catch (err) {
            throw translateError(err);
        }

        usage.input += res.usage?.input_tokens || 0;
        usage.output += res.usage?.output_tokens || 0;
        usage.steps += 1;
        if (res.stop_reason === 'refusal') {
            throw new UserFacingError('Maaf Kak, saya tidak bisa membantu untuk yang satu itu. Coba tanya hal lain seputar usaha ya.');
        }
        if (res.stop_reason === 'tool_use') {
            messages.push({ role: 'assistant', content: res.content }); // utuh, termasuk blok thinking
            const results = [];
            for (const block of res.content) {
                if (block.type !== 'tool_use') continue;
                const out = await runTool(block.name, block.input, ctx);
                results.push({ type: 'tool_result', tool_use_id: block.id, ...out });
            }
            messages.push({ role: 'user', content: results });
            continue;
        }
        finalText = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        break;
    }
    if (!finalText) throw new UserFacingError('Hmm, saya belum berhasil menjawab. Coba kirim ulang ya Kak.');

    // Riwayat hanya teks (foto & hasil tool tidak disimpan ulang: hemat token & privasi).
    await db.addMessages(user.id, image ? `[Mengirim foto] ${text}` : text, finalText);
    return { text: finalText, attachments: ctx.attachments, usage };
}

module.exports = { respond, UserFacingError };
