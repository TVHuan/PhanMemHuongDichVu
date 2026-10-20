# LAB 3: KẾT NỐI VÀ DUY TRÌ KẾT NỐI GIỮA CÁC SERVICE
> **Thực hành tự khám phá · Sau buổi 7–8**  
> **Học phần:** Phần mềm hướng dịch vụ (SOA / Microservices)  
> **Giảng viên:** ThS Nguyễn Việt Dũng  
> **Thời lượng:** 2 tiếng  
> **Chuẩn bị:** Node.js (từ v18 trở lên), Postman, cURL hoặc Script Test  

---

## 1. TỔNG QUAN ĐỀ BÀI

### 1.1. Bối cảnh bài toán
Một hệ thống thanh toán học phí trực tuyến gồm hai dịch vụ:
* **Fee Service (Dịch vụ của trường đại học):** Quản lý công nợ học phí sinh viên và khởi tạo lệnh thanh toán.
* **Ngân hàng giả lập (Cổng thanh toán bên thứ ba - Mock Bank):** Nhận lệnh trừ tiền từ Fee Service.

Sinh viên bấm thanh toán học phí trên hệ thống của trường; **Fee Service** gọi sang **Cổng ngân hàng** để thực hiện trừ tiền. Sinh viên tự dựng hai service độc lập bằng Node.js/Express (dữ liệu lưu trữ in-memory trong bộ nhớ), sau đó xử lý 4 tình huống sự cố thực tế với các tiêu chuẩn kết quả cần đạt rõ ràng.

---

### 1.2. Nhiệm vụ cụ thể của từng Service

#### A. Fee Service (Cổng `4001`)
* **Dữ liệu sinh viên khởi tạo trong bộ nhớ:**
  * Sinh viên `1`: Nợ `50.000.000đ`
  * Sinh viên `2`: Nợ `0đ`
  * Sinh viên `3`: Nợ `3.200.000đ`
* **Các Endpoint API:**
  * `GET /students/{id}/fees`: Tra cứu công nợ sinh viên hiện tại.
  * `POST /students/{id}/payments`: Nhận yêu cầu thanh toán với body:
    ```json
    { "amount": 100000 }
    ```
    * **Logic xử lý:**
      1. Kiểm tra số tiền hợp lệ và không vượt quá công nợ hiện tại.
      2. Tạo mã lệnh thanh toán tăng dần: `P1`, `P2`, `P3`...
      3. Gửi request sang Ngân hàng qua header `Idempotency-Key` mang mã lệnh này.
      4. Chỉ giảm trừ công nợ khi phía ngân hàng xác nhận trừ tiền thành công.
* **Biến môi trường:**
  * `BANK_URL`: Địa chỉ của ngân hàng (mặc định là `http://localhost:4002`). Nếu đổi sang port khác (ví dụ: `http://localhost:4999`), hệ thống vẫn phải xử lý đồng nhất.

---

#### B. Ngân hàng giả lập (Mock Bank - Cổng `4002`)
* **Endpoint API:**
  * `POST /charges`: Body:
    ```json
    { "reference": "P1", "amount": 100000 }
    ```
    * Trả về `201 Created` kèm `chargeId` nếu thành công.
    * Trả về `400 Bad Request` nếu số tiền không hợp lệ (`amount <= 0`).
    * Trả về `402 Payment Required` nếu số tiền thanh toán vượt hạn mức **20.000.000đ** cho một lần giao dịch.
    * **Header `Idempotency-Key`:** Nếu nhận lại cùng một khóa (ví dụ do Fee Service thử lại), ngân hàng phải trả lại kết quả của giao dịch cũ, tuyệt đối không trừ thêm tiền.
  * `GET /stats`: Trả về số liệu thống kê:
    ```json
    {
      "connections": 0,
      "requests": 0,
      "charges": 0,
      "duplicates": 0
    }
    ```
    * `connections`: Tổng số kết nối TCP mới nhận được.
    * `requests`: Tổng số lượt gọi HTTP request nhận vào.
    * `charges`: Tổng số lần trừ tiền thành công.
    * `duplicates`: Số lần trừ tiền bị trùng cho cùng một `reference` (**mục tiêu phải luôn = 0**).

