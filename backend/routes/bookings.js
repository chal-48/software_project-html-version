// routes/bookings.js
// หน้าที่: จัดการการจอง
// - User: จอง, อัปโหลดสลิป, ดูประวัติ, ยกเลิก
// - Admin: ตรวจสลิป, ยืนยัน/ปฏิเสธ, ออก E-Ticket

const express                    = require('express');
const router                     = express.Router();
const pool                       = require('../db');
const multer                     = require('multer');
const path                       = require('path');
const { createClient }           = require('@supabase/supabase-js');
const { randomUUID }             = require('crypto');
const { verifyToken, requireRole } = require('../middleware/auth');

// ── Upload สลิป ───────────────────────────────────────
const storage = multer.memoryStorage();

const upload = multer({
    storage,
    limits: { fileSize: 4 * 1024 * 1024, files: 1 }, // Below Vercel's 4.5MB request limit
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('ไฟล์ต้องเป็น JPG, PNG หรือ PDF เท่านั้น'));
        }
    }
});

// ── สร้าง ticket code ─────────────────────────────────
function generateTicketCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = 'VV-';
    for (let i = 0; i < 8; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

// ── POST /api/bookings ────────────────────────────────
// User จองรถ (ต้อง Login)
router.post('/', verifyToken, requireRole('user'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { schedule_id } = req.body;
        if (!schedule_id) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'กรุณาระบุรอบที่ต้องการจอง' });
        }

        // ดึงข้อมูลรอบ + Lock เพื่อป้องกันการจองซ้อน
        const schedResult = await client.query(
            'SELECT * FROM van_schedules WHERE id = $1 FOR UPDATE',
            [schedule_id]
        );

        if (schedResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'ไม่พบรอบนี้' });
        }

        const schedule = schedResult.rows[0];

        // ตรวจสอบที่นั่ง
        if (schedule.available_seats <= 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'ที่นั่งเต็มแล้ว' });
        }
        if (schedule.status !== 'available') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'รอบนี้ไม่สามารถจองได้' });
        }

        // ดึงราคาจาก route
        const routeResult = await client.query(
            'SELECT price FROM routes WHERE id = $1',
            [schedule.route_id]
        );
        const amount = routeResult.rows[0].price;

        // กำหนดเวลาหมดอายุ 15 นาที
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

        // สร้างการจอง
        const bookingResult = await client.query(`
            INSERT INTO bookings 
                (user_id, schedule_id, amount, status, expires_at)
            VALUES ($1, $2, $3, 'pending', $4)
            RETURNING *
        `, [req.user.id, schedule_id, amount, expiresAt]);

        // ลดที่นั่งว่าง
        const newAvailable = schedule.available_seats - 1;
        await client.query(`
            UPDATE van_schedules 
            SET available_seats = $1,
                status = CASE WHEN $1 = 0 THEN 'full' ELSE status END
            WHERE id = $2
        `, [newAvailable, schedule_id]);

        await client.query('COMMIT');

        res.status(201).json({
            success: true,
            message: 'จองสำเร็จ! กรุณาชำระเงินภายใน 15 นาที',
            data: {
                ...bookingResult.rows[0],
                expires_at: expiresAt,
                minutes_left: 15
            }
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาด' });
    } finally {
        client.release();
    }
});

