const express = require('express');
const http = require('http');

const app = express();
app.use(express.json());

// Cấu hình biến môi trường
const PORT = process.env.BANK_PORT || 4002;
const DELAY_MS = parseInt(process.env.DELAY_MS || '0', 10);
const FAIL_RATE = parseFloat(process.env.FAIL_RATE || '0');
const DROP_RATE = parseFloat(process.env.DROP_RATE || '0');

// Bộ nhớ in-memory
const stats = {
  connections: 0,
  requests: 0,
  charges: 0,
  duplicates: 0
};

// Lưu kết quả idempotency: key -> { status, body }
const idempotencyStore = new Map();

// Lưu danh sách các reference đã từng trừ tiền (để phát hiện duplicates nếu vi phạm)
const chargedReferences = new Set();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// API thống kê
app.get('/stats', (req, res) => {
  res.json({
    connections: stats.connections,
    requests: stats.requests,
    charges: stats.charges,
    duplicates: stats.duplicates
  });
});

// API reset thống kê (hỗ trợ test tự động)
app.post('/stats/reset', (req, res) => {
  stats.requests = 0;
  stats.charges = 0;
  stats.duplicates = 0;
  // stats.connections không reset hoặc reset tuỳ ý, nhưng reset để dễ đo
  stats.connections = 0;
  idempotencyStore.clear();
  chargedReferences.clear();
  console.log('[BANK] Đã reset stats và idempotency store.');
  res.json({ message: 'Stats reset successfully', stats });
});

// API thanh toán /charges
app.post('/charges', async (req, res) => {
  stats.requests++;
  const idempotencyKey = req.headers['idempotency-key'] || req.body?.reference;
  const { reference, amount } = req.body || {};

  console.log(`[BANK] Nhận POST /charges: reference=${reference}, amount=${amount}, Idempotency-Key=${idempotencyKey}`);

  // 1. Kiểm tra Idempotency trước tiên
  if (idempotencyKey && idempotencyStore.has(idempotencyKey)) {
    console.log(`[BANK] Khóa Idempotency "${idempotencyKey}" đã tồn tại. Trả lại kết quả cũ, không trừ tiền.`);
    const cachedResponse = idempotencyStore.get(idempotencyKey);
    return res.status(cachedResponse.status).json(cachedResponse.body);
  }

  // 2. Giả lập DELAY_MS (nếu có)
  if (DELAY_MS > 0) {
    console.log(`[BANK] Giả lập trễ ${DELAY_MS}ms...`);
    await sleep(DELAY_MS);
  }

  // 3. Giả lập FAIL_RATE: lỗi 500 trước khi trừ tiền
  if (FAIL_RATE > 0 && Math.random() < FAIL_RATE) {
    console.log(`[BANK] Giả lập lỗi 500 (FAIL_RATE=${FAIL_RATE}) trước khi trừ tiền.`);
    return res.status(500).json({
      error: 'Ngân hàng gặp sự cố nội bộ tạm thời (500 Internal Server Error)',
      reference
    });
  }

  // 4. Validate nghiệp vụ
  const numAmount = Number(amount);
  if (!numAmount || isNaN(numAmount) || numAmount <= 0) {
    return res.status(400).json({
      error: 'Số tiền thanh toán không hợp lệ',
      reference
    });
  }

  // Vượt hạn mức 20.000.000đ trả 402
  if (numAmount > 20000000) {
    console.log(`[BANK] Từ chối: Số tiền ${numAmount}đ vượt hạn mức 20.000.000đ.`);
    return res.status(402).json({
      error: 'Số tiền giao dịch vượt hạn mức 20.000.000đ',
      reference
    });
  }

  // 5. Trừ tiền thành công
  // Kiểm tra trùng lặp reference (nếu chưa có trong idempotencyStore mà reference đã từng trừ tiền)
  if (reference && chargedReferences.has(reference)) {
    stats.duplicates++;
    console.warn(`[BANK] CẢNH BÁO: Phát hiện trừ tiền trùng lặp cho reference=${reference}! duplicates=${stats.duplicates}`);
  } else if (reference) {
    chargedReferences.add(reference);
  }

  stats.charges++;
  const chargeId = `CHG_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const responseData = {
    chargeId,
    reference,
    amount: numAmount,
    status: 'PAID'
  };

  // Lưu vào Idempotency Store
  if (idempotencyKey) {
    idempotencyStore.set(idempotencyKey, {
      status: 201,
      body: responseData
    });
  }

  // 6. Giả lập DROP_RATE: Trừ tiền xong rồi ngắt kết nối đột ngột
  if (DROP_RATE > 0 && Math.random() < DROP_RATE) {
    console.log(`[BANK] Giả lập DROP_RATE=${DROP_RATE}: Đã trừ tiền (${chargeId}), ngắt kết nối TCP đột ngột.`);
    // Ngắt socket ngay lập tức mà không gửi HTTP header/body
    if (req.socket) {
      req.socket.destroy();
    }
    return;
  }

  console.log(`[BANK] Trừ tiền thành công: ${chargeId}, amount=${numAmount}đ`);
  return res.status(201).json(responseData);
});

// Tạo HTTP Server để kiểm soát connection & keepAliveTimeout
const server = http.createServer(app);

// Giữ kết nối nhàn rỗi tối đa 5 giây theo đề bài
server.keepAliveTimeout = 5000;
server.headersTimeout = 6000; // Phải lớn hơn keepAliveTimeout trong Node.js

// Lắng nghe sự kiện kết nối TCP mới
server.on('connection', (socket) => {
  stats.connections++;
  console.log(`[BANK] New TCP Connection #${stats.connections} from ${socket.remoteAddress}:${socket.remotePort}`);
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(`🏦 Mock Bank Service đang chạy trên cổng ${PORT}`);
    console.log(`- DELAY_MS : ${DELAY_MS}ms`);
    console.log(`- FAIL_RATE: ${FAIL_RATE}`);
    console.log(`- DROP_RATE: ${DROP_RATE}`);
    console.log(`- KeepAlive: ${server.keepAliveTimeout}ms`);
    console.log(`=================================================`);
  });
}

module.exports = { app, server, stats, idempotencyStore };
