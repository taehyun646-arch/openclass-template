const test = require('node:test');
const assert = require('node:assert/strict');

const { publicConfig } = require('../api/index')._test;

function settings(phase) {
  return [{ setting_key: 'operation_phase', setting_value: phase }];
}

test('공개수업 운영과 참관 확인·자료 제출은 신청 단계와 관계없이 항상 열린다', () => {
  ['준비', '공개수업신청', '참관신청', '전체'].forEach(phase => {
    const access = publicConfig(settings(phase)).tabAccess;
    assert.equal(access.operation, true);
    assert.equal(access.attendance, true);
    assert.equal(access.documents, true);
  });
});

test('기존 수업진행 설정은 신청 준비·마감 단계로 안전하게 전환한다', () => {
  const config = publicConfig(settings('수업진행'));
  assert.equal(config.operationPhase, '준비');
  assert.equal(config.tabAccess.open, false);
  assert.equal(config.tabAccess.observe, false);
  assert.equal(config.tabAccess.operation, true);
});
