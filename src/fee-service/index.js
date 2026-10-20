const express = require('express');
const http = require('http');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.FEE_PORT || 4001;
const BANK_URL = process.env.BANK_URL || 'http://localhost:4002';

// 1. Cấu hình HTTP Agent với Keep-Alive để tái sử dụng kết nối TCP
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 20,        // Giới hạn tối đa 20 socket đồng thời theo đề bài
  maxFreeSockets: 10,    // Giữ sẵn các socket rảnh rỗi trong pool
  keepAliveMsecs: 60000,
  timeout: 60000
});

// Tạo instance axios gắn với Agent và base URL
const bankClient = axios.create({
  baseURL: BANK_URL,
  httpAgent: httpAgent,
  validateStatus: () => true // Không throw exception tự động để ta chủ động phân loại mã HTTP
});

// Dữ liệu sinh viên in-memory theo đề bài
const initialStudents = {
  '1': 50000000,
  '2': 0,
  '3': 3200000
};

let students = { ...initialStudents };
let paymentCounter = 0;

// API reset công nợ (phục vụ test tự động)
app.post('/students/reset', (req, res) => {
  students = { ...initialStudents };
  paymentCounter = 0;
  console.log('[FEE SERVICE] Đã reset công nợ sinh viên và bộ đếm payment.');
  res.json({ message: 'Reset successfully', students });
});

// API lấy công nợ sinh viên
app.get('/students/:id/fees', (req, res) => {
  const { id } = req.params;
  if (students[id] === undefined) {
    return res.status(404).json({ error: 'Không tìm thấy sinh viên' });
  }

  res.json({
    studentId: id,
    debt: students[id]
  });
});

// Hàm gọi Bank kèm cơ chế Idempotent Retry & Phân loại lỗi
async function callBankWithRetry({ paymentId, amount }) {
  const MAX_TOTAL_TIME = 4300; // Tổng thời gian trần <= 4.5 giây
  const startTime = Date.now();
  const maxAttempts = 3;       // Tối đa 3 lần gọi (1 lần gốc + 2 lần retry)

  let lastError = null;
  let lastResponse = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const elapsed = Date.now() - startTime;
    const remainingTime = MAX_TOTAL_TIME - elapsed;

    // Nếu thời gian còn lại quá ít, không thử thêm để đảm bảo tổng thời gian <= 4.5s
    if (remainingTime <= 400 && attempt > 1) {
      console.log(`[FEE SERVICE] ${paymentId}: Hết quỹ thời gian (${elapsed}ms). Dừng retry.`);
      break;
    }

    // Timeout cho mỗi lần gọi: tối đa 1400ms hoặc thời gian còn lại
    const attemptTimeout = Math.min(1400, remainingTime);

    try {
      console.log(`[FEE SERVICE] ${paymentId}: Gọi Bank lần ${attempt} (timeout: ${attemptTimeout}ms)...`);
      const response = await bankClient.post(
        '/charges',
        { reference: paymentId, amount },
        {
          headers: {
            'Idempotency-Key': paymentId,
            'Content-Type': 'application/json'
          },
          timeout: attemptTimeout
        }
      );

      lastResponse = response;

      // 1. Thành công: 201
      if (response.status === 201) {
        return { success: true, status: 201, data: response.data };
      }

      // 2. Ngân hàng từ chối rõ ràng: các mã 4xx (400, 402, v.v.)
      // -> TUYỆT ĐỐI KHÔNG RETRY
      if (response.status >= 400 && response.status < 500) {
        console.log(`[FEE SERVICE] ${paymentId}: Ngân hàng từ chối rõ ràng HTTP ${response.status}. Không retry.`);
        return {
          success: false,
          status: response.status,
          rejection: true,
          data: response.data
        };
      }

      // 3. Lỗi 500 từ ngân hàng: Lỗi tạm thời -> Có thể retry
      console.warn(`[FEE SERVICE] ${paymentId}: Ngân hàng trả về HTTP ${response.status}. Chuẩn bị retry...`);
      lastError = new Error(`Bank error HTTP ${response.status}`);
      lastError.httpStatus = response.status;
    } catch (err) {
      lastError = err;
      const errCode = err.code || err.message;
      console.warn(`[FEE SERVICE] ${paymentId}: Lần gọi ${attempt} thất bại (${errCode}).`);

      // Nếu ngân hàng chưa bật / không kết nối được (ECONNREFUSED / ENOTFOUND)
      // -> Đây là "Chắc chắn chưa trừ tiền" -> KHÔNG RETRY để phản hồi ngay < 1.5s
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        console.log(`[FEE SERVICE] ${paymentId}: Không thể kết nối tới ngân hàng (${err.code}). Trả về 503 ngay.`);
        return {
          success: false,
          status: 503,
          isConnRefused: true,
          error: 'Không thể kết nối tới cổng ngân hàng (Dịch vụ ngân hàng đang tắt hoặc không tồn tại)'
        };
      }

      // Nếu là lỗi đứt socket giữa chừng (ECONNRESET, EPIPE, socket hang up)
      // -> Do DROP_RATE hoặc stale socket -> Retry tiếp với cùng Idempotency-Key!
    }

    // Nghỉ 50ms giữa các lần retry nếu còn lượt
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  // Nếu duyệt hết vòng lặp mà vẫn không thành công:
  // Nếu Bank từ chối với mã 4xx
  if (lastResponse && lastResponse.status >= 400 && lastResponse.status < 500) {
    return {
      success: false,
      status: lastResponse.status,
      rejection: true,
      data: lastResponse.data
    };
  }

  // Trường hợp không biết chắc đã trừ tiền hay chưa (Timeout hoặc đứt kết nối sau khi gửi request)
  // Quy ước: Trả về 504 PENDING
  return {
    success: false,
    status: 504,
    isPending: true,
    error: lastError?.message || 'Không nhận được phản hồi xác nhận từ ngân hàng'
  };
}

