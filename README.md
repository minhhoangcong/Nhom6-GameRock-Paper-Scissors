# 🪨 📄 ✂️ Trò Chơi Kéo Búa Bao - Multiplayer Rooms

Một trò chơi kéo búa bao đa người chơi với hệ thống phòng riêng, cho phép tối đa 2 người chơi trong một phòng.

## ✨ Tính năng mới

- 🏠 **Hệ thống phòng riêng**: Tạo và tham gia phòng với tên tùy chỉnh
- 👥 **Tối đa 2 người chơi**: Hỗ trợ từ 2 người trong một phòng
- 🎯 **Quản lý người chơi**: Đặt tên, trạng thái sẵn sàng
- 📊 **Tính điểm đa người**: So sánh lựa chọn của tất cả người chơi
- 🔄 **Chơi lại nhiều vòng**: Tiếp tục với cùng nhóm người chơi
- 📱 **Giao diện responsive**: Tương thích với mọi thiết bị
- 🔔 **Thông báo real-time**: Cập nhật trạng thái theo thời gian thực
- 🔊 **Hiệu ứng âm thanh**: Thêm âm thanh cho các hành động trong trò chơi (chọn Búa/Bao/Kéo, kết quả thắng/thua/hòa).

## 🚀 Cách chạy

### Yêu cầu hệ thống

- Python 3.7+
- Trình duyệt web hiện đại

### Bước 1: Cài đặt dependencies

```bash
pip install websockets
```

### Bước 2: Khởi động server

```bash
cd backend
python server.py
```

Server sẽ chạy tại `ws://localhost:8082`

### Bước 3: Mở trò chơi

Mở file `frontend/index.html` trong trình duyệt web.

Hoặc sử dụng một web server đơn giản:

```bash
cd frontend
python -m http.server 8000
```

Sau đó truy cập `http://localhost:8000`

## 🎯 Cách chơi

### 1. **Đặt tên người chơi**

- Nhập tên của bạn và nhấn "Cập nhật"

### 2. **Tạo hoặc tham gia phòng**

- **Tạo phòng mới**: Nhấn "Tạo phòng mới" → Đặt tên phòng → Chọn số người tối đa
- **Tham gia phòng**: Chọn phòng từ danh sách → Nhấn "Tham gia"

### 3. **Chuẩn bị chơi**

- Chờ người chơi khác tham gia
- Nhấn "Sẵn sàng" khi muốn bắt đầu
- Tất cả người chơi phải sẵn sàng để game bắt đầu

### 4. **Chơi game**

- Chọn Búa 🪨, Bao 📄, hoặc Kéo ✂️
- Xem kết quả và điểm số của tất cả người chơi
- Nhấn "Chơi lại" để tiếp tục

## 📋 Luật chơi đa người

- **Búa 🪨** thắng **Kéo ✂️**
- **Kéo ✂️** thắng **Bao 📄**
- **Bao 📄** thắng **Búa 🪨**
- Nếu cùng lựa chọn thì **Hòa**
- **Nhiều người cùng lựa chọn**: Tất cả người chọn lựa chọn thắng sẽ thắng

### Ví dụ với 4 người chơi:

- Người A: Búa 🪨
- Người B: Kéo ✂️
- Người C: Búa 🪨
- Người D: Bao 📄

**Kết quả**: Người A và C thắng (Búa thắng Kéo), Người B thua, Người D thua (Bao thua Búa)

## 🏗️ Cấu trúc dự án

```
GK-nhóm1-kéo/
├── backend/
│   └── server.py          # Server WebSocket với hệ thống phòng
├── frontend/
│   ├── assets/
│   │   └── sounds/       # Thư mục chứa các tệp âm thanh (click.mp3, win.mp3, lose.mp3, draw.mp3)
│   ├── index.html        # Giao diện chính với 3 màn hình
│   ├── script.js         # Logic client cho hệ thống phòng
│   └── style.css         # CSS styling responsive
├── requirements.txt      # Các thư viện cần cài đặt
├── start_server.bat      # Script khởi động Windows
└── README.md             # Hướng dẫn này
```

## 🔧 Công nghệ sử dụng

- **Backend**: Python + WebSocket (websockets library)
- **Frontend**: HTML5 + CSS3 + JavaScript (ES6+)
- **Giao thức**: WebSocket cho giao tiếp real-time
- **Kiến trúc**: Client-Server với phòng riêng biệt

## 🎨 Tính năng giao diện

### **3 Màn hình chính:**

1. **Màn hình chính**: Danh sách phòng, tạo phòng
2. **Màn hình tạo phòng**: Form tạo phòng mới
3. **Màn hình phòng chơi**: Game interface với danh sách người chơi

### **Responsive Design:**

- Tương thích với mọi kích thước màn hình
- Mobile-friendly interface
- Touch-friendly buttons

### **Real-time Updates:**

- Cập nhật danh sách phòng tự động
- Thông báo người chơi tham gia/rời phòng
- Hiển thị trạng thái sẵn sàng real-time

## 🐛 Xử lý lỗi

- **Tự động kết nối lại** khi mất kết nối
- **Thông báo lỗi** rõ ràng cho người dùng
- **Xử lý ngắt kết nối** của người chơi
- **Validation** dữ liệu đầu vào
- **Phòng tự động xóa** khi không còn người chơi

## 📈 Tính năng nâng cao

### **Hệ thống phòng:**

- **Phòng riêng biệt**: Mỗi phòng có ID duy nhất
- **Quản lý người chơi**: Theo dõi trạng thái từng người
- **Tự động ghép cặp**: Không cần chờ đợi

### **Logic game đa người:**

- **So sánh lựa chọn**: Xử lý nhiều lựa chọn cùng lúc
- **Tính điểm**: Cập nhật điểm số cho tất cả người chơi
- **Lịch sử trận đấu**: Lưu trữ 10 trận đấu gần nhất

### **Quản lý trạng thái:**

- **Trạng thái phòng**: Waiting, Playing, Finished
- **Trạng thái người chơi**: Ready, Waiting, Playing
- **Đồng bộ hóa**: Tất cả người chơi thấy cùng trạng thái

## 🎮 Cách test

### **Test với 1 máy:**

1. Mở nhiều tab trình duyệt
2. Mỗi tab đặt tên khác nhau
3. Tạo phòng từ tab đầu tiên
4. Tham gia phòng từ các tab khác
5. Chơi thử nghiệm

### **Test với nhiều máy:**

1. Chạy server trên máy chủ
2. Các máy khác kết nối qua IP máy chủ
3. Thay đổi `localhost` thành IP máy chủ trong `script.js`

## 🤝 Đóng góp

Nếu bạn muốn đóng góp vào dự án, hãy:

1. Fork repository
2. Tạo branch mới cho tính năng
3. Commit thay đổi
4. Tạo Pull Request

## 📄 License

Dự án này được phát hành dưới MIT License.

---

**Chúc bạn chơi vui vẻ với bạn bè! 🎉**
