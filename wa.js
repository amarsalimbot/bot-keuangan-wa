// ============================================================
//  BOT KEUANGAN WHATSAPP - VERSI LENGKAP
//  Fitur: Grafik ASCII, Dashboard Web, AI Analisis, Budget Custom,
//         Pencarian, Export, Pengingat, Tips Harian, Tren
// ============================================================

const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason
} = require("@whiskeysockets/baileys");

const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const { GoogleGenAI } = require("@google/genai");
const OpenAI = require("openai");
const pino = require("pino");
const http = require("http");
const crypto = require("crypto");

// ── ENV ──────────────────────────────────────────────────────
const SPREADSHEET_ID            = process.env.SPREADSHEET_ID || "";
const OPENAI_API_KEY            = process.env.OPENAI_API_KEY || process.env.CHATGPT_API_KEY || "";
const OPENAI_MODEL              = process.env.OPENAI_MODEL || "gpt-4o-mini";
const GEMINI_API_KEY            = process.env.GEMINI_API_KEY || "";
const WHATSAPP_PHONE_NUMBER     = String(process.env.WHATSAPP_PHONE_NUMBER || "").replace(/\D/g, "");
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
const GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || "";
const GOOGLE_CLIENT_EMAIL      = String(process.env.GOOGLE_CLIENT_EMAIL || "").trim();
const GOOGLE_PRIVATE_KEY       = process.env.GOOGLE_PRIVATE_KEY || "";
const DASHBOARD_TOKEN           = String(process.env.DASHBOARD_TOKEN || "").trim();
const DASHBOARD_SECRET          = String(process.env.DASHBOARD_SECRET || DASHBOARD_TOKEN || "").trim();
const DASHBOARD_BASE_URL        = String(process.env.DASHBOARD_BASE_URL || process.env.PUBLIC_BASE_URL || process.env.APP_URL || "").trim();
const DASHBOARD_LINK_DAYS       = Math.max(1, Number(process.env.DASHBOARD_LINK_DAYS || 30) || 30);
const SUPER_ADMIN_NUMBERS       = String(process.env.SUPER_ADMIN_NUMBERS || process.env.SUPER_ADMIN_NUMBER || "")
    .split(",").map(n => n.replace(/\D/g, "")).filter(Boolean);
const BINANCE_BALANCE_NUMBER    = String(process.env.BINANCE_BALANCE_NUMBER || "33827179200526").replace(/\D/g, "");
const BINANCE_API_KEY_FOR_BALANCE = String(process.env[`BINANCE_API_KEY_${BINANCE_BALANCE_NUMBER}`] || process.env.BINANCE_API_KEY_33827179200526 || process.env.BINANCE_API_KEY || "").trim();
const BINANCE_API_SECRET_FOR_BALANCE = String(process.env[`BINANCE_API_SECRET_${BINANCE_BALANCE_NUMBER}`] || process.env.BINANCE_API_SECRET_33827179200526 || process.env.BINANCE_API_SECRET || "").trim();
const BINANCE_BASE_URL          = String(process.env.BINANCE_BASE_URL || "https://api.binance.com").replace(/\/+$/, "");
const BINANCE_CACHE_SECONDS     = Math.max(2, Number(process.env.BINANCE_CACHE_SECONDS || 5) || 5);
const BINANCE_PRICE_CACHE_SECONDS = Math.max(1, Number(process.env.BINANCE_PRICE_CACHE_SECONDS || 2) || 2);
const BINANCE_TOP_ASSETS_LIMIT  = Math.max(5, Number(process.env.BINANCE_TOP_ASSETS_LIMIT || 50) || 50);
const BINANCE_MIN_ASSET_USDT    = Math.max(0, Number(process.env.BINANCE_MIN_ASSET_USDT || 0) || 0);
const BINANCE_RECV_WINDOW       = Math.max(1000, Number(process.env.BINANCE_RECV_WINDOW || 5000) || 5000);
const BINANCE_USDT_IDR_RATE_FALLBACK = Math.max(0, Number(process.env.BINANCE_USDT_IDR_RATE || 0) || 0);
const BINANCE_USDT_IDR_SYMBOL   = String(process.env.BINANCE_USDT_IDR_SYMBOL || process.env.BINANCE_IDR_SYMBOL || "USDTIDR").toUpperCase().replace(/[^A-Z0-9]/g, "");
const BINANCE_IDR_RATE_CACHE_SECONDS = Math.max(2, Number(process.env.BINANCE_IDR_RATE_CACHE_SECONDS || 5) || 5);
const BINANCE_USDT_IDR_MODE     = String(process.env.BINANCE_USDT_IDR_MODE || "auto").toLowerCase();
const APP_TIMEZONE              = "Asia/Makassar";
const PORT                      = process.env.PORT || 7860;

if (!SPREADSHEET_ID)             console.warn("⚠️ SPREADSHEET_ID belum diisi. Dashboard tetap online, tetapi data spreadsheet belum bisa dibaca.");
if (!OPENAI_API_KEY && !GEMINI_API_KEY) console.warn("⚠️ AI key belum diisi. Bot tetap berjalan memakai parsing dan analisis lokal.");
if (!GOOGLE_SERVICE_ACCOUNT_JSON) console.warn("⚠️ GOOGLE_SERVICE_ACCOUNT_JSON belum diisi. Dashboard tetap online, tetapi data spreadsheet belum bisa dibaca.");
if (OPENAI_API_KEY || GEMINI_API_KEY) {
    if (!OPENAI_API_KEY) console.warn("⚠️ OPENAI_API_KEY belum diisi. AI utama ChatGPT nonaktif, memakai Gemini.");
    if (!GEMINI_API_KEY) console.warn("⚠️ GEMINI_API_KEY belum diisi. Fallback Gemini nonaktif.");
}
if (!DASHBOARD_SECRET) console.warn("⚠️ DASHBOARD_SECRET belum diisi. Kunci link dashboard diturunkan dari service account.");
if (!SUPER_ADMIN_NUMBERS.length) console.warn("⚠️ SUPER_ADMIN_NUMBERS belum diisi. Akses dashboard super admin via WhatsApp belum aktif.");
if (BINANCE_BALANCE_NUMBER && (!BINANCE_API_KEY_FOR_BALANCE || !BINANCE_API_SECRET_FOR_BALANCE)) {
    console.warn(`⚠️ API Binance untuk nomor ${BINANCE_BALANCE_NUMBER} belum lengkap. Fitur saldo Binance akan tampil sebagai belum tersambung.`);
}

let serviceAccount = null;
let serviceAccountParseError = "";

function stripEnvQuotes(value) {
    let text = String(value || "").trim();
    if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) {
        text = text.slice(1, -1).trim();
    }
    return text;
}

function decodeBase64Text(value) {
    const text = stripEnvQuotes(value);
    if (!text) return "";
    try {
        const decoded = Buffer.from(text, "base64").toString("utf8").trim();
        if (decoded.startsWith("{") && decoded.includes("private_key")) return decoded;
    } catch (_) {}
    return "";
}

function parseJsonServiceAccount(raw) {
    const text = stripEnvQuotes(raw);
    if (!text) return null;
    const candidates = [text];
    const decoded = decodeBase64Text(text);
    if (decoded) candidates.push(decoded);
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === "object") return parsed;
        } catch (e) {
            serviceAccountParseError = e.message || String(e);
        }
    }
    return null;
}

function normalisasiPrivateKey(rawKey) {
    let key = stripEnvQuotes(rawKey);
    if (!key) return "";
    key = key
        .replace(/\\r\\n/g, "\n")
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\n")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .trim();

    const pemMatch = key.match(/-----BEGIN ([A-Z ]+?)-----([\s\S]*?)-----END \1-----/);
    if (pemMatch) {
        const label = pemMatch[1];
        const body = pemMatch[2].replace(/[^A-Za-z0-9+/=]/g, "");
        const wrapped = body.match(/.{1,64}/g)?.join("\n") || body;
        return `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----\n`;
    }
    return key;
}

serviceAccount = parseJsonServiceAccount(GOOGLE_SERVICE_ACCOUNT_JSON)
    || parseJsonServiceAccount(GOOGLE_SERVICE_ACCOUNT_JSON_BASE64)
    || (GOOGLE_CLIENT_EMAIL && GOOGLE_PRIVATE_KEY ? {
        type: "service_account",
        client_email: GOOGLE_CLIENT_EMAIL,
        private_key: GOOGLE_PRIVATE_KEY
    } : null);

if (serviceAccount?.private_key) {
    serviceAccount.private_key = normalisasiPrivateKey(serviceAccount.private_key);
}

if (!serviceAccount && (GOOGLE_SERVICE_ACCOUNT_JSON || GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || GOOGLE_CLIENT_EMAIL || GOOGLE_PRIVATE_KEY)) {
    console.warn(`⚠️ Google Service Account belum bisa dibaca. ${serviceAccountParseError ? `Detail: ${serviceAccountParseError}` : "Cek format Railway Variables."}`);
}

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

// ── STATE GLOBAL ─────────────────────────────────────────────
const statusReset     = {};
const statusExport    = {};
const budgetCustom    = {};        // { jid: { Konsumsi: 2000000, ... } }
const reminderAktif   = {};        // { jid: intervalId }
const cacheSheet      = {};        // ringan, bukan cache berat
const mutationQueues  = {};
const statusProviderAI = {
    ChatGPT: { blockedUntil: 0, reason: "", notifiedAt: 0 },
    Gemini: { blockedUntil: 0, reason: "", notifiedAt: 0 }
};
let   sockGlobal      = null;
let   sedangStart     = false;
let   reconnectTimer  = null;
let   jumlahReconnect = 0;
let   sudahStartKeepAlive = false;
let   lastAIFallbackLog = 0;
let   googleDocCache = null;
let   googleDocCacheAt = 0;
let   googleDocPromise = null;
let   binanceBalanceCache = { at: 0, number: "", data: null };
let   binancePriceCache = { at: 0, map: new Map() };
let   binanceIdrRateCache = { at: 0, rate: null, source: "", error: "" };

const HEADER_TRANSAKSI = ["Tanggal","Jenis","Kategori","Nominal","Keterangan","Dompet","Saldo"];
const BATAS_PESAN_WHATSAPP = 3500;
const BARIS_PER_HALAMAN = 20;
const GOOGLE_DOC_CACHE_TTL = 60 * 1000;

// ── UTILITAS ─────────────────────────────────────────────────
const tunggu      = ms => new Promise(r => setTimeout(r, ms));
const formatRupiah = n => Number(n||0).toLocaleString("id-ID");
const ambilNomorDariJid = jid => String(jid||"").split("@")[0].replace(/\D/g,"");

function sekarangWita() {
    return new Date(new Date().toLocaleString("en-US", { timeZone: APP_TIMEZONE }));
}

function tanggalHariIni() {
    return new Date().toLocaleDateString("id-ID",{
        timeZone: APP_TIMEZONE, day:"2-digit", month:"2-digit", year:"numeric"
    }).replace(/\./g,"/");
}

function labelPeriode(tipe) {
    if (tipe === "hari") return "Hari Ini";
    if (tipe === "minggu") return "7 Hari Terakhir";
    if (tipe === "bulan") return "Bulan Ini";
    if (tipe === "tahun") return "Tahun Ini";
    return "Semua Waktu";
}

const NAMA_BULAN = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const ALIAS_BULAN = {
    jan:1, januari:1, feb:2, februari:2, mar:3, maret:3, apr:4, april:4, mei:5, jun:6, juni:6,
    jul:7, juli:7, agu:8, agustus:8, sep:9, sept:9, september:9, okt:10, oktober:10,
    nov:11, november:11, des:12, desember:12
};

function buatOpsiPeriode(tipe = "bulan", opsi = {}) {
    const now = sekarangWita();
    const tahun = Number(opsi.tahun || opsi.year || now.getFullYear());
    const bulan = Math.min(12, Math.max(1, Number(opsi.bulan || opsi.month || now.getMonth() + 1)));
    if (tipe === "bulan") {
        return {
            tipe, tahun, bulan,
            key:`${tahun}-${String(bulan).padStart(2,"0")}`,
            label:`${NAMA_BULAN[bulan - 1]} ${tahun}`,
            end:new Date(tahun, bulan, 0, 23, 59, 59, 999)
        };
    }
    if (tipe === "tahun") {
        return { tipe, tahun, bulan:null, key:String(tahun), label:`Tahun ${tahun}`, end:new Date(tahun, 11, 31, 23, 59, 59, 999) };
    }
    return { tipe, tahun, bulan, key:tipe, label:labelPeriode(tipe), end:now };
}

function parsePeriodePesan(teks, tipeDefault = "bulan") {
    const raw = String(teks || "").toLowerCase();
    const now = sekarangWita();
    const yearMatch = raw.match(/\b(20\d{2})\b/);
    const tahun = yearMatch ? Number(yearMatch[1]) : now.getFullYear();
    const bulanEntry = Object.entries(ALIAS_BULAN).find(([alias]) => new RegExp(`\\b${alias}\\b`, "i").test(raw));
    if (/\b(tahun|tahunan|annual)\b/i.test(raw) && !bulanEntry) return buatOpsiPeriode("tahun", { tahun });
    if (bulanEntry) return buatOpsiPeriode("bulan", { tahun, bulan:bulanEntry[1] });
    if (/\b(bulan lalu|bulan sebelumnya)\b/i.test(raw)) {
        const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        return buatOpsiPeriode("bulan", { tahun:previous.getFullYear(), bulan:previous.getMonth() + 1 });
    }
    return buatOpsiPeriode(tipeDefault, { tahun, bulan:now.getMonth() + 1 });
}

function parsePeriodeKey(value) {
    const raw = String(value || "").trim();
    const monthMatch = raw.match(/^(20\d{2})-(0[1-9]|1[0-2])$/);
    if (monthMatch) return buatOpsiPeriode("bulan", { tahun:Number(monthMatch[1]), bulan:Number(monthMatch[2]) });
    const yearMatch = raw.match(/^(20\d{2})$/);
    if (yearMatch) return buatOpsiPeriode("tahun", { tahun:Number(yearMatch[1]) });
    return buatOpsiPeriode("bulan");
}

function potongTeks(value, max = 18) {
    const teks = String(value ?? "-").replace(/\s+/g, " ").trim();
    if (teks.length <= max) return teks;
    return `${teks.slice(0, Math.max(1, max - 1))}…`;
}

function padCell(value, width, align = "left") {
    const text = potongTeks(value, width);
    const gap = Math.max(width - text.length, 0);
    return align === "right" ? `${" ".repeat(gap)}${text}` : `${text}${" ".repeat(gap)}`;
}

function buatTabelWhatsapp(columns, rows, { title = "", maxRows = BARIS_PER_HALAMAN, emptyText = "Tidak ada data." } = {}) {
    if (rows.length === 0) {
        return title ? `*${title}*\n_${emptyText}_` : `_${emptyText}_`;
    }

    const widths = columns.map(col => {
        const minWidth = String(col.label || col.key).length;
        const contentWidth = Math.max(minWidth, ...rows.map(row => String(row[col.key] ?? "").length));
        return Math.min(col.width || 18, Math.max(minWidth, contentWidth));
    });

    const header = columns.map((col, i) => padCell(col.label || col.key, widths[i], col.align)).join(" | ");
    const separator = widths.map(w => "-".repeat(w)).join("-|-");
    const pageSize = Number.isFinite(maxRows) && maxRows > 0 ? Math.floor(maxRows) : rows.length;
    const jumlahHalaman = Math.ceil(rows.length / pageSize);

    return Array.from({ length: jumlahHalaman }, (_, halaman) => {
        const data = rows.slice(halaman * pageSize, (halaman + 1) * pageSize);
        const body = data.map(row => columns.map((col, i) => padCell(row[col.key], widths[i], col.align)).join(" | ")).join("\n");
        const judulHalaman = title
            ? `*${title}${jumlahHalaman > 1 ? ` (${halaman + 1}/${jumlahHalaman})` : ""}*\n`
            : "";
        return `${judulHalaman}\`\`\`\n${header}\n${separator}\n${body}\n\`\`\``;
    }).join("\n\n");
}

function pecahPesanWhatsapp(value, maxChars = BATAS_PESAN_WHATSAPP) {
    const teks = String(value ?? "").trim();
    if (!teks || teks.length <= maxChars) return teks ? [teks] : [];

    const hasil = [];
    let aktif = "";
    const tambah = bagian => {
        const kandidat = aktif ? `${aktif}\n\n${bagian}` : bagian;
        if (kandidat.length <= maxChars) {
            aktif = kandidat;
            return;
        }
        if (aktif) hasil.push(aktif);
        aktif = "";

        if (bagian.length <= maxChars) {
            aktif = bagian;
            return;
        }

        let potongan = "";
        for (const baris of bagian.split("\n")) {
            const kandidatBaris = potongan ? `${potongan}\n${baris}` : baris;
            if (kandidatBaris.length <= maxChars) {
                potongan = kandidatBaris;
                continue;
            }
            if (potongan) hasil.push(potongan);
            potongan = baris;
            while (potongan.length > maxChars) {
                hasil.push(potongan.slice(0, maxChars));
                potongan = potongan.slice(maxChars);
            }
        }
        aktif = potongan;
    };

    for (const bagian of teks.split(/\n{2,}/).filter(Boolean)) tambah(bagian);
    if (aktif) hasil.push(aktif);
    return hasil;
}

function csvCell(value) {
    return `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
}

function maskNomor(nomor) {
    const angka = String(nomor || "").replace(/\D/g, "");
    if (!angka) return "-";
    if (angka.length <= 6) return angka.replace(/\d(?=\d{2})/g, "•");
    return `${angka.slice(0, 4)}${"•".repeat(Math.max(3, angka.length - 7))}${angka.slice(-3)}`;
}

function nomorAdalahSuperAdmin(nomor) {
    return SUPER_ADMIN_NUMBERS.includes(String(nomor || "").replace(/\D/g, ""));
}

function nomorPunyaAksesBinance(jidAtauNomor) {
    const nomor = String(jidAtauNomor || "").split("@")[0].replace(/\D/g, "");
    return !!BINANCE_BALANCE_NUMBER && nomor === BINANCE_BALANCE_NUMBER;
}

function binanceTerkonfigurasi() {
    return !!(BINANCE_BALANCE_NUMBER && BINANCE_API_KEY_FOR_BALANCE && BINANCE_API_SECRET_FOR_BALANCE);
}

function formatUSDT(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return "0.00 USDT";
    return `${n.toLocaleString("id-ID", { minimumFractionDigits:2, maximumFractionDigits:2 })} USDT`;
}

function formatCrypto(value, maxDigits = 8) {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return "0";
    return n.toLocaleString("id-ID", { maximumFractionDigits:maxDigits });
}

async function binanceFetchJson(url, options = {}) {
    const res = await fetch(url, options);
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; }
    catch { data = { raw:text }; }
    if (!res.ok) {
        const message = data.msg || data.message || data.raw || `HTTP ${res.status}`;
        throw new Error(`Binance API: ${message}`);
    }
    return data;
}

async function binanceSignedRequest(path, params = {}) {
    if (!binanceTerkonfigurasi()) {
        throw new Error("API Key dan Secret Binance untuk nomor khusus belum diisi di Railway.");
    }
    const query = new URLSearchParams({
        ...params,
        recvWindow:String(BINANCE_RECV_WINDOW),
        timestamp:String(Date.now())
    });
    const signature = crypto.createHmac("sha256", BINANCE_API_SECRET_FOR_BALANCE)
        .update(query.toString())
        .digest("hex");
    query.set("signature", signature);
    return binanceFetchJson(`${BINANCE_BASE_URL}${path}?${query.toString()}`, {
        headers:{ "X-MBX-APIKEY": BINANCE_API_KEY_FOR_BALANCE }
    });
}

async function ambilHargaBinanceUSDT(opsi = {}) {
    const ttlMs = BINANCE_PRICE_CACHE_SECONDS * 1000;
    const masihSegar = binancePriceCache.map && !opsi.force && Date.now() - binancePriceCache.at < ttlMs;
    if (masihSegar) return binancePriceCache.map;
    const rows = await binanceFetchJson(`${BINANCE_BASE_URL}/api/v3/ticker/price`);
    const map = new Map();
    for (const row of rows || []) {
        const symbol = String(row.symbol || "").toUpperCase();
        const price = Number(row.price || 0);
        if (symbol && price > 0) map.set(symbol, price);
    }
    binancePriceCache = { at:Date.now(), map };
    return map;
}

function rateUSDTIDRDariMapHarga(prices) {
    if (!prices || typeof prices.get !== "function") return null;
    const kandidatLangsung = [BINANCE_USDT_IDR_SYMBOL, "USDTIDR", "USDTBIDR"];
    for (const symbol of kandidatLangsung) {
        const rate = Number(prices.get(symbol) || 0);
        if (rate > 0) return { rate, source:`Binance ${symbol}` };
    }
    const kandidatInverse = ["IDRUSDT", "BIDRUSDT"];
    for (const symbol of kandidatInverse) {
        const inverse = Number(prices.get(symbol) || 0);
        if (inverse > 0) return { rate:1 / inverse, source:`Binance 1/${symbol}` };
    }
    return null;
}

async function ambilRateUSDTIDR(prices, opsi = {}) {
    if (BINANCE_USDT_IDR_MODE === "manual") {
        return BINANCE_USDT_IDR_RATE_FALLBACK > 0
            ? { rate:BINANCE_USDT_IDR_RATE_FALLBACK, source:"manual Railway", fallback:true }
            : { rate:null, source:"manual belum diisi", fallback:true };
    }

    const dariMap = rateUSDTIDRDariMapHarga(prices);
    if (dariMap) {
        binanceIdrRateCache = { at:Date.now(), rate:dariMap.rate, source:dariMap.source, error:"" };
        return dariMap;
    }

    const ttlMs = BINANCE_IDR_RATE_CACHE_SECONDS * 1000;
    const cacheSegar = binanceIdrRateCache.rate && !opsi.force && Date.now() - binanceIdrRateCache.at < ttlMs;
    if (cacheSegar) return { rate:binanceIdrRateCache.rate, source:binanceIdrRateCache.source || "cache Binance" };

    if (BINANCE_USDT_IDR_SYMBOL) {
        try {
            const row = await binanceFetchJson(`${BINANCE_BASE_URL}/api/v3/ticker/price?symbol=${encodeURIComponent(BINANCE_USDT_IDR_SYMBOL)}`);
            const rate = Number(row && row.price || 0);
            if (rate > 0) {
                const info = { rate, source:`Binance ${BINANCE_USDT_IDR_SYMBOL}` };
                binanceIdrRateCache = { at:Date.now(), rate, source:info.source, error:"" };
                return info;
            }
        } catch (err) {
            binanceIdrRateCache.error = err.message || String(err);
        }
    }

    if (BINANCE_USDT_IDR_RATE_FALLBACK > 0) {
        return { rate:BINANCE_USDT_IDR_RATE_FALLBACK, source:"fallback Railway", fallback:true, error:binanceIdrRateCache.error || null };
    }
    return { rate:null, source:"USDTIDR belum tersedia di Binance dan fallback kosong", error:binanceIdrRateCache.error || null };
}

function hargaAsetKeUSDT(asset, prices, idrRate = null) {
    const a = String(asset || "").toUpperCase();
    const stableCoins = ["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "DAI"];
    if (stableCoins.includes(a)) return { price:1, source:a === "USDT" ? "USDT" : `${a}/USDT≈1` };
    if (["IDR", "BIDR"].includes(a) && idrRate > 0) {
        return { price:1 / idrRate, source:`IDR/USDT dari rate ${formatRupiah(Math.round(idrRate))}` };
    }
    const direct = prices.get(`${a}USDT`);
    if (direct) return { price:direct, source:`${a}USDT` };
    const quoteBridges = ["BTC", "ETH", "BNB", "USDC", "FDUSD", "BUSD"];
    for (const bridge of quoteBridges) {
        const pair = prices.get(`${a}${bridge}`);
        const bridgeUsdt = bridge === "USDT" ? 1 : prices.get(`${bridge}USDT`);
        if (pair && bridgeUsdt) return { price:pair * bridgeUsdt, source:`${a}${bridge} × ${bridge}USDT` };
    }
    const inverse = prices.get(`USDT${a}`);
    if (inverse) return { price:1 / inverse, source:`1 / USDT${a}` };
    return { price:null, source:"Belum ada pair USDT" };
}

function formatHargaUSDTPerKoin(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return "-";
    const maxDigits = n >= 100 ? 2 : n >= 1 ? 4 : 8;
    return `${n.toLocaleString("id-ID", { minimumFractionDigits: n >= 1 ? 2 : 0, maximumFractionDigits:maxDigits })} USDT`;
}
async function ambilSaldoBinance(nomor, opsi = {}) {
    const nomorBersih = String(nomor || "").replace(/\D/g, "");
    if (!nomorPunyaAksesBinance(nomorBersih)) {
        return { enabled:false, available:false, message:"Integrasi Binance hanya aktif untuk nomor khusus." };
    }
    if (!binanceTerkonfigurasi()) {
        return { enabled:true, available:false, configured:false, message:"API Key dan Secret Binance belum diisi di Railway." };
    }
    const cacheMs = BINANCE_CACHE_SECONDS * 1000;
    if (!opsi.force && binanceBalanceCache.data && binanceBalanceCache.number === nomorBersih && Date.now() - binanceBalanceCache.at < cacheMs) {
        return binanceBalanceCache.data;
    }
    const [account, prices] = await Promise.all([
        binanceSignedRequest("/api/v3/account"),
        ambilHargaBinanceUSDT({ force: !!opsi.forcePrice }).catch(() => new Map())
    ]);
    const idrRateInfo = await ambilRateUSDTIDR(prices, { force: !!opsi.forcePrice });
    const idrRate = Number(idrRateInfo.rate || 0) || null;
    const assets = (account.balances || [])
        .map(row => {
            const asset = String(row.asset || "").toUpperCase();
            const free = Number(row.free || 0);
            const locked = Number(row.locked || 0);
            const total = free + locked;
            const konversi = hargaAsetKeUSDT(asset, prices, idrRate);
            const priceUsdt = konversi.price;
            const valueUsdt = priceUsdt ? total * priceUsdt : null;
            return { asset, free, locked, total, priceUsdt, valueUsdt, priceSource:konversi.source };
        })
        .filter(row => row.total > 0)
        .filter(row => BINANCE_MIN_ASSET_USDT <= 0 || row.valueUsdt === null || row.valueUsdt >= BINANCE_MIN_ASSET_USDT)
        .sort((a,b) => Number(b.valueUsdt || 0) - Number(a.valueUsdt || 0) || b.total - a.total);
    const totalUsdt = assets.reduce((sum, row) => sum + Number(row.valueUsdt || 0), 0);
    const totalIdr = idrRate > 0 ? totalUsdt * idrRate : null;
    const result = {
        enabled:true,
        configured:true,
        available:true,
        number:nomorBersih,
        accountType:account.accountType || "SPOT",
        canTrade:!!account.canTrade,
        canWithdraw:!!account.canWithdraw,
        canDeposit:!!account.canDeposit,
        totalUsdt,
        totalIdr,
        idrRate:idrRate || null,
        idrRateSource:idrRateInfo.source || null,
        idrRateError:idrRateInfo.error || null,
        idrRateFallback:!!idrRateInfo.fallback,
        assetCount:assets.length,
        assets:assets.slice(0, BINANCE_TOP_ASSETS_LIMIT),
        refreshedAt:new Date().toLocaleString("id-ID", { timeZone: APP_TIMEZONE }),
        priceRefreshedAt:new Date(binancePriceCache.at || Date.now()).toLocaleString("id-ID", { timeZone: APP_TIMEZONE }),
        cacheSeconds:BINANCE_CACHE_SECONDS,
        priceCacheSeconds:BINANCE_PRICE_CACHE_SECONDS,
        minAssetUsdt:BINANCE_MIN_ASSET_USDT
    };
    binanceBalanceCache = { at:Date.now(), number:nomorBersih, data:result };
    return result;
}

function ringkasSaldoBinanceUntukWhatsapp(data) {
    if (!data || !data.enabled) return "";
    if (!data.available) return `🔶 *BINANCE REALTIME*\n${data.message || "Saldo Binance belum tersedia."}`;
    let teks = `💎 *BINANCE SPOT REALTIME*\n`;
    teks += `Total estimasi: *${formatUSDT(data.totalUsdt)}*`;
    if (data.totalIdr !== null && data.totalIdr !== undefined) {
        teks += `\nEstimasi rupiah: *Rp ${formatRupiah(Math.round(data.totalIdr))}*`;
        if (data.idrRate) teks += `\nRate USDT/IDR: Rp ${formatRupiah(Math.round(data.idrRate))} · ${data.idrRateSource || "Binance"}`;
    }
    teks += `\nAset aktif: *${data.assetCount}* · Saldo: ${data.refreshedAt}`;
    if (data.priceRefreshedAt) teks += `\nHarga koin: ${data.priceRefreshedAt} · cache ${data.priceCacheSeconds || 0} detik`;
    if (data.assets && data.assets.length) {
        teks += "\n\n🏦 *Konversi Aset ke USDT:*";
        for (const row of data.assets.slice(0, 10)) {
            const harga = row.priceUsdt ? ` @ ${formatHargaUSDTPerKoin(row.priceUsdt)}` : " @ belum ada pair";
            const nilai = row.valueUsdt !== null && row.valueUsdt !== undefined ? ` = *${formatUSDT(row.valueUsdt)}*` : "";
            teks += `\n• ${row.asset}: ${formatCrypto(row.total)}${harga}${nilai}`;
        }
    }
    return teks;
}

async function buatRingkasanBinance(jid) {
    const nomor = ambilNomorDariJid(jid);
    const data = await ambilSaldoBinance(nomor, { force:true, forcePrice:true });
    return ringkasSaldoBinanceUntukWhatsapp(data) || "ℹ️ Fitur Binance hanya aktif untuk nomor khusus.";
}

function dapatkanBaseUrlDashboard() {
    const normalisasi = value => {
        const bersih = String(value || "").trim().replace(/\/+$/, "");
        if (!bersih) return "";
        if (/^https?:\/\//i.test(bersih)) return bersih;
        if (/^(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(bersih)) return `http://${bersih}`;
        return `https://${bersih}`;
    };
    if (DASHBOARD_BASE_URL) return normalisasi(DASHBOARD_BASE_URL);
    if (process.env.RAILWAY_PUBLIC_DOMAIN) return normalisasi(process.env.RAILWAY_PUBLIC_DOMAIN);
    if (process.env.SPACE_HOST) return normalisasi(process.env.SPACE_HOST);
    return `http://localhost:${PORT}`;
}

function kunciTandaTanganDashboard() {
    return DASHBOARD_SECRET || crypto.createHash("sha256").update(GOOGLE_SERVICE_ACCOUNT_JSON).digest("hex");
}

function base64Url(value) {
    return Buffer.from(value).toString("base64url");
}

function tandaTanganDashboard(payload) {
    return crypto.createHmac("sha256", kunciTandaTanganDashboard()).update(payload).digest("base64url");
}

function buatTokenAksesDashboard(nomor, role = "user") {
    const payload = base64Url(JSON.stringify({
        v: 1,
        role: role === "admin" ? "admin" : "user",
        number: String(nomor || "").replace(/\D/g, ""),
        exp: Date.now() + DASHBOARD_LINK_DAYS * 24 * 60 * 60 * 1000
    }));
    return `${payload}.${tandaTanganDashboard(payload)}`;
}

function verifikasiTokenAksesDashboard(token) {
    try {
        const [payload, signature] = String(token || "").split(".");
        if (!payload || !signature) return null;
        const expected = tandaTanganDashboard(payload);
        const actualBuffer = Buffer.from(signature);
        const expectedBuffer = Buffer.from(expected);
        if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
        const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        const number = String(data.number || "").replace(/\D/g, "");
        if (data.v !== 1 || !number || Number(data.exp) < Date.now()) return null;
        if (data.role === "admin" && !nomorAdalahSuperAdmin(number)) return null;
        return { role: data.role === "admin" ? "admin" : "user", number, expiresAt: Number(data.exp) };
    } catch {
        return null;
    }
}

function ambilAksesDashboard(req, urlObj) {
    const accessHeader = req.headers["x-dashboard-access"] || req.headers.authorization || "";
    const accessToken = String(accessHeader).replace(/^Bearer\s+/i, "").trim() || urlObj.searchParams.get("access") || "";
    const signedAccess = verifikasiTokenAksesDashboard(accessToken);
    if (signedAccess) return signedAccess;

    const legacyToken = String(req.headers["x-dashboard-token"] || urlObj.searchParams.get("token") || "").trim();
    if (DASHBOARD_TOKEN && legacyToken === DASHBOARD_TOKEN) {
        return { role: "admin", number: SUPER_ADMIN_NUMBERS[0] || WHATSAPP_PHONE_NUMBER, legacy: true };
    }
    return null;
}

function buatLinkDashboard(jid, role = "user") {
    const nomor = ambilNomorDariJid(jid);
    const token = buatTokenAksesDashboard(nomor, role);
    return `${dapatkanBaseUrlDashboard()}/d/${encodeURIComponent(token)}`;
}

function jsonResponse(res, statusCode, data) {
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    });
    res.end(JSON.stringify(data));
}

function buatHttpError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

async function bacaJsonBody(req, maxBytes = 64 * 1024) {
    return new Promise((resolve, reject) => {
        let raw = "";
        req.on("data", chunk => {
            raw += chunk;
            if (Buffer.byteLength(raw) > maxBytes) {
                reject(buatHttpError("Payload terlalu besar.", 413));
                req.destroy();
            }
        });
        req.on("end", () => {
            if (!raw.trim()) return resolve({});
            try { resolve(JSON.parse(raw)); }
            catch { reject(buatHttpError("Body JSON tidak valid.")); }
        });
        req.on("error", reject);
    });
}

function nomorTargetDashboard(akses, urlObj) {
    const diminta = String(urlObj.searchParams.get("nomor") || "").replace(/\D/g, "");
    if (akses.role === "admin" && diminta) return diminta;
    return akses.number;
}

function ambilTipeDariPesan(pesan, fallback = "bulan") {
    if (pesan.includes("hari")) return "hari";
    if (pesan.includes("minggu")) return "minggu";
    if (pesan.includes("semua") || pesan.includes("total")) return "semua";
    return fallback;
}

function formatProviderAI() {
    const chatgptAktif = !!openai && statusProviderAI.ChatGPT.blockedUntil <= Date.now();
    const geminiAktif = !!ai && statusProviderAI.Gemini.blockedUntil <= Date.now();
    if (chatgptAktif && geminiAktif) return `ChatGPT (${OPENAI_MODEL}) utama, Gemini fallback`;
    if (chatgptAktif) return `ChatGPT (${OPENAI_MODEL})`;
    if (geminiAktif && openai) return "Gemini aktif, ChatGPT sedang cooldown";
    if (geminiAktif) return "Gemini";
    if (openai || ai) return "AI sedang cooldown, fallback lokal aktif";
    return "Tidak aktif";
}

function buatAuthGoogle() {
    if (!serviceAccount?.client_email || !serviceAccount?.private_key) {
        throw new Error("Google Service Account belum valid. Isi GOOGLE_SERVICE_ACCOUNT_JSON atau pakai GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY.");
    }
    const privateKey = normalisasiPrivateKey(serviceAccount.private_key);
    try {
        crypto.createPrivateKey(privateKey);
    } catch (e) {
        throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON private_key tidak valid. Di Railway, pastikan private_key masih lengkap dari '-----BEGIN PRIVATE KEY-----' sampai '-----END PRIVATE KEY-----' dan gunakan \\n untuk baris baru, atau pakai GOOGLE_SERVICE_ACCOUNT_JSON_BASE64.");
    }
    return new JWT({
        email: serviceAccount.client_email,
        key: privateKey,
        scopes:["https://www.googleapis.com/auth/spreadsheets"]
    });
}

async function getGoogleDoc(forceRefresh = false) {
    if (!SPREADSHEET_ID) throw new Error("SPREADSHEET_ID belum diisi.");
    if (!serviceAccount) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON belum valid.");
    const cacheMasihAktif = googleDocCache && Date.now() - googleDocCacheAt < GOOGLE_DOC_CACHE_TTL;
    if (!forceRefresh && cacheMasihAktif) return googleDocCache;
    if (googleDocPromise) return googleDocPromise;

    googleDocPromise = (async () => {
        const doc = googleDocCache || new GoogleSpreadsheet(SPREADSHEET_ID, buatAuthGoogle());
        try {
            await doc.loadInfo();
        } catch(e) {
            if (googleDocCache) {
                console.warn("⚠️ Google Sheets refresh gagal, memakai koneksi cache:", e.message || e);
                googleDocCacheAt = Date.now();
                return googleDocCache;
            }
            throw e;
        }
        googleDocCache = doc;
        googleDocCacheAt = Date.now();
        return doc;
    })();

    try {
        return await googleDocPromise;
    } finally {
        googleDocPromise = null;
    }
}

async function getSheetByNomor(jid) {
    const nomor = ambilNomorDariJid(jid);
    if (!nomor) throw new Error("Nomor WhatsApp tidak valid.");
    const cached = cacheSheet[nomor];
    if (cached && Date.now() - cached.at < GOOGLE_DOC_CACHE_TTL) return cached.sheet;

    const doc = await getGoogleDoc();
    let sheet = doc.sheetsByTitle[nomor];
    if (!sheet) {
        sheet = await doc.addSheet({ title: nomor, headerValues: HEADER_TRANSAKSI });
    } else {
        try {
            await sheet.loadHeaderRow();
            const missing = HEADER_TRANSAKSI.some(h => !sheet.headerValues.includes(h));
            if (missing) await sheet.setHeaderRow(HEADER_TRANSAKSI);
        } catch { await sheet.setHeaderRow(HEADER_TRANSAKSI); }
    }
    cacheSheet[nomor] = { sheet, at: Date.now() };
    return sheet;
}

function jalankanMutasiNomor(nomor, operasi) {
    const sebelumnya = mutationQueues[nomor] || Promise.resolve();
    const berikutnya = sebelumnya.catch(() => {}).then(operasi);
    const antrean = berikutnya.catch(() => {}).finally(() => {
        if (mutationQueues[nomor] === antrean) delete mutationQueues[nomor];
    });
    mutationQueues[nomor] = antrean;
    return berikutnya;
}

// ── NORMALISASI ──────────────────────────────────────────────
function normalisasiJenis(j) {
    const t = String(j||"").toLowerCase().trim();
    if (["pemasukan","masuk","income","pendapatan"].includes(t)) return "Pemasukan";
    return "Pengeluaran";
}