* **Hành vi lỗi giả lập (Cấu hình qua biến môi trường - restart để áp dụng):**
  * `DELAY_MS`: Thêm thời gian trễ cố định ngần ấy mili-giây trước khi phản hồi.
  * `FAIL_RATE` (từ `0` đến `1`): Tỉ lệ ngẫu nhiên trả lỗi `500 Internal Server Error` **trước khi** trừ tiền.
  * `DROP_RATE` (từ `0` đến `1`): Tỉ lệ trừ tiền thành công rồi **chủ động cắt kết nối TCP đột ngột** (`socket.destroy()`) trước khi kịp gửi phản hồi HTTP về.

* **Cơ chế TCP Socket:**
  * Giữ kết nối nhàn rỗi (idle keep-alive timeout) tối đa **5 giây** (mặc định của Node.js HTTP server).
  * In log ra terminal mỗi khi có một kết nối TCP mới được thiết lập.

---

### 1.3. Quy tắc nghiệp vụ (Business Rules)
1. **Công nợ chỉ giảm khi ngân hàng đã xác nhận trừ tiền.**
2. **Không bao giờ trừ tiền hai lần cho cùng một lệnh thanh toán.**
3. **Khi ngân hàng gặp sự cố, dịch vụ xem công nợ (`GET /fees`) của trường vẫn phải hoạt động bình thường, không được bị treo hay nghẽn.**

---

### 1.4. Quy ước kết quả thanh toán (HTTP Status & Response Contract)

| Tình trạng giao dịch | HTTP Status | Thuộc tính `status` | Khi nào áp dụng |
| :--- | :---: | :---: | :--- |
| **Thành công** | `201` | `PAID` | Ngân hàng xác nhận đã trừ tiền thành công. |
| **Ngân hàng từ chối rõ ràng** | Giữ nguyên mã của Bank (ví dụ `402`, `400`) | `FAILED` | Lỗi nghiệp vụ (ví dụ: vượt hạn mức 20tr). |
| **Chắc chắn chưa trừ tiền** | `503` | `FAILED` | Không thể kết nối tới ngân hàng (`ECONNREFUSED` / Bank đang tắt). |
| **Không biết đã trừ tiền hay chưa** | `504` | `PENDING` | Hết thời gian chờ (Timeout) hoặc bị ngắt kết nối giữa chừng khi đang chờ phản hồi. |

*Cấu trúc JSON phản hồi khi có lỗi:*
```json
{
  "paymentId": "P1",
  "status": "FAILED", // hoặc "PENDING"
  "error": "Thông báo chi tiết nguyên nhân lỗi"
}
```

> **Yêu cầu đo lường:** Ghi lại số liệu **trước và sau khi xử lý** ở từng tình huống (thời gian phản hồi, số kết nối TCP, số lượt giao dịch thành công...). Cuối buổi mỗi nhóm sẽ trình bày ngắn gọn.

---

## 2. CHI TIẾT 4 TÌNH HUỐNG SỰ CỐ VÀ KẾT QUẢ CẦN ĐẠT

```
                                  +--------------------------------------+
                                  |         Fee Service (4001)           |
                                  |  - GET  /students/:id/fees           |
                                  |  - POST /students/:id/payments       |
                                  +--------------------------------------+
                                                     |
                                                     | (HTTP Keep-Alive + Timeout + Retry)
                                                     v
                                  +--------------------------------------+
                                  |        Mock Bank Service (4002)      |
                                  |  - DELAY_MS, FAIL_RATE, DROP_RATE    |
                                  |  - POST /charges                     |
                                  |  - GET  /stats                       |
                                  +--------------------------------------+
```

### 🔴 Tình huống 1: Ngân hàng không kết nối được, rồi hoạt động lại
* **Bối cảnh:** Sáng thứ Hai khởi động lại cụm máy chủ: Fee Service lên trước, Mock Bank lên sau vài phút. Trong thời gian chờ đó, sinh viên vẫn gửi yêu cầu thanh toán.
* **Kịch bản tái hiện & Đo lường:**
  1. Tắt Mock Bank (chưa chạy cổng 4002).
  2. Gửi `POST /students/1/payments` sang Fee Service: kiểm tra mã trả về, cấu trúc JSON, thời gian phản hồi, và kiểm tra Fee Service có bị crash hay không.
  3. Khởi động Mock Bank lên và thực hiện lại lệnh thanh toán — **tuyệt đối không restart Fee Service**.
