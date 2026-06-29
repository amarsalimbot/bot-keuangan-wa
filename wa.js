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
const https = require("https");
const crypto = require("crypto");

// ── ENV ──────────────────────────────────────────────────────
const SPREADSHEET_ID            = process.env.SPREADSHEET_ID || "";
const OPENAI_API_KEY            = process.env.OPENAI_API_KEY || process.env.CHATGPT_API_KEY || "";
const OPENAI_MODEL              = process.env.OPENAI_MODEL || "gpt-4o-mini";
const GEMINI_API_KEY            = process.env.GEMINI_API_KEY || "";
const WHATSAPP_PHONE_NUMBER     = String(process.env.WHATSAPP_PHONE_NUMBER || "").replace(/\D/g, "");
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
const DASHBOARD_TOKEN           = String(process.env.DASHBOARD_TOKEN || "").trim();
const DASHBOARD_SECRET          = String(process.env.DASHBOARD_SECRET || DASHBOARD_TOKEN || "").trim();
const DASHBOARD_BASE_URL        = String(process.env.DASHBOARD_BASE_URL || process.env.PUBLIC_BASE_URL || process.env.APP_URL || "").trim();
const DASHBOARD_LINK_DAYS       = Math.max(1, Number(process.env.DASHBOARD_LINK_DAYS || 30) || 30);
const SUPER_ADMIN_NUMBERS       = String(process.env.SUPER_ADMIN_NUMBERS || process.env.SUPER_ADMIN_NUMBER || "")
    .split(",").map(n => n.replace(/\D/g, "")).filter(Boolean);
const APP_TIMEZONE              = "Asia/Makassar";
const PORT                      = process.env.PORT || 7860;
const BINANCE_BALANCE_NUMBER    = String(process.env.BINANCE_BALANCE_NUMBER || "33827179200526").replace(/\D/g, "");
const BINANCE_API_KEY           = String(process.env[`BINANCE_API_KEY_${BINANCE_BALANCE_NUMBER}`] || process.env.BINANCE_API_KEY || "").trim();
const BINANCE_API_SECRET        = String(process.env[`BINANCE_API_SECRET_${BINANCE_BALANCE_NUMBER}`] || process.env.BINANCE_API_SECRET || "").trim();
const BINANCE_BASE_URL          = String(process.env.BINANCE_BASE_URL || "https://api.binance.com").replace(/\/+$/, "");
const BINANCE_RECV_WINDOW       = Math.max(1000, Number(process.env.BINANCE_RECV_WINDOW || 5000) || 5000);
const BINANCE_CACHE_TTL         = Math.max(5, Number(process.env.BINANCE_CACHE_SECONDS || 15) || 15) * 1000;

if (!SPREADSHEET_ID) console.warn("⚠️ SPREADSHEET_ID belum diisi. Web tetap aktif, tetapi data spreadsheet belum bisa dimuat.");
if (!OPENAI_API_KEY && !GEMINI_API_KEY) console.warn("⚠️ AI key belum diisi. Bot tetap berjalan memakai parsing dan analisis lokal.");
if (!GOOGLE_SERVICE_ACCOUNT_JSON) console.warn("⚠️ GOOGLE_SERVICE_ACCOUNT_JSON belum diisi. Web tetap aktif, tetapi data spreadsheet belum bisa dimuat.");
if (OPENAI_API_KEY || GEMINI_API_KEY) {
    if (!OPENAI_API_KEY) console.warn("⚠️ OPENAI_API_KEY belum diisi. AI utama ChatGPT nonaktif, memakai Gemini.");
    if (!GEMINI_API_KEY) console.warn("⚠️ GEMINI_API_KEY belum diisi. Fallback Gemini nonaktif.");
}
if (!DASHBOARD_SECRET) console.warn("⚠️ DASHBOARD_SECRET belum diisi. Kunci link dashboard diturunkan dari service account / fallback lokal.");
if (!SUPER_ADMIN_NUMBERS.length) console.warn("⚠️ SUPER_ADMIN_NUMBERS belum diisi. Akses dashboard super admin via WhatsApp belum aktif.");
if (BINANCE_API_KEY && !BINANCE_API_SECRET) console.warn("⚠️ BINANCE_API_SECRET belum diisi. Integrasi Binance belum bisa dipakai.");
if (!BINANCE_API_KEY || !BINANCE_API_SECRET) console.warn(`ℹ️ Integrasi Binance untuk ${BINANCE_BALANCE_NUMBER} belum aktif. Isi BINANCE_API_KEY_${BINANCE_BALANCE_NUMBER} dan BINANCE_API_SECRET_${BINANCE_BALANCE_NUMBER}.`);

let serviceAccount = null;
let serviceAccountError = "";
if (GOOGLE_SERVICE_ACCOUNT_JSON) {
    try { serviceAccount = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON); }
    catch(e) { serviceAccountError = "GOOGLE_SERVICE_ACCOUNT_JSON tidak valid JSON."; console.warn(`⚠️ ${serviceAccountError}`); }
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
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin":"*",
        "Access-Control-Allow-Headers":"Content-Type, Authorization, x-dashboard-access, x-dashboard-token"
    });
    res.end(JSON.stringify(data));
}

function buatHttpError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function statusKonfigurasi() {
    const spreadsheetReady = !!SPREADSHEET_ID && !!serviceAccount && !!serviceAccount.client_email && !!serviceAccount.private_key;
    const missing = [];
    if (!SPREADSHEET_ID) missing.push("SPREADSHEET_ID");
    if (!GOOGLE_SERVICE_ACCOUNT_JSON) missing.push("GOOGLE_SERVICE_ACCOUNT_JSON");
    if (GOOGLE_SERVICE_ACCOUNT_JSON && !serviceAccount) missing.push("GOOGLE_SERVICE_ACCOUNT_JSON_VALID_JSON");
    if (serviceAccount && (!serviceAccount.client_email || !serviceAccount.private_key)) missing.push("GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL_PRIVATE_KEY");
    if (!WHATSAPP_PHONE_NUMBER) missing.push("WHATSAPP_PHONE_NUMBER");
    return {
        ok: spreadsheetReady && !!WHATSAPP_PHONE_NUMBER,
        spreadsheetReady,
        whatsappReady: !!WHATSAPP_PHONE_NUMBER,
        dashboardReady: true,
        aiReady: !!openai || !!ai,
        binanceReady: !!BINANCE_API_KEY && !!BINANCE_API_SECRET,
        missing,
        serviceAccountError
    };
}

function pastikanKonfigurasiSpreadsheet() {
    const status = statusKonfigurasi();
    if (!status.spreadsheetReady) {
        const detail = status.serviceAccountError || `Variabel belum lengkap: ${status.missing.join(", ") || "GOOGLE_SERVICE_ACCOUNT_JSON / SPREADSHEET_ID"}`;
        throw buatHttpError(`Konfigurasi Google Spreadsheet belum lengkap. ${detail}`, 503);
    }
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function penggunaPunyaAksesBinance(nomor) {
    const normalized = String(nomor || "").replace(/\D/g, "");
    return !!normalized && normalized === BINANCE_BALANCE_NUMBER;
}

function requestJsonHttps(method, fullUrl, headers = {}, body = null, timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(fullUrl);
        const req = https.request({
            method,
            hostname: urlObj.hostname,
            port: urlObj.port || 443,
            path: `${urlObj.pathname}${urlObj.search}`,
            headers,
            timeout: timeoutMs
        }, res => {
            let raw = "";
            res.setEncoding("utf8");
            res.on("data", chunk => raw += chunk);
            res.on("end", () => {
                let parsed = raw;
                try { parsed = raw ? JSON.parse(raw) : {}; } catch {}
                if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
                const msg = typeof parsed === "object" && parsed ? (parsed.msg || parsed.message || JSON.stringify(parsed)) : raw;
                const error = new Error(`HTTP ${res.statusCode}: ${msg}`);
                error.statusCode = res.statusCode;
                error.response = parsed;
                reject(error);
            });
        });
        req.on("timeout", () => {
            req.destroy(new Error("Koneksi Binance timeout."));
        });
        req.on("error", reject);
        if (body) req.write(body);
        req.end();
    });
}

function binanceCredentialsForNumber(nomor) {
    const normalized = String(nomor || "").replace(/\D/g, "");
    if (!penggunaPunyaAksesBinance(normalized)) return null;
    if (!BINANCE_API_KEY || !BINANCE_API_SECRET) return null;
    return { apiKey: BINANCE_API_KEY, apiSecret: BINANCE_API_SECRET };
}

async function binanceSignedRequest(path, params = {}, creds) {
    const query = new URLSearchParams({
        ...params,
        recvWindow: String(BINANCE_RECV_WINDOW),
        timestamp: String(Date.now())
    }).toString();
    const signature = crypto.createHmac("sha256", creds.apiSecret).update(query).digest("hex");
    const url = `${BINANCE_BASE_URL}${path}?${query}&signature=${signature}`;
    return requestJsonHttps("GET", url, { "X-MBX-APIKEY": creds.apiKey });
}