// API thanh toán học phí
app.post('/students/:id/payments', async (req, res) => {
  const { id } = req.params;
  const { amount } = req.body || {};

  // 1. Kiểm tra sinh viên có tồn tại không
  if (students[id] === undefined) {
    return res.status(404).json({ error: 'Không tìm thấy sinh viên', paymentId: null, status: 'FAILED' });
  }

  const numAmount = Number(amount);
  if (!numAmount || isNaN(numAmount) || numAmount <= 0) {
    return res.status(400).json({
      error: 'Số tiền thanh toán không hợp lệ',
      paymentId: null,
      status: 'FAILED'
    });
  }

  // 2. Kiểm tra số tiền không vượt quá công nợ hiện tại
  const currentDebt = students[id];
  if (numAmount > currentDebt) {
    return res.status(400).json({
      error: `Số tiền thanh toán (${numAmount}đ) vượt quá công nợ hiện tại (${currentDebt}đ)`,
      paymentId: null,
      status: 'FAILED'
    });
  }

  // 3. Tạo mã lệnh thanh toán P1, P2...
  paymentCounter++;
  const paymentId = `P${paymentCounter}`;

  // 4. Gọi sang Ngân hàng
  const result = await callBankWithRetry({ paymentId, amount: numAmount });

  // 5. Xử lý kết quả theo bảng quy ước đề bài
  if (result.success && result.status === 201) {
    // Quy tắc nghiệp vụ 1: Công nợ CHỈ giảm khi ngân hàng đã trừ tiền thành công
    students[id] = Math.max(0, students[id] - numAmount);
    console.log(`[FEE SERVICE] ${paymentId}: Thanh toán thành công! Công nợ SV ${id} còn lại: ${students[id]}đ`);

    return res.status(201).json({
      paymentId,
      status: 'PAID',
      amount: numAmount,
      remainingDebt: students[id],
      bankChargeId: result.data?.chargeId
    });
  }

  // Ngân hàng từ chối rõ ràng (402, 400...)
  if (result.rejection) {
    return res.status(result.status).json({
      paymentId,
      status: 'FAILED',
      error: result.data?.error || 'Ngân hàng từ chối giao dịch'
    });
  }

  // Chắc chắn chưa trừ tiền (503): Không kết nối được tới ngân hàng
  if (result.isConnRefused) {
    return res.status(503).json({
      paymentId,
      status: 'FAILED',
      error: result.error
    });
  }

  // Không biết đã trừ tiền hay chưa (504): Hết thời gian chờ hoặc đứt kết nối
  return res.status(504).json({
    paymentId,
    status: 'PENDING',
    error: 'Không biết ngân hàng đã trừ tiền hay chưa (hết thời gian chờ hoặc đứt kết nối)'
  });
});

const server = http.createServer(app);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(`🎓 Fee Service đang chạy trên cổng ${PORT}`);
    console.log(`- BANK_URL: ${BANK_URL}`);
    console.log(`- KeepAlive Agent MaxSockets: 20`);
    console.log(`=================================================`);
  });
}

module.exports = { app, server, students, initialStudents };