// ── GET /api/bookings ─────────────────────────────────
// User ดูประวัติการจองของตัวเอง
router.get('/', verifyToken, requireRole('user'), async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                b.*,
                r.origin,
                r.destination,
                r.price,
                s.depart_time,
                s.status AS schedule_status
            FROM bookings b
            JOIN van_schedules s ON s.id = b.schedule_id
            JOIN routes r ON r.id = s.route_id
            WHERE b.user_id = $1
            ORDER BY b.created_at DESC
        `, [req.user.id]);

        res.json({ success: true, data: result.rows });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาด' });
    }
});

// ── POST /api/bookings/:id/slip ───────────────────────
// User อัปโหลดสลิปการโอนเงิน
router.post('/:id/slip', verifyToken, requireRole('user'), upload.single('slip'), async (req, res) => {
    let storageClient;
    let uploadedPath;
    try {
        // ตรวจสอบว่าเป็นการจองของตัวเอง
        const booking = await pool.query(
            'SELECT * FROM bookings WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );

        if (booking.rows.length === 0) {
            return res.status(404).json({ message: 'ไม่พบการจองนี้' });
        }

        const b = booking.rows[0];

        // ตรวจสอบสถานะ
        if (b.status !== 'pending') {
            return res.status(400).json({ message: `ไม่สามารถอัปโหลดสลิปได้ (สถานะ: ${b.status})` });
        }

        // ตรวจสอบว่าหมดเวลา 15 นาทีหรือยัง
        if (new Date() > new Date(b.expires_at)) {
            // อัปเดตสถานะเป็น expired
            await pool.query(
                "UPDATE bookings SET status = 'expired' WHERE id = $1",
                [req.params.id]
            );
            // คืนที่นั่ง
            await pool.query(
                "UPDATE van_schedules SET available_seats = available_seats + 1, status = 'available' WHERE id = $1",
                [b.schedule_id]
            );
            return res.status(400).json({ message: 'หมดเวลาชำระเงิน กรุณาจองใหม่' });
        }

        if (!req.file) {
            return res.status(400).json({ message: 'กรุณาแนบสลิปการโอนเงิน' });
        }

        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
            return res.status(503).json({ message: 'ยังไม่ได้ตั้งค่าระบบเก็บสลิป' });
        }
        storageClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
            { auth: { persistSession: false, autoRefreshToken: false } });
        const filename = `slip-${randomUUID()}${path.extname(req.file.originalname).toLowerCase()}`;
        const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'slips';
        const { error: uploadError } = await storageClient.storage.from(bucket)
            .upload(filename, req.file.buffer, { contentType: req.file.mimetype });
        if (uploadError) throw uploadError;
        uploadedPath = filename;

        // อัปเดตสลิปและสถานะ
        const result = await pool.query(`
            UPDATE bookings 
            SET slip_image = $1, status = 'slip_uploaded'
            WHERE id = $2 AND status = 'pending'
            RETURNING *
        `, [filename, req.params.id]);
        if (!result.rows.length) throw new Error('Booking status changed during upload');

        res.json({
            success: true,
            message: 'อัปโหลดสลิปสำเร็จ รอ Admin ตรวจสอบ',
            data: result.rows[0]
        });

    } catch (err) {
        if (uploadedPath && storageClient) {
            await storageClient.storage.from(process.env.SUPABASE_STORAGE_BUCKET || 'slips').remove([uploadedPath]);
        }
        console.error(err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาด' });
    }
});

// Generate a fresh, short-lived URL only for the owner or an administrator.
router.get('/:id/slip-url', verifyToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT user_id, slip_image FROM bookings WHERE id = $1', [req.params.id]);
        const booking = result.rows[0];
        if (!booking || (req.user.role !== 'admin' && String(booking.user_id) !== String(req.user.id))) {
            return res.status(404).json({ message: 'ไม่พบสลิปนี้' });
        }
        if (!booking.slip_image) return res.status(404).json({ message: 'ไม่พบสลิปนี้' });
        if (/^https:\/\//.test(booking.slip_image)) return res.json({ url: booking.slip_image });
        const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
            { auth: { persistSession: false, autoRefreshToken: false } });
        const { data, error } = await client.storage.from(process.env.SUPABASE_STORAGE_BUCKET || 'slips')
            .createSignedUrl(booking.slip_image, 300);
        if (error) throw error;
        res.json({ url: data.signedUrl });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'ไม่สามารถเปิดสลิปได้' });
    }
});

// ── POST /api/bookings/:id/verify ────────────────────
// Admin ตรวจสลิป ยืนยัน หรือ ปฏิเสธ
router.post('/:id/verify', verifyToken, requireRole('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { action, reject_reason } = req.body;
        // action = 'approve' หรือ 'reject'

        if (!action || !['approve', 'reject'].includes(action)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'action ต้องเป็น approve หรือ reject' });
        }

        const booking = await client.query(
            'SELECT * FROM bookings WHERE id = $1 FOR UPDATE',
            [req.params.id]
        );

        if (booking.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'ไม่พบการจองนี้' });
        }

        const b = booking.rows[0];

        if (b.status !== 'slip_uploaded') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'การจองนี้ยังไม่มีสลิปรอตรวจสอบ' });
        }

        if (action === 'approve') {
            // ออก E-Ticket
            const ticketCode = generateTicketCode();

            const result = await client.query(`
                UPDATE bookings SET
                    status = 'confirmed',
                    ticket_code = $1,
                    slip_verified_by = $2,
                    slip_verified_at = NOW()
                WHERE id = $3
                RETURNING *
            `, [ticketCode, req.user.id, req.params.id]);

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'ยืนยันการชำระเงินสำเร็จ ออก E-Ticket แล้ว',
                data: result.rows[0]
            });

        } else {
            // ปฏิเสธ → คืนที่นั่ง
            await client.query(`
                UPDATE bookings SET
                    status = 'cancelled',
                    reject_reason = $1,
                    slip_verified_by = $2,
                    slip_verified_at = NOW()
                WHERE id = $3
            `, [reject_reason || 'สลิปไม่ถูกต้อง', req.user.id, req.params.id]);

            await client.query(`
                UPDATE van_schedules 
                SET available_seats = available_seats + 1,
                    status = 'available'
                WHERE id = $1
            `, [b.schedule_id]);

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'ปฏิเสธการชำระเงินแล้ว',
            });
        }

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาด' });
    } finally {
        client.release();
    }
});

// ── DELETE /api/bookings/:id ──────────────────────────
// User ยกเลิกการจอง (ได้เฉพาะสถานะ pending)
router.delete('/:id', verifyToken, requireRole('user'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const booking = await client.query(
            'SELECT * FROM bookings WHERE id = $1 AND user_id = $2 FOR UPDATE',
            [req.params.id, req.user.id]
        );

        if (booking.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'ไม่พบการจองนี้' });
        }

        const b = booking.rows[0];

        if (b.status !== 'pending') {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                message: 'ยกเลิกได้เฉพาะการจองที่ยังไม่ได้ชำระเงินเท่านั้น' 
            });
        }

        // ยกเลิกการจอง
        await client.query(
            "UPDATE bookings SET status = 'cancelled' WHERE id = $1",
            [req.params.id]
        );

        // คืนที่นั่ง
        await client.query(`
            UPDATE van_schedules 
            SET available_seats = available_seats + 1,
                status = 'available'
            WHERE id = $1
        `, [b.schedule_id]);

        await client.query('COMMIT');

        res.json({ success: true, message: 'ยกเลิกการจองสำเร็จ' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาด' });
    } finally {
        client.release();
    }
});

module.exports = router;
