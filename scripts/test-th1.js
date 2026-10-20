const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');

const FEE_URL = 'http://localhost:4001';
const BANK_URL = 'http://localhost:4002';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runTest() {
  console.log('===============================================================');
  console.log('🧪 BẮT ĐẦU TEST TÌNH HUỐNG 1: NGÂN HÀNG TẮT, RỒI HOẠT ĐỘNG LẠI');
  console.log('===============================================================\n');

  // Đảm bảo Fee Service đang chạy
  try {
    await axios.get(`${FEE_URL}/students/1/fees`);
  } catch (e) {
    console.error('❌ LỖI: Fee Service chưa được bật trên cổng 4001! Hãy chạy npm run start:fee trước.');
    process.exit(1);
  }

  // Bước 1: Khi Ngân hàng tắt
  console.log('👉 BƯỚC 1: Kiểm tra thanh toán khi Ngân hàng ĐANG TẮT...');
  const startT1 = Date.now();
  let paymentRes;
  try {
    paymentRes = await axios.post(`${FEE_URL}/students/1/payments`, { amount: 100000 });
  } catch (err) {
    paymentRes = err.response;
  }
  const durationT1 = Date.now() - startT1;

  console.log(`- Mã phản hồi HTTP: ${paymentRes?.status}`);
  console.log(`- Dữ liệu nhận được:`, paymentRes?.data);
  console.log(`- Thời gian phản hồi: ${durationT1}ms`);

  const passT1_Status = paymentRes?.status === 503;
  const passT1_Time = durationT1 < 1500;
  const passT1_Body = paymentRes?.data?.status === 'FAILED' && Boolean(paymentRes?.data?.error);

  console.log(`  [Check 1] Trả về mã 503: ${passT1_Status ? '✅ ĐẠT' : '❌ KHÔNG ĐẠT'}`);
  console.log(`  [Check 2] Thời gian < 1.5s: ${passT1_Time ? '✅ ĐẠT' : '❌ KHÔNG ĐẠT'}`);
  console.log(`  [Check 3] JSON có error và status=FAILED: ${passT1_Body ? '✅ ĐẠT' : '❌ KHÔNG ĐẠT'}`);

  // Bước 2: Kiểm tra Fee Service còn sống và GET /fees vẫn nhanh
  console.log('\n👉 BƯỚC 2: Kiểm tra Fee Service không bị crash & GET /fees phản hồi nhanh...');
  const startT2 = Date.now();
  const feeRes = await axios.get(`${FEE_URL}/students/1/fees`);
  const durationT2 = Date.now() - startT2;
  const passT2 = feeRes.status === 200 && durationT2 < 300;

  console.log(`- GET /students/1/fees: HTTP ${feeRes.status}, data:`, feeRes.data);
  console.log(`- Thời gian tra cứu nợ: ${durationT2}ms`);
  console.log(`  [Check 4] Fee Service còn sống & phản hồi < 300ms: ${passT2 ? '✅ ĐẠT' : '❌ KHÔNG ĐẠT'}`);

  // Bước 3: Khởi động Mock Bank lên
  console.log('\n👉 BƯỚC 3: Khởi động Mock Bank (cổng 4002) mà KHÔNG khởi động lại Fee Service...');
  const bankProcess = spawn('node', [path.join(__dirname, '../src/mock-bank/index.js')], {
    env: { ...process.env, BANK_PORT: '4002' },
    stdio: 'ignore'
  });

  // Chờ bank sẵn sàng
  let bankReady = false;
  for (let i = 0; i < 20; i++) {
    await sleep(200);
    try {
      await axios.get(`${BANK_URL}/stats`);
      bankReady = true;
      break;
    } catch (e) {}
  }

  if (!bankReady) {
    console.error('❌ Không thể khởi động Mock Bank.');
    bankProcess.kill();
    process.exit(1);
  }
  console.log('✅ Mock Bank đã sẵn sàng hoạt động.');

  // Bước 4: Gọi thanh toán lại
  console.log('\n👉 BƯỚC 4: Gọi lại thanh toán sau khi Ngân hàng đã bật...');
  let retryRes;
  try {
    retryRes = await axios.post(`${FEE_URL}/students/1/payments`, { amount: 100000 });
  } catch (err) {
    retryRes = err.response;
  }

  console.log(`- Mã phản hồi HTTP: ${retryRes?.status}`);
  console.log(`- Dữ liệu nhận được:`, retryRes?.data);
  const passT3 = retryRes?.status === 201 && retryRes?.data?.status === 'PAID';
  console.log(`  [Check 5] Thanh toán thành công (201 PAID): ${passT3 ? '✅ ĐẠT' : '❌ KHÔNG ĐẠT'}`);

  // Dọn dẹp process bank
  bankProcess.kill();
  console.log('\n===============================================================');
  const allPass = passT1_Status && passT1_Time && passT1_Body && passT2 && passT3;
  console.log(`🎯 KẾT LUẬN TÌNH HUỐNG 1: ${allPass ? '🏆 TẤT CẢ TIÊU CHÍ ĐÃ ĐẠT!' : '⚠️ CÓ TIÊU CHÍ CHƯA ĐẠT'}`);
  console.log('===============================================================\n');
}

runTest().catch(console.error);
