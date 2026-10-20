# Thực hành LAB 3: Kết nối và duy trì kết nối giữa các service

Thư mục này chứa mã nguồn và tài liệu bài thực hành **LAB 3: Kết nối và duy trì kết nối giữa các service** (Học phần Phần mềm hướng dịch vụ - SOA).

## 📄 Tài liệu chi tiết
Xem toàn bộ yêu cầu đề bài, kiến trúc, bảng quy ước và tiêu chuẩn 4 tình huống sự cố tại:
👉 **[LAB3_SPECIFICATION.md](file:///e:/PhanMemHuongDichVu/LAB3_SPECIFICATION.md)**

## 📌 Tóm tắt các dịch vụ
1. **Fee Service (Port 4001):** Hệ thống của trường đại học, quản lý công nợ và gọi cổng thanh toán.
2. **Mock Bank (Port 4002):** Cổng ngân hàng giả lập có thể kích hoạt các lỗi mạng: trễ (`DELAY_MS`), lỗi tạm thời (`FAIL_RATE`), ngắt kết nối đột ngột (`DROP_RATE`).

## 🎯 4 Tình huống cần vượt qua
- [x] **Tình huống 1:** Ngân hàng không kết nối được (503 < 1.5s), tự phục hồi khi ngân hàng bật lại.
- [x] **Tình huống 2:** Ngân hàng phản hồi rất chậm (Cắt ở ≤ 4.5s trả về 504 PENDING, không nghẽn API xem nợ).
- [x] **Tình huống 3:** Duy trì kết nối TCP HTTP Keep-Alive (200 requests chỉ mở ≤ 20 TCP connections).
- [x] **Tình huống 4:** Xử lý đứt mạng, lỗi 500 với Idempotent Retry (≥ 54/60 thành công, duplicates = 0, không retry lỗi 402).