function parseNominalDariTeks(teks) {
    const m = String(teks||"").match(/(?:rp\s*)?(\d+(?:[\.,]\d+)?)\s*(k|rb|ribu|jt|juta|m|mn|milyar|miliar)?\b/i);
    if (!m) return null;
    let n = Number(String(m[1]).replace(",","."));
    const s = String(m[2]||"").toLowerCase();
    if (["k","rb","ribu"].includes(s)) n *= 1000;
    if (["jt","juta"].includes(s))    n *= 1000000;
    if (["m","mn","milyar","miliar"].includes(s)) n *= 1000000000;
    if (!Number.isFinite(n)||n<=0) return null;
    return { nominal: Math.round(n), raw: m[0] };
}

function deteksiDompet(teks) {
    const p = String(teks||"").toLowerCase();
    if (/\b(shopeepay|spay)\b/.test(p)) return "shopeepay";
    if (/\bgopay\b/.test(p))  return "gopay";
    if (/\bovo\b/.test(p))    return "ovo";
    if (/\bdana\b/.test(p))   return "dana";
    if (/\bbca\b/.test(p))    return "bca";
    if (/\bbri\b/.test(p))    return "bri";
    if (/\bbni\b/.test(p))    return "bni";
    if (/\bmandiri\b/.test(p)) return "mandiri";
    if (/\b(cash|tunai)\b/.test(p)) return "cash";
    return "cash";
}

const KATALOG_KATEGORI = [
    { name:"Konsumsi", type:"Pengeluaran", group:"Kebutuhan", color:"#e06c47", budget:3000000, aliases:["makanan","makan minum","kuliner"], keywords:["makan","minum","kopi","nasi","ayam","resto","restoran","warung","gofood","grabfood","camilan","sarapan","makan siang","makan malam","jajan"] },
    { name:"Belanja", type:"Pengeluaran", group:"Kebutuhan", color:"#cf8c26", budget:1500000, aliases:["belanja harian","sembako"], keywords:["belanja","sembako","pasar","supermarket","minimarket","indomaret","alfamart","kebutuhan dapur","sayur","buah","galon"] },
    { name:"Transportasi", type:"Pengeluaran", group:"Kebutuhan", color:"#2d82c7", budget:900000, aliases:["transport"], keywords:["grab","gojek","ojek","taxi","taksi","angkot","bus","kereta","tiket kendaraan","parkir","tol","transport"] },
    { name:"Kendaraan", type:"Pengeluaran", group:"Kebutuhan", color:"#39718c", budget:900000, aliases:["mobil","motor"], keywords:["bensin","pertalite","pertamax","solar","servis motor","service motor","servis mobil","service mobil","oli","ban","cuci mobil","cuci motor","sparepart"] },
    { name:"Utilitas", type:"Pengeluaran", group:"Kebutuhan", color:"#3f7f70", budget:1200000, aliases:["tagihan","tagihan rumah"], keywords:["listrik","air","pdam","gas","pln","iuran lingkungan","sampah","tagihan rumah"] },
    { name:"Komunikasi & Internet", type:"Pengeluaran", group:"Kebutuhan", color:"#3c66b1", budget:600000, aliases:["internet","komunikasi"], keywords:["wifi","internet","pulsa","paket data","kuota","telkomsel","indihome","xl","axis","tri","smartfren"] },
    { name:"Tempat Tinggal", type:"Pengeluaran", group:"Kebutuhan", color:"#7c68a8", budget:2000000, aliases:["rumah","kos"], keywords:["sewa","kos","kost","kontrakan","cicilan rumah","kpr","renovasi","perbaikan rumah"] },
    { name:"Kesehatan & Perawatan", type:"Pengeluaran", group:"Kebutuhan", color:"#c45872", budget:1200000, aliases:["kesehatan","medis"], keywords:["obat","dokter","klinik","rumah sakit","vitamin","apotek","laboratorium","medical check","terapi"] },
    { name:"Perawatan Diri", type:"Pengeluaran", group:"Gaya Hidup", color:"#c06f9a", budget:500000, aliases:["skincare","salon"], keywords:["skincare","salon","barbershop","potong rambut","kosmetik","makeup","spa","parfum","perawatan diri"] },
    { name:"Pakaian", type:"Pengeluaran", group:"Gaya Hidup", color:"#9a65b5", budget:600000, aliases:["fashion","pakaian & aksesori"], keywords:["baju","celana","sepatu","sandal","tas","jam tangan","pakaian","fashion","aksesori"] },
    { name:"Rumah Tangga", type:"Pengeluaran", group:"Kebutuhan", color:"#7d8e52", budget:700000, aliases:["perlengkapan rumah"], keywords:["sabun cuci","deterjen","alat rumah","perabot","furnitur","furniture","alat dapur","perlengkapan rumah"] },
    { name:"Edukasi & Buku", type:"Pengeluaran", group:"Pengembangan", color:"#4775a8", budget:700000, aliases:["pendidikan","edukasi"], keywords:["buku","kursus","sekolah","kuliah","edukasi","kelas","pelatihan","sertifikasi","les","bootcamp"] },
    { name:"Anak & Keluarga", type:"Pengeluaran", group:"Kebutuhan", color:"#bc7655", budget:2000000, aliases:["keluarga","anak"], keywords:["susu anak","anak","popok","mainan anak","keluarga","uang sekolah","uang jajan anak","baby"] },
    { name:"Hiburan", type:"Pengeluaran", group:"Gaya Hidup", color:"#6d62bd", budget:750000, aliases:["entertainment"], keywords:["game","film","bioskop","hiburan","nonton","konser","netflix","spotify","youtube premium","streaming","hobi"] },
    { name:"Liburan & Perjalanan", type:"Pengeluaran", group:"Gaya Hidup", color:"#238e9b", budget:1000000, aliases:["liburan","travel"], keywords:["liburan","hotel","villa","pesawat","travel","wisata","trip","tiket pesawat","penginapan"] },
    { name:"Elektronik & Gadget", type:"Pengeluaran", group:"Gaya Hidup", color:"#4e6792", budget:800000, aliases:["gadget","elektronik"], keywords:["hp","handphone","laptop","komputer","charger","earphone","headset","gadget","elektronik","aksesori hp"] },
    { name:"Hewan Peliharaan", type:"Pengeluaran", group:"Kebutuhan", color:"#8c7b55", budget:500000, aliases:["pet"], keywords:["kucing","anjing","petshop","makanan kucing","makanan anjing","dokter hewan","grooming"] },
    { name:"Sosial & Sedekah", type:"Pengeluaran", group:"Sosial", color:"#2e9677", budget:500000, aliases:["donasi","sedekah"], keywords:["sedekah","donasi","zakat","sumbangan","amal","sosial"] },
    { name:"Hadiah", type:"Keduanya", group:"Sosial", color:"#bd667a", budget:500000, aliases:["kado"], keywords:["hadiah","kado","traktir","ulang tahun","wedding gift"] },
    { name:"Pajak", type:"Pengeluaran", group:"Kewajiban", color:"#8d6657", budget:1000000, aliases:["administrasi","pajak & administrasi"], keywords:["pajak","pph","ppn","pbb","stnk","sim","paspor","visa","administrasi","materai"] },
    { name:"Asuransi", type:"Pengeluaran", group:"Kewajiban", color:"#526fa5", budget:700000, aliases:["proteksi"], keywords:["asuransi","bpjs","premi","proteksi"] },
    { name:"Cicilan & Utang", type:"Pengeluaran", group:"Kewajiban", color:"#b65555", budget:1500000, aliases:["cicilan","bayar utang"], keywords:["cicilan","bayar utang","angsuran","paylater","kartu kredit","pinjaman"] },
    { name:"Bisnis & Operasional", type:"Keduanya", group:"Bisnis", color:"#257d80", budget:1500000, aliases:["operasional","bisnis"], keywords:["modal usaha","stok dagang","operasional","iklan","ads","supplier","bahan baku","bisnis","usaha"] },
    { name:"Investasi & Tabungan", type:"Keduanya", group:"Finansial", color:"#23845e", budget:1000000, aliases:["investasi","tabungan"], keywords:["investasi","tabungan","deposito","reksadana","saham","obligasi","emas","crypto","kripto"] },
    { name:"Piutang", type:"Keduanya", group:"Finansial", color:"#698348", budget:0, aliases:["pinjaman keluar"], keywords:["piutang","meminjamkan","pinjamkan","dipinjam teman","bayar piutang"] },
    { name:"Pendapatan", type:"Pemasukan", group:"Pemasukan", color:"#18845b", budget:0, aliases:["gaji","salary"], keywords:["gaji","salary","upah","pendapatan","pemasukan","honor"] },
    { name:"Bonus & Sampingan", type:"Pemasukan", group:"Pemasukan", color:"#249677", budget:0, aliases:["bonus","sampingan"], keywords:["bonus","thr","komisi","sampingan","fee","insentif"] },
    { name:"Bisnis & Freelance", type:"Pemasukan", group:"Pemasukan", color:"#1d8790", budget:0, aliases:["freelance","hasil usaha"], keywords:["freelance","hasil usaha","penjualan jasa","proyek","project","klien","client"] },
    { name:"Investasi & Dividen", type:"Pemasukan", group:"Pemasukan", color:"#477e4d", budget:0, aliases:["dividen","hasil investasi"], keywords:["dividen","bunga deposito","capital gain","hasil investasi","kupon obligasi"] },
    { name:"Penjualan", type:"Pemasukan", group:"Pemasukan", color:"#4b8895", budget:0, aliases:["jual barang"], keywords:["jual","penjualan","terjual","laku"] },
    { name:"Refund & Cashback", type:"Pemasukan", group:"Pemasukan", color:"#507bad", budget:0, aliases:["refund","cashback"], keywords:["refund","cashback","pengembalian dana","reimburse","reimbursement"] },
    { name:"Utang", type:"Pemasukan", group:"Finansial", color:"#a65d5d", budget:0, aliases:["pinjaman masuk"], keywords:["utang","pinjam dari","dipinjami","pinjaman masuk"] },
    { name:"Lainnya", type:"Keduanya", group:"Lainnya", color:"#7a8490", budget:0, aliases:["lain-lain","lainnya"], keywords:[] }
];

function normalisasiTeksKategori(value) {
    return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function kategoriSesuaiJenis(item, jenis) {
    return item.type === "Keduanya" || item.type === normalisasiJenis(jenis);
}

function cocokkanNamaKategori(value, jenis = "Pengeluaran") {
    const dicari = normalisasiTeksKategori(value);
    if (!dicari) return null;
    const kandidat = KATALOG_KATEGORI.filter(item => kategoriSesuaiJenis(item, jenis));
    return kandidat.find(item => normalisasiTeksKategori(item.name) === dicari)
        || kandidat.find(item => (item.aliases || []).some(alias => normalisasiTeksKategori(alias) === dicari))
        || kandidat.find(item => normalisasiTeksKategori(item.name).includes(dicari) || dicari.includes(normalisasiTeksKategori(item.name)))
        || null;
}

function klasifikasiKategori(teks, jenis = "Pengeluaran") {
    const p = ` ${normalisasiTeksKategori(teks)} `;
    const kandidat = KATALOG_KATEGORI.filter(item => kategoriSesuaiJenis(item, jenis) && item.name !== "Lainnya");
    let terbaik = null;
    for (const item of kandidat) {
        let score = 0;
        const matches = [];
        for (const keyword of [...(item.keywords || []), ...(item.aliases || [])]) {
            const normalized = normalisasiTeksKategori(keyword);
            if (!normalized || !p.includes(` ${normalized} `)) continue;
            const words = normalized.split(" ").length;
            score += 2 + words * 2 + Math.min(normalized.length / 12, 2);
            matches.push(keyword);
        }
        if (!terbaik || score > terbaik.score) terbaik = { item, score, matches };
    }
    const fallbackName = normalisasiJenis(jenis) === "Pemasukan" ? "Pendapatan" : "Lainnya";
    if (!terbaik || terbaik.score <= 0) return { name:fallbackName, confidence:0, matches:[], group:fallbackName === "Pendapatan" ? "Pemasukan" : "Lainnya" };
    return { name:terbaik.item.name, group:terbaik.item.group, color:terbaik.item.color, matches:terbaik.matches, confidence:Math.min(99, Math.round(45 + terbaik.score * 7)) };
}

function deteksiKategori(teks, jenis) {
    return klasifikasiKategori(teks, jenis).name;
}

function normalisasiKategori(value, jenis, teksPendukung = "") {
    const cocok = cocokkanNamaKategori(value, jenis);
    if (cocok) return cocok.name;
    return deteksiKategori(`${value || ""} ${teksPendukung || ""}`, jenis);
}

// ── BUDGET DEFAULT ────────────────────────────────────────────
const BUDGET_DEFAULT = Object.fromEntries(
    KATALOG_KATEGORI.filter(item => item.budget > 0 && kategoriSesuaiJenis(item, "Pengeluaran"))
        .map(item => [item.name, item.budget])
);

function kunciBudget(jid) {
    return String(jid || "").replace(/\D/g, "");
}

function getBudget(jid) {
    return Object.assign({}, BUDGET_DEFAULT, budgetCustom[kunciBudget(jid)] || {});
}

function setBudgetKategori(jid, kategori, nominal) {
    const item = cocokkanNamaKategori(kategori, "Pengeluaran");
    if (!item || item.name === "Lainnya") throw buatHttpError("Kategori budget tidak dikenali.");
    const limit = Math.round(Number(nominal || 0));
    if (!Number.isFinite(limit) || limit < 0) throw buatHttpError("Limit budget tidak valid.");
    const key = kunciBudget(jid);
    if (!budgetCustom[key]) budgetCustom[key] = {};
    budgetCustom[key][item.name] = limit;
    return { name:item.name, limit };
}

function daftarKategoriUntukWeb() {
    return KATALOG_KATEGORI.map(item => ({
        name:item.name,
        type:item.type,
        group:item.group,
        color:item.color,
        budget:item.budget,
        aliases:item.aliases || [],
        examples:(item.keywords || []).slice(0, 5)
    }));
}

// ── GRAFIK ASCII ──────────────────────────────────────────────
function buatGrafikBar(data, judul = "GRAFIK", maxBar = 20) {
    if (!data || Object.keys(data).length === 0) {
        return `📊 *${judul}*\n_Tidak ada data untuk ditampilkan._`;
    }

    const entri = Object.entries(data).sort((a, b) => b[1] - a[1]);
    const maxVal = entri[0][1] || 1;
    let teks = `📊 *${judul}*\n${"─".repeat(30)}\n`;

    for (const [label, val] of entri) {
        const panjang = Math.round((val / maxVal) * maxBar);
        const bar = "█".repeat(Math.max(panjang, 1));
        const persen = ((val / (Object.values(data).reduce((a,b)=>a+b,0))) * 100).toFixed(1);
        const labelPendek = label.length > 14 ? label.slice(0,13)+"." : label.padEnd(14);
        teks += `${labelPendek} ${bar} ${persen}%\n`;
        teks += `${" ".repeat(15)} Rp ${formatRupiah(val)}\n`;
    }

    teks += `${"─".repeat(30)}`;
    return teks;
}

function buatGrafikTren(dataTren, judul = "TREN 7 HARI") {
    if (!dataTren || dataTren.length === 0) return `📈 *${judul}*\n_Tidak ada data._`;

    const maxVal = Math.max(...dataTren.map(d => Math.max(d.masuk, d.keluar)), 1);
    let teks = `📈 *${judul}*\n${"─".repeat(30)}\n`;

    for (const d of dataTren) {
        const barMasuk  = "🟢".repeat(Math.round((d.masuk  / maxVal) * 8));
        const barKeluar = "🔴".repeat(Math.round((d.keluar / maxVal) * 8));
        teks += `*${d.label}*\n`;
        teks += `  +${barMasuk || "○"} ${formatRupiah(d.masuk)}\n`;
        teks += `  -${barKeluar || "○"} ${formatRupiah(d.keluar)}\n`;
    }

    return teks;
}

// ── LAPORAN KEUANGAN ──────────────────────────────────────────
async function buatLaporanKeuangan(tipe, jid, opsi = {}) {
    const sheet = await getSheetByNomor(jid);
    const rows  = await sheet.getRows();

    let totalMasuk = 0, totalKeluar = 0;
    const detailKategori = {}, saldoDompet = {}, saldoDompetSemua = {}, trenHarian = {};
    const transaksi = [];
    const sekarang = sekarangWita();
    const periode = buatOpsiPeriode(tipe, opsi);
    const periodeTersedia = new Set();
    const ringkasanBulananMap = {};

    for (const row of rows) {
        const tglStr = String(row.get("Tanggal")||"");
        if (!tglStr) continue;
        const [tglBagian] = tglStr.split(", ");
        const [hari, bulan, tahun] = tglBagian.split("/").map(Number);
        if (!hari||!bulan||!tahun) continue;

        const tglTransaksi = new Date(tahun, bulan-1, hari);
        const selisihHari  = (sekarang - tglTransaksi)/(1000*60*60*24);
        const periodKey = `${tahun}-${String(bulan).padStart(2,"0")}`;
        periodeTersedia.add(periodKey);

        let valid = false;
        const tanggalSama = tglTransaksi.getDate()===sekarang.getDate() &&
            tglTransaksi.getMonth()===sekarang.getMonth() &&
            tglTransaksi.getFullYear()===sekarang.getFullYear();
        if (tipe==="hari"   && tanggalSama) valid=true;
        if (tipe==="minggu" && selisihHari>=0 && selisihHari<=7) valid=true;
        if (tipe==="bulan"  && bulan===periode.bulan && tahun===periode.tahun) valid=true;
        if (tipe==="tahun"  && tahun===periode.tahun) valid=true;
        if (tipe==="semua") valid=true;

        const jenis   = String(row.get("Jenis")||"").toLowerCase().trim();
        const nominal = Number(row.get("Nominal")||0);
        const dompet  = String(row.get("Dompet")||"cash").toLowerCase().trim();
        const keterangan = String(row.get("Keterangan")||"-");
        const kategori= normalisasiKategori(row.get("Kategori"), jenis==="pemasukan" ? "Pemasukan" : "Pengeluaran", keterangan);
        const saldoRow = Number(row.get("Saldo")||0);

        const perubahanSaldo = jenis==="pemasukan" ? nominal : -nominal;
        saldoDompetSemua[dompet] = (saldoDompetSemua[dompet]||0) + perubahanSaldo;
        if (tipe === "semua" || tglTransaksi <= periode.end) saldoDompet[dompet] = (saldoDompet[dompet]||0) + perubahanSaldo;

        if (!ringkasanBulananMap[periodKey]) ringkasanBulananMap[periodKey] = { key:periodKey, tahun, bulan, label:`${NAMA_BULAN[bulan-1]} ${tahun}`, masuk:0, keluar:0, transaksi:0, saldoBulan:0, saldoAkumulasi:0 };
        const monthly = ringkasanBulananMap[periodKey];
        if (jenis === "pemasukan") monthly.masuk += nominal;
        else monthly.keluar += nominal;
        monthly.transaksi += 1;
        monthly.saldoBulan = monthly.masuk - monthly.keluar;

        if (valid) {
            if (jenis==="pemasukan") totalMasuk  += nominal;
            else                     { totalKeluar += nominal; detailKategori[kategori]=(detailKategori[kategori]||0)+nominal; }

            transaksi.push({
                rowNumber: row.rowNumber,
                tanggal: tglBagian,
                tanggalLengkap: tglStr,
                tahun,
                bulan,
                hari,
                jenis: jenis==="pemasukan" ? "Pemasukan" : "Pengeluaran",
                kategori,
                nominal,
                keterangan,
                dompet,
                saldo: saldoRow
            });

            // tren harian (untuk grafik)
            const kunciTren = `${String(hari).padStart(2,"0")}/${String(bulan).padStart(2,"0")}`;
            if (!trenHarian[kunciTren]) trenHarian[kunciTren]={masuk:0,keluar:0};
            if (jenis==="pemasukan") trenHarian[kunciTren].masuk  += nominal;
            else                     trenHarian[kunciTren].keluar += nominal;
        }
    }

    let saldoBerjalan = 0;
    const ringkasanBulanan = Object.values(ringkasanBulananMap).sort((a,b)=>a.key.localeCompare(b.key)).map(item => {
        saldoBerjalan += item.saldoBulan;
        return { ...item, saldoAkumulasi:saldoBerjalan };
    });
    const saldoAkumulasi = Object.values(saldoDompet).reduce((sum, value) => sum + value, 0);
    return {
        totalMasuk, totalKeluar, saldo: totalMasuk-totalKeluar, saldoAkumulasi,
        detailKategori, saldoDompet, saldoDompetSemua, trenHarian, transaksi, rows,
        periode, periodeTersedia:[...periodeTersedia].sort().reverse(),
        ringkasanBulanan
    };
}

async function buatLaporanTabel(tipe, jid, opsi = {}) {
    const lap = await buatLaporanKeuangan(tipe, jid, opsi);
    const periode = lap.periode?.label || labelPeriode(tipe);
    const now = new Date().toLocaleString("id-ID", { timeZone: APP_TIMEZONE });
    const rasioSisa = lap.totalMasuk > 0 ? `${((lap.saldo / lap.totalMasuk) * 100).toFixed(0)}%` : "-";
    const transaksiMasuk = lap.transaksi.filter(trx => trx.jenis === "Pemasukan");
    const transaksiKeluar = lap.transaksi.filter(trx => trx.jenis === "Pengeluaran");
    const rataKeluar = transaksiKeluar.length ? lap.totalKeluar / transaksiKeluar.length : 0;
    const terbesarKeluar = transaksiKeluar.reduce((terbesar, trx) => trx.nominal > (terbesar?.nominal || 0) ? trx : terbesar, null);
    const kategoriTerbesar = Object.entries(lap.detailKategori).sort((a,b)=>b[1]-a[1])[0];

    const ringkasanRows = [
        { item: "Pemasukan", nilai: `Rp ${formatRupiah(lap.totalMasuk)}` },
        { item: "Pengeluaran", nilai: `Rp ${formatRupiah(lap.totalKeluar)}` },
        { item: "Saldo Bersih", nilai: `Rp ${formatRupiah(lap.saldo)}` },
        { item: "Tabungan Akumulasi", nilai: `Rp ${formatRupiah(lap.saldoAkumulasi)}` },
        { item: "Rasio Sisa", nilai: rasioSisa },
        { item: "Total Transaksi", nilai: formatRupiah(lap.transaksi.length) },
        { item: "Transaksi Masuk", nilai: formatRupiah(transaksiMasuk.length) },
        { item: "Transaksi Keluar", nilai: formatRupiah(transaksiKeluar.length) },
        { item: "Rata-rata Keluar", nilai: `Rp ${formatRupiah(rataKeluar)}` },
        { item: "Keluar Terbesar", nilai: terbesarKeluar ? `Rp ${formatRupiah(terbesarKeluar.nominal)}` : "-" }
    ];

    const totalKategori = Object.values(lap.detailKategori).reduce((a,b)=>a+b,0) || 1;
    const kategoriRows = Object.entries(lap.detailKategori)
        .sort((a,b)=>b[1]-a[1])
        .map(([kategori, nominal], i) => ({
            no: i + 1,
            kategori,
            nominal: formatRupiah(nominal),
            persen: `${((nominal / totalKategori) * 100).toFixed(0)}%`
        }));

    const dompetRows = Object.entries(lap.saldoDompet)
        .sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]))
        .map(([dompet, saldo]) => ({
            dompet: dompet.toUpperCase(),
            saldo: formatRupiah(saldo)
        }));

    const transaksiRows = lap.transaksi
        .slice()
        .reverse()
        .map((trx, index) => ({
            no: index + 1,
            tgl: trx.tanggalLengkap || trx.tanggal,
            tipe: trx.jenis === "Pemasukan" ? "+" : "-",
            kategori: trx.kategori,
            ket: trx.keterangan,
            dompet: trx.dompet.toUpperCase(),
            rp: formatRupiah(trx.nominal)
        }));

    let teks = `📋 *LAPORAN KEUANGAN - ${periode.toUpperCase()}*\n🕒 ${now}\n\n`;
    teks += buatTabelWhatsapp([
        { key:"item", label:"Ringkasan", width:14 },
        { key:"nilai", label:"Nilai", width:18, align:"right" }
    ], ringkasanRows, { title:"Ringkasan Utama" });

    teks += "\n\n" + buatTabelWhatsapp([
        { key:"no", label:"No", width:2, align:"right" },
        { key:"kategori", label:"Kategori", width:18 },
        { key:"nominal", label:"Nominal", width:13, align:"right" },
        { key:"persen", label:"%", width:4, align:"right" }
    ], kategoriRows, { title:"Pengeluaran per Kategori", emptyText:"Belum ada pengeluaran pada periode ini." });

    teks += "\n\n" + buatTabelWhatsapp([
        { key:"dompet", label:"Dompet", width:12 },
        { key:"saldo", label:"Saldo", width:15, align:"right" }
    ], dompetRows, { title:`Saldo Penutupan ${periode}`, emptyText:"Belum ada saldo dompet." });

    if (tipe === "tahun") {
        const recordedMonths = lap.ringkasanBulanan.filter(item => item.tahun === lap.periode.tahun);
        const monthMap = new Map(recordedMonths.map(item => [item.bulan, item]));
        let saldoCarry = recordedMonths.length ? recordedMonths[0].saldoAkumulasi - recordedMonths[0].saldoBulan : 0;
        const monthlyRows = Array.from({ length:12 }, (_, index) => {
            const item = monthMap.get(index + 1);
            if (item) saldoCarry = item.saldoAkumulasi;
            return {
                bulan:NAMA_BULAN[index],
                masuk:formatRupiah(item?.masuk || 0),
                keluar:formatRupiah(item?.keluar || 0),
                bersih:formatRupiah(item?.saldoBulan || 0),
                tabungan:formatRupiah(saldoCarry),
                trx:item?.transaksi || 0
            };
        });
        teks += "\n\n" + buatTabelWhatsapp([
            { key:"bulan", label:"Bulan", width:10 },
            { key:"masuk", label:"Masuk", width:13, align:"right" },
            { key:"keluar", label:"Keluar", width:13, align:"right" },
            { key:"bersih", label:"Bersih", width:13, align:"right" },
            { key:"tabungan", label:"Tabungan", width:13, align:"right" },
            { key:"trx", label:"Trx", width:4, align:"right" }
        ], monthlyRows, { title:`Ringkasan Bulanan ${lap.periode.tahun}`, maxRows:12, emptyText:"Belum ada transaksi pada tahun ini." });
    }

    teks += "\n\n" + buatTabelWhatsapp([
        { key:"no", label:"No", width:3, align:"right" },
        { key:"tgl", label:"Tanggal", width:20 },
        { key:"tipe", label:"+/-", width:3 },
        { key:"kategori", label:"Kategori", width:15 },
        { key:"ket", label:"Keterangan", width:18 },
        { key:"dompet", label:"Dompet", width:10 },
        { key:"rp", label:"Rp", width:12, align:"right" }
    ], transaksiRows, { title:"Semua Transaksi", maxRows:15, emptyText:"Belum ada transaksi pada periode ini." });

    const status = lap.transaksi.length === 0
        ? "Belum cukup data untuk membaca kondisi keuangan."
        : lap.saldo < 0
            ? `Arus kas sedang defisit Rp ${formatRupiah(Math.abs(lap.saldo))}. Prioritaskan pengeluaran wajib.`
            : kategoriTerbesar
                ? `Kategori terbesar adalah ${kategoriTerbesar[0]} sebesar Rp ${formatRupiah(kategoriTerbesar[1])}.`
                : `Arus kas positif Rp ${formatRupiah(lap.saldo)}.`;

    teks += `\n\n🧭 *SOROTAN OTOMATIS*\n${status}\nTabungan/saldo akumulasi hingga akhir periode: Rp ${formatRupiah(lap.saldoAkumulasi)}.`;
    if (terbesarKeluar) teks += `\nTransaksi keluar terbesar: ${terbesarKeluar.keterangan} (Rp ${formatRupiah(terbesarKeluar.nominal)}).`;
    teks += `\n\n💡 Pintasan: *dashboard*, *analisis*, *riwayat*, atau *export ${tipe === "semua" ? "semua" : periode.toLowerCase()}*.`;
    return teks;
}

async function buatRingkasanSaldo(jid) {
    const nomor = ambilNomorDariJid(jid);
    const [lapSemua, lapBulan] = await Promise.all([
        buatLaporanKeuangan("semua", jid),
        buatLaporanKeuangan("bulan", jid)
    ]);
    const dompet = Object.entries(lapSemua.saldoDompet)
        .sort((a,b) => Math.abs(b[1]) - Math.abs(a[1]));
    let teks =
`💰 *RINGKASAN SALDO*

*Saldo total:* Rp ${formatRupiah(lapSemua.saldo)}
*Masuk bulan ini:* Rp ${formatRupiah(lapBulan.totalMasuk)}
*Keluar bulan ini:* Rp ${formatRupiah(lapBulan.totalKeluar)}
*Sisa bulan ini:* Rp ${formatRupiah(lapBulan.saldo)}`;

    if (dompet.length) {
        teks += "\n\n👛 *Saldo per dompet:*";
        for (const [nama, saldo] of dompet) {
            teks += `\n• ${nama.toUpperCase()}: Rp ${formatRupiah(saldo)}`;
        }
    }
    if (nomorPunyaAksesBinance(nomor)) {
        try {
            const binance = await ambilSaldoBinance(nomor);
            teks += "\n\n" + ringkasSaldoBinanceUntukWhatsapp(binance);
        } catch(e) {
            teks += `\n\n🔶 *BINANCE REALTIME*\nBelum bisa mengambil saldo Binance: ${e.message || e}`;
        }
    }
    teks += "\n\nKetik *laporan*, *riwayat*, atau *saldo binance* jika ingin melihat detail.";
    return teks;
}

async function buatDashboardKeuangan(jid) {
    const lapBulan = await buatLaporanKeuangan("bulan", jid);
    const lapSemua = await buatLaporanKeuangan("semua", jid);
    const budget = getBudget(jid);
    const bulan = new Date().toLocaleDateString("id-ID", { timeZone: APP_TIMEZONE, month:"long", year:"numeric" });
    const rasioSisa = lapBulan.totalMasuk > 0 ? (lapBulan.saldo / lapBulan.totalMasuk) * 100 : 0;
    const status = lapBulan.totalMasuk === 0
        ? "Perlu data"
        : rasioSisa >= 20 ? "Sehat"
        : rasioSisa >= 0 ? "Waspada"
        : "Defisit";
    const topKategori = Object.entries(lapBulan.detailKategori).sort((a,b)=>b[1]-a[1])[0];

    const kpiRows = [
        { item:"Status", nilai: status },
        { item:"Masuk Bulan", nilai:`Rp ${formatRupiah(lapBulan.totalMasuk)}` },
        { item:"Keluar Bulan", nilai:`Rp ${formatRupiah(lapBulan.totalKeluar)}` },
        { item:"Sisa Bulan", nilai:`Rp ${formatRupiah(lapBulan.saldo)}` },
        { item:"Saldo Total", nilai:`Rp ${formatRupiah(lapSemua.saldo)}` },
        { item:"Top Boros", nilai: topKategori ? `${topKategori[0]} (${formatRupiah(topKategori[1])})` : "-" }
    ];

    const budgetRows = Object.entries(budget)
        .map(([kategori, limit]) => {
            const terpakai = lapBulan.detailKategori[kategori] || 0;
            return {
                kategori,
                pakai: formatRupiah(terpakai),
                persen: `${Math.round((terpakai / limit) * 100)}%`,
                sisa: formatRupiah(limit - terpakai)
            };
        })
        .sort((a,b)=>Number(b.persen.replace("%",""))-Number(a.persen.replace("%","")));

    let teks = `📊 *DASHBOARD CATATAN KEUANGAN*\n📅 ${bulan}\n🤖 AI: ${formatProviderAI()}\n\n`;
    teks += buatTabelWhatsapp([
        { key:"item", label:"KPI", width:14 },
        { key:"nilai", label:"Nilai", width:20 }
    ], kpiRows, { title:"Ringkasan Pintar" });

    teks += "\n\n" + buatTabelWhatsapp([
        { key:"kategori", label:"Budget", width:16 },
        { key:"pakai", label:"Pakai", width:12, align:"right" },
        { key:"persen", label:"%", width:4, align:"right" },
        { key:"sisa", label:"Sisa", width:12, align:"right" }
    ], budgetRows, { title:"Status Semua Budget", emptyText:"Belum ada budget." });

    teks += "\n\n⚡ Pintasan: *laporan bulan ini*, *prediksi*, *budget*, *ai kenapa pengeluaran saya naik?*";
    return teks;
}

async function buatPrediksiKeuangan(jid) {
    const [lap, lapSemua] = await Promise.all([
        buatLaporanKeuangan("bulan", jid),
        buatLaporanKeuangan("semua", jid)
    ]);
    const now = sekarangWita();
    const hariBerjalan = Math.max(1, now.getDate());
    const hariDalamBulan = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const sisaHari = Math.max(1, hariDalamBulan - hariBerjalan);
    const proyeksiKeluar = Math.round((lap.totalKeluar / hariBerjalan) * hariDalamBulan);
    const proyeksiMasuk = Math.round((lap.totalMasuk / hariBerjalan) * hariDalamBulan);
    const proyeksiSaldo = proyeksiMasuk - proyeksiKeluar;
    const batasHarianAman = Math.max(0, Math.round((lap.totalMasuk - lap.totalKeluar) / sisaHari));
    const analytics = buatAnalitikDashboard(lap, lapSemua, getBudget(jid), { safeDays:sisaHari });

    const rows = [
        { item:"Hari berjalan", nilai:`${hariBerjalan}/${hariDalamBulan}` },
        { item:"Keluar saat ini", nilai:`Rp ${formatRupiah(lap.totalKeluar)}` },
        { item:"Proyeksi keluar", nilai:`Rp ${formatRupiah(proyeksiKeluar)}` },
        { item:"Proyeksi saldo", nilai:`Rp ${formatRupiah(proyeksiSaldo)}` },
        { item:"Batas harian", nilai:`Rp ${formatRupiah(batasHarianAman)}` },
        { item:"Skor pintar", nilai:`${analytics.healthScore}/100` },
        { item:"Risiko", nilai:analytics.smart.riskLevel }
    ];

    let teks = `🔮 *PREDIKSI CASHFLOW BULAN INI*\n\n`;
    teks += buatTabelWhatsapp([
        { key:"item", label:"Indikator", width:16 },
        { key:"nilai", label:"Nilai", width:18, align:"right" }
    ], rows, { title:"Estimasi Otomatis" });
    teks += `\n\n🎯 *Fokus:* ${analytics.smart.focus.title}\n${analytics.smart.focus.detail}`;

    try {
        const prompt = `Beri 3 saran singkat Bahasa Indonesia berdasarkan prediksi keuangan ini: ${JSON.stringify({
            totalMasuk: lap.totalMasuk,
            totalKeluar: lap.totalKeluar,
            saldo: lap.saldo,
            detailKategori: lap.detailKategori,
            proyeksiKeluar,
            proyeksiSaldo,
            batasHarianAman,
            skorKeuangan: analytics.healthScore,
            risiko: analytics.smart.riskFactors,
            rencanaAksi: analytics.smart.actionPlan
        })}. Jawab max 140 kata, praktis, tidak menghakimi, dan beri prioritas aksi paling penting.`;
        const saran = await panggilAI(prompt, { maxRetry: 1, jedaAwal: 1000 });
        teks += `\n\n🤖 *Saran AI*\n${saran}`;
    } catch {
        const aksi = analytics.smart.actionPlan[0];
        teks += `\n\n💡 ${aksi ? `${aksi.title}: ${aksi.detail}` : "Jaga pengeluaran harian di bawah batas harian agar saldo akhir bulan tetap aman."}`;
    }

    return teks;
}

function buatDaftarKategoriDompet() {
    const kategori = KATALOG_KATEGORI.map(item => `${item.name} - ${item.group}`);
    const dompet = ["cash", "bca", "bri", "bni", "mandiri", "gopay", "ovo", "dana", "shopeepay"];

    return `🏷️ *KATEGORI & DOMPET DIDUKUNG*\n\n` +
        buatTabelWhatsapp([
            { key:"no", label:"No", width:2, align:"right" },
            { key:"kategori", label:"Kategori", width:24 }
        ], kategori.map((k,i)=>({ no:i+1, kategori:k })), { title:"Kategori", maxRows:kategori.length }) +
        "\n\n" +
        buatTabelWhatsapp([
            { key:"no", label:"No", width:2, align:"right" },
            { key:"dompet", label:"Dompet", width:14 }
        ], dompet.map((d,i)=>({ no:i+1, dompet:d.toUpperCase() })), { title:"Dompet/Akun", maxRows:dompet.length }) +
        "\n\nContoh: *beli bensin 50k mandiri* atau *pemasukan 5jt gaji bca*";
}

async function ambilRiwayatTransaksi(limit=Infinity, jid) {
    const sheet = await getSheetByNomor(jid);
    const rows  = await sheet.getRows();
    if (rows.length===0) return "📭 *Riwayat transaksi masih kosong.*";

    const jumlahDitampilkan = Number.isFinite(limit) ? Math.min(Math.max(1, limit), rows.length) : rows.length;
    const rowsTerpilih = rows.slice(-jumlahDitampilkan).reverse();
    let totalMasuk = 0;
    let totalKeluar = 0;
    for (const r of rowsTerpilih) {
        const jenis = String(r.get("Jenis")||"").toLowerCase().trim();
        const nominal = Number(r.get("Nominal")||0);
        if (jenis === "pemasukan") totalMasuk += nominal;
        else totalKeluar += nominal;
    }

    let teks = `📚 *RIWAYAT TRANSAKSI LENGKAP*\n`;
    teks += `Menampilkan *${jumlahDitampilkan}* dari *${rows.length}* transaksi\n`;
    teks += `🟢 Masuk: *Rp ${formatRupiah(totalMasuk)}*\n🔴 Keluar: *Rp ${formatRupiah(totalKeluar)}*\n`;
    teks += `💰 Selisih: *Rp ${formatRupiah(totalMasuk-totalKeluar)}*\n\n${"─".repeat(34)}\n`;

    for (const [index, r] of rowsTerpilih.entries()) {
        const tgl    = String(r.get("Tanggal")||"00/00/0000");
        const jenis  = String(r.get("Jenis")||"Pengeluaran").trim();
        const kat    = String(r.get("Kategori")||"Lainnya");
        const nom    = Number(r.get("Nominal")||0);
        const ket    = String(r.get("Keterangan")||"-");
        const dom    = String(r.get("Dompet")||"cash").toUpperCase();
        const saldo  = Number(r.get("Saldo")||0);
        const simbol = jenis.toLowerCase()==="pemasukan" ? "🟢 +" : "🔴 -";
        teks += `\n*${index + 1}. ${tgl} · ${dom}*\n${simbol} *Rp ${formatRupiah(nom)}* · ${kat}\n📝 ${ket}\n🧮 Saldo ${dom}: Rp ${formatRupiah(saldo)}\n`;
    }

    teks += `\n${"─".repeat(34)}\n💡 Ketik *riwayat 20* untuk 20 transaksi terbaru atau *export semua* untuk file lengkap.`;
    return teks;
}

