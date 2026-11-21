module.exports = function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    return response.status(405).json({ ok: false, message: 'GET 요청만 사용할 수 있습니다.' });
  }

  return response.status(200).json({
    ok: true,
    maintenance: isMaintenanceMode(),
    message: maintenanceMessage()
  });
};

function isMaintenanceMode() {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.MAINTENANCE_MODE || '').trim().toLowerCase());
}

function maintenanceMessage() {
  return String(process.env.MAINTENANCE_MESSAGE || '').trim() || '2학기 수업공개 신청 기간에 다시 열겠습니다.';
}
