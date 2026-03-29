/**
 * Auth Routes — 회원가입 + 로그인 + 이메일 인증
 * POST /api/auth/register
 * POST /api/auth/verify
 * POST /api/auth/resend
 * POST /api/auth/login
 * GET  /api/auth/me
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getOne, getDB, generateId } = require('../db');
const { authMiddleware, getSecret } = require('../middleware/auth');
const { sendVerificationCode } = require('../services/email');

const TOKEN_EXPIRY = '7d';
const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10분

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// POST /api/auth/register — 가입 + 인증 코드 발송
router.post('/register', async (req, res) => {
  console.log('[register] 요청 수신:', req.body?.email);
  try {
    const { email, password } = req.body;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email) || email.length > 254) {
      return res.status(400).json({ error: 'Please enter a valid email' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (password.length > 128) {
      return res.status(400).json({ error: 'Password is too long' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = getOne('SELECT id, verified FROM users WHERE email = ?', [normalizedEmail]);

    if (existing && existing.verified) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    let userId;
    if (existing && !existing.verified) {
      // 미인증 계정 재가입 — 비밀번호 업데이트
      userId = existing.id;
      const passwordHash = await bcrypt.hash(password, 10);
      getDB().run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);
    } else {
      // 신규 가입
      const passwordHash = await bcrypt.hash(password, 10);
      userId = generateId('u');
      const now = Date.now();
      getDB().run(
        'INSERT INTO users (id, email, password_hash, created_at, verified) VALUES (?, ?, ?, ?, 0)',
        [userId, normalizedEmail, passwordHash, now]
      );
    }

    // 기존 미사용 코드 무효화
    getDB().run('UPDATE email_verification_codes SET used = 1 WHERE user_id = ? AND used = 0', [userId]);

    // 새 인증 코드 생성 + 발송
    const code = generateCode();
    const codeId = generateId('vc');
    getDB().run(
      'INSERT INTO email_verification_codes (id, user_id, code, expires_at, used) VALUES (?, ?, ?, ?, 0)',
      [codeId, userId, code, Date.now() + CODE_EXPIRY_MS]
    );

    const emailSent = await sendVerificationCode(normalizedEmail, code);
    console.log('[register] 코드 생성:', code, '이메일 발송:', emailSent);

    res.status(201).json({
      needsVerification: true,
      email: normalizedEmail,
      emailSent,
      message: emailSent ? 'Verification code sent' : 'Account created but email could not be sent. Please try resending.',
    });
  } catch (err) {
    console.error('POST /api/auth/register error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/verify — 인증 코드 확인
router.post('/verify', (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ error: 'Email and code required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = getOne('SELECT id, email, verified FROM users WHERE email = ?', [normalizedEmail]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (user.verified) {
      return res.status(400).json({ error: 'Already verified' });
    }

    const record = getOne(
      'SELECT * FROM email_verification_codes WHERE user_id = ? AND used = 0 ORDER BY expires_at DESC',
      [user.id]
    );
    if (!record) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }
    if (Date.now() > record.expires_at) {
      return res.status(400).json({ error: 'Code expired. Please request a new one' });
    }
    if (record.attempts >= 5) {
      getDB().run('UPDATE email_verification_codes SET used = 1 WHERE id = ?', [record.id]);
      return res.status(400).json({ error: 'Too many attempts. Please request a new code' });
    }
    if (record.code !== code.trim()) {
      getDB().run('UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = ?', [record.id]);
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    // 인증 완료
    getDB().run('UPDATE users SET verified = 1 WHERE id = ?', [user.id]);
    getDB().run('UPDATE email_verification_codes SET used = 1 WHERE id = ?', [record.id]);

    const token = jwt.sign({ id: user.id, email: user.email }, getSecret(), { expiresIn: TOKEN_EXPIRY });
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error('POST /api/auth/verify error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/resend — 인증 코드 재발송
router.post('/resend', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = getOne('SELECT id, verified FROM users WHERE email = ?', [normalizedEmail]);
    if (!user || user.verified) {
      // 보안: 존재/인증 여부 미노출
      return res.json({ message: 'If the email exists, a new code has been sent' });
    }

    // 기존 코드 무효화
    getDB().run('UPDATE email_verification_codes SET used = 1 WHERE user_id = ? AND used = 0', [user.id]);

    const code = generateCode();
    const codeId = generateId('vc');
    getDB().run(
      'INSERT INTO email_verification_codes (id, user_id, code, expires_at, used) VALUES (?, ?, ?, ?, 0)',
      [codeId, user.id, code, Date.now() + CODE_EXPIRY_MS]
    );

    await sendVerificationCode(normalizedEmail, code);
    res.json({ message: 'If the email exists, a new code has been sent' });
  } catch (err) {
    console.error('POST /api/auth/resend error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = getOne('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (!user) {
      return res.status(401).json({ error: 'Incorrect email or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Incorrect email or password' });
    }

    if (!user.verified) {
      return res.status(403).json({ error: 'Email not verified', needsVerification: true, email: user.email });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, getSecret(), { expiresIn: TOKEN_EXPIRY });
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error('POST /api/auth/login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/me — 토큰 유효성 확인
router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: { id: req.user.id, email: req.user.email } });
});

// GET /api/auth/profile — 사용자 프로필 조회
router.get('/profile', authMiddleware, (req, res) => {
  const profile = getOne('SELECT * FROM user_profiles WHERE user_id = ?', [req.user.id]);
  res.json({ profile: profile || null });
});

// POST /api/auth/profile — 사용자 프로필 저장
router.post('/profile', authMiddleware, (req, res) => {
  try {
    const { occupation, context } = req.body;
    if ((occupation && occupation.length > 500) || (context && context.length > 500)) {
      return res.status(400).json({ error: 'Input too long (max 500 characters)' });
    }
    const existing = getOne('SELECT user_id FROM user_profiles WHERE user_id = ?', [req.user.id]);

    if (existing) {
      getDB().run(
        'UPDATE user_profiles SET occupation = ?, context = ? WHERE user_id = ?',
        [occupation || '', context || '', req.user.id]
      );
    } else {
      getDB().run(
        'INSERT INTO user_profiles (user_id, occupation, context, created_at) VALUES (?, ?, ?, ?)',
        [req.user.id, occupation || '', context || '', Date.now()]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/auth/profile error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
