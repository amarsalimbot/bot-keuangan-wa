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
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard Bot Keuangan WA</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  :root{
    --paper:rgba(255,255,255,.66);--paper-strong:rgba(255,255,255,.86);--paper-soft:rgba(255,255,255,.44);
    --line:rgba(255,255,255,.58);--line-strong:rgba(16,44,65,.12);--text:#102033;--muted:#5f6f83;
    --green:#07966c;--green-soft:rgba(8,180,127,.14);--red:#d84a63;--red-soft:rgba(255,96,124,.16);
    --blue:#286be8;--blue-soft:rgba(67,126,255,.16);--amber:#c98213;--amber-soft:rgba(255,190,72,.18);
    --teal:#0694a2;--pink:#d84ca3;--ink:#122033;--shadow:0 24px 70px rgba(31,68,105,.18);
  }
  html{background:#f2fbff}
  body{font-family:'Plus Jakarta Sans','Inter','Segoe UI',ui-sans-serif,system-ui,sans-serif;color:var(--text);min-height:100vh;letter-spacing:0;background:linear-gradient(115deg,rgba(255,255,255,.88),rgba(232,249,255,.68) 38%,rgba(255,244,232,.7) 100%),conic-gradient(from 220deg at 18% 18%,#ffe28a,#6ee7d8,#7da8ff,#ff92bd,#ffe28a);background-attachment:fixed}
  body:before{content:"";position:fixed;inset:0;pointer-events:none;background:linear-gradient(90deg,rgba(255,255,255,.42),rgba(255,255,255,0) 28%,rgba(255,255,255,.28) 72%,rgba(255,255,255,0)),linear-gradient(180deg,rgba(255,255,255,.52),rgba(255,255,255,0) 42%,rgba(17,80,135,.08));z-index:0}
  button,input,select{font:inherit}button{color:inherit}[hidden]{display:none!important}
  .shell{position:relative;z-index:1;min-height:100vh;display:grid;grid-template-columns:292px minmax(0,1fr);gap:18px;padding:18px;transition:grid-template-columns .22s ease}
  .sidebar{background:linear-gradient(155deg,rgba(20,42,70,.72),rgba(20,79,108,.56));border:1px solid rgba(255,255,255,.32);color:#f7fbff;padding:18px 14px;display:flex;flex-direction:column;gap:18px;position:sticky;top:18px;height:calc(100vh - 36px);border-radius:24px;box-shadow:0 26px 70px rgba(10,33,55,.28);backdrop-filter:blur(24px) saturate(145%);-webkit-backdrop-filter:blur(24px) saturate(145%);transition:opacity .22s ease,transform .22s ease,padding .22s ease}
  .brand{display:flex;align-items:center;gap:12px;padding:6px 4px}
  .mark{width:44px;height:44px;border-radius:16px;background:linear-gradient(135deg,#18d49e,#2f74ff 58%,#ff78b7);color:white;display:grid;place-items:center;font-weight:900;box-shadow:0 16px 34px rgba(51,121,255,.32)}
  .brand h1{font-size:1rem;line-height:1.2}.brand small{display:block;color:#c2d4e5;font-size:.76rem;margin-top:3px}
  .nav{display:grid;gap:7px}
  .nav-item{width:100%;border:1px solid transparent;background:rgba(255,255,255,.08);color:#dbe8f4;border-radius:16px;padding:10px 11px;display:flex;align-items:center;gap:10px;cursor:pointer;text-align:left;font-weight:800;font-size:.86rem;transition:background .18s ease,border-color .18s ease,transform .18s ease}
  .nav-item:hover{background:rgba(255,255,255,.12);color:#fff;transform:translateY(-1px)}.nav-item.active{background:linear-gradient(135deg,rgba(255,255,255,.24),rgba(255,255,255,.1));border-color:rgba(255,255,255,.34);color:#fff}
  .nav-swatch{width:9px;height:9px;border-radius:3px;background:var(--blue);flex:none}.nav-item[data-view="binance"] .nav-swatch{background:#f3ba2f}.nav-item[data-view="analytics"] .nav-swatch{background:#13b7a6}.nav-item[data-view="reports"] .nav-swatch{background:#f4b94d}.nav-item[data-view="trend"] .nav-swatch{background:#78a7ff}.nav-item[data-view="budget"] .nav-swatch{background:#ff985f}.nav-item[data-view="transactions"] .nav-swatch{background:#1ecb8f}.nav-item[data-view="catalog"] .nav-swatch{background:#e266b4}.nav-item[data-view="system"] .nav-swatch{background:#0fb8c8}.nav-item[data-view="admin"] .nav-swatch{background:#ff6178}
  .side-meta{margin-top:auto;display:grid;gap:8px;padding:12px;border:1px solid rgba(255,255,255,.18);border-radius:8px;background:rgba(255,255,255,.08);font-size:.78rem;color:#c8d8e6}.side-meta b{color:#fff}
  .content{display:grid;align-content:start;gap:18px;max-width:1480px;width:100%}
  .topbar{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;background:var(--paper);border:1px solid var(--line);border-radius:24px;padding:17px;box-shadow:var(--shadow);backdrop-filter:blur(24px) saturate(150%);-webkit-backdrop-filter:blur(24px) saturate(150%)}
  .kicker{font-size:.76rem;color:var(--blue);font-weight:900;margin-bottom:4px}.topbar h2{font-size:1.42rem;line-height:1.2}.topbar p{color:var(--muted);font-size:.88rem;margin-top:4px}
  .actions,.toolbar,.modal-actions,.actions-cell{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .btn{border:1px solid var(--line-strong);background:rgba(255,255,255,.7);border-radius:14px;padding:9px 12px;cursor:pointer;font-weight:850;transition:background .18s ease,border-color .18s ease,box-shadow .18s ease,transform .18s ease;box-shadow:0 8px 24px rgba(36,82,126,.08)}
  .btn:hover{background:rgba(255,255,255,.95);box-shadow:0 14px 30px rgba(36,82,126,.13);transform:translateY(-1px)}.btn.primary{background:linear-gradient(135deg,#286be8,#13b7a6);border-color:rgba(255,255,255,.28);color:white}.btn.primary:hover{background:linear-gradient(135deg,#1e5fd6,#0e9f96)}.btn.danger{background:var(--red-soft);color:var(--red);border-color:rgba(216,74,99,.22)}.btn.small{padding:6px 9px;font-size:.75rem}
  .pill{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);background:rgba(255,255,255,.58);border-radius:999px;padding:8px 11px;font-size:.82rem;font-weight:850}.dot{width:9px;height:9px;border-radius:99px;background:var(--amber)}.dot.online{background:var(--green)}.dot.offline{background:var(--red)}
  .view{display:none;gap:14px}.view.active{display:grid}
  .metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
  .metric-card,.panel-card,.mini,.radar-card{background:var(--paper);border:1px solid var(--line);border-radius:22px;box-shadow:var(--shadow);backdrop-filter:blur(22px) saturate(150%);-webkit-backdrop-filter:blur(22px) saturate(150%)}
  .metric-card{padding:16px;min-height:112px;display:grid;align-content:space-between;gap:10px}.metric-card:nth-child(1){background:linear-gradient(160deg,rgba(255,255,255,.82),rgba(211,255,235,.56))}.metric-card:nth-child(2){background:linear-gradient(160deg,rgba(255,255,255,.82),rgba(255,218,226,.58))}.metric-card:nth-child(3){background:linear-gradient(160deg,rgba(255,255,255,.82),rgba(219,232,255,.62))}.metric-card:nth-child(4){background:linear-gradient(160deg,rgba(255,255,255,.82),rgba(255,238,199,.62))}
  .label{font-size:.75rem;color:var(--muted);font-weight:850}.value{font-size:1.25rem;font-weight:950;line-height:1.2;word-break:break-word}.hint{font-size:.78rem;color:var(--muted)}
  .value.green{color:var(--green)}.value.red{color:var(--red)}.value.blue{color:var(--blue)}.value.amber{color:var(--amber)}
  .panel-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(280px,.85fr);gap:14px}.panel-grid.equal{grid-template-columns:1fr 1fr}.panel-card{padding:16px;min-width:0}.panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:13px}.panel-head h3{font-size:1rem;line-height:1.25}.subtle{font-size:.78rem;color:var(--muted);margin-top:3px}
  .finance-hero{position:relative;overflow:hidden;background:linear-gradient(135deg,rgba(17,47,80,.88),rgba(25,111,143,.8) 44%,rgba(235,91,149,.68));color:#f8fcff;border:1px solid rgba(255,255,255,.28);border-radius:26px;padding:22px;display:grid;grid-template-columns:minmax(0,1.28fr) repeat(3,minmax(135px,.5fr));gap:14px;align-items:center;box-shadow:0 26px 70px rgba(26,76,116,.26);backdrop-filter:blur(22px) saturate(150%);-webkit-backdrop-filter:blur(22px) saturate(150%)}
  .finance-hero:before{content:"";position:absolute;inset:0;background:linear-gradient(120deg,rgba(255,255,255,.2),rgba(255,255,255,0) 42%,rgba(255,255,255,.14));pointer-events:none}.hero-copy,.hero-stat{position:relative}.hero-copy h3{font-size:1.22rem}.hero-copy p{color:#d7e8f3;font-size:.86rem;margin-top:6px;max-width:620px}.hero-stat{background:rgba(255,255,255,.13);border:1px solid rgba(255,255,255,.22);border-radius:18px;padding:13px}.hero-stat span{display:block;color:#c7ddeb;font-size:.74rem}.hero-stat b{display:block;font-size:1.08rem;margin-top:5px}.score{color:#75f0bd}
  .smart-radar{display:grid;grid-template-columns:1.18fr repeat(3,1fr);gap:12px}.radar-card{padding:14px;min-height:112px;background:rgba(255,255,255,.56)}.radar-card.priority{background:linear-gradient(145deg,rgba(255,255,255,.8),rgba(210,247,255,.56))}.radar-card span{display:block;color:var(--muted);font-size:.72rem;font-weight:900}.radar-card b{display:block;margin-top:6px;font-size:1rem;line-height:1.25}.radar-card p{margin-top:6px;color:var(--muted);font-size:.78rem;line-height:1.45}
  .insight-list{display:grid;gap:8px}.insight-item{display:flex;gap:10px;align-items:flex-start;padding:11px;border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.58)}.insight-mark{width:8px;height:8px;border-radius:3px;background:linear-gradient(135deg,var(--green),var(--blue));margin-top:5px;flex:none}
  .catalog-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.catalog-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}.category-card{border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.62);padding:13px;display:grid;gap:8px}.category-top{display:flex;gap:9px;align-items:center}.category-swatch{width:12px;height:34px;border-radius:4px;flex:none}.category-card h4{font-size:.9rem}.category-card p{font-size:.76rem;color:var(--muted);line-height:1.45}.category-meta{display:flex;gap:6px;flex-wrap:wrap}.tag{display:inline-flex;border:1px solid var(--line-strong);border-radius:999px;padding:4px 7px;font-size:.7rem;color:var(--muted);background:rgba(255,255,255,.58)}
  .budget-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.budget-card-list{display:grid;gap:9px}.budget-card{display:grid;gap:7px;padding:12px;border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.62)}.budget-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.budget-card-head button{border:0;background:transparent;color:var(--blue);font-weight:900;cursor:pointer}.budget-card .bar-meta{align-items:center}
  .smart-suggestion{display:none;border:1px solid rgba(8,180,127,.3);background:var(--green-soft);border-radius:8px;padding:9px 10px;font-size:.78rem;color:#155c47}.smart-suggestion.show{display:flex;align-items:center;justify-content:space-between;gap:8px}.smart-suggestion button{border:0;background:rgba(255,255,255,.82);border-radius:6px;padding:5px 8px;color:#155c47;font-weight:900;cursor:pointer}
  .mini-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.mini{padding:13px}.mini b{display:block;font-size:1.03rem;margin-top:5px;line-height:1.25}
  .report-banner{background:linear-gradient(135deg,rgba(18,42,69,.88),rgba(44,116,155,.76));color:#fff;border:1px solid rgba(255,255,255,.26);border-radius:8px;padding:18px;display:flex;justify-content:space-between;align-items:center;gap:16px;box-shadow:var(--shadow)}.report-banner p{color:#d4e2ec;font-size:.82rem;margin-top:5px}.report-balance{text-align:right}.report-balance span{display:block;color:#c7ddeb;font-size:.74rem}.report-balance b{display:block;color:#7ef1bd;font-size:1.22rem;margin-top:4px}
  .trend-shell{background:rgba(15,31,51,.76);border-color:rgba(255,255,255,.2);color:#f5fafc;padding:18px;box-shadow:0 24px 70px rgba(20,36,45,.24)}.trend-shell .subtle{color:#b7c9d7}.trend-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:12px}.trend-kpi{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);border-radius:8px;padding:11px}.trend-kpi span{display:block;color:#b7c9d7;font-size:.7rem;font-weight:850}.trend-kpi b{display:block;font-size:.94rem;margin-top:5px}.trend-legend{display:flex;gap:14px;align-items:center;font-size:.74rem;color:#d1e0ea}.legend-dot{width:8px;height:8px;border-radius:2px;display:inline-block;margin-right:5px}.legend-dot.income{background:#4fd0a2}.legend-dot.expense{background:#ff7c82}
  .chart-wrap{height:340px;border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.58);overflow:hidden}.trend-shell .chart-wrap{background:#112029;border-color:rgba(255,255,255,.14)}svg{width:100%;height:100%;display:block}
  .table-wrap{overflow:auto;max-height:460px;border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.62)}.table{width:100%;border-collapse:collapse;font-size:.84rem}.table th,.table td{padding:10px 9px;border-bottom:1px solid rgba(16,44,65,.1);text-align:left;vertical-align:top}.table th{position:sticky;top:0;background:rgba(255,255,255,.86);color:var(--muted);font-size:.74rem;font-weight:900;backdrop-filter:blur(14px)}.table tbody tr:hover{background:rgba(255,255,255,.55)}.right{text-align:right!important}.muted{color:var(--muted)}
  .bar-list,.wallets{display:grid;gap:10px}.list-scroll{max-height:430px;overflow:auto;padding-right:3px}.bar-row{display:grid;gap:6px}.bar-meta{display:flex;justify-content:space-between;gap:10px;font-size:.82rem}.bar-meta span{text-align:right;color:var(--muted)}.bar{height:8px;background:rgba(17,51,82,.12);border-radius:8px;overflow:hidden}.bar span{display:block;height:100%;background:var(--blue);border-radius:8px}.bar span.danger{background:var(--red)}.bar span.warn{background:var(--amber)}.bar span.good{background:var(--green)}
  .wallet{display:flex;align-items:center;justify-content:space-between;border:1px solid var(--line);border-radius:8px;padding:11px;background:rgba(255,255,255,.62)}.wallet span{font-weight:900}
  .status-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.status-item{border:1px solid var(--line);border-radius:8px;padding:12px;background:rgba(255,255,255,.62)}.status-item b{display:block;font-size:.92rem}.status-item span{display:block;font-size:.78rem;color:var(--muted);margin-top:4px}
  .cmds{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:9px}.cmd{border:1px solid var(--line);border-radius:8px;padding:12px;background:rgba(255,255,255,.62);text-align:left;cursor:pointer}.cmd:hover{background:rgba(255,255,255,.88)}.cmd code{font-weight:900;color:var(--blue);white-space:normal}.cmd span{display:block;color:var(--muted);font-size:.76rem;margin-top:4px}
  .badge,.type-badge{display:inline-flex;padding:5px 8px;border-radius:999px;font-size:.72rem;font-weight:900}.badge{background:var(--blue-soft);color:var(--blue)}.type-badge.income{background:var(--green-soft);color:var(--green)}.type-badge.expense{background:var(--red-soft);color:var(--red)}
  .category-pill{display:inline-flex;align-items:center;gap:6px;font-weight:800}.category-pill:before{content:"";width:7px;height:7px;border-radius:2px;background:var(--category-color,#7a8490)}
  .field{border:1px solid var(--line-strong);background:rgba(255,255,255,.72);border-radius:8px;padding:9px 11px;color:var(--text);min-width:150px;outline:none}.field:focus,.form-group input:focus,.form-group select:focus,.lock-box input:focus{border-color:rgba(40,107,232,.45);box-shadow:0 0 0 3px rgba(40,107,232,.12)}.search-field{min-width:230px}.user-row{cursor:pointer}.user-row.active{background:rgba(67,126,255,.14)}
  .empty{border:1px dashed rgba(16,44,65,.22);border-radius:8px;padding:16px;color:var(--muted);background:rgba(255,255,255,.46)}
  .lock{position:fixed;inset:0;background:rgba(239,247,255,.72);display:none;align-items:center;justify-content:center;padding:18px;z-index:10;backdrop-filter:blur(18px)}.lock.show{display:flex}.lock-box{width:min(420px,100%);background:var(--paper-strong);border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow);padding:20px;display:grid;gap:12px}.lock-box input{width:100%;border:1px solid var(--line-strong);border-radius:8px;padding:11px;background:rgba(255,255,255,.7)}
  .modal{position:fixed;inset:0;background:rgba(15,30,48,.52);display:none;align-items:center;justify-content:center;padding:18px;z-index:20;backdrop-filter:blur(14px)}.modal.show{display:flex}.modal-box{width:min(620px,100%);background:var(--paper-strong);border:1px solid var(--line);border-radius:8px;box-shadow:0 30px 80px rgba(12,30,60,.28);padding:22px;display:grid;gap:16px}
  .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.form-group{display:grid;gap:6px}.form-group.full{grid-column:1/-1}.form-group label{font-size:.75rem;font-weight:900;color:var(--muted)}.form-group input,.form-group select{border:1px solid var(--line-strong);border-radius:8px;padding:11px;background:rgba(255,255,255,.72)}
  .toast{position:fixed;right:18px;bottom:18px;background:#122033;color:white;border-radius:8px;padding:10px 12px;font-size:.82rem;display:none;z-index:30;box-shadow:0 18px 45px rgba(16,32,51,.24)}.toast.show{display:block}
  .shell.menu-collapsed{grid-template-columns:0 minmax(0,1fr)}.shell.menu-collapsed .sidebar{opacity:0;pointer-events:none;overflow:hidden;padding:0;border:0;transform:translateX(-18px)}.menu-fab{display:inline-flex;align-items:center;gap:8px}.binance-card{background:linear-gradient(145deg,rgba(255,255,255,.82),rgba(255,244,202,.66));border-color:rgba(243,186,47,.28)}.binance-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.binance-kpi{padding:12px;border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,.58)}.binance-kpi span{display:block;font-size:.72rem;color:var(--muted);font-weight:900}.binance-kpi b{display:block;margin-top:5px;font-size:1rem}.asset-chip{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:4px 8px;background:rgba(243,186,47,.14);font-weight:900;color:#7a5600}.mobile-overlay{display:none}
  @media (max-width:1120px){.shell{grid-template-columns:1fr}.shell.menu-collapsed{grid-template-columns:1fr}.shell.menu-collapsed .sidebar{opacity:1;pointer-events:auto;padding:18px 14px;border:1px solid rgba(255,255,255,.32);transform:none}.sidebar{position:static;height:auto}.nav{grid-template-columns:repeat(4,minmax(0,1fr))}.side-meta{margin-top:0}.metric-grid,.mini-grid,.budget-summary{grid-template-columns:repeat(2,1fr)}.panel-grid,.panel-grid.equal{grid-template-columns:1fr}.finance-hero{grid-template-columns:1fr repeat(3,minmax(120px,1fr))}.smart-radar{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media (max-width:720px){.shell{display:block;padding:12px}.sidebar{display:none;position:fixed;z-index:25;inset:12px;height:auto;overflow:auto}.shell.menu-open .sidebar{display:flex}.mobile-overlay{position:fixed;inset:0;background:rgba(13,31,50,.42);z-index:24;backdrop-filter:blur(8px)}.shell.menu-open .mobile-overlay{display:block}.content{gap:14px}.nav{grid-template-columns:repeat(2,minmax(0,1fr))}.metric-grid,.mini-grid,.budget-summary,.trend-kpis,.smart-radar,.binance-kpis{grid-template-columns:1fr}.metric-card .value{font-size:1.05rem;word-break:normal}.status-grid,.form-grid,.finance-hero{grid-template-columns:1fr}.hero-stat{padding:12px}.form-group.full{grid-column:auto}.toolbar,.catalog-toolbar{align-items:stretch}.field,.search-field,.btn{width:100%}.table-wrap{max-height:420px}.chart-wrap{height:300px}.report-banner{align-items:flex-start;flex-direction:column}.report-balance{text-align:left}.topbar{padding:14px}}
</style>
</head>
<body>
<div class="shell" id="shell">
  <div class="mobile-overlay" id="mobile-overlay"></div>
  <aside class="sidebar">
    <div class="brand"><div class="mark">WA</div><div><h1>Bot Keuangan</h1><small>Dashboard operasional</small></div></div>
    <nav class="nav">
      <button class="nav-item active" data-view="overview" type="button"><span class="nav-swatch"></span><span>Overview</span></button>
      <button class="nav-item" data-view="binance" type="button"><span class="nav-swatch"></span><span>Binance</span></button>
      <button class="nav-item" id="admin-nav" data-view="admin" type="button" hidden><span class="nav-swatch"></span><span>Pengguna</span></button>
      <button class="nav-item" data-view="analytics" type="button"><span class="nav-swatch"></span><span>Analitik</span></button>
      <button class="nav-item" data-view="reports" type="button"><span class="nav-swatch"></span><span>Laporan</span></button>
      <button class="nav-item" data-view="trend" type="button"><span class="nav-swatch"></span><span>Tren</span></button>
      <button class="nav-item" data-view="budget" type="button"><span class="nav-swatch"></span><span>Budget</span></button>
      <button class="nav-item" data-view="transactions" type="button"><span class="nav-swatch"></span><span>Transaksi</span></button>
      <button class="nav-item" data-view="catalog" type="button"><span class="nav-swatch"></span><span>Katalog</span></button>
      <button class="nav-item" data-view="system" type="button"><span class="nav-swatch"></span><span>Sistem</span></button>
      <button class="nav-item" data-view="commands" type="button"><span class="nav-swatch"></span><span>Command</span></button>
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
        <select class="field" id="global-period-select" aria-label="Pilih periode laporan"></select>
        <span class="pill"><span id="status-dot" class="dot"></span><span id="status-label">Memuat</span></span>
        <button class="btn" id="token-btn" type="button">Ganti Akses</button>
        <button class="btn" id="quick-add-btn" type="button">+ Catat</button>
        <button class="btn primary" id="refresh-btn" type="button">Refresh</button>
      </div>
    </section>

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
        <div class="metric-card"><div class="label">Pemasukan Periode</div><div class="value green" id="income-month">-</div><div class="hint" id="income-today">-</div></div>
        <div class="metric-card"><div class="label">Pengeluaran Periode</div><div class="value red" id="expense-month">-</div><div class="hint" id="expense-today">-</div></div>
        <div class="metric-card"><div class="label">Saldo Bersih Periode</div><div class="value blue" id="net-month">-</div><div class="hint" id="finance-status">Status -</div></div>
        <div class="metric-card"><div class="label">Saldo Total</div><div class="value amber" id="total-balance">-</div><div class="hint" id="transaction-count">0 transaksi</div></div>
      </div>
      <div class="panel-card binance-card" id="binance-overview-card">
        <div class="panel-head"><div><h3>Binance Realtime</h3><div class="subtle" id="binance-overview-subtitle">Khusus nomor 33827179200526</div></div><span class="asset-chip">SPOT</span></div>
        <div class="binance-kpis">
          <div class="binance-kpi"><span>Total USDT</span><b id="binance-total-usdt">-</b></div>
          <div class="binance-kpi"><span>Estimasi Rupiah</span><b id="binance-total-idr">-</b></div>
          <div class="binance-kpi"><span>Aset Aktif</span><b id="binance-asset-count">-</b></div>
        </div>
      </div>
      <div class="mini-grid">
        <div class="mini"><span class="label">Rata-rata Pengeluaran</span><b id="avg-expense">-</b><span class="hint">Per transaksi bulan ini</span></div>
        <div class="mini"><span class="label">Proyeksi Pengeluaran</span><b id="projected-expense">-</b><span class="hint">Estimasi akhir bulan</span></div>
        <div class="mini"><span class="label">Kategori Terbesar</span><b id="insight-top-category">-</b><span class="hint">Pengeluaran bulan ini</span></div>
        <div class="mini"><span class="label">Rasio Sisa</span><b id="remaining-ratio">-</b><span class="hint">Dari pemasukan bulan ini</span></div>
      </div>
      <div class="panel-grid equal">
        <div class="panel-card">
          <div class="panel-head"><div><h3>Pengeluaran per Kategori</h3><div class="subtle" id="top-category">-</div></div></div>
          <div class="bar-list list-scroll" id="category-list"></div>
        </div>
        <div class="panel-card">
          <div class="panel-head"><div><h3>Saldo Dompet</h3><div class="subtle">Semua waktu</div></div></div>
          <div class="wallets list-scroll" id="wallet-list"></div>
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

    <section class="view" data-view="trend" id="view-trend">
      <div class="panel-card trend-shell">
        <div class="panel-head"><div><h3>Arus Kas Harian</h3><div class="subtle">Pergerakan pemasukan dan pengeluaran pada periode terpilih</div></div><div class="subtle" id="period-label">-</div></div>
        <div class="trend-kpis">
          <div class="trend-kpi"><span>Total Masuk</span><b id="trend-income">-</b></div>
          <div class="trend-kpi"><span>Total Keluar</span><b id="trend-expense">-</b></div>
          <div class="trend-kpi"><span>Arus Bersih</span><b id="trend-net">-</b></div>
          <div class="trend-kpi"><span>Hari Tersibuk</span><b id="trend-peak">-</b></div>
        </div>
        <div class="panel-head"><div class="trend-legend"><span><i class="legend-dot income"></i>Pemasukan</span><span><i class="legend-dot expense"></i>Pengeluaran</span></div></div>
        <div class="chart-wrap"><svg id="trend-chart" viewBox="0 0 900 360" preserveAspectRatio="xMidYMid meet"></svg></div>
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
          <thead><tr><th>Tanggal</th><th>Jenis</th><th>Kategori</th><th>Keterangan</th><th>Dompet</th><th class="right">Nominal</th><th class="right">Aksi</th></tr></thead>
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
<div class="toast" id="toast"></div>

<script>
  const rupiah = new Intl.NumberFormat("id-ID", { style:"currency", currency:"IDR", maximumFractionDigits:0 });
  const params = new URLSearchParams(location.search);
  let token = params.get("access") || params.get("token") || sessionStorage.getItem("dashboardAccess") || "";
  let selectedNumber = params.get("nomor") || "";
  let selectedPeriod = params.get("periode") || sessionStorage.getItem("dashboardPeriod") || "";
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
  let activeView = localStorage.getItem("dashboardView") || "overview";
  const viewTitles = {
    overview:"Overview",
    binance:"Binance",
    admin:"Pengguna",
    analytics:"Analitik",
    reports:"Laporan",
    trend:"Tren",
    budget:"Budget",
    transactions:"Transaksi",
    catalog:"Katalog",
    system:"Sistem",
    commands:"Command"
  };
  if (params.get("access") || params.get("token")) {
    sessionStorage.setItem("dashboardAccess", token);
    history.replaceState(null, "", "/dashboard");
  }
  const $ = id => document.getElementById(id);
  const money = value => rupiah.format(Number(value || 0));
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
      button.classList.toggle("active", button.dataset.view === activeView);
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
      return;
    }

    const s = finance.summary || {};
    $("income-month").textContent = money(s.incomeMonth);
    $("expense-month").textContent = money(s.expenseMonth);
    $("net-month").textContent = money(s.netMonth);
    $("total-balance").textContent = money(s.totalBalance);
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
    return currentRecent.filter(row => {
      const haystack = [row.date,row.type,row.category,row.note,row.wallet,row.amount].join(" ").toLowerCase();
      return (!keyword || haystack.includes(keyword)) && (!filter || row.type === filter) && (!category || row.category === category);
    });
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
    $("binance-total-usdt").textContent = totalUsdt;
    $("binance-total-idr").textContent = totalIdr;
    $("binance-asset-count").textContent = assetCount;
    $("binance-overview-subtitle").textContent = available ? "Update " + (info.refreshedAt || "-") : message;
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
    const totalIncome = rows.reduce((sum, row) => sum + Number(row.masuk || 0), 0);
    const totalExpense = rows.reduce((sum, row) => sum + Number(row.keluar || 0), 0);
    const peak = rows.slice().sort((a,b) => (Number(b.masuk || 0) + Number(b.keluar || 0)) - (Number(a.masuk || 0) + Number(a.keluar || 0)))[0];
    $("trend-income").textContent = money(totalIncome);
    $("trend-expense").textContent = money(totalExpense);
    $("trend-net").textContent = money(totalIncome - totalExpense);
    $("trend-peak").textContent = peak ? peak.label : "-";
    if (!rows.length) {
      svg.innerHTML = '<rect width="900" height="360" fill="#112029"></rect><text x="450" y="185" text-anchor="middle" fill="#9fb2bd" font-size="14">Belum ada data arus kas pada periode ini.</text>';
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
      return '<line x1="' + left + '" y1="' + gy.toFixed(1) + '" x2="' + (w-right) + '" y2="' + gy.toFixed(1) + '" stroke="#29404d" stroke-width="1"></line><text x="' + (left-12) + '" y="' + (gy+4).toFixed(1) + '" text-anchor="end" fill="#8299a5" font-size="10">' + esc(compact(value)) + '</text>';
    }).join("");
    const labelEvery = Math.max(1, Math.ceil(rows.length / 7));
    const labels = rows.map((row, i) => i % labelEvery === 0 || i === rows.length - 1 ? '<text x="' + x(i).toFixed(1) + '" y="' + (h-18) + '" text-anchor="middle" fill="#8299a5" font-size="10">' + esc(row.label) + '</text>' : "").join("");
    const dots = (pts, color) => pts.map(point => '<circle cx="' + point[0].toFixed(1) + '" cy="' + point[1].toFixed(1) + '" r="3.5" fill="' + color + '" stroke="#112029" stroke-width="2"><title>' + esc(point[3]) + ': ' + esc(money(point[2])) + '</title></circle>').join("");
    svg.innerHTML =
      '<defs><linearGradient id="income-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#4fd0a2" stop-opacity=".28"></stop><stop offset="100%" stop-color="#4fd0a2" stop-opacity="0"></stop></linearGradient><linearGradient id="expense-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ff7c82" stop-opacity=".22"></stop><stop offset="100%" stop-color="#ff7c82" stop-opacity="0"></stop></linearGradient></defs>' +
      '<rect width="900" height="360" fill="#112029"></rect>' + grid +
      '<path d="' + area(income) + '" fill="url(#income-area)"></path><path d="' + area(expense) + '" fill="url(#expense-area)"></path>' +
      '<path d="' + path(income) + '" fill="none" stroke="#4fd0a2" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>' +
      '<path d="' + path(expense) + '" fill="none" stroke="#ff7c82" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>' +
      dots(income, "#4fd0a2") + dots(expense, "#ff7c82") + labels;
  }

  document.querySelectorAll(".nav-item").forEach(button => {
    button.addEventListener("click", () => { setActiveView(button.dataset.view); $("shell").classList.remove("menu-open"); });
  });
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
  if (localStorage.getItem("dashboardMenuCollapsed") === "1") $("shell").classList.add("menu-collapsed");
  $("global-period-select").addEventListener("change", event => {
    selectedPeriod = event.target.value;
    sessionStorage.setItem("dashboardPeriod", selectedPeriod);
    loadDashboard();
  });
  $("token-btn").addEventListener("click", () => $("lock").classList.add("show"));
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