// ── CARI TRANSAKSI ────────────────────────────────────────────
async function cariTransaksi(keyword, jid) {
    const sheet = await getSheetByNomor(jid);
    const rows  = await sheet.getRows();
    const kw    = keyword.toLowerCase().trim();

    if (!kw || kw.length < 2) return "⚠️ Kata kunci pencarian minimal 2 karakter.";

    const cocokRows = rows.filter(r =>
        String(r.get("Tanggal")||"").toLowerCase().includes(kw) ||
        String(r.get("Jenis")||"").toLowerCase().includes(kw) ||
        String(r.get("Keterangan")||"").toLowerCase().includes(kw) ||
        String(r.get("Kategori")||"").toLowerCase().includes(kw) ||
        String(r.get("Dompet")||"").toLowerCase().includes(kw) ||
        String(r.get("Nominal")||"").toLowerCase().includes(kw)
    ).reverse();

    if (cocokRows.length===0) return `🔍 Tidak ada transaksi yang cocok dengan *"${keyword}"*.`;

    let teks = `🔍 *HASIL PENCARIAN: "${keyword}"*\n_(${cocokRows.length} transaksi ditemukan)_\n${"─".repeat(34)}\n`;
    let totalMasuk=0, totalKeluar=0;

    for (const r of cocokRows) {
        const tgl    = String(r.get("Tanggal")||"");
        const jenis  = String(r.get("Jenis")||"").toLowerCase().trim();
        const nom    = Number(r.get("Nominal")||0);
        const kat    = String(r.get("Kategori")||"-");
        const ket    = String(r.get("Keterangan")||"-");
        const dom    = String(r.get("Dompet")||"cash").toUpperCase();
        const simbol = jenis==="pemasukan" ? "🟢 +" : "🔴 -";
        if (jenis==="pemasukan") totalMasuk+=nom; else totalKeluar+=nom;
        teks += `\n*[${tgl}]* ${ket}\n   ${simbol} *Rp ${formatRupiah(nom)}* | ${kat} | ${dom}\n`;
    }

    teks += `\n${"─".repeat(34)}\n🟢 Masuk: Rp ${formatRupiah(totalMasuk)}\n🔴 Keluar: Rp ${formatRupiah(totalKeluar)}\n💰 Selisih: Rp ${formatRupiah(totalMasuk-totalKeluar)}`;
    return teks;
}

// ── EXPORT LAPORAN EXCEL ─────────────────────────────────────
function xmlEscape(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function excelCell(value, type = "String", style = "sText") {
    const numeric = type === "Number" && Number.isFinite(Number(value));
    const cellType = numeric ? "Number" : "String";
    const cellValue = numeric ? String(Number(value)) : xmlEscape(value);
    return `<Cell ss:StyleID="${style}"><Data ss:Type="${cellType}">${cellValue}</Data></Cell>`;
}

function excelRow(values, style = "sText") {
    return `<Row>${values.map(item => Array.isArray(item) ? excelCell(item[0], item[1], item[2] || style) : excelCell(item, "String", style)).join("")}</Row>`;
}

function excelWorksheet(name, rows) {
    return `<Worksheet ss:Name="${xmlEscape(String(name).slice(0, 31))}"><Table>${rows.join("")}</Table></Worksheet>`;
}

function buatBarExcel(value, maxValue, width = 28) {
    const n = Number(value || 0);
    const max = Math.max(Number(maxValue || 0), 1);
    const jumlah = Math.max(1, Math.round((n / max) * width));
    return "█".repeat(jumlah);
}

function buatExcelXmlLaporan(lap, label, now) {
    const totalKategori = Object.values(lap.detailKategori || {}).reduce((a,b)=>a+b,0) || 1;
    const maxKategori = Math.max(...Object.values(lap.detailKategori || { kosong:0 }), 1);
    const kategoriRows = Object.entries(lap.detailKategori || {})
        .sort((a,b)=>b[1]-a[1]);
    const walletRows = Object.entries(lap.saldoDompet || {})
        .sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
    const trendRows = Object.entries(lap.trenHarian || {})
        .sort(([a],[b]) => a.localeCompare(b));
    const maxTrend = Math.max(...trendRows.flatMap(([,v]) => [Number(v.masuk || 0), Number(v.keluar || 0)]), 1);

    const summary = [
        excelRow([[`LAPORAN KEUANGAN ${label.toUpperCase()}`, "String", "sTitle"]]),
        excelRow([["Dibuat", "String", "sHead"], [now, "String", "sText"]]),
        excelRow([["Pemasukan", "String", "sHead"], [lap.totalMasuk, "Number", "sMoney"]]),
        excelRow([["Pengeluaran", "String", "sHead"], [lap.totalKeluar, "Number", "sMoney"]]),
        excelRow([["Saldo Periode", "String", "sHead"], [lap.saldo, "Number", "sMoney"]]),
        excelRow([["Tabungan Akumulasi", "String", "sHead"], [lap.saldoAkumulasi, "Number", "sMoney"]]),
        excelRow([["Total Transaksi", "String", "sHead"], [lap.transaksi.length, "Number", "sNumber"]])
    ];

    const kategoriSheet = [
        excelRow([["DIAGRAM PENGELUARAN PER KATEGORI", "String", "sTitle"]]),
        excelRow([["Kategori", "String", "sHead"], ["Nominal", "String", "sHead"], ["Persen", "String", "sHead"], ["Diagram", "String", "sHead"]])
    ];
    for (const [name, amount] of kategoriRows) {
        kategoriSheet.push(excelRow([
            [name, "String", "sText"],
            [amount, "Number", "sMoney"],
            [Math.round((amount / totalKategori) * 100), "Number", "sNumber"],
            [buatBarExcel(amount, maxKategori), "String", "sBar"]
        ]));
    }
    if (!kategoriRows.length) kategoriSheet.push(excelRow([["Belum ada pengeluaran pada periode ini.", "String", "sText"]]));

    const walletSheet = [
        excelRow([["SALDO DOMPET / REKENING", "String", "sTitle"]]),
        excelRow([["Dompet", "String", "sHead"], ["Saldo", "String", "sHead"]])
    ];
    for (const [name, saldo] of walletRows) walletSheet.push(excelRow([[name.toUpperCase(), "String", "sText"], [saldo, "Number", "sMoney"]]));
    if (!walletRows.length) walletSheet.push(excelRow([["Belum ada saldo dompet.", "String", "sText"]]));

    const trendSheet = [
        excelRow([["DIAGRAM ARUS KAS HARIAN", "String", "sTitle"]]),
        excelRow([["Tanggal", "String", "sHead"], ["Masuk", "String", "sHead"], ["Keluar", "String", "sHead"], ["Masuk Bar", "String", "sHead"], ["Keluar Bar", "String", "sHead"]])
    ];
    for (const [tgl, item] of trendRows) {
        trendSheet.push(excelRow([
            [tgl, "String", "sText"],
            [item.masuk || 0, "Number", "sMoney"],
            [item.keluar || 0, "Number", "sMoney"],
            [Number(item.masuk || 0) ? buatBarExcel(item.masuk, maxTrend) : "", "String", "sBarGreen"],
            [Number(item.keluar || 0) ? buatBarExcel(item.keluar, maxTrend) : "", "String", "sBarRed"]
        ]));
    }
    if (!trendRows.length) trendSheet.push(excelRow([["Belum ada tren pada periode ini.", "String", "sText"]]));

    const transaksiSheet = [
        excelRow([["TRANSAKSI LENGKAP", "String", "sTitle"]]),
        excelRow([["Tanggal", "String", "sHead"], ["Jenis", "String", "sHead"], ["Kategori", "String", "sHead"], ["Nominal", "String", "sHead"], ["Keterangan", "String", "sHead"], ["Dompet", "String", "sHead"], ["Saldo", "String", "sHead"]])
    ];
    for (const trx of lap.transaksi) {
        transaksiSheet.push(excelRow([
            [trx.tanggalLengkap || trx.tanggal, "String", "sText"],
            [trx.jenis, "String", trx.jenis === "Pemasukan" ? "sIncome" : "sExpense"],
            [trx.kategori, "String", "sText"],
            [trx.nominal, "Number", "sMoney"],
            [trx.keterangan, "String", "sText"],
            [String(trx.dompet || "").toUpperCase(), "String", "sText"],
            [trx.saldo, "Number", "sMoney"]
        ]));
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="sTitle"><Font ss:Bold="1" ss:Size="14" ss:Color="#12304A"/><Interior ss:Color="#DFF7FF" ss:Pattern="Solid"/></Style>
  <Style ss:ID="sHead"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#2B74E4" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#9BC8FF"/></Borders></Style>
  <Style ss:ID="sText"><Font ss:Color="#172033"/></Style>
  <Style ss:ID="sNumber"><NumberFormat ss:Format="#,##0"/></Style>
  <Style ss:ID="sMoney"><NumberFormat ss:Format="Rp #,##0"/></Style>
  <Style ss:ID="sIncome"><Font ss:Bold="1" ss:Color="#087B55"/><Interior ss:Color="#E3FFF4" ss:Pattern="Solid"/></Style>
  <Style ss:ID="sExpense"><Font ss:Bold="1" ss:Color="#C5364D"/><Interior ss:Color="#FFEAF0" ss:Pattern="Solid"/></Style>
  <Style ss:ID="sBar"><Font ss:Color="#2B74E4"/></Style>
  <Style ss:ID="sBarGreen"><Font ss:Color="#0C9B70"/></Style>
  <Style ss:ID="sBarRed"><Font ss:Color="#E2556A"/></Style>
 </Styles>
 ${excelWorksheet("Ringkasan", summary)}
 ${excelWorksheet("Diagram Kategori", kategoriSheet)}
 ${excelWorksheet("Saldo Dompet", walletSheet)}
 ${excelWorksheet("Diagram Tren", trendSheet)}
 ${excelWorksheet("Transaksi", transaksiSheet)}
</Workbook>`;
}

async function eksporLaporan(tipe, jid, opsi = {}) {
    const lap = await buatLaporanKeuangan(tipe, jid, opsi);
    const now = new Date().toLocaleString("id-ID",{timeZone:APP_TIMEZONE});
    const tanggalFile = tanggalHariIni().split("/").reverse().join("-");
    const label = lap.periode?.label || labelPeriode(tipe);
    const namaPeriode = label.toLowerCase().replace(/\s+/g, "-");
    const excelXml = buatExcelXmlLaporan(lap, label, now);
    const caption =
`📤 *EXPORT EXCEL ${label.toUpperCase()}*

📊 ${lap.transaksi.length} transaksi
🟢 Masuk: Rp ${formatRupiah(lap.totalMasuk)}
🔴 Keluar: Rp ${formatRupiah(lap.totalKeluar)}
💰 Saldo periode: Rp ${formatRupiah(lap.saldo)}
🏦 Tabungan akumulasi: Rp ${formatRupiah(lap.saldoAkumulasi)}
🕒 Dibuat: ${now}

File Excel berisi sheet Ringkasan, Diagram Kategori, Saldo Dompet, Diagram Tren, dan Transaksi.`;

    return {
        document: Buffer.from(excelXml, "utf8"),
        mimetype: "application/vnd.ms-excel",
        fileName: `laporan-keuangan-${namaPeriode}-${tanggalFile}.xls`,
        caption
    };
}

// ── AI HELPER: ChatGPT utama + Gemini fallback ────────────────
const OPENAI_MODELS = (process.env.OPENAI_MODELS || OPENAI_MODEL)
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
const GEMINI_MODELS = (process.env.GEMINI_MODELS || "gemini-2.5-flash,gemini-1.5-flash,gemini-1.5-flash-8b")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
const AI_QUOTA_COOLDOWN_MS = Math.max(10, Number(process.env.AI_QUOTA_COOLDOWN_MINUTES || 360) || 360) * 60 * 1000;
const AI_RATE_LIMIT_COOLDOWN_MS = Math.max(1, Number(process.env.AI_RATE_LIMIT_COOLDOWN_MINUTES || 2) || 2) * 60 * 1000;

function klasifikasiErrorAI(e) {
    const status = Number(e?.status || e?.code || e?.response?.status || 0);
    const msg = String(e?.message || "").toLowerCase();
    const quota = msg.includes("exceeded your current quota") ||
        msg.includes("insufficient_quota") ||
        (msg.includes("quota") && (msg.includes("billing") || msg.includes("plan")));
    if (quota) return { tipe:"quota", retry:false, blockProvider:true, cooldown:AI_QUOTA_COOLDOWN_MS };
    if ([401,403].includes(status) || msg.includes("invalid api key")) {
        return { tipe:"auth", retry:false, blockProvider:true, cooldown:AI_QUOTA_COOLDOWN_MS };
    }
    if (status === 429 || msg.includes("rate limit")) {
        return { tipe:"rate_limit", retry:false, blockProvider:true, cooldown:AI_RATE_LIMIT_COOLDOWN_MS };
    }
    const sementara = [408,409,500,502,503,504].includes(status) ||
        msg.includes("timeout") ||
        msg.includes("unavailable") ||
        msg.includes("high demand") ||
        msg.includes("overloaded");
    return { tipe: sementara ? "sementara" : "permanen", retry: sementara, blockProvider:false, cooldown:0 };
}

function blokirProviderAI(nama, info) {
    const state = statusProviderAI[nama];
    if (!state || !info.blockProvider) return;
    state.blockedUntil = Date.now() + info.cooldown;
    state.reason = info.tipe;
    if (Date.now() - state.notifiedAt > 5 * 60 * 1000) {
        const menit = Math.ceil(info.cooldown / 60000);
        console.warn(`⚠️ ${nama} dinonaktifkan sementara ${menit} menit (${info.tipe}). Beralih ke provider/fallback berikutnya.`);
        state.notifiedAt = Date.now();
    }
}

function providerAIAktif(nama) {
    const state = statusProviderAI[nama];
    if (!state || state.blockedUntil <= Date.now()) {
        if (state) {
            state.blockedUntil = 0;
            state.reason = "";
        }
        return true;
    }
    return false;
}

function logFallbackAISekali(konteks) {
    if (Date.now() - lastAIFallbackLog < 5 * 60 * 1000) return;
    console.log(`ℹ️ ${konteks}: memakai fallback lokal karena provider AI belum tersedia.`);
    lastAIFallbackLog = Date.now();
}

async function generateOpenAI(prompt, model) {
    if (!openai) throw new Error("OpenAI tidak aktif");
    const resp = await openai.chat.completions.create({
        model,
        temperature: 0.2,
        messages: [
            {
                role: "system",
                content: "Kamu adalah asisten catatan keuangan WhatsApp yang cepat, akurat, hemat kata, dan menjawab dalam Bahasa Indonesia."
            },
            { role: "user", content: prompt }
        ]
    });
    return resp.choices?.[0]?.message?.content || "";
}

async function generateGemini(prompt, model) {
    if (!ai) throw new Error("Gemini tidak aktif");
    const resp = await ai.models.generateContent({ model, contents: prompt });
    return resp.text || resp.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function panggilAI(prompt, { maxRetry = 2, jedaAwal = 1500 } = {}) {
    let lastErr;
    const providers = [];
    if (openai) providers.push({ nama:"ChatGPT", models:OPENAI_MODELS, generate:generateOpenAI });
    if (ai) providers.push({ nama:"Gemini", models:GEMINI_MODELS, generate:generateGemini });

    providerLoop:
    for (const provider of providers) {
        if (!providerAIAktif(provider.nama)) continue;
        for (const model of provider.models) {
            for (let percobaan = 1; percobaan <= maxRetry; percobaan++) {
                try {
                    const txt = await provider.generate(prompt, model);
                    if (String(txt||"").trim()) {
                        if (provider.nama !== "ChatGPT" || model !== OPENAI_MODELS[0] || percobaan > 1) {
                            console.log(`✅ AI berhasil via ${provider.nama} model=${model} percobaan=${percobaan}`);
                        }
                        statusProviderAI[provider.nama].blockedUntil = 0;
                        statusProviderAI[provider.nama].reason = "";
                        return String(txt).trim();
                    }
                    throw new Error("Respons AI kosong");
                } catch (e) {
                    lastErr = e;
                    const info = klasifikasiErrorAI(e);
                    blokirProviderAI(provider.nama, info);

                    if (!info.blockProvider) {
                        console.warn(`⚠️ AI ${provider.nama} [${model}] percobaan ${percobaan}/${maxRetry}: ${e.message}`);
                    }
                    if (info.blockProvider) continue providerLoop;
                    if (!info.retry) break;
                    if (percobaan < maxRetry) {
                        const jeda = jedaAwal * Math.pow(2, percobaan - 1);
                        await tunggu(jeda);
                    }
                }
            }
        }
    }

    throw lastErr || new Error("Semua provider AI tidak tersedia");
}

// ── ANALISIS AI ───────────────────────────────────────────────
async function analisisAIKeuangan(lap, tipe="bulan", konteksTambahan = {}) {
    const budget = konteksTambahan.budget || {};
    const lapSemua = konteksTambahan.lapSemua || lap;
    const analytics = buatAnalitikDashboard(lap, lapSemua, budget, konteksTambahan.analyticsOptions || {});
    const transaksiTerbesar = (lap.transaksi || [])
        .filter(t => t.jenis === "Pengeluaran")
        .slice()
        .sort((a,b) => Number(b.nominal || 0) - Number(a.nominal || 0))
        .slice(0, 5)
        .map(t => ({
            tanggal:t.tanggalLengkap || t.tanggal,
            kategori:t.kategori,
            nominal:t.nominal,
            keterangan:t.keterangan,
            dompet:t.dompet
        }));
    const ringkasan = {
        periode:        tipe,
        totalMasuk:     lap.totalMasuk,
        totalKeluar:    lap.totalKeluar,
        saldo:          lap.saldo,
        detailKategori: lap.detailKategori,
        saldoDompet:    lapSemua.saldoDompet,
        budget:         analytics.budget,
        skorKeuangan:   analytics.healthScore,
        labelKesehatan: analytics.healthLabel,
        fokusPintar:    analytics.smart.focus,
        risiko:         analytics.smart.riskFactors,
        peluang:        analytics.smart.opportunities,
        rencanaAksi:    analytics.smart.actionPlan,
        pacing:         analytics.smart.pacing,
        perbandinganBulan: analytics.comparison,
        transaksiTerbesar
    };

    const prompt =
`Kamu adalah konsultan keuangan pribadi yang bijak, teliti, dan praktis.
Analisis data keuangan berikut sebagai co-pilot keuangan pribadi:

${JSON.stringify(ringkasan, null, 2)}

Berikan:
1. Diagnosis singkat berbasis data, bukan nasihat generik
2. Dua risiko terbesar beserta angka penyebabnya
3. Rencana aksi: hari ini, minggu ini, dan sisa bulan
4. Kategori/top transaksi yang perlu diawasi dan cara menguranginya
5. Satu kalimat motivasi yang realistis

Gunakan Bahasa Indonesia. Jawab max 280 kata. Nada hangat, tidak menghakimi, memotivasi, dan hindari saran investasi spesifik.`;

    try {
        return await panggilAI(prompt);
    } catch (e) {
        logFallbackAISekali("Analisis keuangan");
        // Fallback manual berdasarkan data
        const kondisi = lap.saldo >= 0 ? "positif 🟢" : "defisit 🔴";
        const terboros = Object.entries(lap.detailKategori).sort((a,b)=>b[1]-a[1])[0];
        const risikoOffline = analytics.smart.riskFactors.length
            ? analytics.smart.riskFactors.map(item => `- ${item}`).join("\n")
            : "- Belum ada risiko besar yang menonjol dari data periode ini.";
        const aksiOffline = analytics.smart.actionPlan.slice(0, 3).map((item, index) =>
            `${index + 1}. ${item.title} - ${item.detail}`
        ).join("\n");
        return (
`📊 *Ringkasan Keuangan (Mode Offline)*

Kondisi saldo kamu saat ini *${kondisi}*.
🟢 Pemasukan : Rp ${formatRupiah(lap.totalMasuk)}
🔴 Pengeluaran: Rp ${formatRupiah(lap.totalKeluar)}
💰 Saldo Bersih: Rp ${formatRupiah(lap.saldo)}

${terboros ? `🏷️ Pengeluaran terbesar: *${terboros[0]}* (Rp ${formatRupiah(terboros[1])})` : ""}

*Risiko terbaca:*
${risikoOffline}

*Aksi prioritas:*
${aksiOffline}

💡 Tips: Coba ketik *tips* untuk saran keuangan, atau coba *analisis* lagi dalam beberapa menit.
_⚠️ Analisis AI sedang tidak tersedia sementara (server padat)._`
        );
    }
}

async function dapatkanTipsHarian() {
    const TIPS_OFFLINE = [
        "💡 Terapkan aturan 50/30/20: 50% kebutuhan, 30% keinginan, 20% tabungan.",
        "🎯 Sebelum beli sesuatu, tanya diri: 'Apakah ini kebutuhan atau keinginan?'",
        "📊 Review pengeluaran mingguan bisa menghemat 10-15% pengeluaran bulanan.",
        "🐷 Sisihkan tabungan di awal bulan, bukan sisa di akhir bulan.",
        "☕ Bawa bekal & kopi sendiri bisa hemat ratusan ribu per bulan.",
        "📱 Hapus notifikasi promo belanja online untuk mengurangi godaan impulsif.",
        "🧾 Simpan struk belanja — kesadaran pengeluaran adalah langkah pertama menabung.",
        "🏦 Dana darurat ideal = 3–6 bulan pengeluaran. Mulai dari yang kecil!",
        "🔄 Bayar tagihan & cicilan di awal bulan supaya tidak lupa dan tidak boros.",
        "💳 Hindari cicilan 0% untuk barang konsumtif — itu tetap utang.",
        "🛒 Buat daftar belanja sebelum ke supermarket dan patuhi daftarnya.",
        "📈 Investasi Rp 100rb/bulan lebih baik dari tidak sama sekali.",
    ];

    const hari = new Date().toLocaleDateString("id-ID",{timeZone:APP_TIMEZONE,weekday:"long"});
    const prompt = `Berikan 1 tips keuangan harian yang singkat, praktis, dan memotivasi dalam Bahasa Indonesia untuk hari ${hari}. Max 3 kalimat. Sertakan 1 emoji yang relevan di awal.`;

    try {
        return await panggilAI(prompt, { maxRetry: 2, jedaAwal: 1500 });
    } catch {
        // Fallback ke tips statis, rotasi berdasarkan tanggal
        return TIPS_OFFLINE[new Date().getDate() % TIPS_OFFLINE.length];
    }
}

async function tanyaAIKeuangan(pertanyaan, jid) {
    const lapBulan = await buatLaporanKeuangan("bulan", jid);
    const lapSemua = await buatLaporanKeuangan("semua", jid);
    const budget = getBudget(jid);
    const analytics = buatAnalitikDashboard(lapBulan, lapSemua, budget);
    const konteks = {
        bulanIni: {
            totalMasuk: lapBulan.totalMasuk,
            totalKeluar: lapBulan.totalKeluar,
            saldo: lapBulan.saldo,
            detailKategori: lapBulan.detailKategori
        },
        saldoDompet: lapSemua.saldoDompet,
        budget: analytics.budget,
        skorKeuangan: analytics.healthScore,
        labelKesehatan: analytics.healthLabel,
        fokusPintar: analytics.smart.focus,
        risiko: analytics.smart.riskFactors,
        peluang: analytics.smart.opportunities,
        rencanaAksi: analytics.smart.actionPlan,
        pacing: analytics.smart.pacing,
        perbandinganBulan: analytics.comparison,
        transaksiTerbaru: lapBulan.transaksi.slice(-10).map(t => ({
            tanggal: t.tanggal,
            jenis: t.jenis,
            kategori: t.kategori,
            nominal: t.nominal,
            keterangan: t.keterangan,
            dompet: t.dompet
        }))
    };

    const prompt =
`Kamu adalah asisten keuangan pribadi untuk bot WhatsApp.
Jawab pertanyaan user dengan data berikut seperti analis yang praktis.
Gunakan Bahasa Indonesia, ringkas, jelas, dan kaitkan jawaban dengan angka di data.
Jika data belum cukup, katakan apa data yang perlu dicatat.

DATA:
${JSON.stringify(konteks, null, 2)}

PERTANYAAN USER:
${pertanyaan}

Format jawaban:
- Mulai dengan kesimpulan singkat
- Maksimal 5 bullet
- Akhiri dengan 1 aksi yang bisa dilakukan hari ini
- Jangan memberi saran investasi spesifik atau klaim pasti`;

    try {
        const jawaban = await panggilAI(prompt, { maxRetry: 2, jedaAwal: 1500 });
        return `🤖 *ASISTEN KEUANGAN AI*\n\n${jawaban}`;
    } catch {
        return `🤖 *ASISTEN KEUANGAN AI*\n\nAI sedang tidak tersedia sementara.\n\nRingkasan cepat: pemasukan bulan ini Rp ${formatRupiah(lapBulan.totalMasuk)}, pengeluaran Rp ${formatRupiah(lapBulan.totalKeluar)}, saldo Rp ${formatRupiah(lapBulan.saldo)}.\n\nAksi hari ini: catat minimal 3 transaksi terakhir agar analisis berikutnya lebih akurat.`;
    }
}

// ── PARSING & AI ─────────────────────────────────────────────
function parsingPerintahTransaksi(teksUser) {
    const txt = String(teksUser||"").trim();
    const awalanMasuk   = /^(pemasukan|masuk|income|pendapatan|catat pemasukan|tambah pemasukan)\b/i;
    const awalanKeluar  = /^(pengeluaran|keluar|expense|catat pengeluaran|tambah pengeluaran)\b/i;
    let jenis=null, sisa=txt;

    if (awalanMasuk.test(txt))       { jenis="Pemasukan";   sisa=txt.replace(awalanMasuk,"").trim(); }
    else if (awalanKeluar.test(txt)) { jenis="Pengeluaran"; sisa=txt.replace(awalanKeluar,"").trim(); }
    else if (/\b(gaji|bonus|thr|terima|dapat|masuk|pendapatan|income|refund|cashback|dividen|terjual|penjualan)\b/i.test(txt)) jenis="Pemasukan";
    else if (/\b(beli|bayar|keluar|jajan|belanja|sewa|cicilan|donasi|servis|service)\b/i.test(txt))                          jenis="Pengeluaran";

    if (!jenis) return { is_transaksi: false };
    const hasilNominal = parseNominalDariTeks(sisa||txt);
    if (!hasilNominal) return { is_transaksi: false };

    const dompet  = deteksiDompet(txt);
    const kategori= deteksiKategori(txt, jenis);
    let keterangan= (sisa||txt)
        .replace(hasilNominal.raw,"")
        .replace(/\b(ke|dari|via|pakai|dengan)\s+(cash|tunai|bca|bri|bni|mandiri|gopay|ovo|dana|spay|shopeepay)\b/ig,"")
        .replace(/\s+/g," ").trim() || txt;

    return { is_transaksi:true, jenis, nominal:hasilNominal.nominal, kategori, keterangan, dompet, tanggal:tanggalHariIni() };
}

function fallbackParsingLokal(text) {
    const p    = String(text||"").toLowerCase().trim();
    const h    = parseNominalDariTeks(p);
    if (!h) return { is_transaksi:false };
    const dom  = deteksiDompet(p);
    const kp   = ["gaji","bonus","thr","terima","masuk","dapat","pendapatan","income","pemasukan","refund","cashback","dividen","terjual","penjualan"];
    const jenis= kp.some(k=>p.includes(k)) ? "Pemasukan" : "Pengeluaran";
    return { is_transaksi:true, jenis, nominal:h.nominal, kategori:deteksiKategori(p,jenis), keterangan:text, dompet:dom, tanggal:tanggalHariIni() };
}

async function analisisPesanDenganAI(teksUser) {
    const waktu  = new Date().toLocaleString("id-ID",{timeZone:APP_TIMEZONE});
    const prompt =
`Kamu sistem AI pencatat keuangan. Waktu sekarang: ${waktu}.
Analisis chat user → JSON transaksi.

Aturan:
1. Konversi: 25k=25000, 1.5jt=1500000
2. Pilih kategori paling sesuai dari: [${KATALOG_KATEGORI.map(item => item.name).join(",")}]
3. Jenis: Pemasukan | Pengeluaran
4. Dompet: cash/bca/bri/bni/mandiri/gopay/ovo/dana/shopeepay. Default: cash
5. Tanggal: DD/MM/YYYY. Default: hari ini
6. Bukan transaksi → {"is_transaksi":false}

User: "${teksUser}"
Balas HANYA JSON valid.`;

    try {
        let mentah = await panggilAI(prompt, { maxRetry: 2, jedaAwal: 1200 });
        mentah = mentah.replaceAll("```json","").replaceAll("```","").trim();

        const hasil = JSON.parse(mentah);
        if (!hasil.is_transaksi)                    return { is_transaksi:false };
        if (!hasil.nominal||Number(hasil.nominal)<=0) return { is_transaksi:false };

        hasil.nominal    = Math.round(Number(hasil.nominal));
        hasil.dompet     = String(hasil.dompet||"cash").toLowerCase().trim();
        hasil.keterangan = String(hasil.keterangan||teksUser).trim();
        hasil.jenis      = normalisasiJenis(hasil.jenis||"Pengeluaran");
        hasil.kategori   = normalisasiKategori(hasil.kategori, hasil.jenis, teksUser);
        return hasil;
    } catch (e) {
        logFallbackAISekali("Parsing transaksi");
        return fallbackParsingLokal(teksUser);
    }
}

// ── SIMPAN & HAPUS ────────────────────────────────────────────
async function simpanKeSheet(dataAi, jid) {
    const nomor = ambilNomorDariJid(jid);
    return jalankanMutasiNomor(nomor, async () => {
    dataAi.jenis = normalisasiJenis(dataAi.jenis || "Pengeluaran");
    dataAi.kategori = normalisasiKategori(dataAi.kategori, dataAi.jenis, dataAi.keterangan);
    const sheet   = await getSheetByNomor(jid);
    const lapKini = await buatLaporanKeuangan("semua", jid);
    const dom     = String(dataAi.dompet||"cash").toLowerCase().trim();
    const saldoLama  = lapKini.saldoDompet[dom]||0;
    const saldoBaru  = dataAi.jenis==="Pemasukan" ? saldoLama+dataAi.nominal : saldoLama-dataAi.nominal;
    const jam     = new Date().toLocaleTimeString("id-ID",{timeZone:APP_TIMEZONE});

    await sheet.addRow({
        Tanggal:    `${dataAi.tanggal}, ${jam}`,
        Jenis:      dataAi.jenis,
        Kategori:   dataAi.kategori,
        Nominal:    dataAi.nominal,
        Keterangan: dataAi.keterangan,
        Dompet:     dom,
        Saldo:      saldoBaru
    });

    let budgetAlert = null;
    if (dataAi.jenis==="Pengeluaran") {
        const budget   = getBudget(jid);
        const lapBulan = await buatLaporanKeuangan("bulan", jid);
        const total    = lapBulan.detailKategori[dataAi.kategori]||0;
        const limit    = budget[dataAi.kategori];
        if (limit) {
            if (total>=limit)       budgetAlert=`🚨 *BUDGET OVERLIMIT!*\n*${dataAi.kategori}* bulan ini: *Rp ${formatRupiah(total)}* dari limit *Rp ${formatRupiah(limit)}*.`;
            else if (total>=limit*0.85) budgetAlert=`⚠️ *PERINGATAN ANGGARAN!*\n*${dataAi.kategori}* sudah 85%: *Rp ${formatRupiah(total)}* / Rp ${formatRupiah(limit)}.`;
        }
    }

    return { saldoDompetBaru: saldoBaru, budgetAlert };
    });
}

async function hapusTransaksiTerakhir(jid) {
    const nomor = ambilNomorDariJid(jid);
    return jalankanMutasiNomor(nomor, async () => {
    const sheet = await getSheetByNomor(jid);
    const rows  = await sheet.getRows();
    if (rows.length===0) return null;
    const baris = rows[rows.length-1];
    const data  = { jenis:baris.get("Jenis"), nominal:Number(baris.get("Nominal")||0), keterangan:baris.get("Keterangan") };
    await baris.delete();
    await hitungUlangSaldoSheet(sheet);
    return data;
    });
}

async function resetSeluruhData(jid) {
    const nomor = ambilNomorDariJid(jid);
    return jalankanMutasiNomor(nomor, async () => {
    const sheet = await getSheetByNomor(jid);
    await sheet.clearRows();
    });
}

function formatTanggalWeb(value, fallback = "") {
    const teks = String(value || fallback || "").trim();
    const iso = teks.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}, ${new Date().toLocaleTimeString("id-ID",{timeZone:APP_TIMEZONE})}`;
    if (/^\d{2}\/\d{2}\/\d{4}(?:,\s*.+)?$/.test(teks)) return teks.includes(",") ? teks : `${teks}, ${new Date().toLocaleTimeString("id-ID",{timeZone:APP_TIMEZONE})}`;
    throw buatHttpError("Format tanggal harus YYYY-MM-DD atau DD/MM/YYYY.");
}

function normalisasiTransaksiWeb(data, existing = {}) {
    const nominal = Math.round(Number(data.amount ?? data.nominal ?? existing.Nominal ?? 0));
    if (!Number.isFinite(nominal) || nominal <= 0) throw buatHttpError("Nominal harus lebih besar dari 0.");
    const jenis = normalisasiJenis(data.type ?? data.jenis ?? existing.Jenis ?? "Pengeluaran");
    const keterangan = String(data.note ?? data.keterangan ?? existing.Keterangan ?? "-").trim().slice(0, 300);
    const kategori = normalisasiKategori(data.category ?? data.kategori ?? existing.Kategori, jenis, keterangan);
    const dompet = String(data.wallet ?? data.dompet ?? existing.Dompet ?? "cash").toLowerCase().trim().slice(0, 40);
    if (!kategori || !keterangan || !dompet) throw buatHttpError("Kategori, keterangan, dan dompet wajib diisi.");
    return {
        Tanggal: formatTanggalWeb(data.date ?? data.tanggal, existing.Tanggal || tanggalHariIni()),
        Jenis: jenis,
        Kategori: kategori,
        Nominal: nominal,
        Keterangan: keterangan,
        Dompet: dompet
    };
}

async function hitungUlangSaldoSheet(sheet) {
    const rows = await sheet.getRows();
    const saldoDompet = {};
    for (const row of rows) {
        const dompet = String(row.get("Dompet") || "cash").toLowerCase().trim();
        const nominal = Number(row.get("Nominal") || 0);
        const jenis = String(row.get("Jenis") || "").toLowerCase().trim();
        saldoDompet[dompet] = (saldoDompet[dompet] || 0) + (jenis === "pemasukan" ? nominal : -nominal);
        if (Number(row.get("Saldo") || 0) !== saldoDompet[dompet]) {
            row.set("Saldo", saldoDompet[dompet]);
            await row.save();
        }
    }
}

async function tambahTransaksiDashboard(nomor, data) {
    const transaksi = normalisasiTransaksiWeb(data);
    return jalankanMutasiNomor(nomor, async () => {
        const sheet = await getSheetByNomor(`${nomor}@s.whatsapp.net`);
        await sheet.addRow({ ...transaksi, Saldo:0 });
        await hitungUlangSaldoSheet(sheet);
        return { message:"Transaksi berhasil ditambahkan." };
    });
}

async function editTransaksiDashboard(nomor, rowNumber, data) {
    return jalankanMutasiNomor(nomor, async () => {
        const sheet = await getSheetByNomor(`${nomor}@s.whatsapp.net`);
        const rows = await sheet.getRows();
        const row = rows.find(item => item.rowNumber === Number(rowNumber));
        if (!row) throw buatHttpError("Transaksi tidak ditemukan.", 404);
        row.assign(normalisasiTransaksiWeb(data, row.toObject()));
        await row.save();
        await hitungUlangSaldoSheet(sheet);
        return { message:"Transaksi berhasil diperbarui." };
    });
}

async function hapusTransaksiDashboard(nomor, rowNumber) {
    return jalankanMutasiNomor(nomor, async () => {
        const sheet = await getSheetByNomor(`${nomor}@s.whatsapp.net`);
        const rows = await sheet.getRows();
        const row = rows.find(item => item.rowNumber === Number(rowNumber));
        if (!row) throw buatHttpError("Transaksi tidak ditemukan.", 404);
        await row.delete();
        await hitungUlangSaldoSheet(sheet);
        return { message:"Transaksi berhasil dihapus." };
    });
}

// ── SET BUDGET CUSTOM ─────────────────────────────────────────
function parseBudgetCustom(teks) {
    // format: "set budget Konsumsi 2jt"
    const m = teks.match(/set\s+budget\s+(.+?)\s+([\d,.]+\s*(?:k|rb|ribu|jt|juta|m)?)/i);
    if (!m) return null;
    const kategori = m[1].trim();
    const nominal  = parseNominalDariTeks(m[2]);
    if (!nominal) return null;
    return { kategori, nominal: nominal.nominal };
}

function metaKategori(name, jenis = "Pengeluaran") {
    return cocokkanNamaKategori(name, jenis)
        || KATALOG_KATEGORI.find(item => item.name === "Lainnya");
}

function parseTanggalTransaksi(value) {
    const m = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
}

function hitungPerbandinganBulan(transaksi) {
    const now = sekarangWita();
    const currentKey = `${now.getFullYear()}-${now.getMonth()}`;
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const previousKey = `${prevDate.getFullYear()}-${prevDate.getMonth()}`;
    const hasil = {
        current:{ income:0, expense:0, transactions:0 },
        previous:{ income:0, expense:0, transactions:0 }
    };
    for (const trx of transaksi || []) {
        const date = parseTanggalTransaksi(trx.tanggalLengkap || trx.tanggal);
        if (!date) continue;
        const key = `${date.getFullYear()}-${date.getMonth()}`;
        const target = key === currentKey ? hasil.current : key === previousKey ? hasil.previous : null;
        if (!target) continue;
        if (trx.jenis === "Pemasukan") target.income += Number(trx.nominal || 0);
        else target.expense += Number(trx.nominal || 0);
        target.transactions += 1;
    }
    const change = (current, previous) => previous > 0 ? Math.round(((current - previous) / previous) * 100) : null;
    return {
        ...hasil,
        expenseChange:change(hasil.current.expense, hasil.previous.expense),
        incomeChange:change(hasil.current.income, hasil.previous.income)
    };
}

function buatProfilPintarDashboard(lapBulan, lapSemua, budgetRows, comparison, opsi = {}) {
    const totalMasuk = Number(lapBulan.totalMasuk || 0);
    const totalKeluar = Number(lapBulan.totalKeluar || 0);
    const totalBudget = Number(opsi.totalBudget || 0);
    const usedBudget = Number(opsi.usedBudget || 0);
    const dailySafeSpend = Number(opsi.dailySafeSpend || 0);
    const transaksiKeluar = (lapBulan.transaksi || []).filter(t => t.jenis === "Pengeluaran");
    const kategori = Object.entries(lapBulan.detailKategori || {}).sort((a,b) => b[1] - a[1]);
    const [topName, topAmount = 0] = kategori[0] || [];
    const topShare = totalKeluar > 0 ? Math.round((Number(topAmount || 0) / totalKeluar) * 100) : 0;
    const expenseRatio = totalMasuk > 0 ? Math.round((totalKeluar / totalMasuk) * 100) : (totalKeluar > 0 ? 999 : 0);
    const budgetPressure = totalBudget > 0 ? Math.round((usedBudget / totalBudget) * 100) : 0;
    const largestExpense = transaksiKeluar.reduce((max, trx) => Number(trx.nominal || 0) > Number(max?.nominal || 0) ? trx : max, null);
    const activeExpenseDays = new Set(transaksiKeluar.map(t => String(t.tanggal || t.tanggalLengkap || "").slice(0, 10))).size;
    const avgDailyExpense = activeExpenseDays ? Math.round(totalKeluar / activeExpenseDays) : 0;
    const negativeWallets = Object.entries(lapSemua.saldoDompet || {}).filter(([, value]) => Number(value || 0) < 0);
    const overBudgets = budgetRows.filter(row => row.percent >= 100).sort((a,b) => b.percent - a.percent);
    const watchBudgets = budgetRows.filter(row => row.percent >= 80 && row.percent < 100).sort((a,b) => b.percent - a.percent);

    const riskFactors = [];
    if (totalMasuk <= 0 && totalKeluar > 0) riskFactors.push("Belum ada pemasukan pada periode ini, sementara pengeluaran sudah berjalan.");
    if (expenseRatio > 100) riskFactors.push(`Pengeluaran sudah ${expenseRatio}% dari pemasukan periode ini.`);
    else if (expenseRatio >= 85) riskFactors.push(`Pengeluaran sudah memakai ${expenseRatio}% pemasukan, ruang aman mulai tipis.`);
    if (budgetPressure >= 100) riskFactors.push(`Total budget sudah terpakai ${budgetPressure}%.`);
    else if (budgetPressure >= 85) riskFactors.push(`Total budget mendekati batas di ${budgetPressure}%.`);
    if (topName && topShare >= 40) riskFactors.push(`${topName} menyerap ${topShare}% dari total pengeluaran.`);
    if (comparison.expenseChange !== null && comparison.expenseChange > 20) riskFactors.push(`Pengeluaran naik ${comparison.expenseChange}% dibanding bulan lalu.`);
    if (negativeWallets.length) riskFactors.push(`${negativeWallets.length} dompet/rekening bersaldo negatif.`);

    const opportunities = [];
    if (topName) opportunities.push(`Audit kategori ${topName}; potensi hemat terbesar ada di pos ini.`);
    if (dailySafeSpend > 0) opportunities.push(`Jaga belanja harian di bawah Rp ${formatRupiah(dailySafeSpend)} sampai akhir periode.`);
    if (comparison.incomeChange !== null && comparison.incomeChange < 0) opportunities.push(`Pemasukan turun ${Math.abs(comparison.incomeChange)}%; siapkan buffer sebelum menambah komitmen baru.`);
    if (!opportunities.length) opportunities.push("Gunakan dashboard transaksi untuk menjaga catatan tetap lengkap dan mudah dianalisis.");

    const actionPlan = [];
    if (overBudgets[0]) actionPlan.push({
        priority: "Tinggi",
        title: `Rem budget ${overBudgets[0].name}`,
        detail: `Sudah ${overBudgets[0].percent}% dari limit. Tunda transaksi non-wajib di kategori ini.`
    });
    if (!overBudgets[0] && watchBudgets[0]) actionPlan.push({
        priority: "Sedang",
        title: `Pantau ${watchBudgets[0].name}`,
        detail: `Pemakaian ${watchBudgets[0].percent}% dari limit. Sisakan ruang untuk kebutuhan akhir periode.`
    });
    if (topName && topShare >= 30) actionPlan.push({
        priority: topShare >= 45 ? "Tinggi" : "Sedang",
        title: `Kurangi dominasi ${topName}`,
        detail: `Kategori ini mengambil ${topShare}% pengeluaran. Cari 1 transaksi yang bisa dikurangi minggu ini.`
    });
    if (dailySafeSpend <= 0 && totalMasuk > 0) actionPlan.push({
        priority: "Tinggi",
        title: "Bekukan belanja opsional",
        detail: "Saldo periode sudah tertekan. Utamakan tagihan dan kebutuhan pokok dulu."
    });
    if (largestExpense && Number(largestExpense.nominal || 0) >= Math.max(250000, totalKeluar * 0.25)) actionPlan.push({
        priority: "Sedang",
        title: "Cek transaksi terbesar",
        detail: `${largestExpense.keterangan || largestExpense.kategori} sebesar Rp ${formatRupiah(largestExpense.nominal)} perlu diberi label yang tepat.`
    });
    if (!actionPlan.length) actionPlan.push({
        priority: "Ringan",
        title: "Pertahankan ritme catatan",
        detail: "Arus kas masih terkendali. Lanjutkan pencatatan harian agar prediksi makin presisi."
    });

    let riskScore = 0;
    if (expenseRatio > 100) riskScore += 35;
    else if (expenseRatio >= 85) riskScore += 24;
    else if (expenseRatio >= 70) riskScore += 12;
    if (budgetPressure >= 100) riskScore += 28;
    else if (budgetPressure >= 85) riskScore += 16;
    riskScore += Math.min(18, overBudgets.length * 9 + watchBudgets.length * 4);
    if (topShare >= 45) riskScore += 12;
    if (comparison.expenseChange !== null && comparison.expenseChange > 20) riskScore += 10;
    if (negativeWallets.length) riskScore += 8;
    riskScore = Math.max(0, Math.min(100, Math.round(riskScore)));

    const focusTitle = actionPlan[0]?.title || "Pantau arus kas";
    const focusDetail = actionPlan[0]?.detail || opportunities[0];
    return {
        riskScore,
        riskLevel:riskScore >= 70 ? "Tinggi" : riskScore >= 40 ? "Sedang" : "Rendah",
        focus:{ title:focusTitle, detail:focusDetail },
        riskFactors:riskFactors.slice(0, 5),
        opportunities:opportunities.slice(0, 4),
        actionPlan:actionPlan.slice(0, 5),
        pacing:{ expenseRatio, budgetPressure, topCategoryShare:topShare, avgDailyExpense },
        largestExpense:largestExpense ? {
            category:largestExpense.kategori,
            note:largestExpense.keterangan,
            amount:Number(largestExpense.nominal || 0),
            wallet:largestExpense.dompet
        } : null
    };
}

function buatAnalitikDashboard(lapBulan, lapSemua, budget, opsi = {}) {
    const budgetFactor = Math.max(1, Number(opsi.budgetFactor || 1));
    const budgetRows = Object.entries(budget).map(([name, limit]) => {
        const limitPeriode = Number(limit || 0) * budgetFactor;
        const used = lapBulan.detailKategori[name] || 0;
        const percent = limitPeriode > 0 ? Math.round((used / limitPeriode) * 100) : 0;
        return { name, limit:limitPeriode, monthlyLimit:Number(limit || 0), used, percent, remaining:limitPeriode-used };
    });
    const totalBudget = budgetRows.reduce((sum, row) => sum + row.limit, 0);
    const usedBudget = budgetRows.reduce((sum, row) => sum + row.used, 0);
    const groupMap = {};
    for (const [name, amount] of Object.entries(lapBulan.detailKategori)) {
        const meta = metaKategori(name);
        groupMap[meta.group] = (groupMap[meta.group] || 0) + amount;
    }
    const comparison = hitungPerbandinganBulan(lapSemua.transaksi);
    const savingsRatio = lapBulan.totalMasuk > 0 ? Math.round((lapBulan.saldo / lapBulan.totalMasuk) * 100) : 0;
    const overCount = budgetRows.filter(row => row.percent >= 100).length;
    const watchCount = budgetRows.filter(row => row.percent >= 85 && row.percent < 100).length;
    let healthScore = 50;
    healthScore += Math.max(-25, Math.min(25, savingsRatio));
    healthScore -= overCount * 8 + watchCount * 3;
    if (lapBulan.transaksi.length >= 20) healthScore += 8;
    if (lapBulan.totalMasuk > lapBulan.totalKeluar) healthScore += 8;
    healthScore = Math.max(0, Math.min(100, Math.round(healthScore)));
    const now = sekarangWita();
    const remainingDays = Math.max(1, Number(opsi.safeDays || 0) || (new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1));
    const dailySafeSpend = Math.max(0, Math.round((lapBulan.totalMasuk - lapBulan.totalKeluar) / remainingDays));
    const smart = buatProfilPintarDashboard(lapBulan, lapSemua, budgetRows, comparison, {
        totalBudget,
        usedBudget,
        dailySafeSpend
    });
    const tips = [];
    if (overCount) tips.push(`${overCount} budget sudah melewati limit. Prioritaskan kategori dengan persentase tertinggi.`);
    if (watchCount) tips.push(`${watchCount} budget mendekati limit dan perlu dipantau sampai akhir bulan.`);
    if (savingsRatio < 10 && lapBulan.totalMasuk > 0) tips.push("Rasio sisa di bawah 10%. Tahan pengeluaran gaya hidup untuk menjaga arus kas.");
    if (comparison.expenseChange !== null && comparison.expenseChange > 15) tips.push(`Pengeluaran naik ${comparison.expenseChange}% dibanding bulan lalu.`);
    for (const item of smart.actionPlan.slice(0, 2)) tips.push(`${item.title}: ${item.detail}`);
    if (!tips.length) tips.push("Arus kas dan budget masih terkendali. Pertahankan pencatatan transaksi secara rutin.");
    return {
        healthScore,
        healthLabel:healthScore >= 80 ? "Sangat baik" : healthScore >= 65 ? "Sehat" : healthScore >= 45 ? "Perlu perhatian" : "Berisiko",
        savingsRatio,
        dailySafeSpend,
        budget:{ total:totalBudget, used:usedBudget, remaining:totalBudget-usedBudget, overCount, watchCount },
        groups:Object.entries(groupMap).sort((a,b)=>b[1]-a[1]).map(([name, amount]) => ({ name, amount })),
        comparison,
        smart,
        tips
    };
}

function saranKategoriDashboard(data) {
    const jenis = normalisasiJenis(data.type ?? data.jenis ?? "Pengeluaran");
    const note = String(data.note ?? data.keterangan ?? "");
    const hasil = klasifikasiKategori(note, jenis);
    return {
        ...hasil,
        type:jenis,
        alternatives:KATALOG_KATEGORI
            .filter(item => kategoriSesuaiJenis(item, jenis) && item.name !== hasil.name)
            .slice(0, 5)
            .map(item => item.name)
    };
}

function ubahBudgetDashboard(nomor, data) {
    const saved = setBudgetKategori(nomor, data.category ?? data.kategori, data.limit ?? data.nominal);
    return { message:`Budget ${saved.name} berhasil diperbarui.`, budget:saved };
}

// ── PENGINGAT OTOMATIS ────────────────────────────────────────
function aktifkanPengingat(jid, sock) {
    if (reminderAktif[jid]) return false; // sudah aktif

    // Kirim pengingat setiap malam jam 20:00 WITA
    const checkInterval = setInterval(async () => {
        const now  = new Date();
        const wita = new Date(now.toLocaleString("en-US",{timeZone:APP_TIMEZONE}));
        if (wita.getHours()===20 && wita.getMinutes()===0) {
            const tips = await dapatkanTipsHarian();
            await sock.sendMessage(jid, {
                text: `🔔 *PENGINGAT HARIAN*\n\nSudah catat keuangan hari ini? 📝\n\nKetik *hari ini* untuk lihat ringkasan.\n\n${tips}`
            });
        }
    }, 60000); // cek setiap menit

    reminderAktif[jid] = checkInterval;
    return true;
}

function matikanPengingat(jid) {
    if (!reminderAktif[jid]) return false;
    clearInterval(reminderAktif[jid]);
    delete reminderAktif[jid];
    return true;
}

// ── TREN HARIAN ───────────────────────────────────────────────
async function buatTrenHarian(jid, hari=7) {
    const sheet = await getSheetByNomor(jid);
    const rows  = await sheet.getRows();
    const sekarang = sekarangWita();
    const peta  = {};

    for (let i=0; i<hari; i++) {
        const d = new Date(sekarang);
        d.setDate(d.getDate()-i);
        const key = d.toLocaleDateString("id-ID",{timeZone:APP_TIMEZONE,day:"2-digit",month:"2-digit"}).replace(/\./g,"/");
        peta[key] = { masuk:0, keluar:0 };
    }

    for (const row of rows) {
        const tglStr = String(row.get("Tanggal")||"");
        if (!tglStr) continue;
        const [tglBagian] = tglStr.split(", ");
        const [h,b,t]     = tglBagian.split("/").map(Number);
        if (!h||!b||!t) continue;

        const tgl = new Date(t, b-1, h);
        const selisih = (sekarang-tgl)/(1000*60*60*24);
        if (selisih>hari) continue;

        const keyRow = `${String(h).padStart(2,"0")}/${String(b).padStart(2,"0")}`;
        if (!peta[keyRow]) continue;

        const jenis  = String(row.get("Jenis")||"").toLowerCase();
        const nominal= Number(row.get("Nominal")||0);
        if (jenis==="pemasukan") peta[keyRow].masuk  += nominal;
        else                     peta[keyRow].keluar += nominal;
    }

    return Object.entries(peta)
        .reverse()
        .map(([label, d]) => ({ label, ...d }));
}

function ringkasRowsDashboard(rows, nomor) {
    const sekarang = sekarangWita();
    let incomeMonth = 0, expenseMonth = 0, totalBalance = 0, lastTransaction = "-";
    for (const row of rows) {
        const tanggal = String(row.get("Tanggal") || "");
        const [tanggalBagian] = tanggal.split(", ");
        const [hari, bulan, tahun] = tanggalBagian.split("/").map(Number);
        const jenis = String(row.get("Jenis") || "").toLowerCase().trim();
        const nominal = Number(row.get("Nominal") || 0);
        totalBalance += jenis === "pemasukan" ? nominal : -nominal;
        if (bulan === sekarang.getMonth() + 1 && tahun === sekarang.getFullYear()) {
            if (jenis === "pemasukan") incomeMonth += nominal;
            else expenseMonth += nominal;
        }
        if (tanggal) lastTransaction = tanggal;
    }
    return {
        number: nomor,
        maskedNumber: maskNomor(nomor),
        incomeMonth,
        expenseMonth,
        netMonth: incomeMonth - expenseMonth,
        totalBalance,
        totalTransactions: rows.length,
        lastTransaction
    };
}

async function ambilDaftarPenggunaDashboard() {
    const doc = await getGoogleDoc();
    const sheets = Object.values(doc.sheetsById)
        .filter(sheet => /^\d{8,16}$/.test(String(sheet.title || "")))
        .sort((a,b) => String(a.title).localeCompare(String(b.title)));
    const users = [];
    for (const sheet of sheets) {
        try {
            const rows = await sheet.getRows();
            users.push(ringkasRowsDashboard(rows, sheet.title));
        } catch(e) {
            console.warn(`Dashboard admin gagal membaca sheet ${sheet.title}:`, e.message || e);
        }
    }
    return users;
}

async function buatDataDashboardWeb(akses, nomorDipilih = "", periodeDipilih = "") {
    const now = new Date().toLocaleString("id-ID",{timeZone:APP_TIMEZONE});
    const periodeAktif = parsePeriodeKey(periodeDipilih);
    const bulan = periodeAktif.label;
    let daftarPengguna = [];
    let adminMessage = "";
    if (akses.role === "admin") {
        try {
            daftarPengguna = await ambilDaftarPenggunaDashboard();
        } catch(e) {
            adminMessage = `Daftar pengguna belum bisa dimuat: ${e.message || e}`;
        }
    }
    const nomorDiminta = String(nomorDipilih || "").replace(/\D/g, "");
    const nomorAktif = akses.role === "admin"
        ? (daftarPengguna.some(user => user.number === nomorDiminta) ? nomorDiminta : (daftarPengguna[0]?.number || akses.number))
        : akses.number;
    const ownerJid = nomorAktif ? `${nomorAktif}@s.whatsapp.net` : "";
    const totalAdmin = daftarPengguna.reduce((acc, user) => ({
        incomeMonth: acc.incomeMonth + user.incomeMonth,
        expenseMonth: acc.expenseMonth + user.expenseMonth,
        totalBalance: acc.totalBalance + user.totalBalance,
        totalTransactions: acc.totalTransactions + user.totalTransactions
    }), { incomeMonth:0, expenseMonth:0, totalBalance:0, totalTransactions:0 });
    const base = {
        access: {
            role: akses.role,
            isAdmin: akses.role === "admin",
            selectedNumber: nomorAktif,
            expiresAt: akses.expiresAt || null
        },
        report: {
            selected:periodeAktif.key,
            type:periodeAktif.tipe,
            label:periodeAktif.label,
            availablePeriods:[],
            availableYears:[]
        },
        system: {
            status: sockGlobal ? "Online" : "Offline",
            connected: !!sockGlobal,
            reconnect: jumlahReconnect,
            time: now,
            timezone: APP_TIMEZONE,
            uptimeSeconds: Math.floor(process.uptime()),
            port: PORT,
            owner: maskNomor(nomorAktif),
            protected: true
        },
        ai: {
            provider: formatProviderAI(),
            openai: !!openai,
            gemini: !!ai,
            model: openai ? OPENAI_MODEL : (GEMINI_MODELS[0] || null),
            status: Object.fromEntries(Object.entries(statusProviderAI).map(([nama, state]) => [nama, {
                available: providerAIAktif(nama),
                reason: state.reason || null,
                blockedUntil: state.blockedUntil || null
            }]))
        },
        admin: akses.role === "admin" ? {
            users: daftarPengguna,
            message: adminMessage,
            summary: {
                totalUsers: daftarPengguna.length,
                ...totalAdmin,
                netMonth: totalAdmin.incomeMonth - totalAdmin.expenseMonth
            }
        } : null,
        catalog: daftarKategoriUntukWeb(),
        finance: null,
        commands: [
            { cmd:"dashboard", desc:"Ringkasan pintar di WhatsApp" },
            { cmd:"laporan bulan ini", desc:"Laporan tabel periode berjalan" },
            { cmd:"laporan visual", desc:"Laporan grafis ala buku kas + link web" },
            { cmd:"laporan visual Mei 2026", desc:"Laporan visual untuk bulan tertentu" },
            { cmd:"laporan Mei 2026", desc:"Laporan lengkap bulan sebelumnya" },
            { cmd:"laporan tahunan 2026", desc:"Rekap dan transaksi setahun" },
            { cmd:"saldo", desc:"Rekap semua waktu" },
            { cmd:"saldo binance", desc:"Saldo Binance + harga/koin ke USDT realtime" },
            { cmd:"riwayat bulan lalu", desc:"Riwayat periode sebelumnya" },
            { cmd:"riwayat 20", desc:"20 transaksi terakhir" },
            { cmd:"budget", desc:"Monitor anggaran" },
            { cmd:"set budget Konsumsi 2jt", desc:"Ubah limit kategori" },
            { cmd:"kategori", desc:"Lihat katalog kategori pintar" },
            { cmd:"prediksi", desc:"Estimasi cashflow" },
            { cmd:"analisis", desc:"Insight AI bulanan" },
            { cmd:"cari makan", desc:"Cari transaksi cocok" },
            { cmd:"export Mei 2026", desc:"Unduh Excel periode historis" }
        ]
    };

    if (!ownerJid) {
        base.finance = {
            available: false,
            message: "Belum ada nomor pengguna yang terdata di spreadsheet."
        };
        return base;
    }

    try {
        const [lapHari, lapBulan, lapSemua, lapTahun] = await Promise.all([
            buatLaporanKeuangan("hari", ownerJid),
            buatLaporanKeuangan(periodeAktif.tipe, ownerJid, periodeAktif),
            buatLaporanKeuangan("semua", ownerJid),
            buatLaporanKeuangan("tahun", ownerJid, { tahun:periodeAktif.tahun })
        ]);
        const tren = Object.entries(lapBulan.trenHarian)
            .sort(([a],[b]) => {
                const [da,ma] = a.split("/").map(Number);
                const [db,mb] = b.split("/").map(Number);
                return new Date(periodeAktif.tahun, ma-1, da) - new Date(periodeAktif.tahun, mb-1, db);
            })
            .map(([label, value]) => ({ label, ...value }));
        base.report.availablePeriods = lapSemua.periodeTersedia;
        base.report.availableYears = [...new Set(lapSemua.periodeTersedia.map(key => Number(key.slice(0,4))))].sort((a,b)=>b-a);
        base.report.months = lapTahun.ringkasanBulanan.filter(item => item.tahun === periodeAktif.tahun);
        base.report.closingBalance = lapBulan.saldoAkumulasi;
        const budget = getBudget(ownerJid);
        const transaksiKeluar = lapBulan.transaksi.filter(t => t.jenis === "Pengeluaran");
        const transaksiMasuk = lapBulan.transaksi.filter(t => t.jenis === "Pemasukan");
        const rataKeluar = transaksiKeluar.length ? Math.round(lapBulan.totalKeluar / transaksiKeluar.length) : 0;
        const rasioSisa = lapBulan.totalMasuk > 0 ? Math.round((lapBulan.saldo / lapBulan.totalMasuk) * 100) : 0;
        const nowWita = sekarangWita();
        const periodeBulanBerjalan = periodeAktif.tipe === "bulan" && periodeAktif.tahun === nowWita.getFullYear() && periodeAktif.bulan === nowWita.getMonth() + 1;
        const hariBerjalan = nowWita.getDate();
        const hariDalamBulan = new Date(nowWita.getFullYear(), nowWita.getMonth() + 1, 0).getDate();
        const proyeksiKeluar = periodeBulanBerjalan && hariBerjalan ? Math.round((lapBulan.totalKeluar / hariBerjalan) * hariDalamBulan) : lapBulan.totalKeluar;
        const budgetFactor = periodeAktif.tipe === "tahun" ? 12 : 1;
        const safeDays = periodeBulanBerjalan
            ? Math.max(1, hariDalamBulan - hariBerjalan + 1)
            : (periodeAktif.tipe === "tahun" ? 365 : new Date(periodeAktif.tahun, periodeAktif.bulan || 12, 0).getDate());
        const statusKeuangan = lapBulan.totalMasuk === 0
            ? "Perlu data"
            : rasioSisa >= 20 ? "Sehat"
            : rasioSisa >= 0 ? "Waspada"
            : "Defisit";
        const topKategori = Object.entries(lapBulan.detailKategori).sort((a,b)=>b[1]-a[1])[0] || null;
        const analytics = buatAnalitikDashboard(lapBulan, lapSemua, budget, { budgetFactor, safeDays });
        let binanceInfo = { enabled:nomorPunyaAksesBinance(nomorAktif), available:false, configured:binanceTerkonfigurasi(), message:"Integrasi Binance hanya aktif untuk nomor khusus." };
        if (nomorPunyaAksesBinance(nomorAktif)) {
            try {
                binanceInfo = await ambilSaldoBinance(nomorAktif);
            } catch(e) {
                binanceInfo = { enabled:true, available:false, configured:binanceTerkonfigurasi(), message:String(e.message || e) };
            }
        }

        base.finance = {
            available: true,
            period: bulan,
            periodType:periodeAktif.tipe,
            periodKey:periodeAktif.key,
            owner: maskNomor(nomorAktif),
            binance: binanceInfo,
            summary: {
                status: statusKeuangan,
                incomeMonth: lapBulan.totalMasuk,
                expenseMonth: lapBulan.totalKeluar,
                netMonth: lapBulan.saldo,
                incomeToday: lapHari.totalMasuk,
                expenseToday: lapHari.totalKeluar,
                totalBalance: lapSemua.saldo,
                closingBalance:lapBulan.saldoAkumulasi,
                remainingRatio: rasioSisa,
                avgExpense: rataKeluar,
                projectedExpense: proyeksiKeluar,
                incomeTransactions: transaksiMasuk.length,
                expenseTransactions: transaksiKeluar.length,
                totalTransactions: lapSemua.transaksi.length,
                monthTransactions: lapBulan.transaksi.length,
                topCategory: topKategori ? { name: topKategori[0], amount: topKategori[1] } : null
            },
            wallets: Object.entries(lapSemua.saldoDompet)
                .sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]))
                .map(([name, balance]) => ({ name: name.toUpperCase(), balance })),
            analytics,
            categories: Object.entries(lapBulan.detailKategori)
                .sort((a,b)=>b[1]-a[1])
                .map(([name, amount]) => {
                    const meta = metaKategori(name);
                    return { name, amount, group:meta.group, color:meta.color };
                }),
            budgets: Object.entries(budget)
                .map(([name, limit]) => {
                    const limitPeriode = Number(limit || 0) * budgetFactor;
                    const used = lapBulan.detailKategori[name] || 0;
                    const percent = limitPeriode > 0 ? Math.round((used / limitPeriode) * 100) : 0;
                    const meta = metaKategori(name);
                    return {
                        name,
                        group:meta.group,
                        color:meta.color,
                        used,
                        limit:limitPeriode,
                        monthlyLimit:Number(limit || 0),
                        remaining: limitPeriode - used,
                        percent,
                        status: percent >= 100 ? "Over" : percent >= 85 ? "Waspada" : "Aman"
                    };
                })
                .sort((a,b)=>b.percent-a.percent),
            trend: tren,
            recent: lapBulan.transaksi.slice().reverse().map(t => ({
                rowNumber: t.rowNumber,
                date: t.tanggalLengkap || t.tanggal,
                type: t.jenis,
                category: t.kategori,
                amount: t.nominal,
                note: t.keterangan,
                wallet: String(t.dompet || "").toUpperCase(),
                balance: t.saldo
            }))
        };
    } catch(e) {
        base.finance = {
            available: false,
            message: `Data keuangan belum bisa dimuat: ${e.message || e}`
        };
    }

    return base;
}

