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
const { sendVerificationCode, sendPasswordResetCode } = require('../services/email');

const TOKEN_EXPIRY = '7d';
const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10분

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// POST /api/auth/register — 가입 + 인증 코드 발송
router.post('/register', async (req, res) => {
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

// POST /api/auth/forgot-password — 비밀번호 재설정 코드 발송
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = getOne('SELECT id, verified FROM users WHERE email = ?', [normalizedEmail]);

    // 보안: 존재/인증 여부 미노출
    if (!user || !user.verified) {
      return res.json({ message: '등록된 이메일이면 재설정 코드를 보냈어요' });
    }

    // 기존 코드 무효화
    getDB().run('UPDATE password_reset_codes SET used = 1 WHERE user_id = ? AND used = 0', [user.id]);

    const code = generateCode();
    const codeId = generateId('rc');
    getDB().run(
      'INSERT INTO password_reset_codes (id, user_id, code, expires_at, used) VALUES (?, ?, ?, ?, 0)',
      [codeId, user.id, code, Date.now() + CODE_EXPIRY_MS]
    );

    await sendPasswordResetCode(normalizedEmail, code);
    res.json({ message: '등록된 이메일이면 재설정 코드를 보냈어요' });
  } catch (err) {
    console.error('POST /api/auth/forgot-password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/reset-password — 비밀번호 재설정
router.post('/reset-password', async (req, res) => {
  try {
    const { email, code, password } = req.body;
    if (!email || !code || !password) {
      return res.status(400).json({ error: '모든 항목을 입력해주세요' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: '비밀번호는 8자 이상이어야 해요' });
    }
    if (password.length > 128) {
      return res.status(400).json({ error: '비밀번호가 너무 길어요' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = getOne('SELECT id, email, verified FROM users WHERE email = ?', [normalizedEmail]);
    if (!user || !user.verified) {
      return res.status(400).json({ error: '올바르지 않은 코드예요' });
    }

    const record = getOne(
      'SELECT * FROM password_reset_codes WHERE user_id = ? AND used = 0 ORDER BY expires_at DESC',
      [user.id]
    );
    if (!record) {
      return res.status(400).json({ error: '올바르지 않은 코드예요' });
    }
    if (Date.now() > record.expires_at) {
      return res.status(400).json({ error: '코드가 만료되었어요. 다시 요청해주세요' });
    }
    if (record.attempts >= 5) {
      getDB().run('UPDATE password_reset_codes SET used = 1 WHERE id = ?', [record.id]);
      return res.status(400).json({ error: '시도 횟수를 초과했어요. 다시 요청해주세요' });
    }
    if (record.code !== code.trim()) {
      getDB().run('UPDATE password_reset_codes SET attempts = attempts + 1 WHERE id = ?', [record.id]);
      return res.status(400).json({ error: '올바르지 않은 코드예요' });
    }

    // 비밀번호 변경 + 코드 사용 처리
    const passwordHash = await bcrypt.hash(password, 10);
    getDB().run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, user.id]);
    getDB().run('UPDATE password_reset_codes SET used = 1 WHERE id = ?', [record.id]);

    const token = jwt.sign({ id: user.id, email: user.email }, getSecret(), { expiresIn: TOKEN_EXPIRY });
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error('POST /api/auth/reset-password error:', err);
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