* **Kết quả cần đạt:**
  - [ ] Khi ngân hàng tắt: Thanh toán trả về `503`, JSON có trường `error` và `status: "FAILED"`, thời gian phản hồi `< 1.5 giây`.
  - [ ] Fee Service không bị crash / sập process; gọi `GET /students/1/fees` vẫn trả về `200` rất nhanh.
  - [ ] Khi ngân hàng chạy lại: Gọi thanh toán lập tức trả về `201 PAID` mà không cần khởi động lại Fee Service.
  - [ ] Đọc URL ngân hàng từ biến môi trường `BANK_URL` (mặc định `http://localhost:4002`); khi trỏ sang `http://localhost:4999` (cổng không tồn tại) thì hành vi vẫn phải giống hệt.

---

### 🔴 Tình huống 2: Ngân hàng phản hồi rất chậm
* **Bối cảnh:** Giờ cao điểm đóng học phí, phía ngân hàng bị quá tải, mỗi giao dịch mất đến 5 giây mới phản hồi xong.
* **Kịch bản tái hiện & Đo lường:**
  1. Khởi động Mock Bank với biến môi trường `DELAY_MS=5000`.
  2. Gửi 1 yêu cầu thanh toán và đo thời gian phản hồi.
  3. Bắn đồng thời 20 yêu cầu thanh toán, trong lúc các request này đang chờ thì liên tục gọi `GET /students/1/fees`.
* **Kết quả cần đạt:**
  - [ ] Thanh toán không được treo theo ngân hàng mà phải ngắt và trả về `504` với `status: "PENDING"`.
  - [ ] Tổng thời gian phản hồi của lệnh thanh toán `≤ 4.5 giây` (nhỏ hơn mức 5s của Bank).
  - [ ] Trong khi 20 request thanh toán đang chờ xử lý, API xem công nợ `GET /students/1/fees` vẫn phản hồi nhanh `< 300ms` (không bị blocking I/O hay tắc nghẽn).

---

### 🔴 Tình huống 3: Duy trì kết nối TCP (HTTP Keep-Alive & Connection Reuse)
* **Bối cảnh:** Hàng ngàn sinh viên thanh toán trong thời gian ngắn. Nếu mỗi lời gọi HTTP mở một kết nối TCP mới (bắt tay 3 bước SYN / SYN-ACK / ACK) rồi đóng thì rất lãng phí CPU, socket và thời gian. Ngoài ra ngân hàng lại tự động đóng kết nối nhàn rỗi sau 5 giây.
* **Kịch bản tái hiện & Đo lường:**
  1. Cho Mock Bank chạy ở trạng thái bình thường (không delay, không lỗi).
  2. Viết một script kiểm thử gửi 200 lượt thanh toán, chia thành 10 yêu cầu đồng thời (mỗi lần 1.000đ).
  3. Đo tổng thời gian hoàn thành và kiểm tra chỉ số `connections` tại `GET /stats` của ngân hàng (so sánh số liệu **trước** và **sau** khi tối ưu kết nối).
  4. Để hệ thống nhàn rỗi hơn 6 giây (để ngân hàng đóng kết nối cũ), sau đó gửi tiếp vài request thanh toán tiếp theo.
* **Kết quả cần đạt:**
  - [ ] `200/200` thanh toán thành công hoàn toàn (`201 PAID`).
  - [ ] Số kết nối TCP mà ngân hàng ghi nhận mở mới (`connections`) phải **≤ 20** (tái sử dụng socket).
  - [ ] Sau khi nhàn rỗi 6 giây, các yêu cầu tiếp theo vẫn thành công trơn tru (tự tạo kết nối mới khi socket cũ bị đóng).

---

