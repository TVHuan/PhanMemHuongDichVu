const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');

const FEE_URL = 'http://localhost:4001';
const BANK_URL = 'http://localhost:4002';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runTest() {
  console.log('===============================================================');
  console.log('🧪 BẮT ĐẦU TEST TÌNH HUỐNG 2: NGÂN HÀNG PHẢN HỒI RẤT CHẬM (DELAY_MS=5000)');
  console.log('===============================================================\n');

  // Đảm bảo Fee Service đang chạy
  try {
    await axios.get(`${FEE_URL}/students/1/fees`);
  } catch (e) {
    console.error('❌ LỖI: Fee Service chưa được bật trên cổng 4001! Hãy chạy npm run start:fee trước.');
    process.exit(1);
  }

  // Khởi động Mock Bank với DELAY_MS=5000
  console.log('👉 Khởi động Mock Bank với biến môi trường DELAY_MS=5000...');
  const bankProcess = spawn('node', [path.join(__dirname, '../src/mock-bank/index.js')], {
    env: { ...process.env, BANK_PORT: '4002', DELAY_MS: '5000' },
    stdio: 'ignore'
  });

  // Chờ bank sẵn sàng
  for (let i = 0; i < 20; i++) {
    await sleep(200);
    try {
      await axios.get(`${BANK_URL}/stats`);
      break;
    } catch (e) {}
  }
  console.log('✅ Mock Bank (Delay 5000ms) đã sẵn sàng hoạt động.\n');

  // Bước 1: Gọi 1 thanh toán và đo thời gian
  console.log('👉 BƯỚC 1: Gửi 1 yêu cầu thanh toán để đo timeout và status...');
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

  const passT1_Status = paymentRes?.status === 504 && paymentRes?.data?.status === 'PENDING';
  const passT1_Time = durationT1 <= 4500;

  console.log(`  [Check 1] Trả về mã 504 và status="PENDING": ${passT1_Status ? '✅ ĐẠT' : '❌ KHÔNG ĐẠT'}`);
  console.log(`  [Check 2] Tổng thời gian phản hồi <= 4.5 giây: ${passT1_Time ? '✅ ĐẠT' : '❌ KHÔNG ĐẠT'}`);

  // Bước 2: Bắn đồng thời 20 thanh toán và trong lúc đó gọi GET /students/1/fees
  console.log('\n👉 BƯỚC 2: Bắn đồng thời 20 thanh toán và kiểm tra GET /students/1/fees...');
  console.log('- Đang kích hoạt 20 thanh toán đồng thời chạy nền...');
  const paymentPromises = Array.from({ length: 20 }, (_, i) =>
    axios.post(`${FEE_URL}/students/1/payments`, { amount: 1000 }).catch((e) => e.response)
  );

  // Đợi 300ms cho các request bắt đầu gửi đi
  await sleep(300);

  // Gọi GET /fees nhiều lần trong khi 20 request kia đang chờ
  console.log('- Tiến hành gọi tra cứu GET /students/1/fees liên tục:');
  const getDurations = [];
  for (let i = 1; i <= 4; i++) {
    const startGet = Date.now();
    const feeRes = await axios.get(`${FEE_URL}/students/1/fees`);
    const durationGet = Date.now() - startGet;
    getDurations.push(durationGet);
    console.log(`  + Lần ${i}: HTTP ${feeRes.status}, thời gian = ${durationGet}ms`);
    await sleep(200);
  }

  const maxGetDuration = Math.max(...getDurations);
  const passT2 = maxGetDuration < 300;
  console.log(`  [Check 3] GET /fees vẫn phản hồi nhanh < 300ms trong lúc cao điểm (Max: ${maxGetDuration}ms): ${passT2 ? '✅ ĐẠT' : '❌ KHÔNG ĐẠT'}`);

  // Chờ 20 request thanh toán kết thúc
  console.log('- Chờ 20 request thanh toán hoàn tất...');
  const paymentResults = await Promise.all(paymentPromises);
  const all504 = paymentResults.every((r) => r.status === 504 && r.data?.status === 'PENDING');
  console.log(`  [Check 4] Tất cả 20 request đều trả về 504 PENDING đúng hạn: ${all504 ? '✅ ĐẠT' : '❌ KHÔNG ĐẠT'}`);

  bankProcess.kill();
  console.log('\n===============================================================');
  const allPass = passT1_Status && passT1_Time && passT2 && all504;
  console.log(`🎯 KẾT LUẬN TÌNH HUỐNG 2: ${allPass ? '🏆 TẤT CẢ TIÊU CHÍ ĐÃ ĐẠT!' : '⚠️ CÓ TIÊU CHÍ CHƯA ĐẠT'}`);
  console.log('===============================================================\n');
}

runTest().catch(console.error);
