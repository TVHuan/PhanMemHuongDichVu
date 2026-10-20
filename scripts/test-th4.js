const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');

const FEE_URL = 'http://localhost:4001';
const BANK_URL = 'http://localhost:4002';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startBank(envVars) {
  const bankProcess = spawn('node', [path.join(__dirname, '../src/mock-bank/index.js')], {
    env: { ...process.env, BANK_PORT: '4002', ...envVars },
    stdio: 'ignore'
  });

  for (let i = 0; i < 20; i++) {
    await sleep(200);
    try {
      await axios.get(`${BANK_URL}/stats`);
      break;
    } catch (e) {}
  }
  return bankProcess;
}

async function runTest() {
  console.log('=============================================================================');
  console.log('🧪 BẮT ĐẦU TEST TÌNH HUỐNG 4: ĐỨT GIỮA CHỪNG, LỖI TẠM THỜI, TỪ CHỐI NGHIỆP VỤ');
  console.log('=============================================================================\n');

  try {
    await axios.get(`${FEE_URL}/students/1/fees`);
  } catch (e) {
    console.error('❌ LỖI: Fee Service chưa được bật trên cổng 4001! Hãy chạy npm run start:fee trước.');
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // KỊCH BẢN (A): DROP_RATE = 0.3 (Trừ tiền xong rồi ngắt kết nối đột ngột)
  // -------------------------------------------------------------------------
  console.log('👉 KỊCH BẢN 4(a): DROP_RATE = 0.3 (Ngân hàng trừ tiền xong ngắt kết nối)...');
  let bankA = await startBank({ DROP_RATE: '0.3' });
  await axios.post(`${FEE_URL}/students/reset`);
  await axios.post(`${BANK_URL}/stats/reset`);

  const initialDebtRes = await axios.get(`${FEE_URL}/students/1/fees`);
  const initialDebt = initialDebtRes.data.debt;

  let paidCountA = 0;
  let pendingCountA = 0;
  let maxTimeA = 0;
  const AMOUNT_PER_PAYMENT = 1000;

  console.log('- Đang gửi lần lượt 60 thanh toán (1.000đ/lần)...');
  for (let i = 1; i <= 60; i++) {
    const startT = Date.now();
    try {
      const res = await axios.post(`${FEE_URL}/students/1/payments`, { amount: AMOUNT_PER_PAYMENT });
      const elapsed = Date.now() - startT;
      if (elapsed > maxTimeA) maxTimeA = elapsed;

      if (res.status === 201 && res.data?.status === 'PAID') {
        paidCountA++;
      }
    } catch (err) {
      const elapsed = Date.now() - startT;
      if (elapsed > maxTimeA) maxTimeA = elapsed;

      const res = err.response;
      if (res?.status === 504 && res?.data?.status === 'PENDING') {
        pendingCountA++;
      }
    }
  }

  const statsA = (await axios.get(`${BANK_URL}/stats`)).data;
  const finalDebtResA = await axios.get(`${FEE_URL}/students/1/fees`);
  const finalDebtA = finalDebtResA.data.debt;
  const debtReducedA = initialDebt - finalDebtA;
  const expectedDebtReducedA = paidCountA * AMOUNT_PER_PAYMENT;

  console.log(`- Kết quả 4(a): PAID=${paidCountA}/60, PENDING=${pendingCountA}/60, MaxTime=${maxTimeA}ms`);
  console.log(`- Bank Stats:`, statsA);
  console.log(`- Công nợ giảm thực tế: ${debtReducedA}đ, dự kiến theo lệnh PAID: ${expectedDebtReducedA}đ`);

  const pass4a_Dup = statsA.duplicates === 0;
  const pass4a_Rate = paidCountA >= 54;
  const pass4a_Debt = debtReducedA === expectedDebtReducedA;
  const pass4a_Time = maxTimeA <= 4500;

  console.log(`  [Check 4a.1] duplicates = 0: ${pass4a_Dup ? '✅ ĐẠT' : '❌ KHÔNG ĐẠT'}`);
  console.log(`  [Check 4a.2] Số thanh toán thành công >= 54/60 (${paidCountA}/60): ${pass4a_Rate ? '✅ ĐẠT' : '❌ KHÔNG ĐẠT'}`);
  console.log(`  [Check 4a.3] Công nợ giảm đúng bằng số tiền các lệnh PAID: ${pass4a_Debt ? '✅ ĐẠT' : '❌ KHÔNG ĐẠT'}`);
  console.log(`  [Check 4a.4] Thời gian phản hồi <= 4.5s: ${pass4a_Time ? '✅ ĐẠT' : '❌ KHÔNG ĐẠT'}`);

  bankA.kill();
  await sleep(1000);

  // -------------------------------------------------------------------------
  // KỊCH BẢN (B): FAIL_RATE = 0.3 (Lỗi 500 tạm thời trước khi trừ tiền)
  // -------------------------------------------------------------------------
  console.log('\n👉 KỊCH BẢN 4(b): FAIL_RATE = 0.3 (Lỗi 500 trước khi trừ tiền)...');
  let bankB = await startBank({ FAIL_RATE: '0.3' });
  await axios.post(`${FEE_URL}/students/reset`);
  await axios.post(`${BANK_URL}/stats/reset`);

  let paidCountB = 0;
  let maxTimeB = 0;

  console.log('- Đang gửi lần lượt 60 thanh toán (1.000đ/lần)...');
  for (let i = 1; i <= 60; i++) {
    const startT = Date.now();
    try {
      const res = await axios.post(`${FEE_URL}/students/1/payments`, { amount: AMOUNT_PER_PAYMENT });
      const elapsed = Date.now() - startT;
      if (elapsed > maxTimeB) maxTimeB = elapsed;

      if (res.status === 201 && res.data?.status === 'PAID') {
        paidCountB++;
      }
    } catch (err) {
      const elapsed = Date.now() - startT;
      if (elapsed > maxTimeB) maxTimeB = elapsed;
    }
  }

  const statsB = (await axios.get(`${BANK_URL}/stats`)).data;
  console.log(`- Kết quả 4(b): PAID=${paidCountB}/60, MaxTime=${maxTimeB}ms`);
  console.log(`- Bank Stats:`, statsB);

  const pass4b_Dup = statsB.duplicates === 0;
  const pass4b_Rate = paidCountB >= 54;
  const pass4b_Time = maxTimeB <= 4500;

  console.log(`  [Check 4b.1] Số thanh toán thành công >= 54/60 (${paidCountB}/60): ${pass4b_Rate ? '✅ ĐẠT' : '❌ KHÔNG ĐẠT'}`);
  console.log(`  [Check 4b.2] Không trừ tiền 2 lần (duplicates = 0): ${pass4b_Dup ? '✅ ĐẠT' : '❌ KHÔNG ĐẠT'}`);
  console.log(`  [Check 4b.3] Thời gian phản hồi <= 4.5s: ${pass4b_Time ? '✅ ĐẠT' : '❌ KHÔNG ĐẠT'}`);

  bankB.kill();
  await sleep(1000);

  // -------------------------------------------------------------------------
  // KỊCH BẢN (C): LỖI TỪ CHỐI NGHIỆP VỤ (Vượt hạn mức 20.000.000đ)
  // -------------------------------------------------------------------------
  console.log('\n👉 KỊCH BẢN 4(c): Từ chối vì vượt hạn mức (25.000.000đ > 20.000.000đ)...');
  let bankC = await startBank({});
  await axios.post(`${FEE_URL}/students/reset`);
  await axios.post(`${BANK_URL}/stats/reset`);

  let resC;
  try {
    resC = await axios.post(`${FEE_URL}/students/1/payments`, { amount: 25000000 });
  } catch (err) {
    resC = err.response;
  }

  const statsC = (await axios.get(`${BANK_URL}/stats`)).data;
  console.log(`- HTTP Status nhận được: ${resC?.status}, body:`, resC?.data);
  console.log(`- Bank stats: requests=${statsC.requests}, charges=${statsC.charges}`);

  const pass4c_Status = resC?.status === 402 && resC?.data?.status === 'FAILED';
  const pass4c_NoRetry = statsC.requests === 1;

  console.log(`  [Check 4c.1] Trả về đúng HTTP 402 và status="FAILED": ${pass4c_Status ? '✅ ĐẠT' : '❌ KHÔNG ĐẠT'}`);
  console.log(`  [Check 4c.2] Ngân hàng chỉ nhận đúng 1 request (không retry lỗi 4xx): ${pass4c_NoRetry ? '✅ ĐẠT' : '❌ KHÔNG ĐẠT'}`);

  bankC.kill();
  console.log('\n=============================================================================');
  const allPass = pass4a_Dup && pass4a_Rate && pass4a_Debt && pass4a_Time &&
                  pass4b_Dup && pass4b_Rate && pass4b_Time &&
                  pass4c_Status && pass4c_NoRetry;
  console.log(`🎯 KẾT LUẬN TÌNH HUỐNG 4: ${allPass ? '🏆 TẤT CẢ TIÊU CHÍ ĐÃ ĐẠT!' : '⚠️ CÓ TIÊU CHÍ CHƯA ĐẠT'}`);
  console.log('=============================================================================\n');
}

runTest().catch(console.error);