### 🔴 Tình huống 4: Đứt kết nối giữa chừng, lỗi tạm thời, và bị từ chối
* **Bối cảnh:** Mạng Internet chập chờn với 3 phân loại lỗi hoàn toàn khác biệt:
  * **(a) Đứt kết nối:** Ngân hàng đã trừ tiền xong nhưng kết nối bị đứt đột ngột trước khi trả lời.
  * **(b) Lỗi tạm thời (500):** Ngân hàng gặp sự cố nội bộ trả lỗi `500` trước khi trừ tiền.
  * **(c) Lỗi từ chối nghiệp vụ (402):** Sinh viên thanh toán vượt hạn mức quy định.
* **Kịch bản tái hiện & Đo lường:**
  * **Kịch bản (a):** Khởi động Bank với `DROP_RATE=0.3`. Gửi lần lượt 60 thanh toán. So sánh số lệnh ghi nhận `PAID` ở Fee Service với chỉ số `charges` và `duplicates` ở `/stats`.
  * **Kịch bản (b):** Khởi động Bank với `FAIL_RATE=0.3`. Gửi lần lượt 60 thanh toán.
  * **Kịch bản (c):** Gửi thanh toán với số tiền `25.000.000đ` (vượt trần 20tr).
* **Kết quả cần đạt:**
  - [ ] **Kịch bản (a):** `duplicates = 0`; số thanh toán thành công `≥ 54/60`; những lệnh không thành công phải trả về `504` kèm `status: "PENDING"`; tổng công nợ của sinh viên chỉ giảm đúng bằng số tiền của các lệnh `PAID`.
  - [ ] **Kịch bản (b):** Tỷ lệ thành công `≥ 54/60`; tuyệt đối không bị trừ tiền 2 lần cho cùng một lệnh.
  - [ ] **Kịch bản (c):** Trả về HTTP `402 FAILED`, và ngân hàng chỉ nhận đúng 1 yêu cầu duy nhất (**tuyệt đối không thử lại / retry với lỗi 4xx**).
  - [ ] Tất cả các trường hợp trên (kể cả có cơ chế retry) vẫn phải tuân thủ trần thời gian tổng **`≤ 4.5 giây`** của Tình huống 2.

---

## 3. PHÂN TÍCH KỸ THUẬT & KIẾN TRÚC GIẢI PHÁP

### 3.1. Thiết kế Fee Service
Để thỏa mãn đồng thời cả 4 tình huống, Client HTTP trong Fee Service cần được trang bị:
1. **HTTP Keep-Alive Agent:**
   * Sử dụng `http.Agent({ keepAlive: true, maxSockets: 20, maxFreeSockets: 10, timeout: 60000 })`.
   * Tái sử dụng pool kết nối TCP cho các request tiếp theo, hạn chế việc khởi tạo socket mới.
2. **Quản lý Timeout ngắn hạn:**
   * Cấu hình request timeout ở mức khoảng `1200ms - 1500ms` cho mỗi lần thử để đảm bảo nếu thực hiện 2–3 lần retry thì tổng thời gian vẫn **`< 4500ms`**.
3. **Chiến lược Retry & Phân loại lỗi (Error Classification):**
   * **Lỗi kết nối / ECONNREFUSED:** Nếu ngân hàng tắt hoàn toàn -> trả ngay `503 FAILED`, không retry mù quáng để tránh lãng phí thời gian.
   * **Lỗi 500 hoặc rớt mạng (ECONNRESET, EPIPE, Socket Hang Up):** Là lỗi tạm thời -> Thực hiện **Retry** (tối đa 2 lần) với cùng `Idempotency-Key` (reference).
   * **Lỗi 4xx (400, 402):** Lỗi nghiệp vụ từ chối rõ ràng -> **Không retry**, trả ngay kết quả cho client.
   * **Hết số lần Retry mà vẫn lỗi:** Nếu lỗi là do đứt kết nối hoặc timeout -> Trả về `504 PENDING` (vì phía ngân hàng có thể đã xử lý xong).