// ── DASHBOARD WEB HTML ────────────────────────────────────────
function buatHalamanWeb() {
    return `<!DOCTYPE html>
<html lang="id" data-type="software" data-radius="soft" data-motion>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="page-type" content="software">
<meta name="site-kind" content="software">
<title>Dashboard Bot Keuangan WA</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{color-scheme:light;--bg:#f7f9f8;--surface:#fff;--surface-2:#ebf0ee;--ink:#123e44;--muted:#4e7375;--line:rgba(6,82,92,.12);--accent:#06525c;--accent-ink:#f7f9f8;--green:#328666;--green-soft:#e8f4ee;--red:#c76a62;--red-soft:#f9ece9;--amber:#a57435;--amber-soft:#f7f0e4;--blue:#397d90;--shadow:0 8px 24px rgba(18,62,68,.055);--shadow-hover:0 12px 30px rgba(18,62,68,.1);--radius:18px;--side:#eaf0ee;--side-ink:#123e44;--side-muted:#5f7a7c;--side-line:rgba(6,82,92,.1)}
html[data-theme="meadow"]{--bg:#f5f8f1;--surface:#fff;--surface-2:#eaf0e4;--ink:#2f4433;--muted:#667b68;--line:rgba(51,85,55,.12);--accent:#496f4f;--accent-ink:#fff;--green:#397b55;--green-soft:#e9f3e8;--red:#ba675b;--red-soft:#f9ece8;--amber:#9a783d;--amber-soft:#f6f0e0;--blue:#47788b;--side:#edf2e9;--side-ink:#2f4433;--side-muted:#6d806e;--side-line:rgba(51,85,55,.1)}
html[data-theme="clay"]{--bg:#fbf5ef;--surface:#fffdfa;--surface-2:#f2e8dc;--ink:#513b31;--muted:#806d60;--line:rgba(104,67,45,.13);--accent:#9a6048;--accent-ink:#fff8f1;--green:#588064;--green-soft:#edf3e9;--red:#c4685c;--red-soft:#faece7;--amber:#9d7136;--amber-soft:#f6efdf;--blue:#587e8b;--side:#f3e9df;--side-ink:#513b31;--side-muted:#806d60;--side-line:rgba(104,67,45,.1)}
html[data-theme="night"]{color-scheme:dark;--bg:#111b1d;--surface:#1b292b;--surface-2:#233436;--ink:#e8f1ef;--muted:#a8b9b6;--line:rgba(218,242,237,.1);--accent:#89cbc0;--accent-ink:#102326;--green:#80c6a5;--green-soft:rgba(128,198,165,.13);--red:#ee9489;--red-soft:rgba(238,148,137,.13);--amber:#e4bd79;--amber-soft:rgba(228,189,121,.13);--blue:#8dbbca;--shadow:0 8px 24px rgba(0,0,0,.15);--shadow-hover:0 12px 30px rgba(0,0,0,.24);--side:#172426;--side-ink:#e8f1ef;--side-muted:#a8b9b6;--side-line:rgba(218,242,237,.1)}
html{background:var(--bg);scroll-behavior:smooth}body{min-height:100vh;background:var(--bg);color:var(--ink);font-family:'Outfit',system-ui,sans-serif;letter-spacing:-.018em;transition:background-color .22s,color .22s}button,input,select{font:inherit}button{color:inherit}[hidden]{display:none!important}::selection{background:var(--accent);color:var(--accent-ink)}::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--muted) 28%,transparent);border-radius:99px}::-webkit-scrollbar-track{background:transparent}
.bg-fx{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden}.bg-fx .grid-fx{position:absolute;inset:0;opacity:.11;background-image:radial-gradient(var(--muted) .7px,transparent .7px);background-size:22px 22px;mask-image:linear-gradient(to bottom,#000,transparent 55%)}.bg-fx .blob{position:absolute;width:360px;height:360px;border-radius:50%;filter:blur(100px);opacity:.09}.bg-fx .b1{left:22%;top:-240px;background:var(--accent)}.bg-fx .b2{right:-200px;bottom:-240px;background:var(--blue)}.bg-fx .b3{display:none}
.shell{position:relative;z-index:1;display:grid;grid-template-columns:248px minmax(0,1fr);gap:26px;min-height:100vh;padding:24px;transition:grid-template-columns .2s}.sidebar{position:sticky;top:24px;display:flex;flex-direction:column;gap:20px;height:calc(100vh - 48px);min-height:560px;padding:18px 14px;border:1px solid var(--side-line);border-radius:22px;background:var(--side);color:var(--side-ink);overflow:hidden}.brand{display:flex;align-items:center;gap:11px;padding:3px 5px 17px;border-bottom:1px solid var(--side-line)}.mark{width:40px;height:40px;display:grid;place-items:center;border-radius:14px;background:var(--accent);color:var(--accent-ink);font-size:.78rem;font-weight:800}.brand h1{font-size:.98rem;letter-spacing:-.035em;font-weight:600}.brand small{display:block;margin-top:2px;color:var(--side-muted);font-size:.69rem}.nav{display:flex;flex-direction:column;gap:3px;overflow:auto;padding:0 1px}.nav-label{padding:11px 10px 5px;color:var(--side-muted);font-size:.64rem;letter-spacing:.09em;font-weight:600;text-transform:uppercase}.nav-item{display:flex;align-items:center;gap:10px;width:100%;padding:10px 11px;border:1px solid transparent;border-radius:11px;background:transparent;color:var(--side-ink);text-align:left;font-size:.82rem;font-weight:500;cursor:pointer;transition:background-color .15s,color .15s,border-color .15s,transform .15s}.nav-item:hover{background:color-mix(in srgb,var(--accent) 8%,transparent);transform:translateX(2px)}.nav-item:active{transform:translateY(1px) scale(.99)}.nav-item.active{background:var(--accent);color:var(--accent-ink);font-weight:600}.nav-ic{display:grid;place-items:center;width:21px;font-size:.94rem}.nav-more{margin-top:7px}.nav-more>.nav-label{display:flex;justify-content:space-between;align-items:center;cursor:pointer;list-style:none}.nav-more>.nav-label::-webkit-details-marker{display:none}.nav-more>.nav-label:after{content:'+';font-size:.9rem;transition:transform .15s}.nav-more[open]>.nav-label:after{transform:rotate(45deg)}.nav-submenu{display:grid;gap:3px}.side-meta{display:grid;gap:6px;margin-top:auto;padding:11px 12px;border:1px solid var(--side-line);border-radius:13px;color:var(--side-muted);font-size:.67rem}.side-meta b{color:var(--side-ink);font-weight:600}.side-foot{display:none}
.content{display:grid;align-content:start;gap:20px;width:100%;max-width:1540px;min-width:0;margin:0 auto}.topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:4px 2px 15px;border-bottom:1px solid var(--line)}.kicker{margin-bottom:5px;color:var(--accent);font-size:.68rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase}.topbar h2{font-size:clamp(1.4rem,2.4vw,2rem);font-weight:500;letter-spacing:-.045em;line-height:1.1}.topbar p{margin-top:5px;color:var(--muted);font-size:.82rem}.actions,.toolbar,.modal-actions,.actions-cell{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:40px;padding:8px 13px;border:1px solid var(--line);border-radius:11px;background:var(--surface);color:var(--ink);font-size:.78rem;font-weight:500;text-decoration:none;cursor:pointer;transition:transform .14s,background-color .14s,border-color .14s,color .14s,box-shadow .14s}.btn:hover{transform:translateY(-1px);border-color:color-mix(in srgb,var(--accent) 35%,var(--line));box-shadow:var(--shadow)}.btn:active{transform:translateY(1px) scale(.985)}.btn:focus-visible,.nav-item:focus-visible,.theme-select:focus-visible,.metric-card:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.btn.primary{border-color:var(--accent);background:var(--accent);color:var(--accent-ink)}.btn.primary:hover{background:color-mix(in srgb,var(--accent) 90%,var(--ink));color:var(--accent-ink)}.btn.danger{border-color:transparent;background:var(--red-soft);color:var(--red)}.btn.small{min-height:32px;padding:5px 9px;font-size:.71rem}.icon-btn{width:40px;padding:0}.field,.theme-select{min-width:145px;min-height:40px;padding:8px 11px;border:1px solid var(--line);border-radius:11px;background:var(--surface);color:var(--ink);font-size:.77rem;outline:none}.field:focus,.form-group input:focus,.form-group select:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 15%,transparent)}.theme-control{display:flex;align-items:center;gap:7px;color:var(--muted);font-size:.72rem}.theme-select{min-width:120px;cursor:pointer}.pill{display:inline-flex;align-items:center;gap:7px;padding:8px 10px;border:1px solid var(--line);border-radius:99px;background:var(--surface);font-size:.72rem;font-weight:500}.dot{width:8px;height:8px;border-radius:50%;background:var(--amber)}.dot.online{background:var(--green)}.dot.offline{background:var(--red)}.badge-count{position:absolute;top:-4px;right:-4px;display:grid;place-items:center;min-width:16px;height:16px;padding:0 4px;border-radius:99px;background:var(--red);color:#fff;font:500 .6rem 'DM Mono',monospace}.hint,.subtle{color:var(--muted);font-size:.73rem}.label{color:var(--muted);font-size:.7rem;font-weight:500}.value{font:500 1.25rem/1.15 'DM Mono',ui-monospace,monospace;letter-spacing:-.045em;overflow-wrap:anywhere}.value.green{color:var(--green)}.value.red{color:var(--red)}.value.blue{color:var(--blue)}.value.amber{color:var(--amber)}
.view{display:none;gap:14px;min-width:0}.view.active{display:grid;animation:view-open .18s ease-out}@keyframes view-open{from{opacity:.65}to{opacity:1}}.finance-hero{position:relative;isolation:isolate;overflow:hidden;display:grid;grid-template-columns:minmax(220px,1.3fr) repeat(3,minmax(112px,.55fr));align-items:center;gap:12px;min-height:172px;padding:22px;border-radius:22px;background:var(--accent);color:var(--accent-ink)}.finance-hero:after{position:absolute;z-index:-1;content:'';width:330px;height:330px;right:2%;top:-245px;border:1px solid color-mix(in srgb,var(--accent-ink) 19%,transparent);border-radius:50%;box-shadow:0 0 0 28px color-mix(in srgb,var(--accent-ink) 5%,transparent),0 0 0 56px color-mix(in srgb,var(--accent-ink) 4%,transparent)}.hero-copy h3{max-width:500px;font-size:clamp(1.12rem,1.8vw,1.48rem);font-weight:500;letter-spacing:-.035em}.hero-copy p{max-width:590px;margin-top:7px;color:color-mix(in srgb,var(--accent-ink) 74%,var(--accent));font-size:.78rem;line-height:1.55}.hero-stat{padding:11px 12px;border-left:1px solid color-mix(in srgb,var(--accent-ink) 22%,transparent)}.hero-stat span{font-size:.67rem;color:color-mix(in srgb,var(--accent-ink) 72%,var(--accent))}.hero-stat b{display:block;margin-top:5px;font:500 .93rem 'DM Mono',monospace}.hero-stat .score{color:var(--accent-ink)}.smart-radar{display:grid;grid-template-columns:1.2fr repeat(3,1fr);gap:10px}.radar-card{min-width:0;padding:13px 14px;border:1px solid var(--line);border-radius:15px;background:var(--surface);transition:transform .15s,border-color .15s}.radar-card:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--accent) 30%,var(--line))}.radar-card.priority{border-left:3px solid var(--green)}.radar-card span{color:var(--muted);font-size:.62rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase}.radar-card b{display:block;margin-top:5px;font-size:.89rem;font-weight:500}.radar-card p{margin-top:4px;color:var(--muted);font-size:.7rem;line-height:1.4}
.metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:11px}.metric-card,.panel-card,.mini{min-width:0;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);box-shadow:var(--shadow)}.metric-card{position:relative;display:grid;align-content:space-between;gap:9px;min-height:140px;padding:16px;overflow:hidden;cursor:pointer;transition:transform .16s,border-color .16s,box-shadow .16s,background-color .16s}.metric-card:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--accent) 30%,var(--line));box-shadow:var(--shadow-hover)}.metric-card:active{transform:translateY(1px) scale(.99)}.metric-card:after{position:absolute;right:14px;top:12px;content:'↗';color:var(--muted);font-size:.8rem;opacity:.6}.metric-ic{width:34px;height:34px;display:grid;place-items:center;border-radius:11px;background:var(--surface-2);font-size:.93rem}.metric-ic.green{color:var(--green);background:var(--green-soft)}.metric-ic.red{color:var(--red);background:var(--red-soft)}.metric-ic.blue{color:var(--blue);background:color-mix(in srgb,var(--blue) 11%,var(--surface))}.metric-ic.amber{color:var(--amber);background:var(--amber-soft)}.metric-card .spark{position:absolute;right:13px;bottom:12px;width:76px;height:25px;opacity:.65}.mini-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.mini{display:grid;gap:6px;padding:13px 14px}.mini b{font:500 .86rem 'DM Mono',monospace}.mini .hint{font-size:.68rem}.panel-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(250px,.85fr);gap:12px}.panel-grid.equal{grid-template-columns:1fr 1fr}.panel-card{padding:16px}.panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}.panel-head h3{font-size:.94rem;font-weight:500;letter-spacing:-.02em}.panel-head .subtle{display:block;margin-top:4px}.overview-visual{grid-template-columns:minmax(0,1.4fr) minmax(270px,.8fr)}.overview-chart{width:100%;height:220px;display:block;overflow:visible}.overview-chart .income-path,.trend-chart .income-path{stroke:var(--green)}.overview-chart .expense-path,.trend-chart .expense-path{stroke:var(--red)}.overview-chart .chart-grid,.trend-chart .chart-grid{stroke:var(--line)}.overview-chart .chart-label,.trend-chart .chart-label{fill:var(--muted)}.overview-chart .chart-dot.income-path,.trend-chart .chart-dot.income-path{fill:var(--green)}.overview-chart .chart-dot.expense-path,.trend-chart .chart-dot.expense-path{fill:var(--red)}.overview-chart .chart-dot,.trend-chart .chart-dot{transform-box:fill-box;transform-origin:center;animation:dot-breathe 2.8s ease-in-out infinite}.pause-chart-motion .chart-dot{animation-play-state:paused!important}@keyframes dot-breathe{0%,100%{r:4}50%{r:5.5}}.chart-tools{display:flex;align-items:center;gap:9px}.chart-legend{display:flex;gap:14px;align-items:center;color:var(--muted);font-size:.7rem}.chart-legend span{display:flex;align-items:center;gap:6px}.chart-legend i{width:8px;height:8px;border-radius:50%;background:var(--green)}.chart-legend .expense-key{background:var(--red)}.overview-split{display:grid;gap:12px}.list-scroll{max-height:270px;overflow:auto}.bar-list{display:grid;gap:10px}.bar-row{display:grid;grid-template-columns:minmax(95px,1fr) minmax(70px,1.3fr) auto;align-items:center;gap:8px;font-size:.7rem}.bar-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:.68rem}.bar{height:7px;overflow:hidden;border-radius:99px;background:var(--surface-2)}.bar span{display:block;height:100%;border-radius:inherit;background:var(--accent);transition:width .4s cubic-bezier(.2,.8,.2,1)}.wallets{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:7px}.wallet{display:grid;gap:3px;padding:9px 10px;border-radius:12px;background:var(--surface-2)}.wallet b{font-size:.71rem;font-weight:500}.wallet span{font:500 .7rem 'DM Mono',monospace;color:var(--muted)}
.table-wrap{max-width:100%;max-height:560px;overflow:auto;border:1px solid var(--line);border-radius:14px;background:var(--surface)}.table{width:100%;border-collapse:collapse;font-size:.74rem}.table th{position:sticky;top:0;z-index:2;background:var(--surface-2);color:var(--muted);text-align:left;font-size:.64rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase}.table td,.table th{padding:11px 12px;border-bottom:1px solid var(--line);white-space:nowrap}.table tbody tr:last-child td{border-bottom:0}.table tbody tr:hover{background:color-mix(in srgb,var(--accent) 4%,transparent)}.sort-th{cursor:pointer;user-select:none}.sort-th .arrow{margin-left:3px;opacity:.5}.sort-th.sort-active .arrow{color:var(--accent);opacity:1}.pagination{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding-top:10px;color:var(--muted);font-size:.73rem}.empty{padding:14px;border:1px dashed var(--line);border-radius:13px;color:var(--muted);font-size:.76rem}.report-banner{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:17px 19px;border-radius:18px;background:var(--surface-2)}.report-balance{text-align:right}.report-balance span{display:block;color:var(--muted);font-size:.68rem}.report-balance b{display:block;margin-top:4px;font:500 1.15rem 'DM Mono',monospace}.badge,.type-badge{display:inline-flex;align-items:center;padding:4px 8px;border-radius:99px;font-size:.65rem;font-weight:500}.badge{background:var(--surface-2);color:var(--accent)}.type-badge.income{background:var(--green-soft);color:var(--green)}.type-badge.expense{background:var(--red-soft);color:var(--red)}.category-pill{display:inline-flex;align-items:center;gap:6px;font-weight:500}.category-pill:before{width:7px;height:7px;border-radius:50%;background:var(--category-color,#748078);content:''}.insight-list{display:grid;gap:8px}.insight-item{display:flex;align-items:flex-start;gap:9px;padding:10px;border-bottom:1px solid var(--line);font-size:.75rem}.insight-mark{flex:none;width:8px;height:8px;margin-top:4px;border-radius:50%;background:var(--accent)}.catalog-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.catalog-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:9px}.category-card,.budget-card,.goal-card,.status-item,.trend-kpi,.binance-kpi,.cmd{min-width:0;padding:13px;border:1px solid var(--line);border-radius:15px;background:var(--surface);transition:transform .16s,border-color .16s,box-shadow .16s}.category-card:hover,.budget-card:hover,.goal-card:hover,.trend-kpi:hover,.binance-kpi:hover,.cmd:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--accent) 28%,var(--line));box-shadow:var(--shadow-hover)}.category-card{display:grid;gap:8px}.category-top{display:flex;align-items:center;gap:8px}.category-swatch{width:9px;height:28px;border-radius:6px}.category-card h4,.goal-card h4{font-size:.84rem;font-weight:500}.category-card p{color:var(--muted);font-size:.7rem;line-height:1.45}.category-meta{display:flex;gap:5px;flex-wrap:wrap}.tag{padding:4px 7px;border-radius:99px;background:var(--surface-2);color:var(--muted);font-size:.62rem}.budget-summary,.trend-kpis,.binance-kpis,.status-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.binance-kpi span,.trend-kpi span,.status-item span{color:var(--muted);font-size:.68rem}.binance-kpi b,.trend-kpi b,.status-item b{display:block;margin-top:5px;font:500 .95rem 'DM Mono',monospace}.asset-chip{display:inline-flex;padding:5px 8px;border-radius:99px;background:var(--amber-soft);color:var(--amber);font-size:.65rem}.binance-card{border-top:2px solid var(--amber)}.goal-grid,.budget-card-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:9px}.goal-card{display:grid;gap:8px}.goal-card .bar{height:7px}.goal-meta{display:flex;justify-content:space-between;color:var(--muted);font-size:.68rem}.cmds{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:9px}.cmd{text-align:left;color:var(--accent);font-weight:500;cursor:pointer}.cmd span{display:block;margin-top:4px;color:var(--muted);font-size:.7rem;font-weight:400}.chart-wrap{position:relative;height:320px}.trend-shell{display:grid;gap:10px}.trend-legend{display:flex;gap:12px;flex-wrap:wrap;color:var(--muted);font-size:.72rem}.trend-chart{width:100%;height:100%;display:block}
.notif-panel{position:fixed;top:76px;right:22px;z-index:28;display:none;width:min(350px,92vw);max-height:72vh;overflow:auto;padding:13px;border:1px solid var(--line);border-radius:17px;background:var(--surface);box-shadow:var(--shadow-hover)}.notif-panel.show{display:block;animation:panel-open .16s ease-out}@keyframes panel-open{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:none}}.notif-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:9px}.notif-list{display:grid;gap:7px}.notif-item{padding:10px;border:1px solid var(--line);border-radius:12px;font-size:.73rem}.notif-item b{display:block}.notif-item span{color:var(--muted)}.notif-item.warn{border-left:3px solid var(--amber)}.notif-item.danger{border-left:3px solid var(--red)}.notif-item.good{border-left:3px solid var(--green)}.cmdk-overlay{position:fixed;inset:0;z-index:40;display:none;align-items:flex-start;justify-content:center;padding-top:12vh;background:rgba(13,30,33,.4);backdrop-filter:blur(6px)}.cmdk-overlay.show{display:flex}.cmdk-box{display:grid;gap:9px;width:min(560px,92vw);padding:13px;border:1px solid var(--line);border-radius:17px;background:var(--surface);box-shadow:var(--shadow-hover)}.cmdk-box .field{width:100%;font-size:.9rem;padding:12px}.cmdk-list{display:grid;gap:3px;max-height:50vh;overflow:auto}.cmdk-opt{padding:10px;border:0;border-radius:10px;background:transparent;text-align:left;color:var(--ink);font-size:.78rem;cursor:pointer}.cmdk-opt:hover,.cmdk-opt.sel{background:var(--surface-2);color:var(--accent)}
.lock,.modal{position:fixed;inset:0;z-index:20;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(13,30,33,.42);backdrop-filter:blur(7px)}.lock.show,.modal.show{display:flex}.lock-box,.modal-box{display:grid;gap:14px;width:min(620px,100%);padding:20px;border:1px solid var(--line);border-radius:18px;background:var(--surface);box-shadow:var(--shadow-hover)}.lock-box{width:min(420px,100%)}.lock-box input,.form-group input,.form-group select{width:100%;min-height:44px;padding:10px 11px;border:1px solid var(--line);border-radius:11px;background:var(--surface);color:var(--ink);font-size:16px;outline:none}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px}.form-group{display:grid;gap:6px}.form-group.full{grid-column:1/-1}.form-group label{color:var(--muted);font-size:.72rem;font-weight:500}.toast{position:fixed;right:18px;bottom:18px;z-index:35;display:none;padding:11px 14px;border-radius:12px;background:var(--ink);color:var(--bg);font-size:.75rem;box-shadow:var(--shadow-hover)}.toast.show{display:block;animation:panel-open .15s ease-out}.mobile-overlay{display:none}.shell.menu-collapsed{grid-template-columns:0 minmax(0,1fr)}.shell.menu-collapsed .sidebar{opacity:0;pointer-events:none;overflow:hidden;padding:0;border:0;transform:translateX(-12px)}.menu-fab{display:inline-flex}.bottom-nav{display:none}
.lv-wrap{display:grid;gap:14px}.lv-cover{position:relative;overflow:hidden;padding:24px;border-radius:20px;background:var(--accent);color:var(--accent-ink)}.lv-eyebrow{font:500 .65rem 'DM Mono',monospace;letter-spacing:.1em;text-transform:uppercase}.lv-cover h2{margin:9px 0 4px;font-size:clamp(1.45rem,3vw,2rem);font-weight:500;letter-spacing:-.04em}.lv-sub{color:color-mix(in srgb,var(--accent-ink) 72%,var(--accent));font-size:.75rem}.lv-hero-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:15px}.lv-hero-stat,.lv-insight-card{padding:12px;border:1px solid color-mix(in srgb,var(--accent-ink) 20%,transparent);border-radius:14px;background:color-mix(in srgb,var(--accent-ink) 7%,transparent)}.lv-lbl{font-size:.62rem;text-transform:uppercase}.lv-val{margin-top:5px;font:500 1rem 'DM Mono',monospace}.lv-page{padding:19px;border:1px solid var(--line);border-radius:17px;background:var(--surface)}.lv-tag{color:var(--accent);font:500 .65rem 'DM Mono',monospace;text-transform:uppercase}.lv-title{margin:7px 0;font-weight:500;font-size:1rem}.lv-desc{margin-bottom:12px;color:var(--muted);font-size:.74rem}.lv-chartbox{position:relative;height:250px}.lv-two-col{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:center}.lv-legend{list-style:none}.lv-legend li{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line);font-size:.72rem}.lv-name{display:flex;align-items:center;gap:7px}.lv-dot{width:8px;height:8px;border-radius:50%}.lv-amt{font-weight:500}.lv-pct{color:var(--muted);font-size:.65rem}.lv-chip-row{display:flex;flex-wrap:wrap;gap:7px}.lv-chip{display:flex;gap:6px;padding:7px 10px;border:1px solid var(--line);border-radius:99px;background:var(--surface-2);font-size:.7rem}.lv-chip b{color:var(--red)}.lv-chip span{color:var(--muted);font-size:.62rem}.lv-receipt-shell{display:flex;justify-content:center}.lv-receipt{width:100%;max-width:420px;padding:17px;border-radius:13px;background:var(--surface-2)}.lv-receipt h4{text-align:center;font-size:.75rem}.lv-rsub{text-align:center;color:var(--muted);font-size:.66rem}.lv-rrow,.lv-rtotal{display:flex;justify-content:space-between;gap:9px;padding:7px 0;border-bottom:1px dashed var(--line);font-size:.68rem}.lv-rcat{display:block;color:var(--muted);font-size:.6rem}.lv-ramt{font:500 .7rem 'DM Mono',monospace;white-space:nowrap}.lv-rtotal{margin-top:8px;border:0;border-top:1px solid var(--line);font-weight:500}.lv-barcode{height:24px;margin-top:11px;opacity:.45;background:repeating-linear-gradient(90deg,var(--ink) 0 2px,transparent 2px 4px)}.lv-insight-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.lv-insight-card{border-color:var(--line);background:var(--surface-2)}.lv-big{font:500 1.02rem 'DM Mono',monospace}.lv-lbl2{margin-top:4px;color:var(--muted);font-size:.66rem}.lv-rec-list{padding-left:18px}.lv-rec-list li{margin:7px 0;font-size:.74rem}.lv-stamp{display:inline-block;padding:5px 9px;border:1px solid var(--accent);border-radius:6px;color:var(--accent);font-size:.65rem;text-transform:uppercase}
.bottom-nav{position:fixed;left:10px;right:10px;bottom:max(10px,env(safe-area-inset-bottom));z-index:30;display:none;justify-content:space-around;align-items:center;padding:5px;border:1px solid var(--side-line);border-radius:16px;background:var(--side);box-shadow:var(--shadow-hover)}.bottom-nav .bn-item{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-height:48px;padding:5px 2px;border:0;border-radius:11px;background:transparent;color:var(--side-ink);font-size:.59rem;font-weight:500;cursor:pointer}.bottom-nav .bn-ic{font-size:.98rem}.bottom-nav .bn-item.active{background:var(--accent);color:var(--accent-ink)}
@media(max-width:1180px){.shell{grid-template-columns:1fr}.sidebar{position:relative;top:0;height:auto;min-height:0}.nav{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))}.nav-label{grid-column:1/-1}.nav-more{grid-column:1/-1}.side-meta{grid-template-columns:repeat(3,1fr);margin-top:0}.shell.menu-collapsed{grid-template-columns:1fr}.shell.menu-collapsed .sidebar{opacity:1;pointer-events:auto;padding:18px 14px;border:1px solid var(--side-line);transform:none}.overview-visual{grid-template-columns:minmax(0,1.2fr) minmax(250px,.8fr)}}
@media(max-width:760px){.shell{display:block;padding:10px}.sidebar{display:none;position:fixed;inset:8px;z-index:25;max-height:calc(100vh - 16px);overflow:auto;border-radius:18px;box-shadow:var(--shadow-hover)}.shell.menu-open .sidebar{display:flex}.mobile-overlay{position:fixed;inset:0;z-index:24;background:rgba(13,30,33,.35);backdrop-filter:blur(5px)}.shell.menu-open .mobile-overlay{display:block}.content{gap:14px;padding-bottom:78px}.topbar{align-items:flex-start;padding:4px 2px 12px}.topbar h2{font-size:1.4rem}.actions{gap:6px}.actions .btn,.actions .field,.actions .theme-select{min-height:38px;padding:7px 9px;font-size:.7rem}.actions .theme-control{font-size:0}.actions .theme-select{font-size:.7rem}.actions .menu-fab{display:none}.nav{display:flex;gap:3px}.nav-label{padding:12px 8px 5px}.nav-item{min-height:44px}.nav-more>.nav-label{min-height:44px}.metric-grid,.mini-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.metric-card{min-height:130px;padding:12px}.metric-card .value{font-size:1rem}.panel-grid,.panel-grid.equal,.overview-visual{grid-template-columns:1fr}.finance-hero{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:17px}.hero-copy{grid-column:1/-1}.hero-stat{padding:9px 10px;border:1px solid color-mix(in srgb,var(--accent-ink) 18%,transparent);border-radius:12px}.smart-radar{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.radar-card{padding:11px}.overview-chart{height:200px}.panel-card{padding:13px}.table-wrap{max-height:440px}.table{font-size:.67rem}.table td,.table th{padding:9px}.chart-wrap{height:260px}.trend-kpis,.binance-kpis,.budget-summary,.status-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.form-grid{grid-template-columns:1fr}.form-group.full{grid-column:auto}.field,.search-field{min-width:0}.toolbar,.catalog-toolbar{align-items:stretch}.report-banner{align-items:flex-start;flex-direction:column}.report-balance{text-align:left}.lv-two-col{grid-template-columns:1fr}.lv-chartbox{height:220px}.lv-page,.lv-cover{padding:16px}.lv-hero-grid{gap:7px}.lv-hero-stat{padding:9px}.lv-insight-grid{grid-template-columns:1fr 1fr}.bottom-nav{display:flex}.metric-card:after{content:'Buka →';top:auto;bottom:12px;font-size:.58rem}.metric-card .spark{right:9px;bottom:12px}}
@media(max-width:430px){.topbar{gap:10px}.actions{width:100%}.actions .btn{flex:1}.actions .field{flex:1}.actions .theme-select{max-width:128px}.metric-card{min-height:122px;padding:10px}.metric-card .label{font-size:.63rem}.metric-card .value{font-size:.88rem}.metric-card .hint{font-size:.61rem}.mini{padding:10px}.mini .hint{font-size:.61rem}.smart-radar{grid-template-columns:1fr 1fr}.radar-card p{font-size:.64rem}.finance-hero{grid-template-columns:1fr 1fr}.hero-stat span{font-size:.61rem}.hero-stat b{font-size:.78rem}.lv-insight-grid{grid-template-columns:1fr}.table-wrap{border-radius:11px}.table td,.table th{padding:8px;font-size:.62rem}.cmds,.catalog-grid,.goal-grid,.budget-card-list{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{scroll-behavior:auto!important;animation:none!important;transition-duration:.01ms!important}}
</style>


</head>
<body>
<!-- Dashboard bot keuangan · soft teal palette · Outfit + DM Mono · overview-first navigation -->
<div class="bg-fx" aria-hidden="true">
  <div class="grid-fx"></div>
  <div class="blob b1"></div>
  <div class="blob b2"></div>
  <div class="blob b3"></div>
</div>
<div class="shell" id="shell">
  <div class="mobile-overlay" id="mobile-overlay"></div>
  <aside class="sidebar">
    <div class="brand"><div class="mark">WA</div><div><h1>Bot Keuangan</h1><small>Ruang kendali keuangan</small></div></div>
    <nav class="nav" aria-label="Navigasi keuangan">
      <div class="nav-label">Keuangan</div>
      <button class="nav-item active" data-view="overview" type="button"><span class="nav-ic">⌂</span><span>Overview</span></button>
      <button class="nav-item" data-view="transactions" type="button"><span class="nav-ic">↗</span><span>Transaksi</span></button>
      <button class="nav-item" data-view="budget" type="button"><span class="nav-ic">◷</span><span>Budget</span></button>
      <button class="nav-item" data-view="reports" type="button"><span class="nav-ic">▤</span><span>Laporan</span></button>
      <button class="nav-item" data-view="analytics" type="button"><span class="nav-ic">◌</span><span>Analitik</span></button>
      <button class="nav-item" data-view="goals" type="button"><span class="nav-ic">◇</span><span>Target Tabungan</span></button>
      <details class="nav-more">
        <summary class="nav-label">Fitur lainnya</summary>
        <div class="nav-submenu">
          <button class="nav-item" data-view="trend" type="button"><span class="nav-ic">⌁</span><span>Tren</span></button>
          <button class="nav-item" data-view="laporanvisual" type="button"><span class="nav-ic">▧</span><span>Laporan Visual</span></button>
          <button class="nav-item" data-view="binance" type="button"><span class="nav-ic">◈</span><span>Binance</span></button>
          <button class="nav-item" id="admin-nav" data-view="admin" type="button" hidden><span class="nav-ic">♧</span><span>Pengguna</span></button>
          <button class="nav-item" data-view="catalog" type="button"><span class="nav-ic">▦</span><span>Katalog Kategori</span></button>
          <button class="nav-item" data-view="system" type="button"><span class="nav-ic">⚙</span><span>Status Sistem</span></button>
          <button class="nav-item" data-view="commands" type="button"><span class="nav-ic">⌘</span><span>Command WhatsApp</span></button>
        </div>
      </details>
    </nav>
    <div class="side-meta">
      <div>Owner: <b id="side-owner">-</b></div>
      <div>Port: <b id="side-port">-</b></div>
      <div>Zona: <b id="side-zone">-</b></div>
    </div>
  </aside>

  <main class="content">
    <section class="topbar">
      <div>
        <div class="kicker" id="view-kicker">Bot Keuangan WA</div>
        <h2 id="page-title">Dashboard Keuangan</h2>
        <p id="subtitle">Memuat data bot...</p>
      </div>
      <div class="actions">
        <button class="btn menu-fab" id="menu-toggle" type="button">☰ Menu</button>
        <button class="btn" id="cmdk-btn" type="button" title="Pencarian cepat (Ctrl+K)">🔎 Cari <span class="hint" style="margin-left:6px">Ctrl+K</span></button>
        <select class="field" id="global-period-select" aria-label="Pilih periode laporan"></select>
        <label class="theme-control"><span>Tema</span><select class="theme-select" id="theme-select" aria-label="Pilih tema warna"><option value="paper">Teal</option><option value="meadow">Sage</option><option value="clay">Terracotta</option><option value="night">Malam</option></select></label>
        <span class="pill"><span id="status-dot" class="dot"></span><span id="status-label">Memuat</span></span>
        <button class="btn icon-btn" id="notif-btn" type="button" title="Notifikasi">🔔<span class="badge-count" id="notif-count" hidden>0</span></button>
        <button class="btn" id="quick-add-btn" type="button">+ Catat</button>
        <button class="btn primary" id="refresh-btn" type="button">Refresh</button>
      </div>
    </section>
    <div class="notif-panel" id="notif-panel">
      <div class="notif-head"><b>Notifikasi</b><button class="btn small" id="notif-close" type="button">Tutup</button></div>
      <div class="notif-list" id="notif-list"><div class="empty">Belum ada notifikasi.</div></div>
    </div>
    <div class="cmdk-overlay" id="cmdk-overlay">
      <div class="cmdk-box">
        <input id="cmdk-input" class="field" placeholder="Ketik menu, transaksi, atau perintah..." autocomplete="off">
        <div class="cmdk-list" id="cmdk-list"></div>
      </div>
    </div>

    <section class="view active" data-view="overview" id="view-overview">
      <div class="finance-hero">
        <div class="hero-copy"><h3 id="hero-title">Membaca kondisi keuangan...</h3><p id="hero-copy">Dashboard sedang menyusun ringkasan terintegrasi dari transaksi, kategori, dan budget.</p></div>
        <div class="hero-stat"><span>Skor Keuangan</span><b class="score" id="health-score">-</b></div>
        <div class="hero-stat"><span>Batas Aman Harian</span><b id="daily-safe">-</b></div>
        <div class="hero-stat"><span>Budget Tersisa</span><b id="budget-remaining-hero">-</b></div>
      </div>
      <div class="smart-radar">
        <div class="radar-card priority"><span>Fokus Hari Ini</span><b id="radar-focus">-</b><p id="radar-focus-detail">-</p></div>
        <div class="radar-card"><span>Level Risiko</span><b id="radar-risk">-</b><p id="radar-risk-detail">-</p></div>
        <div class="radar-card"><span>Ritme Belanja</span><b id="radar-pace">-</b><p id="radar-pace-detail">-</p></div>
        <div class="radar-card"><span>Transaksi Terbesar</span><b id="radar-largest">-</b><p id="radar-largest-detail">-</p></div>
      </div>
      <div class="metric-grid">
        <div class="metric-card"><div class="metric-ic green">💰</div><div class="label">Pemasukan Periode</div><div class="value green" id="income-month">-</div><div class="hint" id="income-today">-</div><canvas class="spark" id="spark-income"></canvas></div>
        <div class="metric-card"><div class="metric-ic red">🧾</div><div class="label">Pengeluaran Periode</div><div class="value red" id="expense-month">-</div><div class="hint" id="expense-today">-</div><canvas class="spark" id="spark-expense"></canvas></div>
        <div class="metric-card"><div class="metric-ic blue">🏦</div><div class="label">Saldo Bersih Periode</div><div class="value blue" id="net-month">-</div><div class="hint" id="finance-status">Status -</div></div>
        <div class="metric-card"><div class="metric-ic amber">📈</div><div class="label">Saldo Total</div><div class="value amber" id="total-balance">-</div><div class="hint" id="transaction-count">0 transaksi</div></div>
      </div>
      <div class="mini-grid">
        <div class="mini"><span class="label">Rata-rata Pengeluaran</span><b id="avg-expense">-</b><span class="hint">Per transaksi bulan ini</span></div>
        <div class="mini"><span class="label">Proyeksi Pengeluaran</span><b id="projected-expense">-</b><span class="hint">Estimasi akhir bulan</span></div>
        <div class="mini"><span class="label">Kategori Terbesar</span><b id="insight-top-category">-</b><span class="hint">Pengeluaran bulan ini</span></div>
        <div class="mini"><span class="label">Rasio Sisa</span><b id="remaining-ratio">-</b><span class="hint">Dari pemasukan bulan ini</span></div>
      </div>
      <div class="panel-grid overview-visual">
        <div class="panel-card">
          <div class="panel-head"><div><h3>Arus kas bulan ini</h3><div class="subtle" id="overview-chart-caption">Pemasukan dan pengeluaran harian</div></div><div class="chart-tools"><div class="chart-legend"><span><i></i>Masuk</span><span><i class="expense-key"></i>Keluar</span></div><button class="btn small chart-motion-toggle" type="button" aria-pressed="false" aria-label="Jeda animasi diagram">Jeda</button></div></div>
          <svg class="overview-chart" id="overview-chart" viewBox="0 0 900 360" preserveAspectRatio="none" role="img" aria-label="Diagram arus kas harian"></svg>
        </div>
        <div class="panel-card overview-split">
          <div><div class="panel-head"><div><h3>Pengeluaran per kategori</h3><div class="subtle" id="top-category">-</div></div></div><div class="bar-list list-scroll" id="category-list"></div></div>
          <div><div class="panel-head"><div><h3>Saldo dompet</h3><div class="subtle">Ringkasan semua dompet</div></div></div><div class="wallets" id="wallet-list"></div></div>
        </div>
      </div>
    </section>

    <section class="view" data-view="binance" id="view-binance">
      <div class="finance-hero">
        <div class="hero-copy"><h3 id="binance-page-title">Binance Spot Realtime</h3><p id="binance-page-copy">Saldo realtime akan muncul untuk nomor khusus setelah API Key dan Secret diisi di Railway.</p></div>
        <div class="hero-stat"><span>Total USDT</span><b id="binance-page-usdt">-</b></div>
        <div class="hero-stat"><span>Estimasi Rupiah</span><b id="binance-page-idr">-</b></div>
        <div class="hero-stat"><span>Status API</span><b id="binance-page-status">-</b></div>
      </div>
      <div class="panel-grid equal">
        <div class="panel-card binance-card">
          <div class="panel-head"><div><h3>Portofolio Aset</h3><div class="subtle" id="binance-refresh-time">-</div></div><span class="badge">Realtime</span></div>
          <div class="table-wrap">
            <table class="table"><thead><tr><th>Aset</th><th class="right">Free</th><th class="right">Locked</th><th class="right">Total</th><th class="right">Harga/Koin</th><th class="right">Estimasi USDT</th></tr></thead><tbody id="binance-assets-body"></tbody></table>
          </div>
        </div>
        <div class="panel-card">
          <div class="panel-head"><div><h3>Integrasi Spreadsheet + Bot</h3><div class="subtle">Nomor khusus terhubung dengan saldo catatan dan saldo Binance.</div></div></div>
          <div class="insight-list" id="binance-integrations">
            <div class="insight-item"><span class="insight-mark"></span><div><b>Spreadsheet per nomor</b><p class="muted">Transaksi tetap disimpan di sheet bernama nomor pengguna.</p></div></div>
            <div class="insight-item"><span class="insight-mark"></span><div><b>Command WhatsApp</b><p class="muted">Ketik saldo binance untuk melihat aset realtime.</p></div></div>
            <div class="insight-item"><span class="insight-mark"></span><div><b>Excel modern</b><p class="muted">Laporan ekspor berisi ringkasan, diagram kategori, tren, dompet, dan transaksi.</p></div></div>
          </div>
        </div>
      </div>
    </section>

    <section class="view" data-view="admin" id="view-admin">
      <div class="panel-card">
        <div class="panel-head"><div><h3>Super Admin</h3><div class="subtle" id="admin-message">Seluruh nomor yang terdata di spreadsheet</div></div><span class="badge">ADMIN</span></div>
      <div class="mini-grid">
        <div class="mini"><span class="label">Total Pengguna</span><b id="admin-users">-</b></div>
        <div class="mini"><span class="label">Pemasukan Gabungan</span><b id="admin-income">-</b></div>
        <div class="mini"><span class="label">Pengeluaran Gabungan</span><b id="admin-expense">-</b></div>
        <div class="mini"><span class="label">Total Transaksi</span><b id="admin-transactions">-</b></div>
      </div>
      <div class="table-wrap" style="margin-top:12px">
        <table class="table">
          <thead><tr><th>Nomor</th><th>Transaksi Terakhir</th><th class="right">Masuk Bulan Ini</th><th class="right">Keluar Bulan Ini</th><th class="right">Saldo Total</th><th class="right">Transaksi</th></tr></thead>
          <tbody id="admin-user-body"></tbody>
        </table>
      </div>
      </div>
    </section>

    <section class="view" data-view="analytics" id="view-analytics">
      <div class="metric-grid">
        <div class="metric-card"><div class="label">Skor Keuangan</div><div class="value green" id="analytics-score">-</div><div class="hint" id="analytics-label">-</div></div>
        <div class="metric-card"><div class="label">Perubahan Pengeluaran</div><div class="value blue" id="expense-change">-</div><div class="hint">Dibanding bulan lalu</div></div>
        <div class="metric-card"><div class="label">Perubahan Pemasukan</div><div class="value amber" id="income-change">-</div><div class="hint">Dibanding bulan lalu</div></div>
        <div class="metric-card"><div class="label">Batas Aman Harian</div><div class="value" id="analytics-daily-safe">-</div><div class="hint">Sampai akhir bulan</div></div>
      </div>
      <div class="panel-grid equal">
        <div class="panel-card">
          <div class="panel-head"><div><h3>Komposisi Pengeluaran</h3><div class="subtle">Dikelompokkan dari katalog kategori pintar</div></div></div>
          <div class="bar-list" id="group-spending-list"></div>
        </div>
        <div class="panel-card">
          <div class="panel-head"><div><h3>Rekomendasi Terintegrasi</h3><div class="subtle">Berdasarkan transaksi dan penggunaan budget</div></div></div>
          <div class="insight-list" id="smart-tip-list"></div>
        </div>
      </div>
    </section>

    <section class="view" data-view="reports" id="view-reports">
      <div class="report-banner">
        <div><h3 id="report-title">Laporan Keuangan</h3><p>Ringkasan, tabungan akumulasi, dan transaksi lengkap sesuai periode.</p></div>
        <div class="report-balance"><span>Tabungan hingga akhir periode</span><b id="report-closing-balance">-</b></div>
      </div>
      <div class="metric-grid">
        <div class="metric-card"><div class="label">Pemasukan Periode</div><div class="value green" id="report-income">-</div><div class="hint" id="report-income-count">-</div></div>
        <div class="metric-card"><div class="label">Pengeluaran Periode</div><div class="value red" id="report-expense">-</div><div class="hint" id="report-expense-count">-</div></div>
        <div class="metric-card"><div class="label">Saldo Periode</div><div class="value blue" id="report-net">-</div><div class="hint" id="report-ratio">-</div></div>
        <div class="metric-card"><div class="label">Total Transaksi</div><div class="value amber" id="report-count">-</div><div class="hint">Daftar lengkap di bawah</div></div>
      </div>
      <div class="panel-card">
        <div class="panel-head"><div><h3>Ringkasan Bulanan</h3><div class="subtle">Arus kas dan tabungan akumulasi dalam tahun terpilih</div></div></div>
        <div class="table-wrap">
          <table class="table"><thead><tr><th>Bulan</th><th class="right">Masuk</th><th class="right">Keluar</th><th class="right">Bersih</th><th class="right">Tabungan</th><th class="right">Trx</th></tr></thead><tbody id="annual-month-body"></tbody></table>
        </div>
      </div>
      <div class="panel-card">
        <div class="panel-head"><div><h3>Transaksi Lengkap</h3><div class="subtle" id="report-transaction-label">Periode terpilih</div></div><button class="btn" id="report-export-btn" type="button">Export Excel</button></div>
        <div class="table-wrap">
          <table class="table"><thead><tr><th>Tanggal</th><th>Jenis</th><th>Kategori</th><th>Keterangan</th><th>Dompet</th><th class="right">Nominal</th></tr></thead><tbody id="report-transaction-body"></tbody></table>
        </div>
      </div>
    </section>

    <section class="view" data-view="laporanvisual" id="view-laporanvisual">
      <div class="lv-wrap">
        <div class="lv-cover">
          <div class="lv-eyebrow">Buku Kas Pribadi</div>
          <h2 id="lv-title">Laporan Keuangan Visual</h2>
          <div class="lv-sub" id="lv-subtitle">Periode - · Dompet cash · - transaksi</div>
          <button type="button" id="lv-period-shortcut" style="font-family:-apple-system,sans-serif;font-size:11.5px;font-weight:700;background:rgba(241,233,216,.12);border:1px solid rgba(241,233,216,.3);color:#E8CE86;padding:6px 13px;border-radius:20px;cursor:pointer;margin-bottom:16px">🔄 Ganti periode / bulan</button>
          <div class="lv-hero-grid">
            <div class="lv-hero-stat income"><div class="lv-lbl">Total Pemasukan</div><div class="lv-val lv-mono" id="lv-income">Rp 0</div></div>
            <div class="lv-hero-stat expense"><div class="lv-lbl">Total Pengeluaran</div><div class="lv-val lv-mono" id="lv-expense">Rp 0</div></div>
            <div class="lv-hero-stat net"><div class="lv-lbl">Saldo Bersih Periode</div><div class="lv-val lv-mono" id="lv-net">Rp 0</div></div>
          </div>
        </div>

        <div class="lv-page">
          <div class="lv-tag">Halaman 1</div>
          <div class="lv-title">Tren Harian: Arus Masuk &amp; Keluar</div>
          <p class="lv-desc">Batang hijau adalah pemasukan, garis merah adalah pengeluaran harian pada periode yang sedang dipilih di atas.</p>
          <div class="lv-chartbox"><svg id="lv-daily-chart" width="100%" height="100%" viewBox="0 0 900 320" preserveAspectRatio="xMidYMid meet"></svg></div>
        </div>

        <div class="lv-page">
          <div class="lv-tag">Halaman 2</div>
          <div class="lv-title">Ke Mana Uang Kamu Pergi</div>
          <p class="lv-desc">Rincian pengeluaran berdasarkan kategori pada periode terpilih.</p>
          <div class="lv-two-col">
            <div class="lv-chartbox"><svg id="lv-cat-chart" width="100%" height="100%" viewBox="0 0 260 260" preserveAspectRatio="xMidYMid meet"></svg></div>
            <ul class="lv-legend" id="lv-cat-legend"></ul>
          </div>
        </div>

        <div class="lv-page">
          <div class="lv-tag">Halaman 3</div>
          <div class="lv-title">Pengeluaran Terbesar</div>
          <p class="lv-desc">Disajikan seperti struk kasir — urut dari yang paling menguras dompet pada periode ini.</p>
          <div class="lv-receipt-shell">
            <div class="lv-receipt">
              <h4>Struk Pengeluaran</h4>
              <div class="lv-rsub" id="lv-receipt-sub">Periode berjalan</div>
              <div id="lv-receipt-rows"></div>
              <div class="lv-rtotal"><span>TOTAL ITEM</span><span id="lv-receipt-total">Rp 0</span></div>
              <div class="lv-barcode"></div>
            </div>
          </div>
        </div>

        <div class="lv-page">
          <div class="lv-tag">Halaman 4</div>
          <div class="lv-title">Kebiasaan &amp; Ringkasan Cepat</div>
          <p class="lv-desc">Kata kunci paling sering muncul di catatan transaksi kamu bulan ini.</p>
          <div class="lv-chip-row" id="lv-chips"></div>
          <hr style="border:none;border-top:1px dashed var(--line);margin:20px 0">
          <div class="lv-insight-grid">
            <div class="lv-insight-card"><div class="lv-big" id="lv-savings-rate">-</div><div class="lv-lbl2">Tingkat tabungan (net ÷ pemasukan)</div></div>
            <div class="lv-insight-card"><div class="lv-big" id="lv-avg-daily">-</div><div class="lv-lbl2">Rata-rata pengeluaran per hari</div></div>
            <div class="lv-insight-card"><div class="lv-big" id="lv-avg-trx">-</div><div class="lv-lbl2">Rata-rata per transaksi</div></div>
          </div>
        </div>

        <div class="lv-page">
          <div class="lv-tag">Halaman 5</div>
          <div class="lv-title">Catatan Kasir</div>
          <ul class="lv-rec-list" id="lv-notes"></ul>
          <div style="margin-top:16px"><span class="lv-stamp">Tercatat Otomatis</span></div>
        </div>
      </div>
    </section>

    <section class="view" data-view="trend" id="view-trend">
      <div class="panel-card trend-shell">
        <div class="panel-head"><div><h3>Arus Kas Harian</h3><div class="subtle">Pergerakan pemasukan dan pengeluaran pada periode terpilih</div></div><div class="chart-tools"><button class="btn small chart-motion-toggle" type="button" aria-pressed="false" aria-label="Jeda animasi diagram">Jeda</button><div class="subtle" id="period-label">-</div></div></div>
        <div class="trend-kpis">
          <div class="trend-kpi"><span>Total Masuk</span><b id="trend-income">-</b></div>
          <div class="trend-kpi"><span>Total Keluar</span><b id="trend-expense">-</b></div>
          <div class="trend-kpi"><span>Arus Bersih</span><b id="trend-net">-</b></div>
          <div class="trend-kpi"><span>Hari Tersibuk</span><b id="trend-peak">-</b></div>
        </div>
        <div class="panel-head"><div class="trend-legend"><span><i class="legend-dot income"></i>Pemasukan</span><span><i class="legend-dot expense"></i>Pengeluaran</span></div></div>
        <div class="chart-wrap"><svg class="trend-chart" id="trend-chart" viewBox="0 0 900 360" preserveAspectRatio="xMidYMid meet"></svg></div>
      </div>
    </section>

    <section class="view" data-view="budget" id="view-budget">
      <div class="budget-summary">
        <div class="mini"><span class="label">Total Budget</span><b id="budget-total">-</b><span class="hint">Semua kategori aktif</span></div>
        <div class="mini"><span class="label">Sudah Terpakai</span><b id="budget-used">-</b><span class="hint">Bulan berjalan</span></div>
        <div class="mini"><span class="label">Mendekati Limit</span><b id="budget-watch">-</b><span class="hint">Perlu dipantau</span></div>
        <div class="mini"><span class="label">Melewati Limit</span><b id="budget-over">-</b><span class="hint">Perlu tindakan</span></div>
      </div>
      <div class="panel-grid equal">
        <div class="panel-card">
          <div class="panel-head"><div><h3>Budget Periode Terpilih</h3><div class="subtle">Klik Ubah untuk menyesuaikan limit</div></div></div>
          <div class="budget-card-list list-scroll" id="budget-list"></div>
        </div>
        <div class="panel-card">
          <div class="panel-head"><div><h3>Kategori Periode Terpilih</h3><div class="subtle">Urutan pengeluaran terbesar</div></div></div>
          <div class="bar-list list-scroll" id="category-list-budget"></div>
        </div>
      </div>
    </section>

    <section class="view" data-view="goals" id="view-goals">
      <div class="panel-card">
        <div class="panel-head">
          <div><h3>Target Tabungan</h3><div class="subtle">Buat target, pantau progres berdasarkan saldo total kamu saat ini</div></div>
          <button class="btn primary" id="add-goal-btn" type="button">+ Target Baru</button>
        </div>
        <div class="goal-grid" id="goal-list"></div>
      </div>
    </section>

    <section class="view" data-view="transactions" id="view-transactions">
      <div class="panel-card">
      <div class="panel-head">
        <div><h3>Kelola Transaksi</h3><span class="subtle" id="transaction-period-label">Transaksi pada periode terpilih</span></div>
        <div class="toolbar">
          <input class="field search-field" id="transaction-search" placeholder="Cari transaksi...">
          <select class="field" id="transaction-filter"><option value="">Semua jenis</option><option value="Pemasukan">Pemasukan</option><option value="Pengeluaran">Pengeluaran</option></select>
          <select class="field" id="transaction-category-filter"><option value="">Semua kategori</option></select>
          <button class="btn" id="export-csv-btn" type="button">Export Excel</button>
          <button class="btn primary" id="add-transaction-btn" type="button">+ Transaksi</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr>
            <th class="sort-th" data-sort="date">Tanggal <span class="arrow">↕</span></th>
            <th class="sort-th" data-sort="type">Jenis <span class="arrow">↕</span></th>
            <th class="sort-th" data-sort="category">Kategori <span class="arrow">↕</span></th>
            <th>Keterangan</th>
            <th class="sort-th" data-sort="wallet">Dompet <span class="arrow">↕</span></th>
            <th class="right sort-th" data-sort="amount">Nominal <span class="arrow">↕</span></th>
            <th class="right">Aksi</th>
          </tr></thead>
          <tbody id="recent-body"></tbody>
        </table>
      </div>
      </div>
    </section>

    <section class="view" data-view="catalog" id="view-catalog">
      <div class="panel-card">
        <div class="panel-head">
          <div><h3>Katalog Kategori Pintar</h3><div class="subtle">Kategori, kelompok, budget bawaan, dan contoh transaksi</div></div>
          <div class="catalog-toolbar">
            <input class="field search-field" id="catalog-search" placeholder="Cari kategori atau contoh...">
            <select class="field" id="catalog-type-filter"><option value="">Semua jenis</option><option value="Pengeluaran">Pengeluaran</option><option value="Pemasukan">Pemasukan</option><option value="Keduanya">Keduanya</option></select>
          </div>
        </div>
        <div class="catalog-grid" id="catalog-list"></div>
      </div>
    </section>

    <section class="view" data-view="system" id="view-system">
      <div class="panel-grid">
        <div class="panel-card">
          <div class="panel-head"><div><h3>Kesehatan Bot</h3><div class="subtle" id="updated-at">-</div></div></div>
          <div class="status-grid">
            <div class="status-item"><b id="socket-status">-</b><span>WhatsApp socket</span></div>
            <div class="status-item"><b id="ai-provider">-</b><span>Provider AI</span></div>
            <div class="status-item"><b id="reconnect-count">-</b><span>Reconnect</span></div>
            <div class="status-item"><b id="uptime">-</b><span>Uptime</span></div>
          </div>
        </div>
        <div class="panel-card">
          <div class="panel-head"><div><h3>Status AI</h3><div class="subtle">Provider aktif dan fallback</div></div></div>
          <div class="status-grid" id="ai-status-list"></div>
        </div>
      </div>
    </section>

    <section class="view" data-view="commands" id="view-commands">
      <div class="panel-card">
      <div class="panel-head"><div><h3>Command Center</h3><div class="subtle">Perintah WhatsApp</div></div></div>
      <div class="cmds" id="command-list"></div>
      </div>
    </section>
  </main>
  <nav class="bottom-nav" id="bottom-nav">
    <button class="bn-item nav-item" data-view="overview" type="button"><span class="bn-ic">📊</span><span>Overview</span></button>
    <button class="bn-item nav-item" data-view="laporanvisual" type="button"><span class="bn-ic">🧾</span><span>Visual</span></button>
    <button class="bn-item nav-item" data-view="transactions" type="button"><span class="bn-ic">💳</span><span>Transaksi</span></button>
    <button class="bn-item nav-item" data-view="budget" type="button"><span class="bn-ic">🎯</span><span>Budget</span></button>
    <button class="bn-item" id="bottom-more-btn" type="button"><span class="bn-ic">☰</span><span>Lainnya</span></button>
  </nav>
</div>

<div class="lock" id="lock">
  <form class="lock-box" id="token-form">
    <h3>Akses Dashboard</h3>
    <p class="muted">Buka link terbaru dari bot WhatsApp, atau masukkan token admin lama.</p>
    <input id="token-input" type="password" autocomplete="current-password" placeholder="Access token">
    <button class="btn primary" type="submit">Buka Dashboard</button>
  </form>
</div>
<div class="modal" id="transaction-modal">
  <form class="modal-box" id="transaction-form">
    <div class="panel-head"><div><h3 id="transaction-modal-title">Tambah Transaksi</h3><span class="subtle">Data akan langsung disimpan ke spreadsheet.</span></div><button class="btn small" id="close-transaction-modal" type="button">Tutup</button></div>
    <div class="form-grid">
      <div class="form-group"><label>Jenis</label><select id="trx-type" required><option>Pemasukan</option><option selected>Pengeluaran</option></select></div>
      <div class="form-group"><label>Nominal</label><input id="trx-amount" type="number" min="1" required placeholder="Contoh: 50000"></div>
      <div class="form-group"><label>Tanggal</label><input id="trx-date" type="date" required></div>
      <div class="form-group"><label>Dompet</label><input id="trx-wallet" required placeholder="cash / bca / gopay"></div>
      <div class="form-group full"><label>Kategori</label><select id="trx-category" required></select><div class="smart-suggestion" id="category-suggestion"><span id="category-suggestion-text">Saran kategori tersedia.</span><button id="use-category-suggestion" type="button">Gunakan</button></div></div>
      <div class="form-group full"><label>Keterangan</label><input id="trx-note" required placeholder="Makan siang"></div>
    </div>
    <div class="modal-actions"><button class="btn" id="cancel-transaction" type="button">Batal</button><button class="btn primary" id="save-transaction" type="submit">Simpan Transaksi</button></div>
  </form>
</div>
<div class="modal" id="budget-modal">
  <form class="modal-box" id="budget-form">
    <div class="panel-head"><div><h3>Ubah Budget</h3><span class="subtle">Limit akan langsung dipakai oleh web dan notifikasi WhatsApp.</span></div><button class="btn small" id="close-budget-modal" type="button">Tutup</button></div>
    <div class="form-grid">
      <div class="form-group full"><label>Kategori</label><select id="budget-category" required></select></div>
      <div class="form-group full"><label>Limit Bulanan</label><input id="budget-limit" type="number" min="0" required placeholder="Contoh: 1500000"></div>
    </div>
    <div class="modal-actions"><button class="btn" id="cancel-budget" type="button">Batal</button><button class="btn primary" id="save-budget" type="submit">Simpan Budget</button></div>
  </form>
</div>
<div class="modal" id="goal-modal">
  <form class="modal-box" id="goal-form">
    <div class="panel-head"><div><h3 id="goal-modal-title">Target Tabungan Baru</h3><span class="subtle">Progres dihitung otomatis dari saldo total periode berjalan.</span></div><button class="btn small" id="close-goal-modal" type="button">Tutup</button></div>
    <div class="form-grid">
      <div class="form-group full"><label>Nama Target</label><input id="goal-name" required placeholder="Contoh: Dana Darurat"></div>
      <div class="form-group"><label>Target Nominal</label><input id="goal-target" type="number" min="1" required placeholder="Contoh: 10000000"></div>
      <div class="form-group"><label>Tenggat</label><input id="goal-deadline" type="date"></div>
    </div>
    <div class="modal-actions"><button class="btn" id="cancel-goal" type="button">Batal</button><button class="btn primary" type="submit">Simpan Target</button></div>
  </form>
</div>
<div class="toast" id="toast"></div>

<script>
  const rupiah = new Intl.NumberFormat("id-ID", { style:"currency", currency:"IDR", maximumFractionDigits:0 });
  const params = new URLSearchParams(location.search);
  let token = params.get("access") || params.get("token") || sessionStorage.getItem("dashboardAccess") || "";
  let selectedNumber = params.get("nomor") || "";
  const rawHash = (location.hash || "").replace("#", "").trim();
  const hashParts = rawHash.split(":");
  const hashView = hashParts[0] || "";
  const hashPeriod = hashParts[1] ? decodeURIComponent(hashParts[1]) : "";
  let selectedPeriod = hashPeriod || params.get("periode") || sessionStorage.getItem("dashboardPeriod") || "";
  let currentRecent = [];
  let currentReport = {};
  let currentCatalog = [];
  let currentAnalytics = {};
  let currentBudgets = [];
  let currentFinance = {};
  let currentBinance = {};
  let editingRow = null;
  let suggestedCategory = "";
  let categorySuggestionTimer = null;
  let activeView = hashView || localStorage.getItem("dashboardView") || "overview";
  const viewTitles = {
    overview:"Overview",
    binance:"Binance",
    admin:"Pengguna",
    analytics:"Analitik",
    reports:"Laporan",
    laporanvisual:"Laporan Visual",
    trend:"Tren",
    budget:"Budget",
    goals:"Target Tabungan",
    transactions:"Transaksi",
    catalog:"Katalog",
    system:"Sistem",
    commands:"Command"
  };
  if (hashView) history.replaceState(null, "", location.pathname + location.search);
  if (params.get("access") || params.get("token")) {
    sessionStorage.setItem("dashboardAccess", token);
    history.replaceState(null, "", "/dashboard");
  }
  const $ = id => document.getElementById(id);
  const money = value => rupiah.format(Number(value || 0));
  const lastAnimatedValue = {};
  function animateMoney(id, target) {
    const el = $(id);
    if (!el) return;
    target = Number(target || 0);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = money(target); lastAnimatedValue[id] = target; return; }
    const from = lastAnimatedValue[id] !== undefined ? lastAnimatedValue[id] : 0;
    lastAnimatedValue[id] = target;
    const duration = 550, start = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = money(from + (target - from) * eased);
      if (t < 1) requestAnimationFrame(tick);
      else el.textContent = money(target);
    }
    requestAnimationFrame(tick);
  }
  const esc = value => String(value ?? "-").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
  const showToast = text => {
    $("toast").textContent = text;
    $("toast").classList.add("show");
    setTimeout(() => $("toast").classList.remove("show"), 2600);
  };
  const duration = seconds => {
    const s = Number(seconds || 0), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h > 0) return h + "j " + m + "m";
    if (m > 0) return m + "m";
    return s + "d";
  };
  function setActiveView(view, store = true) {
    if (view === "admin" && $("admin-nav").hidden) view = "overview";
    activeView = viewTitles[view] ? view : "overview";
    document.querySelectorAll(".view").forEach(section => {
      section.classList.toggle("active", section.dataset.view === activeView);
    });
    document.querySelectorAll(".nav-item").forEach(button => {
      const active = button.dataset.view === activeView;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    $("view-kicker").textContent = viewTitles[activeView] || "Overview";
    if (store) localStorage.setItem("dashboardView", activeView);
  }
  const dateForInput = value => {
    const parts = String(value || "").split(",")[0].split("/");
    return parts.length === 3 ? parts[2] + "-" + parts[1] + "-" + parts[0] : new Date().toISOString().slice(0,10);
  };
  const apiHeaders = () => token ? { "Content-Type":"application/json", "x-dashboard-access":token, "x-dashboard-token":token } : { "Content-Type":"application/json" };

  async function transactionRequest(path, options) {
    const query = selectedNumber ? "?nomor=" + encodeURIComponent(selectedNumber) : "";
    const res = await fetch(path + query, { ...options, headers:apiHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "HTTP " + res.status);
    return data;
  }

  async function loadDashboard() {
    try {
      const headers = token ? { "x-dashboard-access": token, "x-dashboard-token": token } : {};
      const query = new URLSearchParams();
      if (selectedNumber) query.set("nomor", selectedNumber);
      if (selectedPeriod) query.set("periode", selectedPeriod);
      const res = await fetch("/api/dashboard" + (query.toString() ? "?" + query.toString() : ""), { headers });
      if (res.status === 401) {
        $("lock").classList.add("show");
        return;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (token) sessionStorage.setItem("dashboardAccess", token);
      $("lock").classList.remove("show");
      render(data);
    } catch (e) {
      showToast("Dashboard belum bisa dimuat: " + e.message);
    }
  }

  async function loadBinanceRealtime(force = false) {
    try {
      const headers = token ? { "x-dashboard-access": token, "x-dashboard-token": token } : {};
      const query = new URLSearchParams();
      if (selectedNumber) query.set("nomor", selectedNumber);
      if (force) query.set("force", "1");
      const res = await fetch("/api/binance" + (query.toString() ? "?" + query.toString() : ""), { headers });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      currentBinance = data.binance || currentBinance || {};
      renderBinance(currentBinance);
    } catch (_) {}
  }

  function render(data) {
    const sys = data.system || {};
    const ai = data.ai || {};
    const finance = data.finance || {};
    const access = data.access || {};
    currentFinance = finance || {};
    currentBinance = finance.binance || {};
    currentReport = data.report || {};
    selectedPeriod = currentReport.selected || selectedPeriod;
    if (selectedPeriod) sessionStorage.setItem("dashboardPeriod", selectedPeriod);
    populatePeriodSelector(currentReport);
    selectedNumber = access.selectedNumber || selectedNumber;
    $("page-title").textContent = access.isAdmin ? "Dashboard Super Admin" : "Dashboard Keuangan Pribadi";
    $("subtitle").textContent = "Periode " + ((finance && finance.period) || "-") + " - " + (sys.time || "-");
    $("status-dot").className = "dot " + (sys.connected ? "online" : "offline");
    $("status-label").textContent = sys.connected ? "Online" : "Offline";
    $("side-owner").textContent = sys.owner || "-";
    $("side-port").textContent = sys.port || "-";
    $("side-zone").textContent = sys.timezone || "-";
    $("socket-status").textContent = sys.status || "-";
    $("ai-provider").textContent = ai.provider || "-";
    $("reconnect-count").textContent = (sys.reconnect || 0) + "x";
    $("uptime").textContent = duration(sys.uptimeSeconds);
    $("updated-at").textContent = sys.time || "-";
    renderAIStatus(ai);
    renderAdmin(data.admin, selectedNumber);
    renderCommands(data.commands || []);
    currentCatalog = data.catalog || [];
    renderCatalog();
    populateCategoryControls();

    if (!finance.available) {
      const message = finance.message || "Data keuangan belum tersedia.";
      $("income-month").textContent = "-";
      $("expense-month").textContent = "-";
      $("net-month").textContent = "-";
      $("total-balance").textContent = "-";
      $("income-today").textContent = "-";
      $("expense-today").textContent = "-";
      $("finance-status").textContent = "Status -";
      $("transaction-count").textContent = "0 transaksi";
      $("avg-expense").textContent = "-";
      $("projected-expense").textContent = "-";
      $("insight-top-category").textContent = "-";
      $("remaining-ratio").textContent = "-";
      $("health-score").textContent = "-";
      $("daily-safe").textContent = "-";
      $("budget-remaining-hero").textContent = "-";
      $("hero-title").textContent = "Data keuangan belum tersedia";
      $("hero-copy").textContent = message;
      $("period-label").textContent = "-";
      $("top-category").textContent = "-";
      $("category-list").innerHTML = '<div class="empty">' + esc(message) + '</div>';
      $("category-list-budget").innerHTML = '<div class="empty">' + esc(message) + '</div>';
      $("budget-list").innerHTML = '<div class="empty">' + esc(message) + '</div>';
      $("wallet-list").innerHTML = '<div class="empty">' + esc(message) + '</div>';
      $("recent-body").innerHTML = '<tr><td colspan="7" class="muted">' + esc(message) + '</td></tr>';
      currentRecent = [];
      $("report-transaction-body").innerHTML = '<tr><td colspan="6" class="muted">' + esc(message) + '</td></tr>';
      $("annual-month-body").innerHTML = '<tr><td colspan="6" class="muted">' + esc(message) + '</td></tr>';
      renderReport(currentReport, {});
      drawTrend([]);
      renderAnalytics({});
      renderBinance(null);
      renderLaporanVisual(null, currentReport);
      return;
    }

    const s = finance.summary || {};
    animateMoney("income-month", s.incomeMonth);
    animateMoney("expense-month", s.expenseMonth);
    animateMoney("net-month", s.netMonth);
    animateMoney("total-balance", s.totalBalance);
    $("income-today").textContent = (s.incomeTransactions || 0) + " transaksi masuk";
    $("expense-today").textContent = (s.expenseTransactions || 0) + " transaksi keluar";
    $("finance-status").textContent = (s.status || "-") + " - rasio sisa " + (s.remainingRatio || 0) + "%";
    $("transaction-count").textContent = (s.totalTransactions || 0) + " transaksi - " + (s.monthTransactions || 0) + " bulan ini";
    $("avg-expense").textContent = money(s.avgExpense);
    $("projected-expense").textContent = money(s.projectedExpense);
    $("insight-top-category").textContent = s.topCategory ? s.topCategory.name : "-";
    $("remaining-ratio").textContent = (s.remainingRatio || 0) + "%";
    $("period-label").textContent = finance.period || "-";
    $("top-category").textContent = s.topCategory ? s.topCategory.name + " " + money(s.topCategory.amount) : "-";
    currentAnalytics = finance.analytics || {};
    currentBudgets = finance.budgets || [];
    renderAnalytics(currentAnalytics);
    renderBinance(finance.binance || {});

    renderBars("category-list", finance.categories || [], "amount");
    renderBars("category-list-budget", finance.categories || [], "amount");
    renderBudgets(currentBudgets);
    renderWallets(finance.wallets || []);
    currentRecent = finance.recent || [];
    renderRecent();
    renderReport(currentReport, finance);
    renderCommands(data.commands || []);
    drawTrend(finance.trend || []);
    drawSparklines(finance.trend || []);
    renderGoals();
    computeNotifications(s, currentBudgets);
    renderLaporanVisual(finance, currentReport);
  }

  function periodLabel(key) {
    const raw = String(key || "");
    if (/^\d{4}$/.test(raw)) return "Tahun " + raw;
    if (/^\d{4}-\d{2}$/.test(raw)) {
      return new Intl.DateTimeFormat("id-ID", { month:"long", year:"numeric" }).format(new Date(raw + "-01T00:00:00"));
    }
    return raw || "Periode berjalan";
  }

  function populatePeriodSelector(report) {
    const select = $("global-period-select");
    const months = [...new Set([report.selected, ...(report.availablePeriods || [])].filter(key => /^\d{4}-\d{2}$/.test(String(key))))].sort().reverse();
    const selectedYear = /^\d{4}$/.test(String(report.selected || "")) ? [String(report.selected)] : [];
    const years = [...new Set((report.availableYears || []).map(String).concat(months.map(key => key.slice(0,4)), selectedYear))].sort().reverse();
    select.innerHTML =
      '<optgroup label="Laporan Bulanan">' + months.map(key => '<option value="' + esc(key) + '">' + esc(periodLabel(key)) + '</option>').join("") + '</optgroup>' +
      '<optgroup label="Laporan Tahunan">' + years.map(key => '<option value="' + esc(key) + '">' + esc(periodLabel(key)) + '</option>').join("") + '</optgroup>';
    if (report.selected) select.value = report.selected;
  }

  function renderReport(report, finance) {
    const summary = finance.summary || {};
    const label = report.label || finance.period || periodLabel(report.selected);
    $("report-title").textContent = "Laporan " + label;
    $("report-closing-balance").textContent = summary.closingBalance !== undefined ? money(summary.closingBalance) : "-";
    $("report-income").textContent = summary.incomeMonth !== undefined ? money(summary.incomeMonth) : "-";
    $("report-expense").textContent = summary.expenseMonth !== undefined ? money(summary.expenseMonth) : "-";
    $("report-net").textContent = summary.netMonth !== undefined ? money(summary.netMonth) : "-";
    $("report-count").textContent = summary.monthTransactions !== undefined ? summary.monthTransactions : "-";
    $("report-income-count").textContent = (summary.incomeTransactions || 0) + " transaksi masuk";
    $("report-expense-count").textContent = (summary.expenseTransactions || 0) + " transaksi keluar";
    $("report-ratio").textContent = "Rasio sisa " + (summary.remainingRatio || 0) + "%";
    $("report-transaction-label").textContent = "Semua transaksi " + label;
    $("transaction-period-label").textContent = "Cari, tambah, edit, atau hapus transaksi " + label;

    const selectedYear = Number(String(report.selected || "").slice(0,4)) || new Date().getFullYear();
    const recordedMonths = (report.months || []).slice().sort((a,b) => Number(a.bulan) - Number(b.bulan));
    const monthMap = new Map(recordedMonths.map(item => [Number(item.bulan), item]));
    let carriedBalance = recordedMonths.length ? Number(recordedMonths[0].saldoAkumulasi || 0) - Number(recordedMonths[0].saldoBulan || 0) : 0;
    const monthRows = Array.from({ length:12 }, (_, index) => {
      const item = monthMap.get(index + 1);
      if (item && item.saldoAkumulasi !== undefined) carriedBalance = item.saldoAkumulasi;
      return item || { label:new Intl.DateTimeFormat("id-ID", { month:"long" }).format(new Date(selectedYear, index, 1)) + " " + selectedYear, masuk:0, keluar:0, saldoBulan:0, saldoAkumulasi:carriedBalance, transaksi:0 };
    });
    $("annual-month-body").innerHTML = monthRows.map(item =>
      '<tr><td><b>' + esc(item.label) + '</b></td><td class="right">' + money(item.masuk) + '</td><td class="right">' + money(item.keluar) + '</td><td class="right">' + money(item.saldoBulan) + '</td><td class="right"><b>' + money(item.saldoAkumulasi) + '</b></td><td class="right">' + esc(item.transaksi) + '</td></tr>'
    ).join("");

    $("report-transaction-body").innerHTML = currentRecent.length ? currentRecent.map(row =>
      '<tr><td>' + esc(row.date) + '</td><td><span class="type-badge ' + (row.type === "Pemasukan" ? "income" : "expense") + '">' + esc(row.type) + '</span></td><td>' + esc(row.category) + '</td><td>' + esc(row.note) + '</td><td>' + esc(row.wallet) + '</td><td class="right"><b>' + money(row.amount) + '</b></td></tr>'
    ).join("") : '<tr><td colspan="6" class="muted">Belum ada transaksi pada periode ini.</td></tr>';
  }

  function renderAdmin(admin, activeNumber) {
    const nav = $("admin-nav");
    if (!admin) {
      nav.hidden = true;
      if (activeView === "admin") setActiveView("overview");
      return;
    }
    nav.hidden = false;
    $("admin-message").textContent = admin.message || "Seluruh nomor yang terdata di spreadsheet";
    const summary = admin.summary || {};
    $("admin-users").textContent = summary.totalUsers || 0;
    $("admin-income").textContent = money(summary.incomeMonth);
    $("admin-expense").textContent = money(summary.expenseMonth);
    $("admin-transactions").textContent = summary.totalTransactions || 0;
    const users = admin.users || [];
    $("admin-user-body").innerHTML = users.length ? users.map(user =>
      '<tr class="user-row ' + (user.number === activeNumber ? 'active' : '') + '" data-number="' + esc(user.number) + '">' +
      '<td><b>' + esc(user.maskedNumber) + '</b></td><td>' + esc(user.lastTransaction) + '</td>' +
      '<td class="right">' + money(user.incomeMonth) + '</td><td class="right">' + money(user.expenseMonth) + '</td>' +
      '<td class="right">' + money(user.totalBalance) + '</td><td class="right">' + esc(user.totalTransactions) + '</td></tr>'
    ).join("") : '<tr><td colspan="6" class="muted">' + esc(admin.message || "Belum ada nomor pengguna.") + '</td></tr>';
    document.querySelectorAll(".user-row").forEach(row => row.addEventListener("click", () => {
      selectedNumber = row.dataset.number || "";
      loadDashboard();
      setActiveView("overview");
      window.scrollTo({ top:0, behavior:"smooth" });
    }));
  }

  function renderAnalytics(analytics) {
    const budget = analytics.budget || {};
    const comparison = analytics.comparison || {};
    const smart = analytics.smart || {};
    const pacing = smart.pacing || {};
    const focus = smart.focus || {};
    const largest = smart.largestExpense || {};
    const hasAnalytics = analytics.healthScore !== undefined;
    const changeLabel = value => value === null || value === undefined ? "Belum ada pembanding" : (value > 0 ? "+" : "") + value + "%";
    $("health-score").textContent = hasAnalytics ? analytics.healthScore + "/100" : "-";
    $("daily-safe").textContent = analytics.dailySafeSpend !== undefined ? money(analytics.dailySafeSpend) : "-";
    $("budget-remaining-hero").textContent = budget.remaining !== undefined ? money(budget.remaining) : "-";
    if (hasAnalytics) {
      $("hero-title").textContent = "Kondisi keuangan: " + (analytics.healthLabel || "-");
      $("hero-copy").textContent = focus.detail || "Skor memadukan arus kas, disiplin budget, konsentrasi kategori, dan konsistensi pencatatan transaksi periode ini.";
    }
    $("radar-focus").textContent = focus.title || "-";
    $("radar-focus-detail").textContent = focus.detail || "Rekomendasi akan muncul setelah data tersedia.";
    $("radar-risk").textContent = smart.riskLevel ? smart.riskLevel + " (" + (smart.riskScore || 0) + "/100)" : "-";
    $("radar-risk-detail").textContent = (smart.riskFactors || [])[0] || "Belum ada sinyal risiko besar.";
    $("radar-pace").textContent = pacing.expenseRatio !== undefined ? pacing.expenseRatio + "% pemasukan" : "-";
    $("radar-pace-detail").textContent = pacing.avgDailyExpense ? "Rata-rata keluar Rp " + money(pacing.avgDailyExpense).replace("Rp", "").trim() + " per hari aktif." : "Ritme belanja akan terbaca dari transaksi periode ini.";
    $("radar-largest").textContent = largest.amount ? money(largest.amount) : "-";
    $("radar-largest-detail").textContent = largest.amount ? (largest.note || largest.category || "Transaksi terbesar") + " - " + (largest.wallet || "-") : "Belum ada transaksi pengeluaran.";
    $("analytics-score").textContent = analytics.healthScore !== undefined ? analytics.healthScore + "/100" : "-";
    $("analytics-label").textContent = analytics.healthLabel || "-";
    $("expense-change").textContent = changeLabel(comparison.expenseChange);
    $("income-change").textContent = changeLabel(comparison.incomeChange);
    $("analytics-daily-safe").textContent = analytics.dailySafeSpend !== undefined ? money(analytics.dailySafeSpend) : "-";
    $("budget-total").textContent = budget.total !== undefined ? money(budget.total) : "-";
    $("budget-used").textContent = budget.used !== undefined ? money(budget.used) : "-";
    $("budget-watch").textContent = budget.watchCount !== undefined ? budget.watchCount + " kategori" : "-";
    $("budget-over").textContent = budget.overCount !== undefined ? budget.overCount + " kategori" : "-";
    renderBars("group-spending-list", analytics.groups || [], "amount");
    const actions = (smart.actionPlan || []).map(item => item.title ? item.title + ": " + item.detail : item);
    const tips = actions.length ? actions : (analytics.tips || []);
    $("smart-tip-list").innerHTML = tips.length
      ? tips.map(tip => '<div class="insight-item"><span class="insight-mark"></span><span>' + esc(tip) + '</span></div>').join("")
      : '<div class="empty">Rekomendasi akan muncul setelah data tersedia.</div>';
  }

  function populateCategoryControls() {
    const type = $("trx-type").value || "Pengeluaran";
    const current = $("trx-category").value;
    const options = currentCatalog.filter(item => item.type === "Keduanya" || item.type === type);
    $("trx-category").innerHTML = options.map(item => '<option value="' + esc(item.name) + '">' + esc(item.name) + '</option>').join("");
    if (options.some(item => item.name === current)) $("trx-category").value = current;
    const filterCurrent = $("transaction-category-filter").value;
    $("transaction-category-filter").innerHTML = '<option value="">Semua kategori</option>' + currentCatalog.map(item => '<option value="' + esc(item.name) + '">' + esc(item.name) + '</option>').join("");
    $("transaction-category-filter").value = filterCurrent;
    const budgetCurrent = $("budget-category").value;
    const budgetOptions = currentCatalog.filter(item => Number(item.budget || 0) > 0 && (item.type === "Pengeluaran" || item.type === "Keduanya"));
    $("budget-category").innerHTML = budgetOptions.map(item => '<option value="' + esc(item.name) + '">' + esc(item.name) + '</option>').join("");
    if (budgetOptions.some(item => item.name === budgetCurrent)) $("budget-category").value = budgetCurrent;
  }

  function renderCatalog() {
    const keyword = $("catalog-search").value.trim().toLowerCase();
    const type = $("catalog-type-filter").value;
    const rows = currentCatalog.filter(item => {
      const haystack = [item.name,item.type,item.group,...(item.aliases || []),...(item.examples || [])].join(" ").toLowerCase();
      return (!keyword || haystack.includes(keyword)) && (!type || item.type === type);
    });
    $("catalog-list").innerHTML = rows.length ? rows.map(item =>
      '<div class="category-card"><div class="category-top"><span class="category-swatch" style="background:' + esc(item.color) + '"></span><div><h4>' + esc(item.name) + '</h4><p>' + esc(item.group) + '</p></div></div>' +
      '<p>' + esc((item.examples || []).join(", ") || "Kategori umum") + '</p><div class="category-meta"><span class="tag">' + esc(item.type) + '</span>' +
      (Number(item.budget || 0) > 0 ? '<span class="tag">Default ' + money(item.budget) + '</span>' : '') + '</div></div>'
    ).join("") : '<div class="empty">Kategori tidak ditemukan.</div>';
  }

  function renderAIStatus(ai) {
    const rows = Object.entries((ai && ai.status) || {});
    if (!rows.length) {
      $("ai-status-list").innerHTML = '<div class="empty">Status provider AI belum tersedia.</div>';
      return;
    }
    $("ai-status-list").innerHTML = rows.map(([name, state]) => {
      const aktif = state && state.available;
      const label = aktif ? "Aktif" : "Cooldown";
      const reason = (state && state.reason) || (aktif ? "Siap digunakan" : "Menunggu provider tersedia");
      return '<div class="status-item"><b>' + esc(name) + ' - ' + label + '</b><span>' + esc(reason) + '</span></div>';
    }).join("");
  }

  function renderBars(id, rows, key) {
    if (!rows.length) {
      $(id).innerHTML = '<div class="empty">Belum ada data.</div>';
      return;
    }
    const max = Math.max(...rows.map(row => Number(row[key] || 0)), 1);
    $(id).innerHTML = rows.map(row => {
      const pct = Math.round((Number(row[key] || 0) / max) * 100);
      const color = row.color || "#255fbd";
      return '<div class="bar-row"><div class="bar-meta"><b>' + esc(row.name) + '</b><span>' + money(row[key]) + '</span></div><div class="bar"><span style="width:' + pct + '%;background:' + esc(color) + '"></span></div></div>';
    }).join("");
  }

  function renderBudgets(rows) {
    if (!rows.length) {
      $("budget-list").innerHTML = '<div class="empty">Belum ada budget.</div>';
      return;
    }
    $("budget-list").innerHTML = rows.map(row => {
      const pct = Math.min(Math.max(Number(row.percent || 0), 0), 140);
      const kind = row.status === "Over" ? "danger" : row.status === "Waspada" ? "warn" : "good";
      return '<div class="budget-card"><div class="budget-card-head"><div><b>' + esc(row.name) + '</b><div class="subtle">' + esc(row.group || "Budget") + '</div></div><button type="button" class="edit-budget" data-category="' + esc(row.name) + '" data-limit="' + esc(row.monthlyLimit || row.limit) + '">Ubah</button></div>' +
        '<div class="bar-meta"><span>' + row.percent + '% terpakai</span><b>' + money(row.used) + ' / ' + money(row.limit) + '</b></div><div class="bar"><span class="' + kind + '" style="width:' + Math.min(pct, 100) + '%"></span></div><div class="hint">' + esc(row.status) + ' - sisa ' + money(row.remaining) + '</div></div>';
    }).join("");
    document.querySelectorAll(".edit-budget").forEach(button => button.addEventListener("click", () => openBudgetModal(button.dataset.category, button.dataset.limit)));
  }

  function renderWallets(rows) {
    if (!rows.length) {
      $("wallet-list").innerHTML = '<div class="empty">Belum ada saldo dompet.</div>';
      return;
    }
    $("wallet-list").innerHTML = rows.map(row => '<div class="wallet"><b>' + esc(row.name) + '</b><span>' + money(row.balance) + '</span></div>').join("");
  }

  function filteredRecentRows() {
    const keyword = $("transaction-search").value.trim().toLowerCase();
    const filter = $("transaction-filter").value;
    const category = $("transaction-category-filter").value;
    const rows = currentRecent.filter(row => {
      const haystack = [row.date,row.type,row.category,row.note,row.wallet,row.amount].join(" ").toLowerCase();
      return (!keyword || haystack.includes(keyword)) && (!filter || row.type === filter) && (!category || row.category === category);
    });
    return sortRecentRows(rows);
  }

  function renderRecent() {
    const rows = filteredRecentRows();
    if (!rows.length) {
      $("recent-body").innerHTML = '<tr><td colspan="7" class="muted">Tidak ada transaksi yang cocok.</td></tr>';
      return;
    }
    $("recent-body").innerHTML = rows.map(row =>
      '<tr><td>' + esc(row.date) + '</td><td><span class="type-badge ' + (row.type === "Pemasukan" ? "income" : "expense") + '">' + esc(row.type) + '</span></td>' +
      '<td><span class="category-pill" style="--category-color:' + esc((currentCatalog.find(item => item.name === row.category) || {}).color || "#7a8490") + '">' + esc(row.category) + '</span></td><td>' + esc(row.note) + '</td><td>' + esc(row.wallet) + '</td><td class="right"><b>' + money(row.amount) + '</b></td>' +
      '<td><div class="actions-cell"><button class="btn small edit-trx" data-row="' + esc(row.rowNumber) + '">Edit</button><button class="btn small danger delete-trx" data-row="' + esc(row.rowNumber) + '">Hapus</button></div></td></tr>'
    ).join("");
    document.querySelectorAll(".edit-trx").forEach(btn => btn.addEventListener("click", () => openTransactionModal(currentRecent.find(row => String(row.rowNumber) === btn.dataset.row))));
    document.querySelectorAll(".delete-trx").forEach(btn => btn.addEventListener("click", () => deleteTransaction(btn.dataset.row)));
  }

  function openTransactionModal(row) {
    editingRow = row ? row.rowNumber : null;
    $("transaction-modal-title").textContent = row ? "Edit Transaksi" : "Tambah Transaksi";
    $("trx-type").value = row ? row.type : "Pengeluaran";
    populateCategoryControls();
    $("trx-amount").value = row ? row.amount : "";
    $("trx-date").value = row ? dateForInput(row.date) : new Date().toISOString().slice(0,10);
    $("trx-wallet").value = row ? String(row.wallet || "").toLowerCase() : "cash";
    $("trx-category").value = row ? row.category : "Lainnya";
    $("trx-note").value = row ? row.note : "";
    $("category-suggestion").classList.remove("show");
    $("transaction-modal").classList.add("show");
  }

  function closeTransactionModal() {
    editingRow = null;
    $("transaction-modal").classList.remove("show");
  }

  function openBudgetModal(category, limit) {
    $("budget-category").value = category || "";
    $("budget-limit").value = limit || "";
    $("budget-modal").classList.add("show");
  }

  function closeBudgetModal() {
    $("budget-modal").classList.remove("show");
  }

  async function requestCategorySuggestion() {
    const note = $("trx-note").value.trim();
    if (note.length < 3) {
      $("category-suggestion").classList.remove("show");
      return;
    }
    try {
      const result = await transactionRequest("/api/categories/suggest", { method:"POST", body:JSON.stringify({ type:$("trx-type").value, note }) });
      const suggestion = result.suggestion || {};
      if (!suggestion.name || suggestion.name === $("trx-category").value || Number(suggestion.confidence || 0) < 45) {
        $("category-suggestion").classList.remove("show");
        return;
      }
      suggestedCategory = suggestion.name;
      $("category-suggestion-text").textContent = "Saran pintar: " + suggestion.name + " (" + suggestion.confidence + "%)";
      $("category-suggestion").classList.add("show");
    } catch {
      $("category-suggestion").classList.remove("show");
    }
  }

  async function deleteTransaction(rowNumber) {
    if (!confirm("Hapus transaksi ini? Saldo akan dihitung ulang otomatis.")) return;
    try {
      const result = await transactionRequest("/api/transactions/" + rowNumber, { method:"DELETE" });
      showToast(result.message || "Transaksi dihapus.");
      await loadDashboard();
    } catch(e) {
      showToast("Gagal menghapus: " + e.message);
    }
  }

  function excelHtmlCell(value) {
    return String(value ?? "-").replace(/[&<>]/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;" }[ch]));
  }

  function exportExcelRows(rows, filename) {
    if (!rows.length) {
      showToast("Tidak ada transaksi untuk diexport.");
      return;
    }
    const summary = (currentFinance && currentFinance.summary) || {};
    const categories = (currentFinance && currentFinance.categories) || [];
    const wallets = (currentFinance && currentFinance.wallets) || [];
    const trend = (currentFinance && currentFinance.trend) || [];
    const maxCategory = Math.max(...categories.map(row => Number(row.amount || 0)), 1);
    const maxTrend = Math.max(...trend.flatMap(row => [Number(row.masuk || 0), Number(row.keluar || 0)]), 1);
    const bar = (value, max) => "█".repeat(Math.max(1, Math.round((Number(value || 0) / Math.max(max, 1)) * 24)));
    const style = '<style>body{font-family:Arial,sans-serif;color:#132033}h2{color:#153b6e}.section{margin:14px 0}table{border-collapse:collapse;width:100%;margin-bottom:16px}th{background:#2b74e4;color:white;font-weight:700}td,th{border:1px solid #b8d6ff;padding:8px;text-align:left}.num{text-align:right}.green{color:#07845e;font-weight:700}.red{color:#d1465c;font-weight:700}.bar{font-family:monospace;color:#2b74e4}.bar-green{font-family:monospace;color:#07966c}.bar-red{font-family:monospace;color:#d84a63}</style>';
    let html = '<html><head><meta charset="UTF-8">' + style + '</head><body>';
    html += '<h2>Laporan Keuangan ' + excelHtmlCell((currentReport && currentReport.label) || "Dashboard") + '</h2>';
    html += '<table><tr><th>Ringkasan</th><th>Nilai</th></tr>' +
      '<tr><td>Pemasukan</td><td class="num">' + money(summary.incomeMonth || 0) + '</td></tr>' +
      '<tr><td>Pengeluaran</td><td class="num">' + money(summary.expenseMonth || 0) + '</td></tr>' +
      '<tr><td>Saldo Periode</td><td class="num">' + money(summary.netMonth || 0) + '</td></tr>' +
      '<tr><td>Saldo Total</td><td class="num">' + money(summary.totalBalance || 0) + '</td></tr></table>';
    html += '<h3>Diagram Kategori</h3><table><tr><th>Kategori</th><th>Nominal</th><th>Diagram</th></tr>' + categories.map(row => '<tr><td>' + excelHtmlCell(row.name) + '</td><td class="num">' + money(row.amount) + '</td><td class="bar">' + bar(row.amount, maxCategory) + '</td></tr>').join("") + '</table>';
    html += '<h3>Saldo Dompet</h3><table><tr><th>Dompet</th><th>Saldo</th></tr>' + wallets.map(row => '<tr><td>' + excelHtmlCell(row.name) + '</td><td class="num">' + money(row.balance) + '</td></tr>').join("") + '</table>';
    html += '<h3>Diagram Tren Harian</h3><table><tr><th>Tanggal</th><th>Masuk</th><th>Keluar</th><th>Masuk Bar</th><th>Keluar Bar</th></tr>' + trend.map(row => '<tr><td>' + excelHtmlCell(row.label) + '</td><td class="num">' + money(row.masuk) + '</td><td class="num">' + money(row.keluar) + '</td><td class="bar-green">' + (Number(row.masuk || 0) ? bar(row.masuk, maxTrend) : "") + '</td><td class="bar-red">' + (Number(row.keluar || 0) ? bar(row.keluar, maxTrend) : "") + '</td></tr>').join("") + '</table>';
    html += '<h3>Transaksi</h3><table><tr><th>Tanggal</th><th>Jenis</th><th>Kategori</th><th>Keterangan</th><th>Dompet</th><th>Nominal</th><th>Saldo</th></tr>' + rows.map(row => '<tr><td>' + excelHtmlCell(row.date) + '</td><td class="' + (row.type === "Pemasukan" ? "green" : "red") + '">' + excelHtmlCell(row.type) + '</td><td>' + excelHtmlCell(row.category) + '</td><td>' + excelHtmlCell(row.note) + '</td><td>' + excelHtmlCell(row.wallet) + '</td><td class="num">' + Number(row.amount || 0) + '</td><td class="num">' + Number(row.balance || 0) + '</td></tr>').join("") + '</table>';
    html += '</body></html>';
    const blob = new Blob(["\ufeff" + html], { type:"application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename || "laporan-dashboard.xls";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Excel berhasil dibuat.");
  }

  function exportFilteredExcel() {
    exportExcelRows(filteredRecentRows(), "transaksi-dashboard.xls");
  }

  function renderBinance(data) {
    const info = data || {};
    const available = !!info.available;
    const message = info.message || (info.enabled ? "Saldo Binance belum tersedia." : "Binance aktif khusus nomor 33827179200526.");
    const totalUsdt = available ? (Number(info.totalUsdt || 0).toLocaleString("id-ID", { minimumFractionDigits:2, maximumFractionDigits:2 }) + " USDT") : "-";
    const totalIdr = available && info.totalIdr !== null && info.totalIdr !== undefined ? money(info.totalIdr) : (available ? "Rate IDR belum diisi" : "-");
    const assetCount = available ? (info.assetCount || 0) + " aset" : "-";
    $("binance-page-usdt").textContent = totalUsdt;
    $("binance-page-idr").textContent = totalIdr;
    $("binance-page-status").textContent = available ? "Terhubung" : (info.configured === false ? "Belum API" : "Nonaktif");
    $("binance-page-copy").textContent = available ? "Portofolio spot Binance sudah dibaca realtime dan digabungkan dengan dashboard keuangan." : message;
    const idrInfo = available && info.idrRate ? " · USDT/IDR " + Number(info.idrRate || 0).toLocaleString("id-ID", { maximumFractionDigits:0 }) + " (" + (info.idrRateSource || "Binance") + ")" : "";
    $("binance-refresh-time").textContent = available ? "Saldo " + (info.refreshedAt || "-") + " · harga " + (info.priceRefreshedAt || "-") + idrInfo + " · cache harga " + (info.priceCacheSeconds || 0) + " detik" : message;
    const assets = info.assets || [];
    $("binance-assets-body").innerHTML = assets.length ? assets.map(row => {
      const hargaNum = Number(row.priceUsdt || 0);
      const harga = row.priceUsdt !== null && row.priceUsdt !== undefined ? hargaNum.toLocaleString("id-ID", { minimumFractionDigits:hargaNum >= 1 ? 2 : 0, maximumFractionDigits:hargaNum >= 1 ? 4 : 8 }) + " USDT" : "-";
      const nilai = row.valueUsdt !== null && row.valueUsdt !== undefined ? Number(row.valueUsdt || 0).toLocaleString("id-ID", { minimumFractionDigits:2, maximumFractionDigits:2 }) + " USDT" : "-";
      return '<tr><td><span class="asset-chip">' + esc(row.asset) + '</span><div class="subtle">' + esc(row.priceSource || "") + '</div></td><td class="right">' + esc(Number(row.free || 0).toLocaleString("id-ID", { maximumFractionDigits:8 })) + '</td><td class="right">' + esc(Number(row.locked || 0).toLocaleString("id-ID", { maximumFractionDigits:8 })) + '</td><td class="right"><b>' + esc(Number(row.total || 0).toLocaleString("id-ID", { maximumFractionDigits:8 })) + '</b></td><td class="right">' + esc(harga) + '</td><td class="right"><b>' + esc(nilai) + '</b></td></tr>';
    }).join("") : '<tr><td colspan="6" class="muted">' + esc(message) + '</td></tr>';
  }

  function renderCommands(rows) {
    $("command-list").innerHTML = rows.map(row => '<button class="cmd" type="button" data-cmd="' + esc(row.cmd) + '"><code>' + esc(row.cmd) + '</code><span>' + esc(row.desc) + '</span></button>').join("");
    document.querySelectorAll(".cmd").forEach(button => button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.cmd || "");
        showToast("Command disalin.");
      } catch {
        showToast(button.dataset.cmd || "Command siap diketik.");
      }
    }));
  }

  function drawTrend(rows) {
    const svg = $("trend-chart");
    const overviewSvg = $("overview-chart");
    const charts = [svg, overviewSvg].filter(Boolean);
    const totalIncome = rows.reduce((sum, row) => sum + Number(row.masuk || 0), 0);
    const totalExpense = rows.reduce((sum, row) => sum + Number(row.keluar || 0), 0);
    const peak = rows.slice().sort((a,b) => (Number(b.masuk || 0) + Number(b.keluar || 0)) - (Number(a.masuk || 0) + Number(a.keluar || 0)))[0];
    $("trend-income").textContent = money(totalIncome);
    $("trend-expense").textContent = money(totalExpense);
    $("trend-net").textContent = money(totalIncome - totalExpense);
    $("trend-peak").textContent = peak ? peak.label : "-";
    if (!svg) return;
    if (!rows.length) {
      const empty = '<line class="chart-grid" x1="74" y1="70" x2="872" y2="70"></line><line class="chart-grid" x1="74" y1="150" x2="872" y2="150"></line><line class="chart-grid" x1="74" y1="230" x2="872" y2="230"></line><line class="chart-grid" x1="74" y1="310" x2="872" y2="310"></line><text class="chart-label" x="450" y="190" text-anchor="middle" font-size="14">Data arus kas akan muncul di sini</text>';
      charts.forEach(chart => { chart.innerHTML = empty; });
      return;
    }
    const w = 900, h = 360, left = 74, right = 28, top = 30, bottom = 46;
    const max = Math.max(...rows.flatMap(row => [Number(row.masuk || 0), Number(row.keluar || 0)]), 1);
    const plotW = w - left - right, plotH = h - top - bottom, baseY = h - bottom;
    const x = i => left + (i * plotW / Math.max(rows.length - 1, 1));
    const y = v => baseY - (Number(v || 0) / max) * plotH;
    const points = field => rows.map((row, i) => [x(i), y(row[field]), Number(row[field] || 0), row.label]);
    const path = pts => pts.map((point, i) => (i ? "L" : "M") + point[0].toFixed(1) + " " + point[1].toFixed(1)).join(" ");
    const area = pts => path(pts) + " L " + pts[pts.length - 1][0].toFixed(1) + " " + baseY + " L " + pts[0][0].toFixed(1) + " " + baseY + " Z";
    const income = points("masuk"), expense = points("keluar");
    const compact = value => value >= 1000000000 ? (value / 1000000000).toFixed(1) + " M" : value >= 1000000 ? (value / 1000000).toFixed(1) + " jt" : value >= 1000 ? Math.round(value / 1000) + " rb" : String(Math.round(value));
    const grid = Array.from({length:5}, (_, i) => {
      const gy = top + (i * plotH / 4);
      const value = max - (i * max / 4);
      return '<line class="chart-grid" x1="' + left + '" y1="' + gy.toFixed(1) + '" x2="' + (w-right) + '" y2="' + gy.toFixed(1) + '" stroke-width="1"></line><text class="chart-label" x="' + (left-12) + '" y="' + (gy+4).toFixed(1) + '" text-anchor="end" font-size="10">' + esc(compact(value)) + '</text>';
    }).join("");
    const labelEvery = Math.max(1, Math.ceil(rows.length / 7));
    const labels = rows.map((row, i) => i % labelEvery === 0 || i === rows.length - 1 ? '<text class="chart-label" x="' + x(i).toFixed(1) + '" y="' + (h-18) + '" text-anchor="middle" font-size="10">' + esc(row.label) + '</text>' : "").join("");
    const dots = (pts, cls) => pts.map((point, i) => '<circle class="chart-dot ' + cls + '" style="animation-delay:' + (i * 90) + 'ms" cx="' + point[0].toFixed(1) + '" cy="' + point[1].toFixed(1) + '" r="4"><title>' + esc(point[3]) + ': ' + esc(money(point[2])) + '</title></circle>').join("");
    charts.forEach(chart => {
      const prefix = chart.id;
      chart.innerHTML =
        '<defs><linearGradient id="' + prefix + '-income-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--green)" stop-opacity=".2"></stop><stop offset="100%" stop-color="var(--green)" stop-opacity="0"></stop></linearGradient><linearGradient id="' + prefix + '-expense-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--red)" stop-opacity=".16"></stop><stop offset="100%" stop-color="var(--red)" stop-opacity="0"></stop></linearGradient></defs>' + grid +
        '<path d="' + area(income) + '" fill="url(#' + prefix + '-income-fill)"></path><path d="' + area(expense) + '" fill="url(#' + prefix + '-expense-fill)"></path>' +
        '<path class="income-path" d="' + path(income) + '" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>' +
        '<path class="expense-path" d="' + path(expense) + '" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>' +
        dots(income, "income-path") + dots(expense, "expense-path") + labels;
    });
  }

  // ── SPARKLINES PADA KARTU METRIK ─────────────────────────────
  function drawSparklines(rows) {
    const draw = (id, field, color) => {
      const canvas = $(id);
      if (!canvas || !rows || !rows.length) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth || 78, h = canvas.clientHeight || 26;
      canvas.width = w * dpr; canvas.height = h * dpr;
      const ctx = canvas.getContext("2d");
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);
      const values = rows.map(row => Number(row[field] || 0));
      const max = Math.max(...values, 1), min = Math.min(...values, 0);
      const span = Math.max(max - min, 1);
      ctx.beginPath();
      values.forEach((v, i) => {
        const x = (i / Math.max(values.length - 1, 1)) * w;
        const y = h - ((v - min) / span) * h;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.lineJoin = "round"; ctx.stroke();
    };
    draw("spark-income", "masuk", "#0c8f5e");
    draw("spark-expense", "keluar", "#c8384f");
  }

  // ── LAPORAN VISUAL (BUKU KAS) — grafik SVG native, tanpa CDN ──
  function drawLvDailyChart(trend) {
    const svg = $("lv-daily-chart");
    const W = 900, H = 320, padL = 54, padR = 16, padT = 18, padB = 34;
    if (!trend || !trend.length) {
      svg.innerHTML = '<text x="' + (W/2) + '" y="' + (H/2) + '" text-anchor="middle" fill="var(--muted)" font-size="14" font-family="-apple-system,sans-serif">Belum ada data tren pada periode ini</text>';
      return;
    }
    const masukVals = trend.map(r => Number(r.masuk || 0));
    const keluarVals = trend.map(r => Number(r.keluar || 0));
    const maxVal = Math.max(...masukVals, ...keluarVals, 1);
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const n = trend.length;
    const bw = Math.min(22, (plotW / n) * 0.5);
    const xAt = i => padL + (n === 1 ? plotW/2 : (i / (n - 1)) * plotW);
    const yAt = v => padT + plotH - (v / maxVal) * plotH;

    let bars = "";
    trend.forEach((r, i) => {
      const x = xAt(i) - bw/2;
      const y = yAt(masukVals[i]);
      const h = padT + plotH - y;
      if (h > 0.5) bars += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2.5" fill="var(--green)" fill-opacity=".55"></rect>';
    });

    let linePts = trend.map((r, i) => xAt(i).toFixed(1) + "," + yAt(keluarVals[i]).toFixed(1)).join(" ");
    const areaPts = linePts + " " + xAt(n-1).toFixed(1) + "," + (padT+plotH) + " " + xAt(0).toFixed(1) + "," + (padT+plotH);

    const gridLines = [0, 0.25, 0.5, 0.75, 1].map(t => {
      const y = padT + plotH - t * plotH;
      const val = maxVal * t;
      const label = val >= 1000000 ? "Rp " + (val/1000000).toFixed(1) + "jt" : "Rp " + Math.round(val/1000) + "rb";
      return '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W-padR) + '" y2="' + y.toFixed(1) + '" stroke="var(--line)" stroke-width="1"></line>' +
             '<text x="' + (padL-8) + '" y="' + (y+3).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--muted)" font-family="ui-monospace,monospace">' + label + '</text>';
    }).join("");

    const step = Math.max(1, Math.ceil(n / 10));
    const xLabels = trend.map((r, i) => i % step === 0 || i === n-1 ? '<text x="' + xAt(i).toFixed(1) + '" y="' + (H-10) + '" text-anchor="middle" font-size="9.5" fill="var(--muted)" font-family="-apple-system,sans-serif">' + esc(r.label||"") + '</text>' : "").join("");

    const dots = trend.map((r,i) => '<circle cx="' + xAt(i).toFixed(1) + '" cy="' + yAt(keluarVals[i]).toFixed(1) + '" r="2.6" fill="var(--red)"></circle>').join("");

    svg.innerHTML =
      gridLines +
      bars +
      '<polygon points="' + areaPts + '" fill="var(--red)" fill-opacity=".12"></polygon>' +
      '<polyline points="' + linePts + '" fill="none" stroke="var(--red)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>' +
      dots + xLabels +
      '<g font-family="-apple-system,sans-serif" font-size="11" font-weight="700">' +
        '<rect x="' + padL + '" y="0" width="10" height="10" rx="2" fill="var(--green)" fill-opacity=".55"></rect><text x="' + (padL+16) + '" y="9" fill="var(--text)">Pemasukan</text>' +
        '<rect x="' + (padL+110) + '" y="0" width="10" height="10" rx="2" fill="var(--red)"></rect><text x="' + (padL+126) + '" y="9" fill="var(--text)">Pengeluaran</text>' +
      '</g>';
  }

  function drawLvDonut(cats) {
    const svg = $("lv-cat-chart");
    const total = cats.reduce((a,c) => a + Number(c.amount||0), 0);
    if (!cats.length || total <= 0) {
      svg.innerHTML = '<text x="130" y="130" text-anchor="middle" fill="var(--muted)" font-size="13" font-family="-apple-system,sans-serif">Belum ada data</text>';
      return;
    }
    const cx = 130, cy = 130, r = 92, sw = 30;
    const circumference = 2 * Math.PI * r;
    let offset = 0;
    let segs = "";
    cats.forEach(c => {
      const frac = Number(c.amount||0) / total;
      const len = frac * circumference;
      segs += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + (c.color || "#7a8490") + '" stroke-width="' + sw + '" stroke-dasharray="' + len.toFixed(2) + ' ' + (circumference - len).toFixed(2) + '" stroke-dashoffset="' + (-offset).toFixed(2) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"></circle>';
      offset += len;
    });
    svg.innerHTML = segs +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r - sw/2 - 4) + '" fill="var(--paper)"></circle>' +
      '<text x="' + cx + '" y="' + (cy-6) + '" text-anchor="middle" font-family="ui-monospace,monospace" font-size="10" fill="var(--muted)">TOTAL</text>' +
      '<text x="' + cx + '" y="' + (cy+14) + '" text-anchor="middle" font-family="ui-monospace,monospace" font-size="13" font-weight="700" fill="var(--text)">' + money(total) + '</text>';
  }

  function renderLaporanVisual(finance, report) {
    const empty = () => {
      $("lv-subtitle").textContent = "Belum ada data pada periode ini";
      $("lv-income").textContent = money(0);
      $("lv-expense").textContent = money(0);
      $("lv-net").textContent = money(0);
      drawLvDailyChart([]);
      drawLvDonut([]);
      $("lv-cat-legend").innerHTML = '<li class="empty">Belum ada data kategori.</li>';
      $("lv-receipt-rows").innerHTML = '<div class="empty">Belum ada transaksi pengeluaran.</div>';
      $("lv-receipt-total").textContent = money(0);
      $("lv-chips").innerHTML = '<div class="empty">Belum cukup data kebiasaan.</div>';
      $("lv-savings-rate").textContent = "-";
      $("lv-avg-daily").textContent = "-";
      $("lv-avg-trx").textContent = "-";
      $("lv-notes").innerHTML = '<li>Belum ada cukup data untuk catatan otomatis.</li>';
    };
    if (!finance || !finance.available) { empty(); return; }
    const s = finance.summary || {};
    const trend = finance.trend || [];

    $("lv-subtitle").textContent = "Periode " + (finance.period || "-") + " \u00b7 Dompet cash \u00b7 " + (s.monthTransactions || 0) + " transaksi";
    $("lv-income").textContent = money(s.incomeMonth);
    $("lv-expense").textContent = money(s.expenseMonth);
    $("lv-net").textContent = money(s.netMonth);

    drawLvDailyChart(trend);

    const cats = (finance.categories || []).slice(0, 12);
    const catTotal = cats.reduce((a,c) => a + Number(c.amount || 0), 0) || 1;
    drawLvDonut(cats);
    $("lv-cat-legend").innerHTML = cats.map(c => {
      const pct = (Number(c.amount || 0) / catTotal * 100).toFixed(1);
      return '<li><span class="lv-name"><span class="lv-dot" style="background:' + (c.color || "#7a8490") + '"></span>' + esc(c.name) + '</span><span><span class="lv-amt lv-mono">' + money(c.amount) + '</span><span class="lv-pct">(' + pct + '%)</span></span></li>';
    }).join("") || '<li class="empty">Belum ada data kategori.</li>';

    const expenses = (finance.recent || []).filter(t => t.type === "Pengeluaran").slice().sort((a,b) => Number(b.amount||0) - Number(a.amount||0)).slice(0, 12);
    $("lv-receipt-sub").textContent = finance.period || "Periode berjalan";
    let rTotal = 0;
    $("lv-receipt-rows").innerHTML = expenses.map((r,i) => {
      rTotal += Number(r.amount || 0);
      return '<div class="lv-rrow"><span class="lv-rname">' + (i+1) + ". " + esc(r.note || r.category) + '<span class="lv-rcat">' + esc(String(r.date||"").split(",")[0]) + " \u00b7 " + esc(r.category) + '</span></span><span class="lv-ramt">' + money(r.amount) + "</span></div>";
    }).join("") || '<div class="empty">Belum ada transaksi pengeluaran pada periode ini.</div>';
    $("lv-receipt-total").textContent = money(rTotal);

    const keywordDefs = [
      { kw:["kopi"], label:"\u2615 Kopi" },
      { kw:["rokok"], label:"\ud83d\udeac Rokok" },
      { kw:["vape","liquid"], label:"\ud83d\udca8 Vape/Liquid" },
      { kw:["bensin","bbm"], label:"\u26fd BBM/Bensin" },
      { kw:["jajan"], label:"\ud83c\udf7f Jajan" },
      { kw:["minuman","minum"], label:"\ud83e\udd64 Minuman" },
      { kw:["makan"], label:"\ud83c\udf7d\ufe0f Makan" },
      { kw:["martabak"], label:"\ud83e\udd5e Martabak" }
    ];
    const kwTotals = keywordDefs.map(def => {
      let total = 0, count = 0;
      (finance.recent || []).forEach(t => {
        if (t.type !== "Pengeluaran") return;
        const text = String(t.note || "").toLowerCase();
        if (def.kw.some(k => text.includes(k))) { total += Number(t.amount || 0); count++; }
      });
      return { ...def, total, count };
    }).filter(k => k.count > 0).sort((a,b) => b.total - a.total);
    $("lv-chips").innerHTML = kwTotals.map(k => '<div class="lv-chip">' + k.label + " <b>" + money(k.total) + "</b><span>" + k.count + "x</span></div>").join("") || '<div class="empty">Belum cukup data kebiasaan.</div>';

    const savingsRate = s.incomeMonth > 0 ? Math.round((s.netMonth / s.incomeMonth) * 100) : 0;
    $("lv-savings-rate").textContent = savingsRate + "%";
    const trendDays = trend.length || 1;
    $("lv-avg-daily").textContent = money(Math.round((s.expenseMonth || 0) / trendDays));
    $("lv-avg-trx").textContent = money(s.avgExpense || 0);

    const notes = [];
    if (cats[0]) notes.push("Kategori terbesar periode ini adalah <b>" + esc(cats[0].name) + "</b> senilai " + money(cats[0].amount) + ".");
    if (s.incomeMonth > 0 && savingsRate < 20) notes.push("Tingkat tabungan hanya <b>" + savingsRate + "%</b> dari pemasukan \u2014 pertimbangkan menekan pengeluaran harian.");
    else if (s.incomeMonth > 0) notes.push("Tingkat tabungan cukup sehat di angka <b>" + savingsRate + "%</b>. Pertahankan!");
    if (kwTotals[0]) notes.push("Kebiasaan paling sering tercatat: <b>" + esc(kwTotals[0].label.replace(/^\S+\s/, "")) + "</b>, total " + money(kwTotals[0].total) + " (" + kwTotals[0].count + "x transaksi).");
    if (expenses[0]) notes.push("Pengeluaran tunggal terbesar: <b>" + esc(expenses[0].note || expenses[0].category) + "</b> senilai " + money(expenses[0].amount) + ".");
    $("lv-notes").innerHTML = notes.map(n => "<li>" + n + "</li>").join("") || "<li>Belum ada cukup data untuk catatan otomatis.</li>";
  }

  // ── NOTIFIKASI CERDAS ─────────────────────────────────────────
  function computeNotifications(summary, budgets) {
    const items = [];
    (budgets || []).forEach(row => {
      if (row.status === "Over") items.push({ kind:"danger", title:"Budget " + row.name + " terlampaui", detail:"Terpakai " + money(row.used) + " dari " + money(row.limit) });
      else if (row.status === "Waspada") items.push({ kind:"warn", title:"Budget " + row.name + " mendekati limit", detail:row.percent + "% sudah terpakai" });
    });
    if (summary && Number(summary.remainingRatio) < 10 && Number(summary.incomeMonth) > 0) {
      items.push({ kind:"warn", title:"Sisa saldo periode ini tipis", detail:"Rasio sisa hanya " + summary.remainingRatio + "% dari pemasukan" });
    }
    if (!items.length) items.push({ kind:"good", title:"Semua terkendali", detail:"Tidak ada budget yang mendekati atau melewati limit." });
    $("notif-list").innerHTML = items.map(item => '<div class="notif-item ' + item.kind + '"><div><b>' + esc(item.title) + '</b><span>' + esc(item.detail) + '</span></div></div>').join("");
    const alertCount = items.filter(item => item.kind !== "good").length;
    $("notif-count").hidden = alertCount === 0;
    $("notif-count").textContent = alertCount;
  }

  // ── TARGET TABUNGAN (GOALS) ───────────────────────────────────
  function goalsKey() { return "financeGoals:" + (selectedNumber || "default"); }
  function loadGoalsData() {
    try { return JSON.parse(localStorage.getItem(goalsKey()) || "[]"); } catch (_) { return []; }
  }
  function saveGoalsData(list) { localStorage.setItem(goalsKey(), JSON.stringify(list)); }
  function renderGoals() {
    const list = $("goal-list");
    if (!list) return;
    const goals = loadGoalsData();
    const balance = Number((currentFinance.summary || {}).totalBalance || 0);
    if (!goals.length) { list.innerHTML = '<div class="empty">Belum ada target tabungan. Klik "+ Target Baru" untuk membuat.</div>'; return; }
    list.innerHTML = goals.map((goal, idx) => {
      const pct = Math.max(0, Math.min(100, Math.round((balance / Math.max(Number(goal.target) || 1, 1)) * 100)));
      const kind = pct >= 100 ? "good" : pct >= 60 ? "" : "warn";
      const deadline = goal.deadline ? "Tenggat " + new Date(goal.deadline).toLocaleDateString("id-ID") : "Tanpa tenggat";
      return '<div class="goal-card panel-card"><div class="panel-head"><div><h4>' + esc(goal.name) + '</h4><div class="subtle">' + esc(deadline) + '</div></div><button class="btn small danger" data-idx="' + idx + '" type="button" data-action="delete-goal">Hapus</button></div>' +
        '<div class="bar"><span class="' + kind + '" style="width:' + pct + '%"></span></div>' +
        '<div class="goal-meta"><span>' + money(balance) + ' terkumpul</span><span>' + pct + '% dari ' + money(goal.target) + '</span></div></div>';
    }).join("");
    document.querySelectorAll('[data-action="delete-goal"]').forEach(btn => btn.addEventListener("click", () => {
      const items = loadGoalsData();
      items.splice(Number(btn.dataset.idx), 1);
      saveGoalsData(items);
      renderGoals();
      showToast("Target dihapus.");
    }));
  }

  // ── COMMAND PALETTE (Ctrl+K) ──────────────────────────────────
  const cmdkActions = Object.keys(viewTitles).map(view => ({ label:"Buka " + viewTitles[view], run: () => setActiveView(view) }))
    .concat([
      { label:"Tambah transaksi baru", run: () => openTransactionModal(null) },
      { label:"Buat target tabungan baru", run: () => openGoalModal() },
      { label:"Refresh dashboard", run: () => loadDashboard() },
      { label:"Ganti tema warna", run: () => toggleTheme() }
    ]);
  let cmdkSelected = 0;
  function renderCmdk(query) {
    const q = (query || "").toLowerCase();
    const filtered = cmdkActions.filter(item => item.label.toLowerCase().includes(q));
    cmdkSelected = 0;
    $("cmdk-list").innerHTML = filtered.map((item, i) => '<button type="button" class="cmdk-opt' + (i === 0 ? " sel" : "") + '" data-idx="' + i + '">' + esc(item.label) + '</button>').join("") || '<div class="empty">Tidak ditemukan.</div>';
    document.querySelectorAll(".cmdk-opt").forEach(btn => btn.addEventListener("click", () => { filtered[Number(btn.dataset.idx)].run(); closeCmdk(); }));
    return filtered;
  }
  let cmdkFiltered = [];
  function openCmdk() { $("cmdk-overlay").classList.add("show"); $("cmdk-input").value = ""; cmdkFiltered = renderCmdk(""); setTimeout(() => $("cmdk-input").focus(), 30); }
  function closeCmdk() { $("cmdk-overlay").classList.remove("show"); }

  // ── TEMA WARNA ───────────────────────────────────────────────
  const dashboardThemes = ["paper", "meadow", "clay", "night"];
  function applyTheme(theme) {
    const selected = dashboardThemes.includes(theme) ? theme : "paper";
    document.documentElement.setAttribute("data-theme", selected);
    const select = $("theme-select");
    if (select) select.value = selected;
  }
  function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") || "paper";
    const next = dashboardThemes[(dashboardThemes.indexOf(current) + 1) % dashboardThemes.length];
    localStorage.setItem("dashboardTheme", next);
    applyTheme(next);
  }

  // ── MODAL TARGET TABUNGAN ─────────────────────────────────────
  function openGoalModal() {
    $("goal-name").value = ""; $("goal-target").value = ""; $("goal-deadline").value = "";
    $("goal-modal").classList.add("show");
  }
  function closeGoalModal() { $("goal-modal").classList.remove("show"); }

  // ── SORTIR TABEL TRANSAKSI ────────────────────────────────────
  let recentSort = { key:"date", dir:-1 };
  function sortRecentRows(rows) {
    const key = recentSort.key;
    return [...rows].sort((a, b) => {
      let av = a[key], bv = b[key];
      if (key === "amount") { av = Number(av || 0); bv = Number(bv || 0); }
      else { av = String(av || ""); bv = String(bv || ""); }
      if (av < bv) return -1 * recentSort.dir;
      if (av > bv) return 1 * recentSort.dir;
      return 0;
    });
  }

  document.querySelectorAll(".metric-card").forEach((card, index) => {
    if (!card.closest("#view-overview")) return;
    const destinations = ["reports", "budget", "reports", "transactions"];
    const labels = ["Buka laporan pemasukan", "Buka pemantauan budget", "Buka laporan arus kas", "Buka riwayat transaksi"];
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-label", labels[index] || "Buka rincian keuangan");
    const openDetails = () => setActiveView(destinations[index] || "reports");
    card.addEventListener("click", openDetails);
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openDetails(); }
    });
  });
  document.querySelectorAll(".nav-item").forEach(button => {
    button.addEventListener("click", () => { setActiveView(button.dataset.view); $("shell").classList.remove("menu-open"); });
  });
  document.querySelectorAll(".chart-motion-toggle").forEach(button => button.addEventListener("click", () => {
    const paused = document.documentElement.classList.toggle("pause-chart-motion");
    document.querySelectorAll(".chart-motion-toggle").forEach(control => {
      control.setAttribute("aria-pressed", String(paused));
      control.setAttribute("aria-label", paused ? "Lanjutkan animasi diagram" : "Jeda animasi diagram");
      control.textContent = paused ? "Lanjut" : "Jeda";
    });
  }));
  setActiveView(activeView, false);
  $("refresh-btn").addEventListener("click", loadDashboard);
  $("menu-toggle").addEventListener("click", () => {
    const shell = $("shell");
    if (window.matchMedia("(max-width:720px)").matches) shell.classList.toggle("menu-open");
    else {
      shell.classList.toggle("menu-collapsed");
      localStorage.setItem("dashboardMenuCollapsed", shell.classList.contains("menu-collapsed") ? "1" : "0");
    }
  });
  $("mobile-overlay").addEventListener("click", () => $("shell").classList.remove("menu-open"));
  const lvPeriodShortcut = document.getElementById("lv-period-shortcut");
  if (lvPeriodShortcut) lvPeriodShortcut.addEventListener("click", () => {
    const sel = $("global-period-select");
    if (sel) { sel.focus(); if (sel.showPicker) { try { sel.showPicker(); } catch (e) {} } }
  });
  const bottomMoreBtn = document.getElementById("bottom-more-btn");
  if (bottomMoreBtn) bottomMoreBtn.addEventListener("click", () => $("shell").classList.add("menu-open"));
  if (localStorage.getItem("dashboardMenuCollapsed") === "1") $("shell").classList.add("menu-collapsed");
  $("global-period-select").addEventListener("change", event => {
    selectedPeriod = event.target.value;
    sessionStorage.setItem("dashboardPeriod", selectedPeriod);
    loadDashboard();
  });
  $("quick-add-btn").addEventListener("click", () => openTransactionModal(null));
  $("transaction-search").addEventListener("input", renderRecent);
  $("transaction-filter").addEventListener("change", renderRecent);
  $("transaction-category-filter").addEventListener("change", renderRecent);
  $("catalog-search").addEventListener("input", renderCatalog);
  $("catalog-type-filter").addEventListener("change", renderCatalog);
  $("export-csv-btn").addEventListener("click", exportFilteredExcel);
  $("report-export-btn").addEventListener("click", () => exportExcelRows(currentRecent, "laporan-" + (selectedPeriod || "periode") + ".xls"));
  $("add-transaction-btn").addEventListener("click", () => openTransactionModal(null));
  $("close-transaction-modal").addEventListener("click", closeTransactionModal);
  $("cancel-transaction").addEventListener("click", closeTransactionModal);
  $("trx-type").addEventListener("change", () => {
    populateCategoryControls();
    requestCategorySuggestion();
  });
  $("trx-note").addEventListener("input", () => {
    clearTimeout(categorySuggestionTimer);
    categorySuggestionTimer = setTimeout(requestCategorySuggestion, 350);
  });
  $("use-category-suggestion").addEventListener("click", () => {
    if (suggestedCategory) $("trx-category").value = suggestedCategory;
    $("category-suggestion").classList.remove("show");
  });
  $("close-budget-modal").addEventListener("click", closeBudgetModal);
  $("cancel-budget").addEventListener("click", closeBudgetModal);
  $("budget-form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = $("save-budget");
    button.disabled = true;
    button.textContent = "Menyimpan...";
    try {
      const result = await transactionRequest("/api/budgets", { method:"PATCH", body:JSON.stringify({ category:$("budget-category").value, limit:Number($("budget-limit").value) }) });
      closeBudgetModal();
      showToast(result.message || "Budget berhasil diperbarui.");
      await loadDashboard();
    } catch(e) {
      showToast("Gagal menyimpan budget: " + e.message);
    } finally {
      button.disabled = false;
      button.textContent = "Simpan Budget";
    }
  });
  $("transaction-form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = $("save-transaction");
    button.disabled = true;
    button.textContent = "Menyimpan...";
    const payload = {
      type:$("trx-type").value,
      amount:Number($("trx-amount").value),
      date:$("trx-date").value,
      wallet:$("trx-wallet").value,
      category:$("trx-category").value,
      note:$("trx-note").value
    };
    try {
      const path = editingRow ? "/api/transactions/" + editingRow : "/api/transactions";
      const result = await transactionRequest(path, { method:editingRow ? "PUT" : "POST", body:JSON.stringify(payload) });
      closeTransactionModal();
      showToast(result.message || "Transaksi berhasil disimpan.");
      await loadDashboard();
    } catch(e) {
      showToast("Gagal menyimpan: " + e.message);
    } finally {
      button.disabled = false;
      button.textContent = "Simpan Transaksi";
    }
  });
  $("token-form").addEventListener("submit", event => {
    event.preventDefault();
    token = $("token-input").value.trim();
    if (!token) return;
    sessionStorage.setItem("dashboardAccess", token);
    loadDashboard();
  });

  // ── TEMA ────────────────────────────────────────────────────
  applyTheme(localStorage.getItem("dashboardTheme") || "paper");
  $("theme-select").addEventListener("change", event => { localStorage.setItem("dashboardTheme", event.target.value); applyTheme(event.target.value); });

  // ── NOTIFIKASI ──────────────────────────────────────────────
  $("notif-btn").addEventListener("click", () => $("notif-panel").classList.toggle("show"));
  $("notif-close").addEventListener("click", () => $("notif-panel").classList.remove("show"));
  document.addEventListener("click", event => {
    if (!$("notif-panel").contains(event.target) && event.target !== $("notif-btn") && !$("notif-btn").contains(event.target)) {
      $("notif-panel").classList.remove("show");
    }
  });

  // ── COMMAND PALETTE ─────────────────────────────────────────
  $("cmdk-btn").addEventListener("click", openCmdk);
  $("cmdk-overlay").addEventListener("click", event => { if (event.target === $("cmdk-overlay")) closeCmdk(); });
  $("cmdk-input").addEventListener("input", event => { cmdkFiltered = renderCmdk(event.target.value); });
  $("cmdk-input").addEventListener("keydown", event => {
    if (event.key === "Escape") { closeCmdk(); return; }
    if (event.key === "Enter" && cmdkFiltered[cmdkSelected]) { cmdkFiltered[cmdkSelected].run(); closeCmdk(); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const opts = document.querySelectorAll(".cmdk-opt");
      if (!opts.length) return;
      opts[cmdkSelected] && opts[cmdkSelected].classList.remove("sel");
      cmdkSelected = event.key === "ArrowDown" ? Math.min(cmdkSelected + 1, opts.length - 1) : Math.max(cmdkSelected - 1, 0);
      opts[cmdkSelected].classList.add("sel");
    }
  });
  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openCmdk(); }
  });

  // ── SORTIR TABEL TRANSAKSI ──────────────────────────────────
  document.querySelectorAll(".sort-th").forEach(th => th.addEventListener("click", () => {
    const key = th.dataset.sort;
    recentSort.dir = recentSort.key === key ? recentSort.dir * -1 : -1;
    recentSort.key = key;
    document.querySelectorAll(".sort-th").forEach(other => other.classList.remove("sort-active"));
    th.classList.add("sort-active");
    renderRecent();
  }));

  // ── TARGET TABUNGAN ─────────────────────────────────────────
  $("add-goal-btn").addEventListener("click", openGoalModal);
  $("close-goal-modal").addEventListener("click", closeGoalModal);
  $("cancel-goal").addEventListener("click", closeGoalModal);
  $("goal-form").addEventListener("submit", event => {
    event.preventDefault();
    const goals = loadGoalsData();
    goals.push({ name:$("goal-name").value.trim() || "Target Tabungan", target:Number($("goal-target").value) || 0, deadline:$("goal-deadline").value || "" });
    saveGoalsData(goals);
    closeGoalModal();
    renderGoals();
    showToast("Target tabungan disimpan.");
  });

  loadDashboard();
  setInterval(() => {
    if (activeView === "binance" || activeView === "overview") loadBinanceRealtime(false);
  }, 5000);
  setInterval(loadDashboard, 60000);
</script>
</body>
</html>`;
}

