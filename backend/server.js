// server.js
const express = require('express');
const cors    = require('cors');
const path    = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();

// ── สร้างโฟลเดอร์ uploads ถ้ายังไม่มี ─────────────────

// ── Middleware ─────────────────────────────────────────
app.use(cors());
app.use(express.json());

// เปิดให้เข้าถึงไฟล์สลิปที่อัปโหลด

// ── Routes ────────────────────────────────────────────
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/auth',      require('./routes/password-reset'));
app.use('/api/routes',    require('./routes/routes'));
app.use('/api/schedules', require('./routes/schedules'));
app.use('/api/bookings',  require('./routes/bookings'));
app.use('/api/admin',     require('./routes/admin'));

// ── Health Check ──────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({ 
        message: '🚐 VanVan API ทำงานอยู่!',
        version: '1.0.0'
    });
});

// ── Start Server ──────────────────────────────────────
// Only expose the frontend files copied by the build script.
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, next) => {
    console.error(err);
    res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
        .json({ message: err.code === 'LIMIT_FILE_SIZE' ? 'ไฟล์ใหญ่เกิน 4MB' : 'ไม่สามารถดำเนินการได้' });
});

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server: http://localhost:${PORT}`));
}

module.exports = app;
