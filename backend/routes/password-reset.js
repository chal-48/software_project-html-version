const router = require('express').Router();
const pool = require('../db');
const bcrypt = require('bcryptjs');
const { randomBytes, createHash } = require('node:crypto');
const hash = token => createHash('sha256').update(token).digest('hex');
const genericMessage = 'หากมีบัญชีนี้ในระบบ คุณจะได้รับลิงก์รีเซ็ตรหัสผ่านทางอีเมล';

router.post('/forgot-password', async (req, res) => {
    const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        return res.status(400).json({ message: 'กรุณากรอก Email ให้ถูกต้อง' });
    }
    if (!process.env.RESEND_API_KEY || !process.env.RESET_EMAIL_FROM || !process.env.APP_URL) {
        return res.status(503).json({ message: 'ระบบส่งอีเมลยังไม่พร้อม กรุณาติดต่อผู้ดูแลระบบ' });
    }
    let tokenHash;
    try {
        const base = new URL(process.env.APP_URL);
        if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('APP_URL must use HTTPS');
        const users = await pool.query('SELECT id, email FROM users WHERE LOWER(email) = LOWER($1)', [email]);
        if (!users.rows.length) return res.json({ message: genericMessage });
        const user = users.rows[0];
        const token = randomBytes(32).toString('hex');
        tokenHash = hash(token);
        // Persistent cooldown across Vercel instances; only the latest token is valid.
        const saved = await pool.query(`
            INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, requested_at)
            VALUES ($1, $2, NOW() + INTERVAL '15 minutes', NOW())
            ON CONFLICT (user_id) DO UPDATE SET token_hash = EXCLUDED.token_hash,
                expires_at = EXCLUDED.expires_at, requested_at = NOW()
            WHERE password_reset_tokens.requested_at < NOW() - INTERVAL '1 minute'
            RETURNING user_id
        `, [String(user.id), tokenHash]);
        if (!saved.rows.length) return res.json({ message: genericMessage });
        const link = new URL('/reset-password.html', base);
        link.hash = new URLSearchParams({ token }).toString();
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: process.env.RESET_EMAIL_FROM, to: [user.email],
                subject: 'VanVan: รีเซ็ตรหัสผ่าน',
                text: `เปิดลิงก์เพื่อตั้งรหัสผ่านใหม่ภายใน 15 นาที:\n${link}\nหากคุณไม่ได้ขอรีเซ็ต สามารถละเว้นอีเมลนี้ได้` }),
            signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) throw new Error('Reset email delivery failed');
        res.json({ message: genericMessage });
    } catch (err) {
        if (tokenHash) {
            await pool.query('DELETE FROM password_reset_tokens WHERE token_hash = $1', [tokenHash])
                .catch(() => {});
        }
        console.error('Password reset request failed:', err.message);
        res.status(503).json({ message: 'ไม่สามารถส่งอีเมลได้ กรุณาลองใหม่ภายหลัง' });
    }
});

router.post('/reset-password', async (req, res) => {
    const { token, new_password } = req.body;
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
        return res.status(400).json({ message: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' });
    }
    if (typeof new_password !== 'string' || new_password.length < 6 || Buffer.byteLength(new_password) > 72) {
        return res.status(400).json({ message: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร และไม่เกิน 72 ไบต์' });
    }
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const found = await client.query(`SELECT user_id FROM password_reset_tokens
            WHERE token_hash = $1 AND expires_at > NOW() FOR UPDATE`, [hash(token)]);
        if (!found.rows.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ กรุณาขอลิงก์ใหม่' });
        }
        const password = await bcrypt.hash(new_password, 10);
        const updated = await client.query('UPDATE users SET password = $1 WHERE id::text = $2 RETURNING id',
            [password, found.rows[0].user_id]);
        if (!updated.rows.length) throw new Error('Reset user not found');
        await client.query('DELETE FROM password_reset_tokens WHERE token_hash = $1', [hash(token)]);
        await client.query('COMMIT');
        res.json({ message: 'เปลี่ยนรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบใหม่' });
    } catch (err) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        console.error('Password reset failed:', err.message);
        res.status(500).json({ message: 'ไม่สามารถเปลี่ยนรหัสผ่านได้ กรุณาลองใหม่' });
    } finally {
        client?.release();
    }
});

module.exports = router;