const STABLE_USDT_ASSETS = new Set(["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "DAI"]);

async function ambilHargaUSDTBinance(asset) {
    const symbol = String(asset || "").toUpperCase();
    if (!symbol) return null;
    if (STABLE_USDT_ASSETS.has(symbol)) return 1;
    if (symbol === "IDR") return null;
    try {
        const data = await requestJsonHttps("GET", `${BINANCE_BASE_URL}/api/v3/ticker/price?symbol=${encodeURIComponent(symbol + "USDT")}`, {}, null, 8000);
        const price = Number(data.price);
        return Number.isFinite(price) && price > 0 ? price : null;
    } catch {
        return null;
    }
}

async function ambilSaldoBinanceUntukNomor(nomor, opsi = {}) {
    const normalized = String(nomor || "").replace(/\D/g, "");
    if (!penggunaPunyaAksesBinance(normalized)) {
        return {
            available:false,
            allowed:false,
            configured:false,
            owner:maskNomor(normalized),
            message:`Integrasi Binance hanya diaktifkan untuk nomor ${maskNomor(BINANCE_BALANCE_NUMBER)}.`
        };
    }
    const creds = binanceCredentialsForNumber(normalized);
    if (!creds) {
        return {
            available:false,
            allowed:true,
            configured:false,
            owner:maskNomor(normalized),
            message:`API Binance belum disetel. Isi BINANCE_API_KEY_${BINANCE_BALANCE_NUMBER} dan BINANCE_API_SECRET_${BINANCE_BALANCE_NUMBER} di environment.`
        };
    }

    const cacheKey = normalized;
    const cached = binanceBalanceCache[cacheKey];
    if (!opsi.force && cached && Date.now() - cached.at < BINANCE_CACHE_TTL) return cached.data;

    try {
        const account = await binanceSignedRequest("/api/v3/account", {}, creds);
        const balances = Array.isArray(account.balances) ? account.balances : [];
        const nonZero = balances
            .map(item => {
                const free = Number(item.free || 0);
                const locked = Number(item.locked || 0);
                return { asset:String(item.asset || "").toUpperCase(), free, locked, total:free + locked };
            })
            .filter(item => item.asset && item.total > 0)
            .sort((a,b) => b.total - a.total);

        const priced = await Promise.all(nonZero.slice(0, 60).map(async item => {
            const priceUSDT = await ambilHargaUSDTBinance(item.asset);
            const estimatedUSDT = priceUSDT ? item.total * priceUSDT : null;
            return { ...item, priceUSDT, estimatedUSDT };
        }));
        const estimatedUSDT = priced.reduce((sum, item) => sum + (Number.isFinite(item.estimatedUSDT) ? item.estimatedUSDT : 0), 0);
        const unknownValueAssets = priced.filter(item => !Number.isFinite(item.estimatedUSDT)).map(item => item.asset);
        const result = {
            available:true,
            allowed:true,
            configured:true,
            owner:maskNomor(normalized),
            updatedAt:new Date().toLocaleString("id-ID", { timeZone:APP_TIMEZONE }),
            estimatedUSDT,
            assetCount:priced.length,
            unknownValueAssets,
            assets:priced
        };
        binanceBalanceCache[cacheKey] = { at:Date.now(), data:result };
        return result;
    } catch(e) {
        return {
            available:false,
            allowed:true,
            configured:true,
            owner:maskNomor(normalized),
            message:`Saldo Binance belum bisa dimuat: ${e.message || e}`,
            updatedAt:new Date().toLocaleString("id-ID", { timeZone:APP_TIMEZONE })
        };
    }
}

async function buatRingkasanSaldoBinance(jid) {
    const nomor = ambilNomorDariJid(jid);
    const [lapSemua, binance] = await Promise.all([
        buatLaporanKeuangan("semua", jid),
        ambilSaldoBinanceUntukNomor(nomor, { force:true })
    ]);
    let teks =
`💎 *SALDO REALTIME*

🧮 *Saldo bot:* Rp ${formatRupiah(lapSemua.saldo)}
👤 Nomor: ${maskNomor(nomor)}`;

    if (!binance.available) {
        teks += `

🏦 *Binance:* belum aktif
${binance.message || "API belum tersedia."}`;
        return teks;
    }

    teks += `

🏦 *Binance realtime*
Estimasi nilai: *${Number(binance.estimatedUSDT || 0).toLocaleString("id-ID", { maximumFractionDigits:2 })} USDT*
Jumlah aset: ${binance.assetCount}
Update: ${binance.updatedAt}`;
    const topAssets = (binance.assets || [])
        .slice()
        .sort((a,b) => (b.estimatedUSDT || 0) - (a.estimatedUSDT || 0))
        .slice(0, 8);
    if (topAssets.length) {
        teks += `

📌 *Aset utama:*`;
        for (const asset of topAssets) {
            const est = Number.isFinite(asset.estimatedUSDT) ? ` ≈ ${asset.estimatedUSDT.toLocaleString("id-ID", { maximumFractionDigits:2 })} USDT` : "";
            teks += `
• ${asset.asset}: ${asset.total.toLocaleString("id-ID", { maximumFractionDigits:8 })}${est}`;
        }
    }
    if (binance.unknownValueAssets?.length) teks += `

ℹ️ Sebagian aset belum memiliki pasangan USDT: ${binance.unknownValueAssets.slice(0,8).join(", ")}.`;
    teks += `

Ketik *dashboard web* untuk melihat tampilan liquid glass dan laporan Excel.`;
    return teks;
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
    pastikanKonfigurasiSpreadsheet();
    return new JWT({
        email: serviceAccount.client_email,
        key:   String(serviceAccount.private_key || "").replace(/\\n/g,"\n"),
        scopes:["https://www.googleapis.com/auth/spreadsheets"]
    });
}

async function getGoogleDoc(forceRefresh = false) {
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
    teks += "\n\nKetik *laporan* atau *riwayat* jika ingin melihat detail transaksi.";
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
    const lap = await buatLaporanKeuangan("bulan", jid);
    const now = sekarangWita();
    const hariBerjalan = Math.max(1, now.getDate());
    const hariDalamBulan = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const sisaHari = Math.max(1, hariDalamBulan - hariBerjalan);
    const proyeksiKeluar = Math.round((lap.totalKeluar / hariBerjalan) * hariDalamBulan);
    const proyeksiMasuk = Math.round((lap.totalMasuk / hariBerjalan) * hariDalamBulan);
    const proyeksiSaldo = proyeksiMasuk - proyeksiKeluar;
    const batasHarianAman = Math.max(0, Math.round((lap.totalMasuk - lap.totalKeluar) / sisaHari));

    const rows = [
        { item:"Hari berjalan", nilai:`${hariBerjalan}/${hariDalamBulan}` },
        { item:"Keluar saat ini", nilai:`Rp ${formatRupiah(lap.totalKeluar)}` },
        { item:"Proyeksi keluar", nilai:`Rp ${formatRupiah(proyeksiKeluar)}` },
        { item:"Proyeksi saldo", nilai:`Rp ${formatRupiah(proyeksiSaldo)}` },
        { item:"Batas harian", nilai:`Rp ${formatRupiah(batasHarianAman)}` }
    ];

    let teks = `🔮 *PREDIKSI CASHFLOW BULAN INI*\n\n`;
    teks += buatTabelWhatsapp([
        { key:"item", label:"Indikator", width:16 },
        { key:"nilai", label:"Nilai", width:18, align:"right" }
    ], rows, { title:"Estimasi Otomatis" });

    try {
        const prompt = `Beri 3 saran singkat Bahasa Indonesia berdasarkan prediksi keuangan ini: ${JSON.stringify({
            totalMasuk: lap.totalMasuk,
            totalKeluar: lap.totalKeluar,
            saldo: lap.saldo,
            detailKategori: lap.detailKategori,
            proyeksiKeluar,
            proyeksiSaldo,
            batasHarianAman
        })}. Jawab max 120 kata, praktis, tidak menghakimi.`;
        const saran = await panggilAI(prompt, { maxRetry: 1, jedaAwal: 1000 });
        teks += `\n\n🤖 *Saran AI*\n${saran}`;
    } catch {
        teks += "\n\n💡 Jaga pengeluaran harian di bawah batas harian agar saldo akhir bulan tetap aman.";
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

// ── EXPORT LAPORAN ────────────────────────────────────────────
function buatBarExcel(label, value, total, color = "#2f7df6") {
    const percent = total > 0 ? Math.round((Number(value || 0) / total) * 100) : 0;
    return `<tr><td>${escapeHtml(label)}</td><td>${Number(value || 0)}</td><td>${percent}%</td><td><div style="width:220px;background:#edf2ff;border-radius:12px;overflow:hidden"><div style="height:16px;width:${Math.min(percent,100)}%;background:${color};border-radius:12px"></div></div></td></tr>`;
}

function buatExcelHtmlLaporan({ title, label, lap, finance = null, binance = null, generatedAt = "" }) {
    const kategoriRows = Object.entries(lap.detailKategori || {}).sort((a,b)=>b[1]-a[1]);
    const kategoriTotal = kategoriRows.reduce((sum, [,amount]) => sum + Number(amount || 0), 0);
    const transaksiRows = (lap.transaksi || []).map(trx => `
        <tr>
            <td>${escapeHtml(trx.tanggalLengkap || trx.tanggal || "")}</td>
            <td>${escapeHtml(trx.jenis || "")}</td>
            <td>${escapeHtml(trx.kategori || "")}</td>
            <td>${Number(trx.nominal || 0)}</td>
            <td>${escapeHtml(trx.keterangan || "")}</td>
            <td>${escapeHtml(String(trx.dompet || "").toUpperCase())}</td>
            <td>${Number(trx.saldo || 0)}</td>
        </tr>`).join("");
    const walletRows = finance?.wallets?.length ? finance.wallets.map(w => `<tr><td>${escapeHtml(w.name)}</td><td>${Number(w.balance || 0)}</td></tr>`).join("") : "";
    const binanceRows = binance?.available && Array.isArray(binance.assets)
        ? binance.assets.map(asset => `<tr><td>${escapeHtml(asset.asset)}</td><td>${Number(asset.free || 0)}</td><td>${Number(asset.locked || 0)}</td><td>${Number(asset.total || 0)}</td><td>${asset.priceUSDT ? Number(asset.priceUSDT) : ""}</td><td>${Number.isFinite(asset.estimatedUSDT) ? Number(asset.estimatedUSDT) : ""}</td></tr>`).join("")
        : `<tr><td colspan="6">${escapeHtml(binance?.message || "Binance belum aktif untuk laporan ini.")}</td></tr>`;
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
body{font-family:Segoe UI,Arial,sans-serif;color:#172033;background:#ffffff}h1{font-size:24px;color:#1d4ed8;margin:0 0 8px}h2{font-size:17px;color:#0f766e;margin:22px 0 8px}.muted{color:#64748b}.kpi td{font-size:15px;border:1px solid #dbeafe;padding:10px}.kpi .label{background:#eff6ff;font-weight:700}.kpi .value{font-weight:800}table{border-collapse:collapse;margin:8px 0 18px;width:100%}th{background:#1d4ed8;color:#fff;padding:9px;border:1px solid #1e40af;text-align:left}td{padding:8px;border:1px solid #dbe3ef}tr:nth-child(even) td{background:#f8fbff}.section{border:1px solid #dbeafe;border-radius:12px;padding:12px;margin-bottom:14px}.bar-title{font-weight:700;color:#334155}.green{color:#047857}.red{color:#b91c1c}.blue{color:#1d4ed8}</style>
</head><body>
<h1>${escapeHtml(title || "Laporan Keuangan")}</h1>
<div class="muted">Periode: ${escapeHtml(label)} | Dibuat: ${escapeHtml(generatedAt)}</div>
<table class="kpi"><tr><td class="label">Total Pemasukan</td><td class="value green">${Number(lap.totalMasuk || 0)}</td><td class="label">Total Pengeluaran</td><td class="value red">${Number(lap.totalKeluar || 0)}</td></tr><tr><td class="label">Saldo Periode</td><td class="value blue">${Number(lap.saldo || 0)}</td><td class="label">Saldo Akumulasi/Bot</td><td class="value blue">${Number(lap.saldoAkumulasi ?? lap.saldo ?? 0)}</td></tr><tr><td class="label">Jumlah Transaksi</td><td>${(lap.transaksi || []).length}</td><td class="label">Estimasi Binance USDT</td><td>${binance?.available ? Number(binance.estimatedUSDT || 0) : "Belum aktif"}</td></tr></table>
<h2>Diagram Modern Kategori Pengeluaran</h2>
<table><tr><th>Kategori</th><th>Nominal</th><th>Persentase</th><th>Visual Bar</th></tr>${kategoriRows.map(([name, amount]) => buatBarExcel(name, amount, kategoriTotal, metaKategori(name).color || "#2f7df6")).join("") || "<tr><td colspan=\"4\">Belum ada kategori pada periode ini.</td></tr>"}</table>
<h2>Saldo Dompet Bot</h2><table><tr><th>Dompet</th><th>Saldo</th></tr>${walletRows || "<tr><td colspan=\"2\">Tidak ada data dompet.</td></tr>"}</table>
<h2>Saldo Binance Realtime</h2><table><tr><th>Aset</th><th>Free</th><th>Locked</th><th>Total</th><th>Harga USDT</th><th>Estimasi USDT</th></tr>${binanceRows}</table>
<h2>Data Transaksi Lengkap</h2><table><tr><th>Tanggal</th><th>Jenis</th><th>Kategori</th><th>Nominal</th><th>Keterangan</th><th>Dompet</th><th>Saldo Dompet</th></tr>${transaksiRows || "<tr><td colspan=\"7\">Tidak ada transaksi pada periode ini.</td></tr>"}</table>
</body></html>`;
}

async function eksporLaporan(tipe, jid, opsi = {}) {
    const lap = await buatLaporanKeuangan(tipe, jid, opsi);
    const now = new Date().toLocaleString("id-ID",{timeZone:APP_TIMEZONE});
    const tanggalFile = tanggalHariIni().split("/").reverse().join("-");
    const label = lap.periode?.label || labelPeriode(tipe);
    const namaPeriode = label.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "periode";
    const nomor = ambilNomorDariJid(jid);
    const binance = await ambilSaldoBinanceUntukNomor(nomor);
    const finance = { wallets:Object.entries(lap.saldoDompet || {}).map(([name, balance]) => ({ name:String(name).toUpperCase(), balance })) };
    const html = "\uFEFF" + buatExcelHtmlLaporan({ title:"Laporan Bot Keuangan WA", label, lap, finance, binance, generatedAt:now });
    const caption =
`📤 *EXPORT EXCEL ${label.toUpperCase()}*

📊 ${lap.transaksi.length} transaksi
🟢 Masuk: Rp ${formatRupiah(lap.totalMasuk)}
🔴 Keluar: Rp ${formatRupiah(lap.totalKeluar)}
💰 Saldo periode: Rp ${formatRupiah(lap.saldo)}
🏦 Tabungan akumulasi: Rp ${formatRupiah(lap.saldoAkumulasi)}
💎 Binance: ${binance.available ? `${Number(binance.estimatedUSDT || 0).toLocaleString("id-ID", { maximumFractionDigits:2 })} USDT` : "belum aktif"}
🕒 Dibuat: ${now}

File Excel berisi ringkasan, diagram kategori, saldo dompet, saldo Binance, dan transaksi lengkap.`;

    return {
        document: Buffer.from(html, "utf8"),
        mimetype: "application/vnd.ms-excel",
        fileName: `laporan-keuangan-${namaPeriode}-${tanggalFile}.xls`,
        caption
    };
}

async function buatExportExcelDashboard(akses, nomorDipilih = "", periodeDipilih = "") {
    const nomor = nomorTargetDashboard(akses, { searchParams:new URLSearchParams(nomorDipilih ? { nomor:nomorDipilih } : {}) });
    const periodeAktif = parsePeriodeKey(periodeDipilih);
    const ownerJid = `${nomor}@s.whatsapp.net`;
    const [lap, lapSemua, binance] = await Promise.all([
        buatLaporanKeuangan(periodeAktif.tipe, ownerJid, periodeAktif),
        buatLaporanKeuangan("semua", ownerJid),
        ambilSaldoBinanceUntukNomor(nomor, { force:true })
    ]);
    const finance = { wallets:Object.entries(lapSemua.saldoDompet || {}).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])).map(([name, balance]) => ({ name:String(name).toUpperCase(), balance })) };
    const now = new Date().toLocaleString("id-ID", { timeZone:APP_TIMEZONE });
    const html = "\uFEFF" + buatExcelHtmlLaporan({ title:"Laporan Dashboard Bot Keuangan WA", label:periodeAktif.label, lap, finance, binance, generatedAt:now });
    const fileSafe = periodeAktif.label.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "periode";
    return {
        buffer:Buffer.from(html, "utf8"),
        fileName:`laporan-dashboard-${maskNomor(nomor).replace(/[^0-9a-z]+/gi, "")}-${fileSafe}.xls`
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
async function analisisAIKeuangan(lap, tipe="bulan") {
    const ringkasan = {
        periode:        tipe,
        totalMasuk:     lap.totalMasuk,
        totalKeluar:    lap.totalKeluar,
        saldo:          lap.saldo,
        detailKategori: lap.detailKategori
    };

    const prompt =
`Kamu adalah konsultan keuangan pribadi yang bijak dan ramah.
Analisis data keuangan berikut dan berikan insight dalam Bahasa Indonesia:

${JSON.stringify(ringkasan, null, 2)}

Berikan:
1. Ringkasan kondisi keuangan (1-2 kalimat)
2. Kategori pengeluaran tertinggi dan saran penghematannya
3. Apakah kondisi keuangan sehat? (pemasukan vs pengeluaran)
4. 2-3 tips konkret untuk bulan depan

Gunakan emoji yang sesuai. Jawab max 300 kata. Nada: hangat, tidak menghakimi, memotivasi.`;

    try {
        return await panggilAI(prompt);
    } catch (e) {
        logFallbackAISekali("Analisis keuangan");
        // Fallback manual berdasarkan data
        const kondisi = lap.saldo >= 0 ? "positif 🟢" : "defisit 🔴";
        const terboros = Object.entries(lap.detailKategori).sort((a,b)=>b[1]-a[1])[0];
        return (
`📊 *Ringkasan Keuangan (Mode Offline)*

Kondisi saldo kamu saat ini *${kondisi}*.
🟢 Pemasukan : Rp ${formatRupiah(lap.totalMasuk)}
🔴 Pengeluaran: Rp ${formatRupiah(lap.totalKeluar)}
💰 Saldo Bersih: Rp ${formatRupiah(lap.saldo)}

${terboros ? `🏷️ Pengeluaran terbesar: *${terboros[0]}* (Rp ${formatRupiah(terboros[1])})` : ""}

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
    const konteks = {
        bulanIni: {
            totalMasuk: lapBulan.totalMasuk,
            totalKeluar: lapBulan.totalKeluar,
            saldo: lapBulan.saldo,
            detailKategori: lapBulan.detailKategori
        },
        saldoDompet: lapSemua.saldoDompet,
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
Jawab pertanyaan user dengan data berikut.
Gunakan Bahasa Indonesia, ringkas, jelas, praktis, dan jika perlu beri langkah aksi.
Jika data belum cukup, katakan apa data yang perlu dicatat.

DATA:
${JSON.stringify(konteks, null, 2)}

PERTANYAAN USER:
${pertanyaan}

Format jawaban:
- Mulai dengan kesimpulan singkat
- Maksimal 5 bullet
- Akhiri dengan 1 aksi yang bisa dilakukan hari ini`;

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
    const tips = [];
    if (overCount) tips.push(`${overCount} budget sudah melewati limit. Prioritaskan kategori dengan persentase tertinggi.`);
    if (watchCount) tips.push(`${watchCount} budget mendekati limit dan perlu dipantau sampai akhir bulan.`);
    if (savingsRatio < 10 && lapBulan.totalMasuk > 0) tips.push("Rasio sisa di bawah 10%. Tahan pengeluaran gaya hidup untuk menjaga arus kas.");
    if (comparison.expenseChange !== null && comparison.expenseChange > 15) tips.push(`Pengeluaran naik ${comparison.expenseChange}% dibanding bulan lalu.`);
    if (!tips.length) tips.push("Arus kas dan budget masih terkendali. Pertahankan pencatatan transaksi secara rutin.");
    return {
        healthScore,
        healthLabel:healthScore >= 80 ? "Sangat baik" : healthScore >= 65 ? "Sehat" : healthScore >= 45 ? "Perlu perhatian" : "Berisiko",
        savingsRatio,
        dailySafeSpend,
        budget:{ total:totalBudget, used:usedBudget, remaining:totalBudget-usedBudget, overCount, watchCount },
        groups:Object.entries(groupMap).sort((a,b)=>b[1]-a[1]).map(([name, amount]) => ({ name, amount })),
        comparison,
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
        integrations: null,
        finance: null,
        commands: [
            { cmd:"dashboard", desc:"Ringkasan pintar di WhatsApp" },
            { cmd:"laporan bulan ini", desc:"Laporan tabel periode berjalan" },
            { cmd:"laporan Mei 2026", desc:"Laporan lengkap bulan sebelumnya" },
            { cmd:"laporan tahunan 2026", desc:"Rekap dan transaksi setahun" },
            { cmd:"saldo", desc:"Rekap semua waktu" },
            { cmd:"riwayat bulan lalu", desc:"Riwayat periode sebelumnya" },
            { cmd:"riwayat 20", desc:"20 transaksi terakhir" },
            { cmd:"budget", desc:"Monitor anggaran" },
            { cmd:"set budget Konsumsi 2jt", desc:"Ubah limit kategori" },
            { cmd:"kategori", desc:"Lihat katalog kategori pintar" },
            { cmd:"prediksi", desc:"Estimasi cashflow" },
            { cmd:"analisis", desc:"Insight AI bulanan" },
            { cmd:"cari makan", desc:"Cari transaksi cocok" },
            { cmd:"export Mei 2026", desc:"Unduh Excel periode historis" },
            { cmd:"saldo binance", desc:"Saldo bot + Binance realtime khusus nomor terhubung" }
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
        base.integrations = { binance: await ambilSaldoBinanceUntukNomor(nomorAktif) };
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

        base.finance = {
            available: true,
            period: bulan,
            periodType:periodeAktif.tipe,
            periodKey:periodeAktif.key,
            owner: maskNomor(nomorAktif),
            binance: base.integrations.binance,
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
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Liquid Finance Dashboard</title>
<style>
  *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;min-height:100vh;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#13213a;background:radial-gradient(circle at 10% 10%,rgba(107,213,255,.55),transparent 28%),radial-gradient(circle at 84% 8%,rgba(255,164,214,.45),transparent 28%),radial-gradient(circle at 44% 92%,rgba(128,255,200,.40),transparent 26%),linear-gradient(135deg,#f8fbff 0%,#eef6ff 44%,#fff6fb 100%);overflow-x:hidden}body:before{content:"";position:fixed;inset:-80px;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180' viewBox='0 0 180 180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='.13'/%3E%3C/svg%3E");pointer-events:none;mix-blend-mode:soft-light}button,input,select,textarea{font:inherit}button{cursor:pointer}.app{min-height:100vh;display:grid;grid-template-columns:300px 1fr;position:relative;transition:grid-template-columns .25s ease}.app.collapsed{grid-template-columns:92px 1fr}.sidebar{position:sticky;top:0;height:100vh;padding:18px;display:flex;flex-direction:column;gap:16px;border-right:1px solid rgba(255,255,255,.48);background:linear-gradient(160deg,rgba(255,255,255,.68),rgba(255,255,255,.28));backdrop-filter:blur(26px) saturate(170%);box-shadow:20px 0 60px rgba(90,120,160,.14);z-index:20;transition:width .25s ease,transform .25s ease}.brand{display:flex;gap:12px;align-items:center;padding:10px;border-radius:24px;background:rgba(255,255,255,.50);border:1px solid rgba(255,255,255,.64)}.logo{width:48px;height:48px;border-radius:18px;display:grid;place-items:center;background:linear-gradient(135deg,#43c6ff,#8d7cff 48%,#ff8cc6);color:#fff;font-size:24px;box-shadow:0 16px 34px rgba(76,115,255,.26)}.brand h1{font-size:1rem;margin:0;line-height:1.1}.brand span{display:block;color:#6c7d98;font-size:.76rem;margin-top:4px}.nav{display:grid;gap:8px}.nav a,.side-button{border:1px solid rgba(255,255,255,.62);background:rgba(255,255,255,.42);color:#24324a;text-decoration:none;border-radius:18px;padding:12px 12px;font-weight:850;display:flex;align-items:center;gap:10px;box-shadow:0 10px 24px rgba(62,90,130,.07)}.nav a:hover,.side-button:hover{transform:translateY(-1px);background:rgba(255,255,255,.72)}.nav .dot{width:10px;height:10px;border-radius:999px;background:linear-gradient(135deg,#21d4fd,#b721ff);flex:none}.side-footer{margin-top:auto;padding:14px;border-radius:22px;background:rgba(255,255,255,.42);border:1px solid rgba(255,255,255,.6);color:#60718c;font-size:.82rem}.side-footer b{color:#24324a}.sidebar.collapsed{width:92px}.sidebar.collapsed .brand h1,.sidebar.collapsed .nav span,.sidebar.collapsed .side-footer,.sidebar.collapsed .side-button span{display:none}.sidebar.collapsed .brand,.sidebar.collapsed .nav a,.sidebar.collapsed .side-button{justify-content:center}.main{padding:22px clamp(14px,3vw,34px) 40px;min-width:0}.topbar{position:sticky;top:0;z-index:10;margin:-22px clamp(-34px,-3vw,-14px) 18px;padding:16px clamp(14px,3vw,34px);display:flex;justify-content:space-between;align-items:center;gap:14px;background:rgba(250,253,255,.62);border-bottom:1px solid rgba(255,255,255,.62);backdrop-filter:blur(22px) saturate(160%)}.top-left{display:flex;gap:12px;align-items:center}.round{width:44px;height:44px;border-radius:16px;border:1px solid rgba(255,255,255,.72);background:rgba(255,255,255,.58);box-shadow:0 12px 28px rgba(52,90,140,.12);display:grid;place-items:center;font-weight:900;color:#315179}.title h2{margin:0;font-size:clamp(1.1rem,2.2vw,1.7rem)}.title p{margin:3px 0 0;color:#63738c;font-size:.88rem}.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.glass-input,.glass-select{border:1px solid rgba(255,255,255,.82);background:rgba(255,255,255,.60);border-radius:16px;padding:11px 12px;color:#1c2a44;outline:none;box-shadow:0 10px 22px rgba(62,90,130,.08)}.glass-input:focus,.glass-select:focus{box-shadow:0 0 0 4px rgba(91,141,255,.16)}.btn{border:1px solid rgba(255,255,255,.78);border-radius:16px;padding:11px 14px;font-weight:900;color:#24324a;background:rgba(255,255,255,.62);box-shadow:0 12px 26px rgba(62,90,130,.10);transition:.18s ease}.btn:hover{transform:translateY(-1px);box-shadow:0 16px 32px rgba(62,90,130,.15)}.btn.primary{background:linear-gradient(135deg,#2f7df6,#8b5cf6);color:white;border-color:transparent}.btn.green{background:linear-gradient(135deg,#00b894,#2dd4bf);color:white;border-color:transparent}.btn.pink{background:linear-gradient(135deg,#ff7eb3,#ff758c);color:white;border-color:transparent}.btn.danger{background:rgba(255,236,241,.85);color:#bf1745}.hero{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(300px,.9fr);gap:18px;margin-bottom:18px}.hero-card{position:relative;overflow:hidden;border-radius:34px;padding:24px;background:linear-gradient(135deg,rgba(255,255,255,.74),rgba(255,255,255,.34));border:1px solid rgba(255,255,255,.72);backdrop-filter:blur(24px) saturate(175%);box-shadow:0 24px 60px rgba(56,90,130,.16)}.hero-card:after{content:"";position:absolute;right:-80px;top:-80px;width:250px;height:250px;border-radius:50%;background:radial-gradient(circle,rgba(54,162,255,.35),transparent 70%)}.hero-card h3{margin:0 0 8px;font-size:clamp(1.35rem,3vw,2.35rem);letter-spacing:-.03em}.hero-card p{margin:0;color:#5f708b;max-width:720px;line-height:1.55}.hero-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.status-pill{display:inline-flex;align-items:center;gap:8px;margin-bottom:12px;padding:8px 12px;border-radius:999px;background:rgba(255,255,255,.64);border:1px solid rgba(255,255,255,.75);font-weight:900;color:#2f4770}.pulse{width:10px;height:10px;border-radius:50%;background:#1cc88a;box-shadow:0 0 0 6px rgba(28,200,138,.15)}.stats-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:18px}.card{border-radius:28px;padding:18px;background:rgba(255,255,255,.56);border:1px solid rgba(255,255,255,.74);backdrop-filter:blur(22px) saturate(170%);box-shadow:0 18px 44px rgba(56,90,130,.12);min-width:0}.metric{display:grid;gap:8px}.metric .label{font-size:.78rem;font-weight:900;color:#6b7a94;text-transform:uppercase;letter-spacing:.06em}.metric .value{font-size:clamp(1.12rem,2.2vw,1.78rem);font-weight:950;letter-spacing:-.03em;word-break:break-word}.metric .hint{color:#71819a;font-size:.84rem}.value.blue{color:#2563eb}.value.green{color:#059669}.value.red{color:#dc2626}.value.purple{color:#7c3aed}.section-grid{display:grid;grid-template-columns:minmax(0,1.18fr) minmax(320px,.82fr);gap:18px;margin-bottom:18px}.section-grid.equal{grid-template-columns:1fr 1fr}.panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}.panel-head h3{margin:0;font-size:1.06rem}.subtle{color:#687893;font-size:.84rem;margin-top:3px}.canvas-wrap{height:270px;position:relative}.list{display:grid;gap:10px}.row-card{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:12px;border-radius:18px;background:rgba(255,255,255,.45);border:1px solid rgba(255,255,255,.6)}.row-card b{font-size:.92rem}.bar{height:9px;border-radius:999px;background:rgba(126,144,180,.16);overflow:hidden;margin-top:8px}.bar i{display:block;height:100%;width:0%;border-radius:999px;background:linear-gradient(90deg,#2f7df6,#7c3aed,#ff7eb3)}.table-wrap{overflow:auto;border-radius:20px;border:1px solid rgba(255,255,255,.62)}table{width:100%;border-collapse:collapse;min-width:780px;background:rgba(255,255,255,.38)}th,td{padding:12px 13px;border-bottom:1px solid rgba(215,226,242,.78);text-align:left;font-size:.88rem}th{position:sticky;top:0;background:rgba(248,252,255,.88);backdrop-filter:blur(12px);font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:#64748b}td.amount{font-weight:950;white-space:nowrap}.tag{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:6px 10px;font-size:.76rem;font-weight:900;background:rgba(255,255,255,.64);border:1px solid rgba(255,255,255,.74)}.tag.in{color:#047857}.tag.out{color:#be123c}.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.field{display:grid;gap:6px}.field label{font-size:.78rem;font-weight:900;color:#5c6d88}.field.full{grid-column:1/-1}.hidden{display:none!important}.toast{position:fixed;right:18px;bottom:18px;z-index:99;padding:13px 15px;border-radius:18px;background:rgba(20,31,52,.88);color:white;box-shadow:0 20px 40px rgba(20,31,52,.24);transform:translateY(20px);opacity:0;transition:.2s}.toast.show{opacity:1;transform:none}.lock{min-height:100vh;display:none;place-items:center;padding:20px}.lock.show{display:grid}.lock-card{max-width:460px;width:100%;border-radius:30px;padding:24px;background:rgba(255,255,255,.70);border:1px solid rgba(255,255,255,.78);backdrop-filter:blur(22px);box-shadow:0 24px 60px rgba(56,90,130,.17)}.lock-card h2{margin:0 0 8px}.empty{padding:18px;border-radius:18px;background:rgba(255,255,255,.42);color:#6d7b92;text-align:center}.admin-only{display:none}.admin .admin-only{display:block}.mobile-overlay{display:none;position:fixed;inset:0;background:rgba(18,30,50,.28);z-index:15}.mobile-overlay.show{display:block}.binance-good{background:linear-gradient(135deg,rgba(254,240,138,.56),rgba(167,243,208,.45));}.binance-off{background:linear-gradient(135deg,rgba(248,250,252,.7),rgba(226,232,240,.45));}.asset-grid{display:grid;gap:9px}.asset{display:grid;grid-template-columns:64px 1fr auto;gap:10px;align-items:center;padding:10px;border-radius:16px;background:rgba(255,255,255,.46);border:1px solid rgba(255,255,255,.65)}.asset .coin{font-weight:950;color:#d97706}.asset small{color:#6b7a94}.command-chip{display:inline-flex;margin:4px;padding:8px 10px;border-radius:999px;background:rgba(255,255,255,.50);border:1px solid rgba(255,255,255,.72);font-size:.8rem;font-weight:850}@media (max-width:1180px){.stats-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.hero,.section-grid,.section-grid.equal{grid-template-columns:1fr}}@media (max-width:820px){.app{grid-template-columns:1fr}.sidebar{position:fixed;left:0;top:0;bottom:0;width:min(84vw,310px);transform:translateX(-104%)}.sidebar.mobile-open{transform:none}.sidebar.collapsed{width:min(84vw,310px)}.sidebar.collapsed .brand h1,.sidebar.collapsed .nav span,.sidebar.collapsed .side-footer,.sidebar.collapsed .side-button span{display:block}.main{padding:14px}.topbar{margin:-14px -14px 14px;padding:12px 14px}.toolbar{width:100%;display:grid;grid-template-columns:1fr 1fr}.toolbar .btn,.toolbar select{width:100%}.title p{font-size:.78rem}.stats-grid{grid-template-columns:1fr}.hero-card{border-radius:26px;padding:18px}.card{border-radius:24px;padding:15px}.form-grid{grid-template-columns:1fr}.canvas-wrap{height:220px}.asset{grid-template-columns:54px 1fr}.asset .est{grid-column:2/-1}.top-left{min-width:0}.round{width:40px;height:40px}.mobile-hide{display:none!important}}
</style>
</head>
<body>
<div id="lock" class="lock"><div class="lock-card"><div class="status-pill"><span class="pulse"></span>Akses aman</div><h2>Masukkan token dashboard</h2><p class="subtle">Gunakan link dashboard dari WhatsApp. Jika token tidak terbaca, tempel token akses di bawah ini.</p><form id="token-form" class="list"><input id="token-input" class="glass-input" placeholder="Token akses"><button class="btn primary" type="submit">Buka Dashboard</button></form></div></div>
<div id="mobile-overlay" class="mobile-overlay"></div>
<div id="app" class="app hidden">
  <aside id="sidebar" class="sidebar">
    <div class="brand"><div class="logo">💧</div><div><h1>Liquid Finance</h1><span>Bot WA + Binance Realtime</span></div></div>
    <button id="collapse-btn" class="side-button" type="button">☰ <span>Sembunyikan Menu</span></button>
    <nav class="nav">
      <a href="#overview"><span class="dot"></span><span>Overview</span></a>
      <a href="#binance"><span class="dot"></span><span>Bot & Binance</span></a>
      <a href="#analytics"><span class="dot"></span><span>Analitik</span></a>
      <a href="#reports"><span class="dot"></span><span>Laporan</span></a>
      <a href="#transactions"><span class="dot"></span><span>Transaksi</span></a>
      <a href="#settings"><span class="dot"></span><span>Integrasi</span></a>
    </nav>
    <div class="side-footer"><b id="side-owner">-</b><br><span id="side-time">Memuat...</span><br><br><span id="side-status">Status sistem</span></div>
  </aside>
  <main class="main">
    <div class="topbar">
      <div class="top-left"><button id="mobile-menu" class="round" type="button">☰</button><div class="title"><h2>Dashboard Keuangan Modern</h2><p id="subtitle">Terintegrasi dengan spreadsheet, bot WhatsApp, dan Binance.</p></div></div>
      <div class="toolbar"><select id="user-select" class="glass-select admin-only"></select><select id="period-select" class="glass-select"></select><button id="refresh-btn" class="btn">↻ Refresh</button><button id="excel-btn" class="btn green">Export Excel</button></div>
    </div>
    <section id="overview" class="hero">
      <div class="hero-card"><div class="status-pill"><span id="live-dot" class="pulse"></span><span id="status-label">Realtime</span></div><h3 id="hero-title">Kelola saldo dengan tampilan liquid glass.</h3><p id="hero-copy">Semua data bot, dompet, transaksi, kategori, budget, dan Binance ditarik dari satu dashboard yang lebih bersih dan responsif untuk HP.</p><div class="hero-actions"><button id="quick-fill-income" class="btn primary" type="button">+ Pemasukan</button><button id="quick-fill-expense" class="btn pink" type="button">+ Pengeluaran</button><a class="btn" href="#transactions">Lihat Transaksi</a></div></div>
      <div id="binance-mini" class="hero-card binance-off"><div class="status-pill">💎 Binance</div><h3 id="binance-estimate">Belum aktif</h3><p id="binance-message">Integrasi Binance khusus nomor 33827179200526. Isi API di environment agar saldo bisa dihitung realtime.</p><div id="binance-assets-mini" class="asset-grid" style="margin-top:14px"></div></div>
    </section>
    <section class="stats-grid">
      <div class="card metric"><span class="label">Saldo Bot</span><span id="kpi-balance" class="value blue">Rp 0</span><span id="kpi-balance-hint" class="hint">Semua dompet spreadsheet</span></div>
      <div class="card metric"><span class="label">Pemasukan Periode</span><span id="kpi-income" class="value green">Rp 0</span><span id="kpi-income-hint" class="hint">Data periode aktif</span></div>
      <div class="card metric"><span class="label">Pengeluaran Periode</span><span id="kpi-expense" class="value red">Rp 0</span><span id="kpi-expense-hint" class="hint">Data periode aktif</span></div>
      <div class="card metric"><span class="label">Skor Kesehatan</span><span id="kpi-health" class="value purple">0/100</span><span id="kpi-health-hint" class="hint">Belum ada data</span></div>
    </section>
    <section id="binance" class="section-grid equal">
      <div class="card"><div class="panel-head"><div><h3>Saldo Dompet Bot</h3><div class="subtle">Saldo dihitung dari setiap dompet di spreadsheet.</div></div></div><div id="wallet-list" class="list"></div></div>
      <div class="card"><div class="panel-head"><div><h3>Saldo Binance Realtime</h3><div class="subtle" id="binance-updated">Menunggu API...</div></div><button id="refresh-binance" class="btn" type="button">Refresh Binance</button></div><div id="binance-assets" class="asset-grid"></div></div>
    </section>
    <section id="analytics" class="section-grid">
      <div class="card"><div class="panel-head"><div><h3>Grafik Cashflow</h3><div class="subtle">Pemasukan vs pengeluaran per hari/periode.</div></div></div><div class="canvas-wrap"><canvas id="trend-chart"></canvas></div></div>
      <div class="card"><div class="panel-head"><div><h3>Kategori Terbesar</h3><div class="subtle">Pengeluaran paling dominan.</div></div></div><div id="category-list" class="list"></div></div>
    </section>
    <section id="reports" class="section-grid">
      <div class="card"><div class="panel-head"><div><h3>Laporan Modern</h3><div class="subtle">Ringkasan periode aktif dan rekomendasi otomatis.</div></div><button id="excel-btn-2" class="btn green" type="button">Download Excel</button></div><div id="tips-list" class="list"></div></div>
      <div class="card"><div class="panel-head"><div><h3>Budget</h3><div class="subtle">Progress limit kategori.</div></div></div><div id="budget-list" class="list"></div></div>
    </section>
    <section id="transactions" class="section-grid">
      <div class="card"><div class="panel-head"><div><h3>Tambah / Edit Transaksi</h3><div class="subtle">Data tersimpan langsung ke spreadsheet pengguna aktif.</div></div><button id="reset-form" class="btn" type="button">Reset</button></div><form id="trx-form" class="form-grid"><input id="editing-row" type="hidden"><div class="field"><label>Jenis</label><select id="trx-type" class="glass-select"><option>Pengeluaran</option><option>Pemasukan</option></select></div><div class="field"><label>Tanggal</label><input id="trx-date" class="glass-input" type="date" required></div><div class="field"><label>Nominal</label><input id="trx-amount" class="glass-input" type="number" min="1" required placeholder="25000"></div><div class="field"><label>Dompet</label><input id="trx-wallet" class="glass-input" placeholder="cash / bca / dana" value="cash"></div><div class="field full"><label>Kategori</label><select id="trx-category" class="glass-select"></select></div><div class="field full"><label>Keterangan</label><textarea id="trx-note" class="glass-input" rows="3" required placeholder="Contoh: beli makan siang"></textarea></div><div class="field full"><button id="save-trx" class="btn primary" type="submit">Simpan Transaksi</button></div></form></div>
      <div class="card"><div class="panel-head"><div><h3>Filter Cepat</h3><div class="subtle">Cari transaksi pada periode aktif.</div></div></div><div class="list"><input id="search-input" class="glass-input" placeholder="Cari catatan, kategori, dompet..."><select id="type-filter" class="glass-select"><option value="all">Semua jenis</option><option value="Pemasukan">Pemasukan</option><option value="Pengeluaran">Pengeluaran</option></select><div id="command-list"></div></div></div>
    </section>
    <section class="card"><div class="panel-head"><div><h3>Riwayat Transaksi</h3><div id="table-info" class="subtle">Data terbaru</div></div></div><div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Jenis</th><th>Kategori</th><th>Keterangan</th><th>Dompet</th><th>Nominal</th><th>Aksi</th></tr></thead><tbody id="transaction-body"></tbody></table></div></section>
    <section id="settings" class="section-grid equal"><div class="card"><h3>Integrasi Aktif</h3><div id="integration-list" class="list" style="margin-top:12px"></div></div><div class="card"><h3>Respons Bot yang Lebih Menarik</h3><p class="subtle">Gunakan perintah saldo, saldo binance, dashboard web, export bulan ini, analisis, prediksi, dan budget untuk respons yang lebih visual.</p></div></section>
  </main>
</div>
<div id="toast" class="toast"></div>
<script>
(function(){
  var $ = function(id){ return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var token = params.get("access") || params.get("token") || sessionStorage.getItem("dashboardAccess") || "";
  var current = null;
  var selectedPeriod = params.get("periode") || sessionStorage.getItem("dashboardPeriod") || "";
  var selectedNumber = params.get("nomor") || sessionStorage.getItem("dashboardNumber") || "";
  var collapsed = localStorage.getItem("liquidSidebarCollapsed") === "1";
  var chartColors = ["#2f7df6","#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444"];
  function rp(n){ return "Rp " + Number(n || 0).toLocaleString("id-ID"); }
  function num(n, d){ return Number(n || 0).toLocaleString("id-ID", { maximumFractionDigits:d || 0 }); }
  function usdt(n){ return Number(n || 0).toLocaleString("id-ID", { maximumFractionDigits:2 }) + " USDT"; }
  function txt(id, value){ var el=$(id); if(el) el.textContent = value; }
  function html(id, value){ var el=$(id); if(el) el.innerHTML = value; }
  function showToast(message){ var t=$("toast"); t.textContent = message; t.classList.add("show"); setTimeout(function(){ t.classList.remove("show"); }, 3200); }
  function apiHeaders(){ return token ? { "Content-Type":"application/json", "x-dashboard-access":token, "x-dashboard-token":token } : { "Content-Type":"application/json" }; }
  function openLock(){ $("lock").classList.add("show"); $("app").classList.add("hidden"); }
  function openApp(){ $("lock").classList.remove("show"); $("app").classList.remove("hidden"); }
  function queryString(){ var q = new URLSearchParams(); if(selectedPeriod) q.set("periode", selectedPeriod); if(selectedNumber) q.set("nomor", selectedNumber); return q.toString(); }
  function todayIso(){ var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"); }
  function escapeText(value){ return String(value == null ? "" : value).replace(/[&<>"']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\\\"":"&quot;","'":"&#39;"}[c]; }); }
  function periodOptions(data){ var sel=$("period-select"); var report=data.report || {}; var periods = report.availablePeriods || []; if(!periods.length && report.selected) periods=[report.selected]; var old = selectedPeriod || report.selected || ""; sel.innerHTML = ""; periods.forEach(function(key){ var opt=document.createElement("option"); opt.value=key; opt.textContent=labelPeriod(key); sel.appendChild(opt); }); if(report.availableYears){ report.availableYears.forEach(function(y){ if(!periods.includes(String(y))){ var opt=document.createElement("option"); opt.value=String(y); opt.textContent="Tahun " + y; sel.appendChild(opt); } }); } sel.value = old || report.selected || (periods[0] || ""); selectedPeriod = sel.value; }
  function labelPeriod(key){ var m=String(key || "").match(/^(20\\\d{2})-(\\d{2})$/); if(m){ var names=["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"]; return names[Number(m[2])-1] + " " + m[1]; } if(/^20\\\d{2}$/.test(String(key))) return "Tahun " + key; return key || "Periode"; }
  function userOptions(data){ var sel=$("user-select"); if(!data.access || !data.access.isAdmin){ document.body.classList.remove("admin"); return; } document.body.classList.add("admin"); var users=(data.admin && data.admin.users) || []; sel.innerHTML=""; users.forEach(function(u){ var opt=document.createElement("option"); opt.value=u.number; opt.textContent=u.maskedNumber + " · " + rp(u.totalBalance); sel.appendChild(opt); }); selectedNumber = selectedNumber || (data.access && data.access.selectedNumber) || (users[0] && users[0].number) || ""; sel.value = selectedNumber; }
  function renderMetrics(data){ var f=data.finance || {}; var s=f.summary || {}; var a=f.analytics || {}; txt("side-owner", "Nomor " + (f.owner || data.system.owner || "-")); txt("side-time", data.system.time || "-"); txt("side-status", (data.system.connected ? "Bot Online" : "Bot Offline") + " · " + data.system.timezone); txt("subtitle", "Periode " + (f.period || data.report.label || "aktif") + " · " + (f.owner || "pengguna")); txt("status-label", data.system.connected ? "Bot online dan data tersinkron" : "Bot offline, dashboard tetap bisa dibaca"); txt("hero-title", "Saldo bot " + rp(s.totalBalance) + " dalam satu tampilan realtime."); txt("kpi-balance", rp(s.totalBalance)); txt("kpi-balance-hint", "Saldo akumulasi spreadsheet"); txt("kpi-income", rp(s.incomeMonth)); txt("kpi-income-hint", (s.incomeTransactions || 0) + " transaksi masuk"); txt("kpi-expense", rp(s.expenseMonth)); txt("kpi-expense-hint", (s.expenseTransactions || 0) + " transaksi keluar"); txt("kpi-health", (a.healthScore || 0) + "/100"); txt("kpi-health-hint", a.healthLabel || "Belum ada data"); }
  function renderWallets(f){ var rows=(f.wallets || []); if(!rows.length) return html("wallet-list", "<div class='empty'>Belum ada saldo dompet.</div>"); html("wallet-list", rows.map(function(w){ var abs=Math.abs(w.balance || 0); return "<div class='row-card'><div><b>"+escapeText(w.name)+"</b><div class='bar'><i style='width:"+Math.min(100,abs/1000000*100)+"%'></i></div></div><strong>"+rp(w.balance)+"</strong></div>"; }).join("")); }
  function renderBinance(binance){ var box=$("binance-mini"); if(!binance || !binance.available){ box.className="hero-card binance-off"; txt("binance-estimate", "Binance belum aktif"); txt("binance-message", (binance && binance.message) || "Isi API Binance khusus nomor 33827179200526 di environment."); txt("binance-updated", (binance && binance.message) || "Belum terhubung"); html("binance-assets-mini", ""); html("binance-assets", "<div class='empty'>"+escapeText((binance && binance.message) || "Saldo Binance belum tersedia.")+"</div>"); return; } box.className="hero-card binance-good"; txt("binance-estimate", usdt(binance.estimatedUSDT)); txt("binance-message", "Estimasi nilai aset Binance realtime · " + (binance.assetCount || 0) + " aset · update " + binance.updatedAt); txt("binance-updated", "Update " + binance.updatedAt + " · " + (binance.assetCount || 0) + " aset"); var assets=(binance.assets || []).slice().sort(function(a,b){ return (b.estimatedUSDT || 0) - (a.estimatedUSDT || 0); }); function assetHtml(a){ return "<div class='asset'><div class='coin'>"+escapeText(a.asset)+"</div><div><b>"+num(a.total,8)+"</b><br><small>Free "+num(a.free,8)+" · Locked "+num(a.locked,8)+"</small></div><div class='est'><b>"+(a.estimatedUSDT == null ? "-" : usdt(a.estimatedUSDT))+"</b></div></div>"; } html("binance-assets-mini", assets.slice(0,3).map(assetHtml).join("")); html("binance-assets", assets.length ? assets.slice(0,30).map(assetHtml).join("") : "<div class='empty'>Tidak ada aset non-zero.</div>"); }
  function renderCategories(f){ var rows=f.categories || []; var total=rows.reduce(function(s,x){ return s + Number(x.amount || 0); },0); if(!rows.length) return html("category-list", "<div class='empty'>Belum ada kategori pada periode ini.</div>"); html("category-list", rows.slice(0,9).map(function(c,i){ var pct=total ? Math.round((c.amount/total)*100) : 0; var color=chartColors[i%chartColors.length]; return "<div class='row-card'><div><b>"+escapeText(c.name)+"</b><div class='subtle'>"+escapeText(c.group || "Kategori")+" · "+pct+"%</div><div class='bar'><i style='width:"+pct+"%;background:"+color+"'></i></div></div><strong>"+rp(c.amount)+"</strong></div>"; }).join("")); }
  function renderBudgets(f){ var rows=f.budgets || []; if(!rows.length) return html("budget-list", "<div class='empty'>Belum ada budget. Atur lewat bot: set budget Konsumsi 2jt.</div>"); html("budget-list", rows.slice(0,8).map(function(b){ var pct=Math.min(100, b.percent || 0); return "<div class='row-card'><div><b>"+escapeText(b.name)+"</b><div class='subtle'>"+rp(b.used)+" dari "+rp(b.limit)+" · "+escapeText(b.status)+"</div><div class='bar'><i style='width:"+pct+"%'></i></div></div><strong>"+(b.percent || 0)+"%</strong></div>"; }).join("")); }
  function renderTips(f){ var a=f.analytics || {}; var tips=a.tips || []; var s=f.summary || {}; var rows=["Status periode: " + (s.status || "-"), "Sisa aman harian: " + rp(a.dailySafeSpend || 0), "Rasio sisa: " + (a.savingsRatio || 0) + "%"].concat(tips); html("tips-list", rows.map(function(t){ return "<div class='row-card'><div><b>✦</b> "+escapeText(t)+"</div></div>"; }).join("")); }
  function renderCommands(data){ var list=(data.commands || []).slice(0,10); html("command-list", list.map(function(c){ return "<span class='command-chip'>"+escapeText(c.cmd)+"</span>"; }).join("")); }
  function renderIntegrations(data){ var bin=(data.integrations && data.integrations.binance) || (data.finance && data.finance.binance); var rows=["Google Spreadsheet: aktif sebagai database transaksi", "WhatsApp Bot: " + (data.system.connected ? "online" : "offline"), "AI: " + (data.ai && data.ai.provider ? data.ai.provider : "fallback lokal"), "Binance: " + (bin && bin.available ? "aktif realtime" : "belum aktif / bukan nomor khusus")]; html("integration-list", rows.map(function(t){ return "<div class='row-card'><div>"+escapeText(t)+"</div></div>"; }).join("")); }
  function filteredRows(){ var f=current && current.finance ? current.finance : {}; var rows=f.recent || []; var q=($("search-input").value || "").toLowerCase(); var type=$("type-filter").value; return rows.filter(function(r){ var okType= type==="all" || r.type===type; var hay=[r.date,r.type,r.category,r.note,r.wallet,String(r.amount)].join(" ").toLowerCase(); return okType && (!q || hay.indexOf(q)>=0); }); }
  function renderTransactions(){ var rows=filteredRows(); txt("table-info", rows.length + " transaksi pada filter aktif"); if(!rows.length) return html("transaction-body", "<tr><td colspan='7' class='empty'>Tidak ada transaksi.</td></tr>"); html("transaction-body", rows.slice(0,80).map(function(r){ var cls=r.type==="Pemasukan" ? "in" : "out"; return "<tr><td>"+escapeText(r.date)+"</td><td><span class='tag "+cls+"'>"+escapeText(r.type)+"</span></td><td>"+escapeText(r.category)+"</td><td>"+escapeText(r.note)+"</td><td>"+escapeText(r.wallet)+"</td><td class='amount'>"+rp(r.amount)+"</td><td><button class='btn' data-edit='"+r.rowNumber+"'>Edit</button> <button class='btn danger' data-del='"+r.rowNumber+"'>Hapus</button></td></tr>"; }).join("")); }
  function drawTrend(f){ var canvas=$("trend-chart"); var ctx=canvas.getContext("2d"); var wrap=canvas.parentElement; var dpr=window.devicePixelRatio || 1; canvas.width=wrap.clientWidth*dpr; canvas.height=wrap.clientHeight*dpr; ctx.scale(dpr,dpr); var w=wrap.clientWidth,h=wrap.clientHeight; ctx.clearRect(0,0,w,h); var rows=(f.trend || []).slice(-14); if(!rows.length){ ctx.fillStyle="#64748b"; ctx.font="14px Segoe UI"; ctx.fillText("Belum ada tren untuk periode ini.",20,35); return; } var pad=34; var max=Math.max.apply(null, rows.map(function(x){return Math.max(x.masuk||0,x.keluar||0);})); max=Math.max(max,1); var bw=(w-pad*2)/rows.length/2.7; ctx.strokeStyle="rgba(120,145,180,.28)"; ctx.lineWidth=1; for(var g=0;g<4;g++){ var y=pad+(h-pad*2)*g/3; ctx.beginPath(); ctx.moveTo(pad,y); ctx.lineTo(w-pad,y); ctx.stroke(); } rows.forEach(function(x,i){ var base=h-pad; var x0=pad+i*((w-pad*2)/rows.length)+bw*.6; var hi=(h-pad*2)*(x.masuk||0)/max; var he=(h-pad*2)*(x.keluar||0)/max; var grad=ctx.createLinearGradient(0,base-hi,0,base); grad.addColorStop(0,"#10b981"); grad.addColorStop(1,"#99f6e4"); ctx.fillStyle=grad; roundRect(ctx,x0,base-hi,bw,hi,8); ctx.fill(); var grad2=ctx.createLinearGradient(0,base-he,0,base); grad2.addColorStop(0,"#f43f5e"); grad2.addColorStop(1,"#fecdd3"); ctx.fillStyle=grad2; roundRect(ctx,x0+bw+4,base-he,bw,he,8); ctx.fill(); ctx.fillStyle="#64748b"; ctx.font="11px Segoe UI"; ctx.fillText(x.label, x0-4, h-10); }); }
  function roundRect(ctx,x,y,w,h,r){ var rr=Math.min(r,w/2,h/2); ctx.beginPath(); ctx.moveTo(x+rr,y); ctx.arcTo(x+w,y,x+w,y+h,rr); ctx.arcTo(x+w,y+h,x,y+h,rr); ctx.arcTo(x,y+h,x,y,rr); ctx.arcTo(x,y,x+w,y,rr); ctx.closePath(); }
  function populateCategories(){ var jenis=$("trx-type").value; var opts=(current && current.catalog ? current.catalog : []).filter(function(c){ return c.type==="Keduanya" || c.type===jenis; }); $("trx-category").innerHTML=opts.map(function(c){ return "<option>"+escapeText(c.name)+"</option>"; }).join(""); }
  function resetForm(type){ $("editing-row").value=""; $("trx-type").value=type || "Pengeluaran"; $("trx-date").value=todayIso(); $("trx-amount").value=""; $("trx-wallet").value="cash"; $("trx-note").value=""; populateCategories(); $("save-trx").textContent="Simpan Transaksi"; }
  function editRow(rowNumber){ var rows=(current.finance && current.finance.recent) || []; var r=rows.find(function(x){ return String(x.rowNumber)===String(rowNumber); }); if(!r) return; $("editing-row").value=r.rowNumber; $("trx-type").value=r.type; $("trx-date").value=parseDate(r.date); $("trx-amount").value=r.amount; $("trx-wallet").value=(r.wallet || "cash").toLowerCase(); populateCategories(); $("trx-category").value=r.category; $("trx-note").value=r.note; $("save-trx").textContent="Update Transaksi"; location.hash="#transactions"; }
  function parseDate(value){ var m=String(value||"").match(/^(\\d{2})\\/(\\d{2})\\/(\\d{4})/); return m ? m[3]+"-"+m[2]+"-"+m[1] : todayIso(); }
  async function transactionRequest(path, options){ var res=await fetch(path + (selectedNumber ? (path.indexOf("?")>=0?"&":"?") + "nomor=" + encodeURIComponent(selectedNumber) : ""), Object.assign({headers:apiHeaders()}, options || {})); var data=await res.json().catch(function(){ return {}; }); if(!res.ok) throw new Error(data.message || "Request gagal"); return data; }
  async function deleteRow(rowNumber){ if(!confirm("Hapus transaksi ini?")) return; await transactionRequest("/api/transactions/"+rowNumber, {method:"DELETE"}); showToast("Transaksi dihapus."); await loadDashboard(true); }
  async function exportExcel(){ if(!token) return openLock(); var q=queryString(); var res=await fetch("/api/export/excel" + (q ? "?"+q : ""), {headers:apiHeaders()}); if(!res.ok){ var e=await res.json().catch(function(){return {};}); throw new Error(e.message || "Gagal export Excel"); } var blob=await res.blob(); var disp=res.headers.get("content-disposition") || ""; var m=disp.match(/filename="?([^";]+)"?/i); var a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=(m && m[1]) || "laporan-dashboard.xls"; document.body.appendChild(a); a.click(); URL.revokeObjectURL(a.href); a.remove(); showToast("Laporan Excel berhasil dibuat."); }
  function renderEmptyState(message, data){ openApp(); txt("hero-title", "Dashboard aktif, data belum siap"); txt("hero-copy", message || "Periksa variabel Railway dan akses Google Spreadsheet."); txt("status-label", "Butuh konfigurasi / akses data"); txt("side-status", "Dashboard Online"); txt("side-time", new Date().toLocaleString("id-ID")); txt("kpi-balance", "Rp 0"); txt("kpi-balance-hint", "Data spreadsheet belum termuat"); txt("kpi-income", "Rp 0"); txt("kpi-income-hint", "Belum ada data"); txt("kpi-expense", "Rp 0"); txt("kpi-expense-hint", "Belum ada data"); txt("kpi-health", "-"); txt("kpi-health-hint", "Menunggu data"); html("wallet-list", "<div class='empty'>"+escapeText(message || "Belum ada data dompet.")+"</div>"); html("category-list", "<div class='empty'>Belum ada kategori.</div>"); html("budget-list", "<div class='empty'>Belum ada budget.</div>"); html("tips-list", "<div class='empty'>"+escapeText(message || "Dashboard berhasil dibuka, tetapi sumber data belum siap.")+"</div>"); html("transaction-body", "<tr><td colspan='7' class='empty'>Belum ada transaksi yang bisa ditampilkan.</td></tr>"); renderBinance(data && (data.integrations && data.integrations.binance)); renderCommands(data || {commands:[]}); renderIntegrations(data || {}); }
  async function loadDashboard(silent){ if(!token){ openLock(); return; } try{ if(!silent) showToast("Memuat data realtime..."); var q=queryString(); var res=await fetch("/api/dashboard" + (q ? "?"+q : ""), {headers:apiHeaders()}); var data=await res.json().catch(function(){ return {message:"Server mengirim respons tidak valid."}; }); if(res.status===401 || res.status===403){ openLock(); throw new Error(data.message || "Akses dashboard tidak valid"); } if(!res.ok) throw new Error(data.message || "Dashboard belum bisa dimuat"); current=data; sessionStorage.setItem("dashboardAccess", token); openApp(); userOptions(data); periodOptions(data); var f=data.finance || {}; if(!f.available){ renderEmptyState(f.message || "Data belum tersedia.", data); return; } renderMetrics(data); renderWallets(f); renderBinance(f.binance || (data.integrations && data.integrations.binance)); renderCategories(f); renderBudgets(f); renderTips(f); renderCommands(data); renderIntegrations(data); populateCategories(); renderTransactions(); drawTrend(f); sessionStorage.setItem("dashboardPeriod", selectedPeriod || ""); sessionStorage.setItem("dashboardNumber", selectedNumber || ""); }catch(e){ if(String(e.message||"").toLowerCase().includes("akses")){ openLock(); } else { renderEmptyState(e.message || "Dashboard gagal dimuat", current || {}); } showToast(e.message || "Dashboard gagal dimuat"); } }
  if(collapsed){ $("sidebar").classList.add("collapsed"); $("app").classList.add("collapsed"); } $("collapse-btn").addEventListener("click", function(){ if(window.innerWidth<=820){ $("sidebar").classList.remove("mobile-open"); $("mobile-overlay").classList.remove("show"); return; } $("sidebar").classList.toggle("collapsed"); $("app").classList.toggle("collapsed", $("sidebar").classList.contains("collapsed")); localStorage.setItem("liquidSidebarCollapsed", $("sidebar").classList.contains("collapsed") ? "1" : "0"); });
  $("mobile-menu").addEventListener("click", function(){ $("sidebar").classList.add("mobile-open"); $("mobile-overlay").classList.add("show"); }); $("mobile-overlay").addEventListener("click", function(){ $("sidebar").classList.remove("mobile-open"); $("mobile-overlay").classList.remove("show"); });
  $("period-select").addEventListener("change", function(){ selectedPeriod=this.value; loadDashboard(true); }); $("user-select").addEventListener("change", function(){ selectedNumber=this.value; loadDashboard(true); }); $("refresh-btn").addEventListener("click", function(){ loadDashboard(false); }); $("refresh-binance").addEventListener("click", function(){ loadDashboard(false); }); $("excel-btn").addEventListener("click", function(){ exportExcel().catch(function(e){ showToast(e.message); }); }); $("excel-btn-2").addEventListener("click", function(){ exportExcel().catch(function(e){ showToast(e.message); }); });
  $("search-input").addEventListener("input", renderTransactions); $("type-filter").addEventListener("change", renderTransactions); $("trx-type").addEventListener("change", populateCategories); $("reset-form").addEventListener("click", function(){ resetForm(); }); $("quick-fill-income").addEventListener("click", function(){ resetForm("Pemasukan"); location.hash="#transactions"; }); $("quick-fill-expense").addEventListener("click", function(){ resetForm("Pengeluaran"); location.hash="#transactions"; });
  $("transaction-body").addEventListener("click", function(e){ var edit=e.target.getAttribute("data-edit"); var del=e.target.getAttribute("data-del"); if(edit) editRow(edit); if(del) deleteRow(del).catch(function(err){ showToast(err.message); }); });
  $("trx-form").addEventListener("submit", async function(e){ e.preventDefault(); var row=$("editing-row").value; var payload={type:$("trx-type").value,date:$("trx-date").value,amount:Number($("trx-amount").value),wallet:$("trx-wallet").value,category:$("trx-category").value,note:$("trx-note").value}; try{ await transactionRequest(row ? "/api/transactions/"+row : "/api/transactions", {method:row ? "PUT" : "POST", body:JSON.stringify(payload)}); showToast(row ? "Transaksi diperbarui." : "Transaksi ditambahkan."); resetForm(); await loadDashboard(true); }catch(err){ showToast(err.message); } });
  $("token-form").addEventListener("submit", function(e){ e.preventDefault(); token=$("token-input").value.trim(); if(!token) return; sessionStorage.setItem("dashboardAccess", token); loadDashboard(false); });
  resetForm(); loadDashboard(false); setInterval(function(){ loadDashboard(true); }, 45000); window.addEventListener("resize", function(){ if(current && current.finance) drawTrend(current.finance); });
})();
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

            if (req.method === "OPTIONS") {
                res.writeHead(204, {
                    "Access-Control-Allow-Origin":"*",
                    "Access-Control-Allow-Headers":"Content-Type, Authorization, x-dashboard-access, x-dashboard-token",
                    "Access-Control-Allow-Methods":"GET,POST,PUT,PATCH,DELETE,OPTIONS",
                    "Cache-Control":"no-store"
                });
                res.end();
                return;
            }

            if (urlObj.pathname === "/health" || urlObj.pathname === "/api/status" || urlObj.pathname === "/api/env-check") {
                jsonResponse(res, 200, {
                    status:"online",
                    bot: sockGlobal?"aktif":"tidak_aktif",
                    reconnect: jumlahReconnect,
                    config: statusKonfigurasi(),
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
                    time: new Date().toLocaleString("id-ID",{timeZone:APP_TIMEZONE})
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

            if (urlObj.pathname === "/api/export/excel") {
                const akses = ambilAksesDashboard(req, urlObj);
                if (!akses) {
                    jsonResponse(res, 401, { error:"ACCESS_REQUIRED", message:"Akses dashboard tidak valid." });
                    return;
                }
                const file = await buatExportExcelDashboard(akses, urlObj.searchParams.get("nomor") || "", urlObj.searchParams.get("periode") || "");
                res.writeHead(200, {
                    "Content-Type":"application/vnd.ms-excel; charset=utf-8",
                    "Content-Disposition":`attachment; filename="${file.fileName}"`,
                    "Cache-Control":"no-store"
                });
                res.end(file.buffer);
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
• *saldo binance* – saldo bot + saldo Binance realtime khusus nomor terhubung
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
Binance   : ${BINANCE_API_KEY && BINANCE_API_SECRET ? `Aktif untuk ${maskNomor(BINANCE_BALANCE_NUMBER)}` : "Belum disetel"}
Reconnect : ${jumlahReconnect}x

Dashboard: ${dapatkanBaseUrlDashboard()}/dashboard
Ketik *dashboard web* untuk link akses pribadi.`
            );
        }

        if (/^(saldo\s+binance|binance|saldo realtime|saldo crypto|saldo kripto)$/i.test(pesan)) {
            return kirim(await buatRingkasanSaldoBinance(from));
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
            const lap    = await buatLaporanKeuangan("bulan", from);
            const insight= await analisisAIKeuangan(lap, "bulan ini");
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
    const config = statusKonfigurasi();
    if (!config.ok) {
        console.warn(`⚠️ Bot WhatsApp belum dijalankan karena konfigurasi belum lengkap: ${config.missing.join(", ") || "variabel belum siap"}. Web dashboard tetap aktif untuk pengecekan.`);
        sedangStart = false;
        return;
    }
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
