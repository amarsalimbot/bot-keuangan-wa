---
title: Bot Keuangan WA
emoji: 📊
colorFrom: green
colorTo: blue
sdk: docker
pinned: false
---

# 🤖 Bot Keuangan WhatsApp – Versi Lengkap

Bot pencatat keuangan berbasis Node.js menggunakan **Baileys**, **Gemini AI**, dan **Google Sheets**.

---

## ✨ Fitur Lengkap

### 📝 Pencatatan Transaksi
- Catat pengeluaran & pemasukan dengan kalimat natural
- Deteksi otomatis: kategori, dompet, nominal (k/rb/jt/juta)
- Fallback parsing lokal jika AI gagal
- Notifikasi saldo dompet setelah transaksi

### 📊 Visualisasi & Laporan
- **Grafik ASCII** pengeluaran per kategori di WhatsApp
- **Grafik tren** 7 hari terakhir dengan bar emoji
- Rekap **hari ini / minggu ini / bulan ini**
- Laporan saldo per dompet
- Statistik persentase pengeluaran per kategori

### 🤖 Fitur AI (Gemini)
- **Analisis keuangan bulanan** – ringkasan kondisi + saran hemat
- **Tips keuangan harian** – otomatis dari AI setiap hari
- Parsing transaksi natural language

### 🔍 Pencarian & Export
- **Cari transaksi** berdasarkan kata kunci (keterangan/kategori/dompet)
- **Export laporan** format teks rapi per periode
- Riwayat 15 transaksi terakhir

### 🎯 Budget & Pengingat
- Budget default per kategori dengan alert 85% & 100%
- **Set budget custom** per kategori
- **Pengingat harian** jam 20:00 WITA (on/off)

### 🌐 Dashboard Web
- Halaman dashboard di browser (port 7860)
- Status bot real-time
- Daftar semua perintah
- Endpoint `/health` untuk monitoring

---

## ⚙️ Environment Variables

| Variable | Keterangan |
|---|---|
| `SPREADSHEET_ID` | ID Google Spreadsheet |
| `GEMINI_API_KEY` | API Key Google Gemini |
| `WHATSAPP_PHONE_NUMBER` | Nomor WA format internasional (628xxx) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | JSON service account Google |

---

## 📋 Perintah Bot

```
# Informasi
menu                    → Tampilkan semua perintah

# Laporan
saldo                   → Total pemasukan & pengeluaran
dompet                  → Saldo per akun/dompet
hari ini                → Rekap hari ini
minggu ini              → Rekap 7 hari terakhir
bulan ini               → Rekap bulan berjalan
riwayat                 → 15 transaksi terakhir
budget                  → Monitor anggaran per kategori

# Visualisasi
grafik bulan ini        → 📊 Grafik ASCII pengeluaran
tren                    → 📈 Tren 7 hari terakhir

# AI
analisis                → Analisis & saran keuangan dari AI
tips                    → Tips keuangan harian

# Pencarian & Export
cari [kata kunci]       → Cari transaksi
export bulan ini        → Export laporan teks

# Pengaturan
set budget [kat] [nom]  → Set limit anggaran
pengingat on/off        → Notifikasi malam

# Darurat
undo                    → Hapus transaksi terakhir
#reset                  → Hapus semua data
```

---

## 🏗️ Stack Teknologi

- **Runtime**: Node.js 20
- **WhatsApp**: @whiskeysockets/baileys (pairing code)
- **AI**: Google Gemini 2.5 Flash
- **Database**: Google Sheets
- **Auth**: Google Service Account JWT
- **Deploy**: Docker / Hugging Face Spaces / Railway