// ── KEEP-ALIVE SERVER ─────────────────────────────────────────
function startKeepAliveServer() {
    const server = http.createServer(async (req, res) => {
        try {
            const urlObj = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

            if (urlObj.pathname === "/") {
                res.writeHead(302, { Location: "/dashboard" });
                res.end();
                return;
            }

            const shortDashboardRoute = urlObj.pathname.match(/^\/d\/([^/]+)$/);
            if (shortDashboardRoute) {
                const access = decodeURIComponent(shortDashboardRoute[1]);
                res.writeHead(302, { Location: `/dashboard?access=${encodeURIComponent(access)}` });
                res.end();
                return;
            }

            if (urlObj.pathname === "/dashboard") {
                const html = buatHalamanWeb();
                res.writeHead(200,{"Content-Type":"text/html; charset=utf-8", "Cache-Control":"no-store"});
                res.end(html);
                return;
            }

            if (urlObj.pathname === "/health" || urlObj.pathname === "/api/status") {
                jsonResponse(res, 200, {
                    status:"online",
                    bot: sockGlobal?"aktif":"tidak_aktif",
                    reconnect: jumlahReconnect,
                    dashboardProtected: true,
                    dashboardAccess: "signed-link-per-number",
                    ai: {
                        primary: formatProviderAI(),
                        openai: !!openai,
                        gemini: !!ai,
                        model: openai ? OPENAI_MODEL : (GEMINI_MODELS[0] || null),
                        cooldown: Object.fromEntries(Object.entries(statusProviderAI).map(([nama, state]) => [nama, {
                            reason: state.reason || null,
                            blockedUntil: state.blockedUntil || null
                        }]))
                    },
                    binance: {
                        enabledNumber: maskNomor(BINANCE_BALANCE_NUMBER),
                        configured: binanceTerkonfigurasi(),
                        cacheSeconds: BINANCE_CACHE_SECONDS,
                        priceCacheSeconds: BINANCE_PRICE_CACHE_SECONDS,
                        topAssetsLimit: BINANCE_TOP_ASSETS_LIMIT,
                        minAssetUsdt: BINANCE_MIN_ASSET_USDT,
                        idrRateMode: BINANCE_USDT_IDR_MODE,
                        idrRateSymbol: BINANCE_USDT_IDR_SYMBOL,
                        idrRateFallbackConfigured: BINANCE_USDT_IDR_RATE_FALLBACK > 0,
                        idrRateCacheSeconds: BINANCE_IDR_RATE_CACHE_SECONDS
                    },
                    time: new Date().toLocaleString("id-ID",{timeZone:APP_TIMEZONE})
                });
                return;
            }

            if (urlObj.pathname === "/api/env-check") {
                jsonResponse(res, 200, {
                    spreadsheet: !!SPREADSHEET_ID,
                    googleServiceAccount: !!(GOOGLE_SERVICE_ACCOUNT_JSON || GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || (GOOGLE_CLIENT_EMAIL && GOOGLE_PRIVATE_KEY)),
                    googleServiceAccountParsed: !!serviceAccount,
                    googleClientEmail: !!serviceAccount?.client_email,
                    googlePrivateKeyReady: !!serviceAccount?.private_key,
                    googleServiceAccountParseError: serviceAccountParseError || null,
                    whatsappNumber: !!WHATSAPP_PHONE_NUMBER,
                    dashboardSecret: !!DASHBOARD_SECRET,
                    dashboardBaseUrl: dapatkanBaseUrlDashboard(),
                    superAdminNumbers: SUPER_ADMIN_NUMBERS.length,
                    openai: !!OPENAI_API_KEY,
                    gemini: !!GEMINI_API_KEY,
                    binance: {
                        number: maskNomor(BINANCE_BALANCE_NUMBER),
                        apiKey: !!BINANCE_API_KEY_FOR_BALANCE,
                        apiSecret: !!BINANCE_API_SECRET_FOR_BALANCE,
                        configured: binanceTerkonfigurasi(),
                        balanceCacheSeconds: BINANCE_CACHE_SECONDS,
                        priceCacheSeconds: BINANCE_PRICE_CACHE_SECONDS,
                        topAssetsLimit: BINANCE_TOP_ASSETS_LIMIT,
                        minAssetUsdt: BINANCE_MIN_ASSET_USDT,
                        usdtIdrMode: BINANCE_USDT_IDR_MODE,
                        usdtIdrSymbol: BINANCE_USDT_IDR_SYMBOL,
                        usdtIdrFallbackRate: BINANCE_USDT_IDR_RATE_FALLBACK || null,
                        idrRateCacheSeconds: BINANCE_IDR_RATE_CACHE_SECONDS
                    }
                });
                return;
            }

            if (urlObj.pathname === "/api/dashboard") {
                const akses = ambilAksesDashboard(req, urlObj);
                if (!akses) {
                    jsonResponse(res, 401, { error:"ACCESS_REQUIRED", message:"Buka link dashboard terbaru dari bot WhatsApp." });
                    return;
                }
                const data = await buatDataDashboardWeb(akses, urlObj.searchParams.get("nomor") || "", urlObj.searchParams.get("periode") || "");
                jsonResponse(res, 200, data);
                return;
            }

            if (urlObj.pathname === "/api/binance") {
                const akses = ambilAksesDashboard(req, urlObj);
                if (!akses) {
                    jsonResponse(res, 401, { error:"ACCESS_REQUIRED", message:"Akses dashboard tidak valid." });
                    return;
                }
                const nomorAktif = nomorTargetDashboard(akses, urlObj);
                const force = ["1", "true", "ya"].includes(String(urlObj.searchParams.get("force") || "").toLowerCase());
                let binanceInfo = { enabled:nomorPunyaAksesBinance(nomorAktif), available:false, configured:binanceTerkonfigurasi(), message:"Integrasi Binance hanya aktif untuk nomor khusus." };
                if (nomorPunyaAksesBinance(nomorAktif)) {
                    try {
                        binanceInfo = await ambilSaldoBinance(nomorAktif, { force, forcePrice: force });
                    } catch(e) {
                        binanceInfo = { enabled:true, available:false, configured:binanceTerkonfigurasi(), message:String(e.message || e) };
                    }
                }
                jsonResponse(res, 200, { binance:binanceInfo, number:maskNomor(nomorAktif), time:new Date().toLocaleString("id-ID", { timeZone:APP_TIMEZONE }) });
                return;
            }


            if (urlObj.pathname === "/api/categories/suggest" && req.method === "POST") {
                const akses = ambilAksesDashboard(req, urlObj);
                if (!akses) {
                    jsonResponse(res, 401, { error:"ACCESS_REQUIRED", message:"Akses dashboard tidak valid." });
                    return;
                }
                jsonResponse(res, 200, { ok:true, suggestion:saranKategoriDashboard(await bacaJsonBody(req)) });
                return;
            }

            if (urlObj.pathname === "/api/budgets" && ["POST","PUT","PATCH"].includes(req.method)) {
                const akses = ambilAksesDashboard(req, urlObj);
                if (!akses) {
                    jsonResponse(res, 401, { error:"ACCESS_REQUIRED", message:"Akses dashboard tidak valid." });
                    return;
                }
                const nomor = nomorTargetDashboard(akses, urlObj);
                if (!nomor) throw buatHttpError("Nomor pengguna tidak valid.", 400);
                const result = ubahBudgetDashboard(nomor, await bacaJsonBody(req));
                jsonResponse(res, 200, { ok:true, ...result });
                return;
            }

            const transactionRoute = urlObj.pathname.match(/^\/api\/transactions(?:\/(\d+))?$/);
            if (transactionRoute) {
                const akses = ambilAksesDashboard(req, urlObj);
                if (!akses) {
                    jsonResponse(res, 401, { error:"ACCESS_REQUIRED", message:"Akses dashboard tidak valid." });
                    return;
                }
                const nomor = nomorTargetDashboard(akses, urlObj);
                if (!nomor) throw buatHttpError("Nomor pengguna tidak valid.", 400);
                let result;
                if (req.method === "POST" && !transactionRoute[1]) {
                    result = await tambahTransaksiDashboard(nomor, await bacaJsonBody(req));
                } else if (["PUT","PATCH"].includes(req.method) && transactionRoute[1]) {
                    result = await editTransaksiDashboard(nomor, transactionRoute[1], await bacaJsonBody(req));
                } else if (req.method === "DELETE" && transactionRoute[1]) {
                    result = await hapusTransaksiDashboard(nomor, transactionRoute[1]);
                } else {
                    throw buatHttpError("Metode tidak didukung.", 405);
                }
                jsonResponse(res, 200, { ok:true, ...result });
                return;
            }

            jsonResponse(res, 404, { error:"NOT_FOUND" });
        } catch(e) {
            const statusCode = Number(e.statusCode || 500);
            if (statusCode >= 500) console.error("❌ Dashboard error:", e.message || e);
            jsonResponse(res, statusCode, { error:"DASHBOARD_ERROR", message:String(e.message || e) });
        }
    });

    server.listen(PORT, () => console.log(`🌐 Dashboard aktif: http://localhost:${PORT}`));
    setInterval(()=>console.log(`💓 Hidup: ${new Date().toLocaleString("id-ID",{timeZone:APP_TIMEZONE})}`), 5*60*1000);
}

