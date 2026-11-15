'use strict';

const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
    console.error('SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diisi di .env');
    process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

function must({ data, error }, what) {
    if (error) throw new Error(`Supabase (${what}): ${error.message}`);
    return data;
}

// Semua fungsi menerima userId dan SELALU memfilter user_id -> data antar-pengguna terpisah.

async function upsertUser(waId, name) {
    const row = { wa_id: waId, last_seen_at: new Date().toISOString() };
    if (name) row.name = name;
    return must(await sb.from('users').upsert(row, { onConflict: 'wa_id' }).select().single(), 'upsertUser');
}

async function getBusiness(userId) {
    return must(await sb.from('businesses').select('*').eq('user_id', userId).maybeSingle(), 'getBusiness');
}

async function saveBusiness(userId, fields) {
    const row = { user_id: userId, updated_at: new Date().toISOString() };
    for (const k of ['name', 'product_type', 'city', 'owner_name']) if (fields[k]) row[k] = fields[k];
    return must(await sb.from('businesses').upsert(row, { onConflict: 'user_id' }).select().single(), 'saveBusiness');
}

async function getProgress(userId) {
    return must(await sb.from('progress_items').select('key,status,note,updated_at').eq('user_id', userId), 'getProgress');
}

async function setProgress(userId, key, status, note) {
    const row = { user_id: userId, key, status, updated_at: new Date().toISOString() };
    if (note) row.note = note;
    return must(await sb.from('progress_items').upsert(row, { onConflict: 'user_id,key' }).select().single(), 'setProgress');
}

async function saveProductCheck(userId, c) {
    return must(
        await sb
            .from('product_checks')
            .insert({
                user_id: userId,
                kind: c.kind,
                product_name: c.product_name || null,
                score: c.score ?? null,
                summary: c.summary || null,
                improvements: c.improvements || [],
            })
            .select()
            .single(),
        'saveProductCheck',
    );
}