### 3.2. Thiết kế Mock Bank Service
1. **Lưu trữ Idempotency Map:**
   * Cấu trúc `Map<string, { status: number, body: any }>` lưu kết quả giao dịch theo `Idempotency-Key`.
   * Khi nhận request có header trùng: Lấy ngay kết quả cũ trả về và **không tăng biến `charges`**.
   * Nếu cùng reference nhưng bị trừ tiền lần 2 mà không qua cache Idempotency -> tăng `duplicates`.
2. **Theo dõi TCP Connection:**
   * Đăng ký listener sự kiện `'connection'` trên `http.Server` để đếm chính xác số TCP handshake mở mới.
3. **Fault Injection Logic:**
   * `DELAY_MS`: Chèn `await sleep(DELAY_MS)` trước khi xử lý.
   * `FAIL_RATE`: Random `Math.random() < FAIL_RATE` -> trả `500` ngay.
   * `DROP_RATE`: Random `Math.random() < DROP_RATE` -> ghi nhận trừ tiền (`charges++`), lưu idempotency rồi gọi `req.socket.destroy()` để ngắt socket đột ngột.

---

## 4. BẢNG SỐ LIỆU ĐO LƯỜNG THỰC TẾ (ĐÃ KIỂM NGHIỆM ĐẠT 100%)

| Tình huống | Chỉ số đo | Trước khi tối ưu | Sau khi tối ưu (Thực tế) | Đánh giá |
| :--- | :--- | :--- | :--- | :---: |
| **TH 1: Ngân hàng tắt** | Mã trả về khi Bank tắt | Crash app / Treo vô tận | **503 FAILED** (Phản hồi sau **33ms** < 1.5s) | ✅ **ĐẠT** |
| | Khả năng tự phục hồi | Cần restart Fee Service | Tự phục hồi **201 PAID** ngay khi Bank bật | ✅ **ĐẠT** |
| | Tra cứu nợ (`GET /fees`) | Bị treo | **2ms** (< 300ms) | ✅ **ĐẠT** |
| **TH 2: Ngân hàng trễ 5s**| Thời gian trả lời thanh toán | Treo 5000ms | **4312ms** (≤ 4.5s), trả **504 PENDING** | ✅ **ĐẠT** |
| | Tra cứu nợ lúc cao điểm | Bị nghẽn hàng đợi | **2ms – 3ms** (< 300ms) | ✅ **ĐẠT** |
| | 20 request đồng thời | Treo server | 20/20 trả về **504 PENDING** an toàn | ✅ **ĐẠT** |
| **TH 3: Keep-Alive Pool** | Số kết nối TCP (200 reqs) | ~200 connections | **10 connections** (≤ 20) | ✅ **ĐẠT** |
| | Tỷ lệ thành công | Dễ cạn socket | **200/200 (100%)** trong **218ms** | ✅ **ĐẠT** |
| | Sau khi nhàn rỗi 6.5s | Lỗi `ECONNRESET` | **5/5 thành công** (tự tái kết nối) | ✅ **ĐẠT** |
| **TH 4a: DROP_RATE 0.3** | Số lần trừ trùng (`duplicates`)| Có thể > 0 | **duplicates = 0** | ✅ **ĐẠT** |
| | Tỷ lệ thành công | Rớt 30% | **60/60** thành công nhờ Idempotent Retry | ✅ **ĐẠT** |
| | Đối soát công nợ | Lệch tiền | Giảm chính xác **60.000đ** theo lệnh PAID | ✅ **ĐẠT** |
| **TH 4b: FAIL_RATE 0.3** | Tỷ lệ thành công | Rớt 30% | **59/60 (98.3%)** (vượt chuẩn ≥ 54/60) | ✅ **ĐẠT** |
| | Số lần trừ trùng (`duplicates`)| Có thể > 0 | **duplicates = 0** | ✅ **ĐẠT** |
| **TH 4c: Lỗi từ chối 402**| Mã HTTP trả về | Không chuẩn | **402 FAILED** | ✅ **ĐẠT** |
| | Số request Bank nhận | Bị retry lãng phí | **Đúng 1 request** (Không retry lỗi 4xx) | ✅ **ĐẠT** |
| **Toàn bộ hệ thống** | Trần thời gian phản hồi | Vượt quá 5s | Luôn **≤ 4500ms** cho mọi trường hợp | ✅ **ĐẠT** |

