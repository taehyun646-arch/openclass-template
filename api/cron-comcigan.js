const { timingSafeEqual } = require('node:crypto');
const openClassApi = require('./index');

module.exports = async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  const secret = String(process.env.CRON_SECRET || '');
  const provided = Buffer.from(String(request.headers?.authorization || ''));
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return response.status(401).json({ ok: false, message: '인증되지 않은 예약 작업입니다.' });
  }
  if (request.method !== 'GET') {
    return response.status(405).json({ ok: false, message: 'GET 요청만 사용할 수 있습니다.' });
  }
  try {
    const result = await openClassApi.runScheduledComciganSync();
    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('예약 컴시간 동기화 실패:', error.message);
    return response.status(500).json({ ok: false, message: '컴시간 예약 동기화에 실패했습니다. 관리자 화면에서 동기화 상태를 확인해 주세요.' });
  }
};
