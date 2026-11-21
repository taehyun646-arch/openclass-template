const crypto = require('node:crypto');

function sessionSecret() {
  const secret = String(process.env.SESSION_SECRET || '');
  if (!secret) throw new Error('Vercel의 SESSION_SECRET을 먼저 설정해 주세요.');
  return secret;
}

function createAdminToken() {
  const payload = Buffer.from(JSON.stringify({ role: 'admin', exp: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret()).update(payload, 'utf8').digest('base64url');
  return `${payload}.${signature}`;
}

function verifyAdminToken(token) {
  if (!token || !token.includes('.')) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const expected = crypto.createHmac('sha256', sessionSecret()).update(parts[0], 'utf8').digest('base64url');
  if (!safeEqual(expected, parts[1])) return false;
  try {
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    return data.role === 'admin' && Number(data.exp) > Date.now();
  } catch (_error) {
    return false;
  }
}

function passwordMatches(left, right) {
  const leftHash = crypto.createHash('sha256').update(String(left), 'utf8').digest();
  const rightHash = crypto.createHash('sha256').update(String(right), 'utf8').digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

module.exports = { createAdminToken, verifyAdminToken, passwordMatches };
