/**
 * 이메일 발송 서비스 (Resend HTTP API)
 * 환경변수: RESEND_API_KEY
 */
const { Resend } = require('resend');

let resend = null;

function getClient() {
  if (resend) return resend;
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY 미설정 — 이메일 발송 불가');
    return null;
  }
  resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
}

async function sendVerificationCode(toEmail, code) {
  const client = getClient();
  if (!client) {
    console.warn(`[email] 인증 코드 ${code} → ${toEmail} (API 키 미설정, 로그만 출력)`);
    return false;
  }

  try {
    const { data, error } = await client.emails.send({
      from: 'Mote <onboarding@resend.dev>',
      to: toEmail,
      subject: 'Mote 인증 코드',
      html: `
        <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 32px;">
          <h2 style="color: #2c2420; font-weight: 400;">Mote</h2>
          <p style="color: #555; font-size: 15px; line-height: 1.6;">
            아래 코드를 입력해서 이메일을 인증해주세요.
          </p>
          <div style="background: #f5f0e8; border-radius: 20px; padding: 24px; text-align: center; margin: 24px 0;">
            <span style="font-size: 32px; letter-spacing: 8px; font-weight: 600; color: #2c2420;">${code}</span>
          </div>
          <p style="color: #999; font-size: 13px;">
            이 코드는 10분 동안 유효합니다.
          </p>
        </div>
      `,
    });

    if (error) {
      console.error('[email] 발송 실패:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[email] 발송 에러:', err.message);
    return false;
  }
}

module.exports = { sendVerificationCode };