async function latestChecks(userId, limit = 3) {
    return must(
        await sb
            .from('product_checks')
            .select('kind,product_name,score,summary,created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit),
        'latestChecks',
    );
}

async function addTransactions(userId, rows) {
    const payload = rows.map((r) => ({
        user_id: userId,
        tx_date: r.tx_date,
        type: r.type,
        amount: r.amount,
        category: r.category || null,
        note: r.note || null,
    }));
    return must(await sb.from('transactions').insert(payload).select(), 'addTransactions');
}

// Ambil semua transaksi dalam rentang (paginasi karena Supabase membatasi 1000 baris/request).
async function listTransactions(userId, from, to, max = 5000) {
    const out = [];
    const PAGE = 1000;
    while (out.length < max) {
        const data = must(
            await sb
                .from('transactions')
                .select('id,tx_date,type,amount,category,note')
                .eq('user_id', userId)
                .gte('tx_date', from)
                .lte('tx_date', to)
                .order('tx_date', { ascending: true })
                .order('id', { ascending: true })
                .range(out.length, out.length + PAGE - 1),
            'listTransactions',
        );
        out.push(...data);
        if (data.length < PAGE) break;
    }
    return out;
}

async function deleteTransaction(userId, id) {
    const data = must(
        await sb.from('transactions').delete().eq('user_id', userId).eq('id', id).select(),
        'deleteTransaction',
    );
    return data.length > 0;
}

async function getHistory(userId, limit = 12) {
    const data = must(
        await sb.from('messages').select('role,content').eq('user_id', userId).order('id', { ascending: false }).limit(limit),
        'getHistory',
    );
    const rows = data.reverse();
    while (rows.length && rows[0].role !== 'user') rows.shift(); // API: pesan pertama harus user
    return rows;
}

async function addMessages(userId, userText, assistantText) {
    must(
        await sb.from('messages').insert([
            { user_id: userId, role: 'user', content: userText },
            { user_id: userId, role: 'assistant', content: assistantText },
        ]),
        'addMessages',
    );
}

async function clearHistory(userId) {
    must(await sb.from('messages').delete().eq('user_id', userId), 'clearHistory');
}

async function stats() {
    const count = async (t) => (await sb.from(t).select('*', { count: 'exact', head: true })).count ?? 0;
    const countBy = async (source) =>
        (await sb.from('message_log').select('*', { count: 'exact', head: true }).eq('direction', 'out').eq('source', source)).count ?? 0;
    const [users, transactions, checks, messages, staticReplies, aiReplies] = await Promise.all([
        count('users'), count('transactions'), count('product_checks'), count('message_log'), countBy('static'), countBy('ai'),
    ]);
    return { users, transactions, checks, messages, staticReplies, aiReplies };
}

async function markWelcomed(userId) {
    must(await sb.from('users').update({ welcomed: true }).eq('id', userId), 'markWelcomed');
}

async function setPhone(userId, phone) {
    must(await sb.from('users').update({ phone }).eq('id', userId), 'setPhone');
}

// ---------- Log pesan (admin) ----------
async function logMessage(userId, m) {
    const { error } = await sb.from('message_log').insert({
        user_id: userId,
        direction: m.direction,
        type: m.type || 'text',
        body: m.body,
        source: m.source || null,
        tokens_in: m.tokensIn ?? null,
        tokens_out: m.tokensOut ?? null,
    });
    if (error) console.error('[logMessage]', error.message); // jangan sampai log mengganggu balasan
}

async function listMessages({ userId, q, source, before, limit = 50 }) {
    let query = sb
        .from('message_log')
        .select('id,user_id,direction,type,body,source,tokens_in,tokens_out,created_at,users(name,phone,wa_id)')
        .order('id', { ascending: false })
        .limit(Math.min(limit, 200));
    if (userId) query = query.eq('user_id', userId);
    if (source) query = query.eq('source', source);
    if (before) query = query.lt('id', before);
    if (q) query = query.ilike('body', `%${q.replace(/[%_,()]/g, ' ')}%`);
    return must(await query, 'listMessages');
}

async function listUserOverview(q) {
    let query = sb.from('user_overview').select('*').order('last_seen_at', { ascending: false }).limit(500);
    if (q) {
        const t = q.replace(/[%_,()]/g, ' ');
        query = query.or(`name.ilike.%${t}%,phone.ilike.%${t}%,business_name.ilike.%${t}%,wa_id.ilike.%${t}%`);
    }
    return must(await query, 'listUserOverview');
}

async function getUserDetail(userId) {
    const [user, business, progress, checks, txs] = await Promise.all([
        sb.from('user_overview').select('*').eq('id', userId).maybeSingle(),
        db_getBusiness(userId),
        getProgress(userId),
        latestChecks(userId, 10),
        sb.from('transactions').select('id,tx_date,type,amount,category,note').eq('user_id', userId).order('tx_date', { ascending: false }).order('id', { ascending: false }).limit(20),
    ]);
    return { user: must(user, 'detail'), business, progress, checks, transactions: must(txs, 'detail tx') };
}
const db_getBusiness = (id) => getBusiness(id);

// ---------- Konten statis ----------
async function seedContent(defaults) {
    const existing = must(await sb.from('static_content').select('key,version,customized'), 'seedContent');
    const byKey = Object.fromEntries(existing.map((r) => [r.key, r]));
    for (const [key, d] of Object.entries(defaults)) {
        const cur = byKey[key];
        if (cur && (cur.customized || cur.version >= d.version)) continue;
        must(
            await sb.from('static_content').upsert(
                { key, title: d.title, body: d.body, version: d.version, customized: false, updated_at: new Date().toISOString() },
                { onConflict: 'key' },
            ),
            'seedContent upsert',
        );
    }
}

async function listContent() {
    return must(await sb.from('static_content').select('key,title,body,version,customized,updated_at').order('key'), 'listContent');
}

async function saveContent(key, body) {
    return must(
        await sb.from('static_content').update({ body, customized: true, updated_at: new Date().toISOString() }).eq('key', key).select().maybeSingle(),
        'saveContent',
    );
}

module.exports = {
    markWelcomed, setPhone, logMessage, listMessages, listUserOverview, getUserDetail, seedContent, listContent, saveContent,
    upsertUser, getBusiness, saveBusiness, getProgress, setProgress, saveProductCheck, latestChecks,
    addTransactions, listTransactions, deleteTransaction, getHistory, addMessages, clearHistory, stats,
};
