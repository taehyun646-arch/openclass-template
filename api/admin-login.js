const { createAdminToken, passwordMatches } = require('../lib/auth');

module.exports = function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (isMaintenanceMode()) {
    return response.status(503).json({ ok: false, maintenance: true, message: maintenanceMessage() });
  }
  if (request.method !== 'POST') {
    return response.status(405).json({ ok: false, message: 'POST 요청만 사용할 수 있습니다.' });
  }

  const configuredPassword = String(process.env.ADMIN_PASSWORD || '');
  const enteredPassword = String(request.body && request.body.password || '');
  if (!configuredPassword) {
    return response.status(500).json({ ok: false, message: 'Vercel의 ADMIN_PASSWORD를 먼저 설정해 주세요.' });
  }
  if (!passwordMatches(enteredPassword, configuredPassword)) {
    return response.status(401).json({ ok: false, message: '관리자 비밀번호가 올바르지 않습니다.' });
  }

  try {
    return response.status(200).json({ ok: true, token: createAdminToken() });
  } catch (error) {
    return response.status(500).json({ ok: false, message: error.message });
  }
}

function isMaintenanceMode() {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.MAINTENANCE_MODE || '').trim().toLowerCase());
}

function maintenanceMessage() {
  return String(process.env.MAINTENANCE_MESSAGE || '').trim() || '2학기 수업공개 신청 기간에 다시 열겠습니다.';
}
