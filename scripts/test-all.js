const { execSync } = require('child_process');
const path = require('path');

console.log('====================================================================');
console.log('🚀 CHẠY TOÀN BỘ KIỂM THỬ LAB 3 (CẢ 4 TÌNH HUỐNG SỰ CỐ)');
console.log('====================================================================\n');

const tests = [
  { name: 'Tình huống 1: Ngân hàng tắt rồi bật lại', script: 'test-th1.js' },
  { name: 'Tình huống 2: Ngân hàng phản hồi rất chậm (DELAY 5s)', script: 'test-th2.js' },
  { name: 'Tình huống 3: Duy trì kết nối TCP (Keep-Alive Pool)', script: 'test-th3.js' },
  { name: 'Tình huống 4: Đứt mạng, lỗi 500, từ chối nghiệp vụ', script: 'test-th4.js' },
];

for (const test of tests) {
  console.log(`\n--------------------------------------------------------------------`);
  console.log(`▶ ĐANG CHẠY: ${test.name}`);
  console.log(`--------------------------------------------------------------------`);
  try {
    execSync(`node ${path.join(__dirname, test.script)}`, { stdio: 'inherit' });
  } catch (err) {
    console.error(`❌ Thất bại ở: ${test.name}`);
    process.exit(1);
  }
}

console.log(`
====================================================================
🎉 TẤT CẢ 4 TÌNH HUỐNG ĐỀU ĐÃ ĐẠT 100% TIÊU CHUẨN ĐỀ BÀI LAB 3!
====================================================================
`);