// ── SOCKET MANAGEMENT ─────────────────────────────────────────
function cleanupSocket() {
    try {
        if (sockGlobal?.ev?.removeAllListeners) {
            sockGlobal.ev.removeAllListeners("connection.update");
            sockGlobal.ev.removeAllListeners("messages.upsert");
            sockGlobal.ev.removeAllListeners("creds.update");
        }
        if (sockGlobal?.ws?.close) sockGlobal.ws.close();
    } catch(e) { console.log("⚠️ Cleanup socket:", e.message); }
    sockGlobal = null;
}

function jadwalkanReconnect(alasan="?", jedaKhusus=null) {
    if (reconnectTimer) return;
    jumlahReconnect++;
    const jeda = jedaKhusus || Math.min(5000+jumlahReconnect*3000, 60000);
    console.log(`🔄 Reconnect (${alasan}) dalam ${jeda/1000}s`);
    reconnectTimer = setTimeout(async()=>{ reconnectTimer=null; sedangStart=false; cleanupSocket(); await startBot(); }, jeda);
}

// ── PESAN RESPON ──────────────────────────────────────────────
const dapatkanRespon = (kat, data={}) => ({
    vnDitolak:        ["🎙️ *VN belum didukung.*\nTolong ketik lewat teks biasa ya 🙏"],
    suksesMencatat:   [`${data.emoji} *DATA BERHASIL DICATAT!*\n\n📌 *Jenis:* ${data.jenis}\n🏷️ *Kategori:* ${data.kategori}\n💰 *Nominal:* Rp ${data.nominal}\n👛 *Dompet:* ${String(data.dompet||"").toUpperCase()}\n📝 *Keterangan:* "${data.keterangan}"\n📅 *Tanggal:* ${data.tanggal}\n\n🧮 *Saldo Akhir ${String(data.dompet||"").toUpperCase()}:* Rp ${data.saldo_dompet}`],
    suksesUtang:      [`🧾 *CATATAN UTANG/PIUTANG BERHASIL!*\n\n📌 *Tipe:* ${data.kategori}\n📝 *Ket.:* ${data.keterangan}\n💰 *Nominal:* Rp ${data.nominal}\n📅 *Tanggal:* ${data.tanggal}\n\n⏰ Jangan lupa ditagih/dibayar tepat waktu.`],
    suksesUndo:       [`↩️ *TRANSAKSI DIHAPUS!*\n\n"${data.keterangan}" sebesar *Rp ${formatRupiah(data.nominal)}* dibatalkan.`],
    gagalUndo:        ["📭 Tidak ada transaksi yang bisa dihapus."],
    konfirmasiReset:  [`⚠️ *KONFIRMASI RESET DATA*\n\nIni akan menghapus *SEMUA* riwayat keuangan kamu.\n\nKalau yakin, balas: *YA* atau *SETUJU*.`],
    batalReset:       ["✅ *Reset dibatalkan.* Data tetap aman."]
}[kat]?.[0] || "✅ Siap.");

