import { toast } from './Toast.js';

const button = document.getElementById('btn-send');
button.addEventListener('click', async () => {
    const email = document.getElementById('email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        toast('กรุณากรอก Email ให้ถูกต้อง', 'warning');
        return;
    }
    button.disabled = true;
    button.textContent = 'กำลังส่ง...';
    try {
        const response = await fetch('/api/auth/forgot-password', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message);
        document.getElementById('reset-msg').textContent = data.message;
        toast(data.message, 'success');
        button.textContent = 'ส่งคำขอแล้ว';
    } catch (err) {
        toast(err.message || 'ไม่สามารถเชื่อมต่อ Server ได้', 'error');
        button.disabled = false;
        button.textContent = 'Send Reset Link';
    }
});
