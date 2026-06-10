---
title: Bot Keuangan WA
emoji: 📊
colorFrom: green
colorTo: emerald
sdk: docker
pinned: false
---

# 🤖 Bot Keuangan WhatsApp

Bot catatan keuangan pribadi berbasis **Node.js**, **Baileys**, **Google Sheets**, **ChatGPT/OpenAI**, dan **Gemini fallback**.

AI utama sekarang memakai **OpenAI/ChatGPT**. Jika OpenAI sedang limit, overload, atau tidak dikonfigurasi, bot bisa memakai **Gemini** sebagai cadangan.

---

## ✨ Fitur Utama

### 📝 Catatan Keuangan Natural
- Catat pemasukan dan pengeluaran dari kalimat biasa.
- Deteksi otomatis nominal `25k`, `100rb`, `1.5jt`, kategori, dompet, tanggal, dan jenis transaksi.
- Fallback parsing lokal jika AI sedang tidak tersedia.
- Notifikasi saldo dompet setelah transaksi dicatat.

### 📊 Laporan Tabel
- Command `laporan`, `saldo`, `hari ini`, `minggu ini`, dan `bulan ini` menampilkan data dalam tabel WhatsApp.
- Tabel ringkasan, pengeluaran per kategori, saldo per dompet, dan transaksi terbaru.
- Export laporan juga memakai format tabel rapi.

### 🤖 AI Keuangan Responsif
- **ChatGPT/OpenAI sebagai AI utama** untuk parsing, analisis, tips, prediksi, dan tanya-jawab.
- **Gemini fallback** otomatis bila provider utama gagal.
- Command `ai [pertanyaan]` untuk bertanya dengan konteks data keuangan.
- Command `analisis`, `tips`, dan `prediksi` untuk insight keuangan.

### 🎯 Budget & Monitoring
- Budget default per kategori.
- Command `set budget [kategori] [nominal]`.
- Alert otomatis saat penggunaan budget mencapai 85% dan 100%.
- Command `budget` tampil sebagai tabel pemantauan.

### 🌐 Dashboard Web
- Dashboard web di port `7860`.
- Status bot, provider AI, reconnect, fitur aktif, dan command utama.
- Endpoint `/health` dan `/api/status` untuk monitoring.

---

## ⚙️ Environment Variables

| Variable | Wajib | Keterangan |
|---|---:|---|
| `SPREADSHEET_ID` | Ya | ID Google Spreadsheet |
| `OPENAI_API_KEY` | Ya* | API key OpenAI/ChatGPT sebagai AI utama |
| `CHATGPT_API_KEY` | Opsional | Alias untuk `OPENAI_API_KEY` |
| `OPENAI_MODEL` | Opsional | Model OpenAI utama, default `gpt-4o-mini` |
| `OPENAI_MODELS` | Opsional | Daftar fallback model OpenAI dipisah koma |
| `GEMINI_API_KEY` | Opsional* | API key Gemini sebagai fallback |
| `GEMINI_MODELS` | Opsional | Daftar fallback model Gemini dipisah koma |
| `WHATSAPP_PHONE_NUMBER` | Ya | Nomor WA format internasional, contoh `628xxx` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Ya | JSON service account Google |
| `PORT` | Opsional | Default `7860` |

\*Minimal isi salah satu dari `OPENAI_API_KEY`/`CHATGPT_API_KEY` atau `GEMINI_API_KEY`. Untuk konfigurasi yang diminta, isi `OPENAI_API_KEY` sebagai utama dan `GEMINI_API_KEY` sebagai fallback.

---

## 📋 Perintah Bot

```text
# Informasi
menu                         -> Tampilkan panduan
status ai                    -> Cek provider AI
kategori                     -> Daftar kategori dan dompet

# Laporan tabel
laporan                      -> Laporan semua waktu
saldo                        -> Rekap semua waktu
hari ini                     -> Laporan hari ini
minggu ini                   -> Laporan 7 hari terakhir
bulan ini                    -> Laporan bulan berjalan
tabel bulan ini              -> Alias laporan tabel
export bulan ini             -> Export laporan tabel

# Dashboard & insight
dashboard                    -> Ringkasan pintar
prediksi                     -> Prediksi cashflow bulan ini
analisis                     -> Analisis AI bulanan
tips                         -> Tips keuangan harian
ai kenapa pengeluaran naik?  -> Tanya AI dengan konteks data

# Visualisasi
grafik bulan ini             -> Grafik ASCII pengeluaran
tren                         -> Tren 7 hari terakhir

# Transaksi
riwayat                      -> 15 transaksi terakhir
cari [kata kunci]            -> Cari transaksi
undo                         -> Hapus transaksi terakhir

# Budget & pengingat
budget                       -> Monitor anggaran tabel
set budget [kat] [nominal]   -> Set budget custom
pengingat on/off             -> Notifikasi harian

# Darurat
#reset                       -> Hapus semua data
```

---

## 🚀 Jalankan

```bash
npm install
npm start
```

Dashboard:

```text
http://localhost:7860/dashboard
```

Health check:

```text
http://localhost:7860/health
```

---

## 🏗️ Stack

- **Runtime**: Node.js 20
- **WhatsApp**: `@whiskeysockets/baileys`
- **AI Utama**: OpenAI/ChatGPT
- **AI Fallback**: Google Gemini
- **Database**: Google Sheets
- **Deploy**: Docker / Hugging Face Spaces / Railway
