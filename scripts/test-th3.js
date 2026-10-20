const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');

const FEE_URL = 'http://localhost:4001';
const BANK_URL = 'http://localhost:4002';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runTest() {
  console.log('===============================================================');
  console.log('🧪 BẮT ĐẦU TEST TÌNH HUỐNG 3: DUY TRÌ KẾT NỐI TCP (KEEP-ALIVE)');
  console.log('===============================================================\n');

  // Đảm bảo Fee Service đang chạy
  try {
    await axios.get(`${FEE_URL}/students/1/fees`);
  } catch (e) {
    console.error('❌ LỖI: Fee Service chưa được bật trên cổng 4001! Hãy chạy npm run start:fee trước.');
    process.exit(1);
  }

  // Khởi động Mock Bank bình thường
  console.log('👉 Khởi động Mock Bank (trạng thái bình thường, keepAliveTimeout=5000ms)...');
  const bankProcess = spawn('node', [path.join(__dirname, '../src/mock-bank/index.js')], {
    env: { ...process.env, BANK_PORT: '4002' },
    stdio: 'ignore'
  });

  for (let i = 0; i < 20; i++) {
    await sleep(200);
    try {
      await axios.get(`${BANK_URL}/stats`);
      break;
    } catch (e) {}
  }
  console.log('✅ Mock Bank đã sẵn sàng hoạt động.');

  // Reset nợ và stats
  await axios.post(`${FEE_URL}/students/reset`);
  await axios.post(`${BANK_URL}/stats/reset`);

  // Bước 1: Gửi 200 thanh toán, 10 yêu cầu cùng lúc (1.000đ mỗi lần)
  console.log('\n👉 BƯỚC 1: Gửi 200 thanh toán với concurrency = 10 (1.000đ/lần)...');
  const TOTAL_REQUESTS = 200;
  const CONCURRENCY = 10;
  let successCount = 0;
  let failCount = 0;

  const startTime = Date.now();

  // Helper hàm chạy theo batch concurrency
  let currentIndex = 0;
  async function worker() {
    while (currentIndex < TOTAL_REQUESTS) {
      const idx = currentIndex++;
      try {
        const res = await axios.post(`${FEE_URL}/students/1/payments`, { amount: 1000 });
        if (res.status === 201 && res.data?.status === 'PAID') {
          successCount++;
        } else {
          failCount++;
        }
      } catch (err) {
        failCount++;
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);
  const totalDuration = Date.now() - startTime;

  // Lấy stats từ ngân hàng
  const statsRes = await axios.get(`${BANK_URL}/stats`);
  const bankStats = statsRes.data;

  console.log(`- Tổng thời gian hoàn thành 200 requests: ${totalDuration}ms`);
  console.log(`- Số thanh toán thành công: ${successCount}/${TOTAL_REQUESTS}`);
  console.log(`- Thống kê phía Ngân hàng (/stats):`, bankStats);

  const passT1_Count = successCount === TOTAL_REQUESTS;
  const passT1_Conn = bankStats.connections <= 20;

  console.log(`  [Check 1] 200/200 thanh toán thành công: ${passT1_Count ? '✅ ĐẠT' : '❌ KHÔNG ĐẠT'}`);
  console.log(`  [Check 2] Số kết nối TCP ngân hàng mở (${bankStats.connections}) <= 20: ${passT1_Conn ? '✅ ĐẠT' : '❌ KHÔNG ĐẠT'}`);

  // Bước 2: Nhàn rỗi 6.5 giây (để ngân hàng đóng kết nối cũ vì idle timeout 5s)
  console.log('\n👉 BƯỚC 2: Chờ nhàn rỗi 6.5 giây (quá thời hạn 5s của ngân hàng để đóng kết nối cũ)...');
  for (let s = 1; s <= 6; s++) {
    await sleep(1000);
    process.stdout.write(`  ... chờ ${s}s/6.5s\r`);
  }
  await sleep(500);
  console.log('\n✅ Đã qua 6.5 giây idle.');

  // Bước 3: Gửi tiếp 5 yêu cầu thanh toán
  console.log('👉 BƯỚC 3: Gửi tiếp 5 yêu cầu thanh toán sau thời gian nhàn rỗi...');
  let afterIdleSuccess = 0;
  for (let i = 1; i <= 5; i++) {
    try {
      const res = await axios.post(`${FEE_URL}/students/1/payments`, { amount: 1000 });
      if (res.status === 201 && res.data?.status === 'PAID') {
        afterIdleSuccess++;
      }
    } catch (e) {}
  }
  const passT2 = afterIdleSuccess === 5;
  console.log(`- Kết quả sau khi idle: ${afterIdleSuccess}/5 thành công`);
  console.log(`  [Check 3] Vài yêu cầu tiếp theo vẫn thành công sau khi socket cũ bị đóng: ${passT2 ? '✅ ĐẠT' : '❌ KHÔNG ĐẠT'}`);

  bankProcess.kill();
  console.log('\n===============================================================');
  const allPass = passT1_Count && passT1_Conn && passT2;
  console.log(`🎯 KẾT LUẬN TÌNH HUỐNG 3: ${allPass ? '🏆 TẤT CẢ TIÊU CHÍ ĐÃ ĐẠT!' : '⚠️ CÓ TIÊU CHÍ CHƯA ĐẠT'}`);
  console.log('===============================================================\n');
}

runTest().catch(console.error);