// ── HANDLE MESSAGE ────────────────────────────────────────────
async function handleMessage(sock, msg) {
    if (!msg.message||msg.key.fromMe) return;
    const from = msg.key.remoteJid;
    const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.videoMessage?.caption || "";
    const pesan = text.toLowerCase().trim();

    if (!text && msg.message.audioMessage) return sock.sendMessage(from,{text:dapatkanRespon("vnDitolak")});
    if (!text) return;

    const kirim = async payload => {
        if (payload && typeof payload === "object" && !Array.isArray(payload)) {
            return sock.sendMessage(from, payload);
        }

        const daftarPesan = (Array.isArray(payload) ? payload : [payload])
            .flatMap(item => pecahPesanWhatsapp(item));
        let hasilTerakhir;
        for (const bagian of daftarPesan) {
            hasilTerakhir = await sock.sendMessage(from, { text: bagian });
            if (daftarPesan.length > 1) await tunggu(300);
        }
        return hasilTerakhir;
    };

    try {
        await getSheetByNomor(from); // pastikan sheet ada

        // ── KONFIRMASI RESET ────────────────────────────────
        if (statusReset[from]==="MENUNGGU_KONFIRMASI") {
            if (/^(ya|setuju|ok)$/i.test(pesan)) {
                delete statusReset[from];
                await resetSeluruhData(from);
                return kirim("🗑️ *RESET BERHASIL!*\n\nSemua data pembukuan sudah dikosongkan.");
            }
            delete statusReset[from];
            return kirim(dapatkanRespon("batalReset"));
        }

        // ── MENU ────────────────────────────────────────────
        if (/^(menu|help|bantuan|fitur|panduan|cara pakai)$/i.test(pesan)) {
            return kirim(
`🤖 *BOT CATATAN KEUANGAN – VERSI LENGKAP*

Ketik seperti ngobrol biasa ✨
AI: *${formatProviderAI()}*

🛒 *Contoh Pengeluaran:*
• beli nasi goreng 25k cash
• bayar wifi 350k gopay
• keluar 100rb bensin mandiri

💵 *Contoh Pemasukan:*
• pemasukan 5jt gaji ke bca
• masuk 750k bonus dana

📊 *Laporan & Visualisasi:*
• *hari ini* / *minggu ini* / *bulan ini*
• *laporan bulan ini* – laporan tabel
• *laporan Mei 2026* – laporan lengkap bulan sebelumnya
• *laporan tahunan 2026* – laporan lengkap setiap bulan
• *laporan visual* – 🧾 laporan grafis ala buku kas (web)
• *laporan visual Mei 2026* – laporan visual untuk bulan tertentu
• *saldo* – ringkasan saldo tanpa riwayat
• *dashboard* – ringkasan + link web pribadi
• *dashboard web* – buka dashboard web pribadi
• *dashboard admin* – dashboard semua pengguna (khusus super admin)
• *prediksi* – estimasi cashflow
• *dompet* – saldo per akun
• *riwayat* – semua transaksi
• *riwayat bulan lalu* – transaksi periode sebelumnya
• *riwayat 20* – 20 transaksi terakhir
• *grafik bulan ini* – 📊 grafik ASCII
• *tren* – 📈 tren 7 hari terakhir
• *budget* – monitor anggaran
• *saldo binance* – saldo spot Binance + konversi tiap koin ke USDT realtime khusus nomor 33827179200526
• *export Mei 2026* – file Excel periode historis

🤖 *Fitur AI:*
• *analisis* – ringkasan & saran AI
• *tips* – tips keuangan harian
• *ai [pertanyaan]* – tanya AI pakai data kamu
  contoh: *ai kenapa pengeluaran saya boros?*

🔍 *Pencarian & Export:*
• *cari [kata kunci]* – cari semua transaksi cocok
• *export bulan ini* – unduh Excel lengkap
• *export semua* – unduh semua data Excel

⚙️ *Pengaturan:*
• *set budget [kategori] [nominal]*
• *pengingat on* / *pengingat off*
• *kategori* – daftar kategori & dompet
• *status ai* – cek provider AI

🚨 *Perintah Darurat:*
• *undo* – hapus transaksi terakhir
• *#reset* – kosongkan semua data`
            );
        }

        // ── STATUS & DASHBOARD ────────────────────────────────
        if (/^(status ai|ai status|status bot|status)$/i.test(pesan)) {
            return kirim(
`🧭 *STATUS BOT*

Bot       : ${sockGlobal ? "Online" : "Offline"}
AI        : ${formatProviderAI()}
OpenAI    : ${openai ? (providerAIAktif("ChatGPT") ? "Aktif" : `Cooldown (${statusProviderAI.ChatGPT.reason})`) : "Belum diisi"}
Gemini    : ${ai ? (providerAIAktif("Gemini") ? "Aktif" : `Cooldown (${statusProviderAI.Gemini.reason})`) : "Fallback nonaktif"}
Reconnect : ${jumlahReconnect}x

Dashboard: ${dapatkanBaseUrlDashboard()}/dashboard
Ketik *dashboard web* untuk link akses pribadi.`
            );
        }

        if (/^(dashboard admin|admin dashboard|dashboard super admin|super admin)$/i.test(pesan)) {
            const nomor = ambilNomorDariJid(from);
            if (!nomorAdalahSuperAdmin(nomor)) {
                return kirim("⛔ Perintah ini khusus nomor super admin yang terdaftar di SUPER_ADMIN_NUMBERS.");
            }
            const link = buatLinkDashboard(from, "admin");
            return kirim([
`🔐 *DASHBOARD SUPER ADMIN*

Lihat seluruh nomor dan data transaksi yang terdaftar di spreadsheet.
Link akses ada di pesan berikutnya.`,
                link,
`Link berlaku ${DASHBOARD_LINK_DAYS} hari dan khusus untuk super admin. Jangan bagikan link ini.`
            ]);
        }

        if (/^(dashboard web|web dashboard|buka dashboard|link dashboard|akses dashboard)$/i.test(pesan)) {
            const link = buatLinkDashboard(from, "user");
            return kirim([
`🌐 *DASHBOARD KEUANGAN PRIBADI*

Dashboard ini hanya menampilkan transaksi milik nomor kamu.
Link akses ada di pesan berikutnya.`,
                link,
`Link berlaku ${DASHBOARD_LINK_DAYS} hari. Jangan bagikan link ini kepada orang lain.`
            ]);
        }

        if (/^(dashboard|dasbor|overview|ringkasan pintar)$/i.test(pesan)) {
            const ringkasan = await buatDashboardKeuangan(from);
            const link = buatLinkDashboard(from, "user");
            return kirim([
                ringkasan,
`🌐 *Buka dashboard web pribadi*
Link akses ada di pesan berikutnya.`,
                link
            ]);
        }

        if (/^(laporan visual|visual laporan|laporan grafis|laporan cantik|buku kas)(\s+\S.*)?$/i.test(pesan)) {
            const hasPeriodeText = /^(laporan visual|visual laporan|laporan grafis|laporan cantik|buku kas)\s+\S/i.test(pesan);
            const periode = hasPeriodeText ? parsePeriodePesan(pesan, "bulan") : null;
            const link = buatLinkDashboard(from, "user") + "#laporanvisual" + (periode ? ":" + encodeURIComponent(periode.key) : "");
            return kirim([
`🧾 *LAPORAN KEUANGAN VISUAL*${periode ? " \u2013 " + periode.label : ""}

Versi grafis ala buku kas: tren arus kas harian, donut kategori, struk pengeluaran terbesar, dan kebiasaan belanja kamu.
Buka link di pesan berikutnya, dashboard akan otomatis membuka tab *Laporan Visual*${periode ? " untuk periode " + periode.label : ""}.

💡 Tips: ketik *laporan visual Mei 2026* atau *laporan visual bulan lalu* untuk periode lain.`,
                link,
`Link berlaku ${DASHBOARD_LINK_DAYS} hari. Jangan bagikan link ini kepada orang lain.`
            ]);
        }

        if (/^(kategori|daftar kategori|list kategori|dompet tersedia)$/i.test(pesan)) {
            return kirim(buatDaftarKategoriDompet());
        }

        // ── BINANCE REALTIME KHUSUS NOMOR ───────────────────
        if (/^(saldo\s+binance|binance|portfolio\s+binance|aset\s+binance|cek\s+binance|harga\s+binance|konversi\s+binance)$/i.test(pesan)) {
            if (!nomorPunyaAksesBinance(from)) {
                return kirim("⛔ Fitur saldo Binance realtime hanya aktif untuk nomor khusus yang didaftarkan di BINANCE_BALANCE_NUMBER.");
            }
            await kirim("💎 _Mengambil saldo Binance realtime..._");
            return kirim(await buatRingkasanBinance(from));
        }

        // ── DOMPET ──────────────────────────────────────────
        if (/^(dompet|cek dompet|rekening|akun|saldo dompet)$/i.test(pesan)) {
            const lap = await buatLaporanKeuangan("semua", from);
            let teks  = "👛 *SALDO AKUN & DOMPET*\n";
            let total = 0;
            for (const [dom, sal] of Object.entries(lap.saldoDompet)) {
                const icon = sal>=0 ? "✅" : "⚠️";
                teks += `\n${icon} *${dom.toUpperCase()}*: Rp ${formatRupiah(sal)}`;
                total += sal;
            }
            if (Object.keys(lap.saldoDompet).length===0) teks += "\n📭 Belum ada saldo.";
            teks += `\n\n${"─".repeat(33)}\n💰 *TOTAL:* Rp ${formatRupiah(total)}`;
            return kirim(teks);
        }

        // ── BUDGET ──────────────────────────────────────────
        if (/^(budget|cek budget|anggaran|cek anggaran)$/i.test(pesan)) {
            const lap    = await buatLaporanKeuangan("bulan", from);
            const budget = getBudget(from);
            const rows = [];
            for (const [kat, limit] of Object.entries(budget)) {
                const terpakai = lap.detailKategori[kat]||0;
                const persen   = ((terpakai/limit)*100).toFixed(0);
                const status   = Number(persen)>=100 ? "Over" : Number(persen)>=85 ? "Waspada" : "Aman";
                rows.push({
                    kategori: kat,
                    pakai: formatRupiah(terpakai),
                    limit: formatRupiah(limit),
                    persen: `${persen}%`,
                    status
                });
            }
            rows.sort((a,b)=>Number(b.persen.replace("%",""))-Number(a.persen.replace("%","")));
            let teks = "🎯 *MONITOR ANGGARAN BULAN INI*\n\n";
            teks += buatTabelWhatsapp([
                { key:"kategori", label:"Kategori", width:16 },
                { key:"pakai", label:"Pakai", width:12, align:"right" },
                { key:"limit", label:"Limit", width:12, align:"right" },
                { key:"persen", label:"%", width:4, align:"right" },
                { key:"status", label:"Status", width:8 }
            ], rows, { maxRows: 12 });
            teks += `\n💡 Ketik *set budget [kategori] [nominal]* untuk ubah limit.`;
            return kirim(teks);
        }

        // ── RIWAYAT ─────────────────────────────────────────
        const punyaNamaBulan = Object.keys(ALIAS_BULAN).some(alias => new RegExp(`\\b${alias}\\b`, "i").test(pesan));
        const mintaPeriodeHistoris = punyaNamaBulan || /\b(bulan lalu|bulan sebelumnya|tahun|tahunan|annual|20\d{2})\b/i.test(pesan);

        if (/^(laporan|rekap|riwayat)\b/i.test(pesan) && mintaPeriodeHistoris) {
            const tipeDefault = (/\b(tahun|tahunan|annual)\b/i.test(pesan) || (/\b20\d{2}\b/.test(pesan) && !punyaNamaBulan)) ? "tahun" : "bulan";
            const periode = parsePeriodePesan(pesan, tipeDefault);
            return kirim(await buatLaporanTabel(periode.tipe, from, periode));
        }

        if (/^(riwayat|history|daftar transaksi|semua transaksi|transaksi terakhir)(?:\s+\d+)?$/i.test(pesan)) {
            const limitMatch = pesan.match(/(\d+)$/);
            const limit = limitMatch ? Math.max(1, Number(limitMatch[1])) : Infinity;
            return kirim(await ambilRiwayatTransaksi(limit, from));
        }

        if (/^(tabel|laporan tabel|rekap tabel)\s*(hari ini|minggu ini|bulan ini|semua)?$/i.test(pesan)) {
            const tipe = ambilTipeDariPesan(pesan, pesan.includes("semua") ? "semua" : "bulan");
            return kirim(await buatLaporanTabel(tipe, from));
        }

        // ── SALDO ───────────────────────────────────────────
        if (/^(saldo|cek saldo|total saldo|total)$/i.test(pesan)) {
            return kirim(await buatRingkasanSaldo(from));
        }

        if (/^(laporan|rekap)$/i.test(pesan)) {
            return kirim(await buatLaporanTabel("semua", from));
        }

        // ── REKAP PERIODE ────────────────────────────────────
        if (/^(hari ini|minggu ini|bulan ini|laporan hari ini|laporan minggu ini|laporan bulan ini)$/i.test(pesan)) {
            const tipeTabel = ambilTipeDariPesan(pesan, "bulan");
            return kirim(await buatLaporanTabel(tipeTabel, from));
        }

        // ── GRAFIK ASCII ─────────────────────────────────────
        if (/^grafik\s*(hari ini|minggu ini|bulan ini|semua)?$/i.test(pesan)) {
            const tipe = pesan.includes("hari")?"hari":pesan.includes("minggu")?"minggu":pesan.includes("semua")?"semua":"bulan";
            const lap  = await buatLaporanKeuangan(tipe, from);
            const label= tipe==="hari"?"HARI INI":tipe==="minggu"?"7 HARI TERAKHIR":tipe==="semua"?"SEMUA WAKTU":"BULAN INI";

            if (Object.keys(lap.detailKategori).length===0) {
                return kirim(`📊 Belum ada data pengeluaran untuk periode *${label}*.`);
            }

            const grafik = buatGrafikBar(lap.detailKategori, `PENGELUARAN ${label}`);
            const ringkasan =
`\n💰 Total Keluar: Rp ${formatRupiah(lap.totalKeluar)}
🟢 Total Masuk : Rp ${formatRupiah(lap.totalMasuk)}
📈 Saldo Bersih: Rp ${formatRupiah(lap.saldo)}`;

            return kirim(grafik + ringkasan);
        }

        // ── TREN HARIAN ──────────────────────────────────────
        if (/^(tren|trend|grafik tren|tren 7 hari)$/i.test(pesan)) {
            const dataTren = await buatTrenHarian(from, 7);
            const grafik   = buatGrafikTren(dataTren, "TREN 7 HARI TERAKHIR");
            return kirim(grafik + "\n\n💡 Ketik *analisis* untuk insight AI dari data kamu.");
        }

        // ── ANALISIS AI ──────────────────────────────────────
        if (/^(prediksi|forecast|proyeksi|cashflow)$/i.test(pesan)) {
            await kirim("🔮 _Menghitung prediksi cashflow bulan ini..._");
            return kirim(await buatPrediksiKeuangan(from));
        }

        if (/^(analisis|analisa|insight|review keuangan|analisis keuangan)$/i.test(pesan)) {
            await kirim("🤖 _Sedang menganalisis data keuangan kamu..._");
            const [lap, lapSemua] = await Promise.all([
                buatLaporanKeuangan("bulan", from),
                buatLaporanKeuangan("semua", from)
            ]);
            const insight= await analisisAIKeuangan(lap, "bulan ini", { lapSemua, budget:getBudget(from) });
            return kirim(`🤖 *ANALISIS AI – KEUANGAN BULAN INI*\n\n${insight}`);
        }

        // ── TIPS HARIAN ──────────────────────────────────────
        if (/^(tips|tip|tips keuangan|saran keuangan)$/i.test(pesan)) {
            await kirim("💡 _Mengambil tips dari AI..._");
            const tips = await dapatkanTipsHarian();
            return kirim(`💡 *TIPS KEUANGAN HARI INI*\n\n${tips}`);
        }

        // ── CARI TRANSAKSI ────────────────────────────────────
        if (/^(ai|tanya ai|chatgpt|asisten)\s+.+/i.test(pesan)) {
            const pertanyaan = text.replace(/^(ai|tanya ai|chatgpt|asisten)\s+/i, "").trim();
            await kirim(`🤖 _Membaca data dan bertanya ke ${formatProviderAI()}..._`);
            return kirim(await tanyaAIKeuangan(pertanyaan, from));
        }

        if (/^cari\s+.+/i.test(pesan)) {
            const kw = pesan.replace(/^cari\s+/i,"").trim();
            return kirim(await cariTransaksi(kw, from));
        }

        // ── EXPORT LAPORAN ────────────────────────────────────
        if (/^export\b/i.test(pesan) && mintaPeriodeHistoris) {
            const tipeDefault = (/\b(tahun|tahunan|annual)\b/i.test(pesan) || (/\b20\d{2}\b/.test(pesan) && !punyaNamaBulan)) ? "tahun" : "bulan";
            const periode = parsePeriodePesan(pesan, tipeDefault);
            await kirim("📤 _Menyiapkan laporan ekspor " + periode.label + "..._");
            return kirim(await eksporLaporan(periode.tipe, from, periode));
        }

        if (/^export\s*(hari ini|minggu ini|bulan ini|semua)?$/i.test(pesan)) {
            const tipe = pesan.includes("hari")?"hari":pesan.includes("minggu")?"minggu":pesan.includes("semua")?"semua":"bulan";
            await kirim("📤 _Menyiapkan laporan ekspor..._");
            const laporan = await eksporLaporan(tipe, from);
            return kirim(laporan);
        }

        // ── SET BUDGET CUSTOM ─────────────────────────────────
        if (/^set\s+budget\b/i.test(pesan)) {
            const hasil = parseBudgetCustom(text);
            if (!hasil) return kirim("⚠️ Format salah. Contoh:\n*set budget Konsumsi 2jt*\n*set budget Hiburan 500k*");
            const namaFinal = setBudgetKategori(from, hasil.kategori, hasil.nominal).name;

            return kirim(`✅ *Budget berhasil diset!*\n\n🏷️ Kategori: *${namaFinal}*\n💰 Limit: *Rp ${formatRupiah(hasil.nominal)}/bulan*\n\nKetik *budget* untuk cek semua anggaran.`);
        }

        // ── PENGINGAT ─────────────────────────────────────────
        if (/^pengingat\s+(on|aktif|nyalakan)$/i.test(pesan)) {
            const berhasil = aktifkanPengingat(from, sock);
            return kirim(berhasil
                ? "🔔 *Pengingat harian aktif!*\n\nKamu akan mendapat notifikasi setiap malam jam 20:00 WITA untuk mencatat keuangan. 💪"
                : "ℹ️ Pengingat sudah aktif sebelumnya."
            );
        }
        if (/^pengingat\s+(off|mati|matikan)$/i.test(pesan)) {
            const berhasil = matikanPengingat(from);
            return kirim(berhasil
                ? "🔕 *Pengingat dimatikan.*\n\nKamu bisa nyalakan lagi kapanpun dengan *pengingat on*."
                : "ℹ️ Pengingat belum aktif."
            );
        }

        // ── UNDO ─────────────────────────────────────────────
        if (/^(batal|undo|hapus terakhir)$/i.test(pesan)) {
            const hasilHapus = await hapusTransaksiTerakhir(from);
            if (!hasilHapus) return kirim(dapatkanRespon("gagalUndo"));
            return kirim(dapatkanRespon("suksesUndo", hasilHapus));
        }

        // ── RESET ─────────────────────────────────────────────
        if (/^(#reset|reset data)$/i.test(pesan)) {
            statusReset[from] = "MENUNGGU_KONFIRMASI";
            return kirim(dapatkanRespon("konfirmasiReset"));
        }

        // ── CATAT TRANSAKSI ───────────────────────────────────
        let dataAi = parsingPerintahTransaksi(text);
        if (!dataAi.is_transaksi) dataAi = await analisisPesanDenganAI(text);

        if (dataAi && dataAi.is_transaksi) {
            const { saldoDompetBaru, budgetAlert } = await simpanKeSheet(dataAi, from);
            const katLower = dataAi.kategori.toLowerCase();
            let balas;

            if (katLower==="utang"||katLower==="piutang") {
                balas = dapatkanRespon("suksesUtang",{
                    kategori:    dataAi.kategori,
                    nominal:     formatRupiah(dataAi.nominal),
                    keterangan:  dataAi.keterangan,
                    tanggal:     dataAi.tanggal
                });
            } else {
                balas = dapatkanRespon("suksesMencatat",{
                    emoji:       dataAi.jenis==="Pemasukan"?"🟢":"🔴",
                    jenis:       dataAi.jenis,
                    kategori:    dataAi.kategori,
                    nominal:     formatRupiah(dataAi.nominal),
                    keterangan:  dataAi.keterangan,
                    dompet:      dataAi.dompet,
                    tanggal:     dataAi.tanggal,
                    saldo_dompet:formatRupiah(saldoDompetBaru)
                });
            }

            if (budgetAlert) balas += `\n\n${budgetAlert}`;
            return kirim(balas);
        }

        return kirim(
`❓ *Aku belum paham maksudnya.*

Coba ketik transaksi seperti:
• pengeluaran 25k makan cash
• pemasukan 5jt gaji ke bca
• bayar listrik 300k gopay

Atau ketik *menu* untuk semua perintah 📋`
        );

    } catch(e) {
        console.error("❌ Error proses pesan:", e.message||e);
        return kirim("⚠️ Sistem sedang memproses. Mohon kirim ulang beberapa saat lagi.");
    }
}

// ── START BOT ─────────────────────────────────────────────────
async function startBot() {
    if (sedangStart) { console.log("⏳ Start dobel dilewati."); return; }
    sedangStart = true;

    try {
        console.log("🚀 Memulai Bot Keuangan...");
        cleanupSocket();

        const { state, saveCreds } = await useMultiFileAuthState("./session");
        const { version }          = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth:                state,
            logger:              pino({level:"silent"}),
            printQRInTerminal:   false,
            browser:             ["Ubuntu","Chrome","20.0.04"],
            connectTimeoutMs:    90_000,
            keepAliveIntervalMs: 30_000,
            retryRequestDelayMs: 5_000,
            markOnlineOnConnect: false,
            syncFullHistory:     false,
            shouldIgnoreJid:     jid => jid?.includes("@broadcast")
        });

        sockGlobal = sock;
        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", async({connection,qr,lastDisconnect}) => {
            if (qr) console.log("📌 QR diterima (diabaikan – memakai pairing code)");
            if (connection==="connecting") console.log("🔌 Menghubungkan ke WhatsApp...");

            if (connection==="open") {
                console.log("✅ Bot terhubung!");
                sedangStart=false; jumlahReconnect=0;
                if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer=null; }
            }

            if (connection==="close") {
                sedangStart=false;
                const kode   = lastDisconnect?.error?.output?.statusCode;
                const alasan = String(lastDisconnect?.error?.message||"").toLowerCase();
                console.log(`⚠️ Koneksi putus. Kode: ${kode||"?"} | ${alasan}`);
                cleanupSocket();

                if (kode===DisconnectReason.loggedOut) { console.log("❌ Logout. Hapus folder session dan deploy ulang."); return; }
                if (kode===440||alasan.includes("conflict")) return jadwalkanReconnect("conflict", 60000);
                if (kode===408||alasan.includes("timed out")) return jadwalkanReconnect("timeout", 20000);
                if (kode===515) return jadwalkanReconnect("restart required", 15000);
                jadwalkanReconnect("close", 20000);
            }
        });

        sock.ev.on("messages.upsert", async({messages}) => {
            try { const m=messages?.[0]; if (m) await handleMessage(sock,m); }
            catch(e) { console.error("❌ messages.upsert:", e.message||e); }
        });

        if (!sock.authState.creds.registered) {
            const nomor = WHATSAPP_PHONE_NUMBER;
            if (!nomor||nomor.length<10) throw new Error("WHATSAPP_PHONE_NUMBER belum diisi dengan benar.");
            console.log("⏳ Menunggu koneksi sebelum meminta kode...");
            await tunggu(5000);
            console.log("🔐 Meminta pairing code...");
            try {
                const kode = await sock.requestPairingCode(nomor);
                const rapi = String(kode).match(/.{1,4}/g)?.join("-")||kode;
                console.log("\n========================================");
                console.log(`🔑 KODE MASUK WHATSAPP: ${rapi}`);
                console.log("========================================\n");
                console.log("📲 Buka WA → Perangkat Tertaut → Tautkan dengan Nomor Telepon → Masukkan kode di atas\n");
            } catch(e) {
                console.log("❌ Gagal pairing code:", e.message);
                sedangStart=false; cleanupSocket();
                jadwalkanReconnect("gagal pairing code", 30000);
                return;
            }
        } else {
            console.log("✅ Session sudah terdaftar.");
        }

        sedangStart = false;
    } catch(e) {
        sedangStart=false; cleanupSocket();
        console.error("❌ Gagal start:", e.message||e);
        jadwalkanReconnect("gagal start", 30000);
    }
}

// ── PROCESS HANDLERS ─────────────────────────────────────────
process.on("uncaughtException",   e => { console.error("🔥 uncaughtException:",  e.message||e); jadwalkanReconnect("exception",15000); });
process.on("unhandledRejection",  e => { console.error("🔥 unhandledRejection:", e?.message||e); jadwalkanReconnect("rejection",15000); });
process.on("SIGINT",  () => { console.log("🛑 Bot dihentikan."); cleanupSocket(); process.exit(0); });
process.on("SIGTERM", () => { console.log("🛑 Bot SIGTERM."); cleanupSocket(); process.exit(0); });

if (!sudahStartKeepAlive) { sudahStartKeepAlive=true; startKeepAliveServer(); }
startBot();







