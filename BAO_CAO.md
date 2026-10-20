# BÁO CÁO KẾT QUẢ THỰC HÀNH LAB 3
## CHỦ ĐỀ: KẾT NỐI VÀ DUY TRÌ KẾT NỐI GIỮA CÁC SERVICE (SOA / MICROSERVICES)

* **Học phần:** Phần mềm hướng dịch vụ (Service-Oriented Architecture)  
* **Giảng viên hướng dẫn:** ThS. Nguyễn Việt Dũng  
* **Nhóm thực hiện:** Nhóm sinh viên  
* **Thời gian thực hiện:** Sau buổi học 7–8  
* **Công nghệ sử dụng:** Node.js (v18+), Express, Axios, HTTP Agent Connection Pool  

---

## MỤC LỤC
1. [GIỚI THIỆU VÀ MỤC TIÊU](#1-giới-thiệu-và-mục-tiêu)
2. [KIẾN TRÚC VÀ THIẾT KẾ HỆ THỐNG](#2-kiến-trúc-và-thiết-kế-hệ-thống)
3. [GIẢI PHÁP KỸ THUẬT VÀ TRIỂN KHAI](#3-giải-pháp-kỹ-thuật-và-triển-khai)
4. [KẾT QUẢ THỰC NGHIỆM CHI TIẾT 4 TÌNH HUỐNG SỰ CỐ](#4-kết-quả-thực-nghiệm-chi-tiết-4-tình-huống-sự-cố)
5. [BẢNG TỔNG HỢP SỐ LIỆU ĐO LƯỜNG](#5-bảng-tổng-hợp-số-liệu-đo-lường)
6. [BÀI HỌC KINH NGHIỆM VÀ KẾT LUẬN](#6-bài-học-kinh-nghiệm-và-kết-luận)

---

## 1. GIỚI THIỆU VÀ MỤC TIÊU

### 1.1. Bối cảnh
Trong kiến trúc phân tán (Microservices/SOA), việc giao tiếp qua mạng (Network I/O) giữa các dịch vụ không bao giờ là an toàn tuyệt đối. Mạng máy tính vốn dĩ tiềm ẩn các rủi ro: trễ cao (latency), mất gói (packet loss), dịch vụ đối tác quá tải hoặc sập đột ngột (service outage).

Bài thực hành mô phỏng bài toán thực tế: **Hệ thống thu học phí của trường đại học (Fee Service)** tích hợp với **Cổng thanh toán ngân hàng bên thứ ba (Mock Bank)** để thực hiện trừ tiền tài khoản sinh viên.

### 1.2. Mục tiêu cần đạt
* Xây dựng 2 dịch vụ độc lập có khả năng giao tiếp HTTP qua mạng.
* Làm chủ kỹ thuật **Duy trì kết nối (HTTP Keep-Alive / TCP Connection Pooling)** để giảm chi phí bắt tay TCP.
* Làm chủ kỹ thuật **Client-Side Timeout** và cơ chế **Non-blocking I/O** để bảo vệ dịch vụ nội bộ không bị kéo sập khi đối tác bị nghẽn.
* Triển khai cơ chế **Idempotent Retry (Thử lại an toàn)** kết hợp với **Phân loại lỗi mạng** (Network Failure Classification):
  * Không bao giờ trừ tiền 2 lần cho cùng một lệnh thanh toán (`duplicates = 0`).
  * Chỉ giảm trừ công nợ khi ngân hàng chắc chắn đã xác nhận trừ tiền thành công.
  * Phản hồi trạng thái chính xác theo đúng bảng quy ước chuẩn quốc tế.

---

## 2. KIẾN TRÚC VÀ THIẾT KẾ HỆ THỐNG

### 2.1. Sơ đồ kiến trúc tổng quan

```
[ Sinh viên / Client ]
         │
         │ (HTTP REST)
         ▼
┌─────────────────────────────────────────────────────────────┐
│                   FEE SERVICE (Port 4001)                   │
│                                                             │
│  - GET  /students/:id/fees (In-memory debt store)           │
│  - POST /students/:id/payments                              │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ HTTP Keep-Alive Agent Pool (maxSockets: 20)           │  │
│  │ Timeout Budgeting (<= 4.5s)                           │  │
│  │ Idempotent Retry Engine (Idempotency-Key: P1, P2...)  │  │
│  │ Error Classifier (4xx vs 500 vs 503 vs 504)           │  │
│  └──────────────────────────┬────────────────────────────┘  │
└─────────────────────────────┼───────────────────────────────┘
                              │
                              │ (HTTP/1.1 Keep-Alive Connection)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   MOCK BANK (Port 4002)                     │
│                                                             │
│  - POST /charges  (Xử lý trừ tiền, kiểm tra Idempotency)    │
│  - GET  /stats    (Thống kê TCP Connections, duplicates...) │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Fault Injection Simulation Engine:                    │  │
│  │   • DELAY_MS   : Giả lập mạng chậm                    │  │
│  │   • FAIL_RATE  : Lỗi 500 trước khi trừ tiền           │  │
│  │   • DROP_RATE  : Trừ tiền xong ngắt TCP đột ngột      │  │
│  │ Idle Keep-Alive Timeout: 5000ms                       │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 2.2. Bảng quy ước trạng thái kết quả thanh toán

| HTTP Status | Thuộc tính `status` | Ý nghĩa nghiệp vụ | Hành động với công nợ |
| :---: | :---: | :--- | :--- |
| **201** | `PAID` | Ngân hàng xác nhận đã trừ tiền thành công | **Giảm công nợ** của sinh viên |
| **400 / 402** | `FAILED` | Ngân hàng từ chối rõ ràng (vượt hạn mức 20tr, số tiền sai) | Giữ nguyên công nợ, **không retry** |
| **503** | `FAILED` | Chắc chắn chưa trừ tiền (Ngân hàng đang tắt/không kết nối được) | Giữ nguyên công nợ, báo lỗi ngay |
| **504** | `PENDING` | Không rõ đã trừ hay chưa (Quá hạn chờ / đứt mạng giữa chừng) | Giữ nguyên công nợ, chuyển đối soát |

---

## 3. GIẢI PHÁP KỸ THUẬT VÀ TRIỂN KHAI

### 3.1. Quản lý kết nối TCP Pool (HTTP Keep-Alive)
* **Vấn đề:** Nếu không dùng Keep-Alive, mỗi request HTTP/1.1 đều phải thực hiện bắt tay 3 bước TCP (SYN $\to$ SYN-ACK $\to$ ACK) và đóng kết nối (FIN $\to$ ACK), gây lãng phí socket và độ trễ cao.
* **Giải pháp:** Cấu hình `http.Agent` gắn vào `axios`:
  ```javascript
  const httpAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 20,       // Khống chế tối đa 20 TCP socket đồng thời
    maxFreeSockets: 10,   // Giữ sẵn 10 socket rảnh rỗi trong pool
    keepAliveMsecs: 60000,
    timeout: 60000
  });
  ```
* **Xử lý Socket Reset sau thời gian nhàn rỗi:** Phía ngân hàng tự ngắt socket rảnh sau 5 giây (`server.keepAliveTimeout = 5000`). Fee Service trang bị cơ chế tự động bắt lỗi `ECONNRESET` trên socket cũ và tái khởi tạo socket mới trong suốt với người dùng.

### 3.2. Quản lý thời gian chờ (Timeout Budgeting) & Non-blocking I/O
* **Vấn đề:** Nếu ngân hàng ngâm request 5 giây, Fee Service không thể chờ theo vì sẽ làm nghẽn tài nguyên và vượt trần cho phép (4.5s).
* **Giải pháp:**
  * Cấu hình trần thời gian tổng cho toàn bộ quy trình thanh toán: `MAX_TOTAL_TIME = 4300ms` ($\le 4.5s$).
  * Mỗi lần gọi gán timeout: `attemptTimeout = Math.min(1400, remainingTime)`.
  * Khi quá hạn chờ, Axios ngắt kết nối với lỗi `ECONNABORTED`, Fee Service chuyển trạng thái ngay thành `504 PENDING`.
  * Node.js Event Loop không bị block, đảm bảo API tra cứu nợ `GET /fees` luôn phản hồi dưới **300ms**.

### 3.3. Phân loại lỗi mạng và Cơ chế Idempotent Retry
* **Header `Idempotency-Key`:** Mỗi lệnh thanh toán sinh một mã tăng dần duy nhất (`P1`, `P2`, `P3`...). Header này được gửi kèm sang ngân hàng.
* **Phía Ngân hàng:** Lưu kết quả của từng giao dịch vào `idempotencyStore (Map)`. Nếu nhận lại một key đã tồn tại, trả lại ngay kết quả cũ mà không thực hiện trừ tiền lần 2 (`duplicates = 0`).
* **Chiến lược Retry tại Fee Service:**
  * `ECONNREFUSED` / `ENOTFOUND` (Bank tắt): **Không retry**, trả ngay `503 FAILED`.
  * Mã `4xx` (400, 402 - Lỗi nghiệp vụ): **Không retry**, trả nguyên mã lỗi về cho client.
  * Mã `500` (Lỗi nội bộ tạm thời) hoặc `ECONNRESET` (Đứt mạng giữa chừng): **Thực hiện Retry** (tối đa 2 lần nữa) với cùng `Idempotency-Key`.

---

## 4. KẾT QUẢ THỰC NGHIỆM CHI TIẾT 4 TÌNH HUỐNG SỰ CỐ

### 4.1. Tình huống 1: Ngân hàng không kết nối được, rồi hoạt động lại
* **Kịch bản:** Tắt Mock Bank (cổng 4002), gửi request thanh toán; kiểm tra Fee Service; sau đó bật lại Bank mà không khởi động lại Fee Service.
* **Kết quả đo lường thực tế:**
  * **Khi Bank tắt:** Trả về HTTP `503 FAILED`, có đầy đủ `error` và `paymentId`. Thời gian phản hồi: **33ms** (tiêu chuẩn $< 1.5s$).
  * **Kiểm tra Fee Service:** Không bị sập/crash; API `GET /students/1/fees` phản hồi cực nhanh trong **2ms** ($< 300ms$).
  * **Khi Bank bật lại:** Lệnh thanh toán tiếp theo thành công ngay lập tức: HTTP `201 PAID`, công nợ giảm trừ chính xác từ 50.000.000đ xuống 49.900.000đ.
* **Đánh giá:** ✅ **ĐẠT TẤT CẢ TIÊU CHÍ**.

---

### 4.2. Tình huống 2: Ngân hàng phản hồi rất chậm (`DELAY_MS=5000`)
* **Kịch bản:** Khởi động Bank với `DELAY_MS=5000`. Gửi 1 thanh toán để đo thời gian. Bắn đồng thời 20 thanh toán và liên tục gọi `GET /students/1/fees`.
* **Kết quả đo lường thực tế:**
  * **Thời gian ngắt timeout:** Fee Service tự động ngắt ở mốc **4312ms** ($\le 4500ms$).
  * **Mã trả về:** HTTP `504` kèm `status: "PENDING"`. Công nợ không bị trừ oan.
  * **Độ trễ của API xem công nợ:** Trong lúc 20 request thanh toán đang bị nghẽn ở background, các lệnh `GET /students/1/fees` vẫn phản hồi tức thì: **2ms – 3ms** (tiêu chuẩn $< 300ms$).
  * **Độ ổn định:** Cả 20/20 request đều kết thúc an toàn ở trạng thái `504 PENDING` đúng hạn, server không bị treo hay quá tải bộ nhớ.
* **Đánh giá:** ✅ **ĐẠT TẤT CẢ TIÊU CHÍ**.

---

### 4.3. Tình huống 3: Duy trì kết nối TCP (HTTP Keep-Alive Pool)
* **Kịch bản:** Chạy Bank bình thường. Gửi **200 thanh toán**, chia theo đợt **10 request đồng thời** (1.000đ/lần). Đo số kết nối TCP ở `/stats`. Sau đó để hệ thống nghỉ 6.5s (ngân hàng đóng kết nối cũ sau 5s) rồi gửi tiếp 5 request.
* **Kết quả đo lường thực tế:**
  * **Tổng thời gian xử lý:** Toàn bộ 200 giao dịch hoàn thành chỉ trong **218ms**.
  * **Tỷ lệ thành công:** **200/200 giao dịch thành công (100%)**.
  * **Số kết nối TCP mở mới (`connections`):** Phía ngân hàng ghi nhận đúng **10 TCP connections** (tiêu chuẩn $\le 20$). Các request tiếp theo đều tái sử dụng socket trong pool.
  * **Kiểm tra sau nhàn rỗi 6.5 giây:** Cả **5/5 request** gửi sau thời gian idle đều thành công trơn tru. Fee Service tự động mở lại socket mới khi phát hiện socket cũ đã bị server đóng.
* **Đánh giá:** ✅ **ĐẠT TẤT CẢ TIÊU CHÍ**.

---

### 4.4. Tình huống 4: Đứt giữa chừng, Lỗi tạm thời, và Bị từ chối
Bao gồm 3 kịch bản lỗi phân tán phức tạp:

#### Kịch bản 4(a) — `DROP_RATE=0.3` (Trừ tiền xong ngắt kết nối đột ngột):
* **Số lượng:** Gửi lần lượt 60 thanh toán.
* **Kết quả:**
  * `duplicates`: **0** (Tuyệt đối không bị trừ tiền 2 lần).
  * Số lệnh `PAID`: **60/60** thành công nhờ cơ chế Idempotent Retry (lần 1 bị drop, lần 2 gửi lại cùng `Idempotency-Key` được Bank trả kết quả cũ đã lưu).
  * Đối soát công nợ: Giảm chính xác **60.000đ** tương ứng với 60 lệnh PAID.
  * Thời gian phản hồi tối đa: **78ms** ($\le 4.5s$).

#### Kịch bản 4(b) — `FAIL_RATE=0.3` (Lỗi 500 trước khi trừ tiền):
* **Số lượng:** Gửi lần lượt 60 thanh toán.
* **Kết quả:**
  * Tỷ lệ thành công: **59/60 (98.3%)** (vượt xa mức yêu cầu $\ge 54/60$).
  * `duplicates`: **0**.
  * Thời gian phản hồi tối đa: **129ms** ($\le 4.5s$).

#### Kịch bản 4(c) — Lỗi từ chối nghiệp vụ (Thanh toán 25.000.000đ > 20.000.000đ):
* **Kết quả:**
  * Mã HTTP: Trả về chính xác **402 FAILED**.
  * Phía ngân hàng: Nhận **đúng 1 request duy nhất** (`requests = 1`, `charges = 0`). Hệ thống nhận diện lỗi 4xx và **tuyệt đối không retry**.

* **Đánh giá:** ✅ **ĐẠT TẤT CẢ TIÊU CHÍ**.

---

## 5. BẢNG TỔNG HỢP SỐ LIỆU ĐO LƯỜNG

Dưới đây là bảng tổng hợp so sánh các chỉ số đo lường trước và sau khi hoàn thiện giải pháp:

| Tình huống | Chỉ số đo | Trước khi sửa | Sau khi sửa (Thực tế) | Đánh giá |
| :--- | :--- | :--- | :--- | :---: |
| **TH 1: Ngân hàng tắt** | Mã trả về khi Bank tắt | Crash / Treo vô tận | **503 FAILED** (Phản hồi sau **33ms** < 1.5s) | ✅ **ĐẠT** |
| | Khả năng tự phục hồi | Phải restart Fee Service | Tự kết nối lại **201 PAID** ngay khi Bank bật | ✅ **ĐẠT** |
| | Tra cứu nợ (`GET /fees`) | Bị treo | **2ms** (< 300ms) | ✅ **ĐẠT** |
| **TH 2: Ngân hàng trễ 5s**| Thời gian trả lời thanh toán | Treo 5000ms | **4312ms** (≤ 4.5s), trả **504 PENDING** | ✅ **ĐẠT** |
| | Tra cứu nợ lúc cao điểm | Bị nghẽn hàng đợi | **2ms – 3ms** (< 300ms) | ✅ **ĐẠT** |
| | 20 request đồng thời | Treo server | 20/20 trả về **504 PENDING** an toàn | ✅ **ĐẠT** |
| **TH 3: Keep-Alive Pool** | Số kết nối TCP (200 reqs) | ~200 connections | **10 connections** (≤ 20) | ✅ **ĐẠT** |
| | Tỷ lệ thành công | Dễ cạn socket | **200/200 (100%)** trong **218ms** | ✅ **ĐẠT** |
| | Sau khi nhàn rỗi 6.5s | Lỗi `ECONNRESET` | **5/5 thành công** (tự phục hồi socket mới) | ✅ **ĐẠT** |
| **TH 4a: DROP_RATE 0.3** | Số lần trừ trùng (`duplicates`)| Có thể > 0 | **duplicates = 0** | ✅ **ĐẠT** |
| | Tỷ lệ thành công | Rớt 30% | **60/60** thành công nhờ Idempotent Retry | ✅ **ĐẠT** |
| | Đối soát công nợ | Lệch tiền | Giảm chính xác **60.000đ** theo lệnh PAID | ✅ **ĐẠT** |
| **TH 4b: FAIL_RATE 0.3** | Tỷ lệ thành công | Rớt 30% | **59/60 (98.3%)** (vượt chuẩn ≥ 54/60) | ✅ **ĐẠT** |
| | Số lần trừ trùng (`duplicates`)| Có thể > 0 | **duplicates = 0** | ✅ **ĐẠT** |
| **TH 4c: Lỗi từ chối 402**| Mã HTTP trả về | Không chuẩn | **402 FAILED** | ✅ **ĐẠT** |
| | Số request Bank nhận | Bị retry lãng phí | **Đúng 1 request** (Không retry lỗi 4xx) | ✅ **ĐẠT** |
| **Toàn bộ hệ thống** | Trần thời gian phản hồi | Vượt quá 5s | Luôn **≤ 4500ms** cho mọi trường hợp | ✅ **ĐẠT** |

---

## 6. BÀI HỌC KINH NGHIỆM VÀ KẾT LUẬN

Qua bài thực hành Lab 3, nhóm đã rút ra được những bài học cốt lõi trong thiết kế hệ thống phần mềm hướng dịch vụ (SOA):

1. **Tầm quan trọng của Idempotency trong thanh toán:**
   * Trong mạng phân tán, hiện tượng *"gửi thành công nhưng không nhận được phản hồi"* xảy ra rất thường xuyên. Nếu không có `Idempotency-Key`, việc thử lại (retry) chắc chắn sẽ làm khách hàng bị trừ tiền nhiều lần.
2. **Sức mạnh của Connection Pooling:**
   * Việc duy trì kết nối TCP (Keep-Alive) giúp tăng tốc độ xử lý lên gấp nhiều lần (200 request chỉ mất 218ms) và giải phóng gánh nặng bắt tay TCP cho cả Client lẫn Server.
3. **Chiến lược Timeout Budgeting và Fail-fast:**
   * Không bao giờ được tin tưởng hoàn toàn vào tốc độ của dịch vụ bên thứ ba. Phải luôn chủ động đặt thời gian chờ (timeout) để tự giải phóng tài nguyên, tránh hiệu ứng domino làm sập toàn bộ hệ thống của chính mình.
4. **Phân loại lỗi thông minh (Smart Error Handling):**
   * Phải phân biệt rõ ràng giữa **Lỗi tạm thời (Transient error - 500, đứt mạng)** có thể retry và **Lỗi nghiệp vụ (Business error - 400, 402)** tuyệt đối không được retry.

---
*Báo cáo hoàn thành và đã được kiểm nghiệm thực tế trên môi trường Node.js.*
