/**
 * 이메일 발송 서비스 (Nodemailer + Gmail SMTP)
 * 환경변수: SMTP_USER, SMTP_PASS
 */
const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('[email] SMTP_USER/SMTP_PASS 미설정 — 이메일 발송 불가');
    return null;
  }
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

async function sendVerificationCode(toEmail, code) {
  console.log('[email] sendVerificationCode 호출:', toEmail);
  console.log('[email] SMTP_USER:', process.env.SMTP_USER ? '설정됨' : '없음');
  console.log('[email] SMTP_PASS:', process.env.SMTP_PASS ? '설정됨' : '없음');
  const t = getTransporter();
  if (!t) {
    console.warn(`[email] 인증 코드 ${code} → ${toEmail} (SMTP 미설정, 로그만 출력)`);
    return false;
  }

  console.log('[email] 발송 시도...');
  try {
    await t.sendMail({
      from: `"Purl" <${process.env.SMTP_USER}>`,
      to: toEmail,
      subject: 'Purl 이메일 인증 코드',
      html: `
        <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 32px;">
          <h2 style="color: #2c2c2c; font-weight: 400;">Purl</h2>
          <p style="color: #555; font-size: 15px; line-height: 1.6;">
            아래 코드를 입력해서 이메일을 인증해주세요.
          </p>
          <div style="background: #f5f3f0; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
            <span style="font-size: 32px; letter-spacing: 8px; font-weight: 600; color: #2c2c2c;">${code}</span>
          </div>
          <p style="color: #999; font-size: 13px;">
            이 코드는 10분 동안 유효합니다.
          </p>
        </div>
      `,
    });
    console.log('[email] 발송 성공:', toEmail);
    return true;
  } catch (err) {
    console.error('[email] 발송 실패:', err.message);
    console.error('[email] 에러 코드:', err.code);
    console.error('[email] 전체 에러:', err);
    return false;
  }
}

module.exports = { sendVerificationCode };
