# Region Snap

_[Read in English](README.md)_

Region Snap là công cụ chụp vùng riêng tư cho Chrome và Windows. Extension có thể khóa vùng nội dung web đang chạy, còn ứng dụng desktop chụp xuyên nhiều màn hình với DPI khác nhau.

## Tính năng

- Chọn nhanh một phần tử bằng cách bấm chuột.
- Kéo để chọn vùng tự do.
- Di chuyển và đổi kích thước vùng đã khóa.
- Trang bên dưới vẫn tương tác bình thường sau khi khóa vùng.
- Chụp bằng toolbar, phím `Enter` hoặc `Alt+Shift+C`.
- Khi nút di chuyển `⠿` đang được focus, dùng phím mũi tên để tinh chỉnh; giữ `Shift` để di chuyển 10 px.
- Crop theo kích thước ảnh thật để hoạt động đúng với zoom và scale màn hình.
- Xuất PNG bo góc 12 px với bốn góc trong suốt.
- Giao diện mặc định bằng tiếng Anh; tự chuyển sang tiếng Việt theo ngôn ngữ Chrome.
- Chỉ inject vào tab khi người dùng yêu cầu; extension không chạy thường trực trên mọi website.

## Ứng dụng Windows desktop

- Chạy trong system tray với phím tắt toàn hệ thống có thể cấu hình.
- Chọn vùng xuyên nhiều màn hình và giữ đúng chất lượng khi mixed-DPI.
- Ẩn overlay rồi lấy frame mới, phù hợp với video và nội dung động.
- Lưu PNG cục bộ và có thể copy trực tiếp vào clipboard.
- Hỗ trợ giao diện tiếng Việt/Anh, di chuyển–resize bằng bàn phím và tùy chọn khởi động cùng Windows.

Dùng `npm run desktop:start` khi phát triển hoặc `npm run desktop:dist` để tạo bộ cài NSIS. Xem [`desktop/README.md`](desktop/README.md) để biết cách sử dụng, đóng gói và ký số.

## Cài đặt để phát triển

Yêu cầu Node.js 22 trở lên.

```powershell
npm ci
npm run ci
```

1. Mở `chrome://extensions`.
2. Bật **Developer mode**.
3. Chạy `npm run build`.
4. Chọn **Load unpacked** và trỏ tới thư mục `dist/`.
5. Ghim Region Snap lên toolbar nếu muốn dùng popup.

Sau mỗi lần thay đổi source, bấm **Reload** tại thẻ extension trước khi kiểm tra lại.

## Cách sử dụng

1. Bấm icon extension hoặc `Alt+Shift+S`.
2. Bấm vào một phần tử, hoặc kéo chuột để chọn vùng tự do.
3. Dùng các nút tròn để đổi kích thước; kéo nút `⠿` để di chuyển.
4. Tương tác với trang nếu cần tạo đúng trạng thái muốn chụp.
5. Bấm **Capture**, nhấn `Enter`, hoặc dùng `Alt+Shift+C`.
6. Nhấn `Esc` hoặc nút **×** để đóng overlay.

Có thể thay đổi phím tắt tại `chrome://extensions/shortcuts`.

## Quyền truy cập

- `activeTab`: chỉ truy cập tab hiện tại sau hành động trực tiếp của người dùng.
- `scripting`: inject giao diện chọn vùng vào tab đang được kích hoạt.

Extension xử lý ảnh ngay trong trình duyệt và không gửi ảnh ra máy chủ.

Privacy Policy công khai: <https://vannt-dev.github.io/region-snap/privacy-policy.html>

## Kiến trúc và hiệu năng

Chi tiết ranh giới module và hướng dẫn mở rộng nằm tại [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

- `background.js` điều phối lệnh, chống inject trùng trên cùng tab và gọi API chụp của Chrome.
- `shared.js` là contract duy nhất cho message, state, command và phím tắt giữa các context.
- `geometry.js` chứa toàn bộ phép tính vùng, resize, di chuyển và tỷ lệ crop; module này không truy cập DOM và được unit test độc lập.
- `content.js` chỉ tồn tại trong tab sau khi người dùng yêu cầu chọn vùng.
- Các sự kiện chuột tốc độ cao được gộp và render tối đa một lần trong mỗi animation frame.
- Overlay dùng CSS custom properties và transform tăng tốc phần cứng, không đọc layout trong vòng lặp rê/kéo chuột.
- Sau khi hủy, content script chỉ giữ listener nhận message rất nhẹ; không còn listener chuột, cuộn hoặc resize.

## Giới hạn của Chrome

Chrome không cho extension inject vào một số trang nội bộ như `chrome://`, trang Chrome Web Store và một số PDF/tab đặc biệt. Với URL `file://`, người dùng có thể cần bật **Allow access to file URLs** trong phần chi tiết extension.

## Kiểm tra nhanh trước khi phát hành

```powershell
npm run ci
npm run smoke
npm run package:store
npm run desktop:test
npm run desktop:dist
```

File có thể upload trực tiếp lên Chrome Web Store được tạo tại `release/region-snap-interactive-screenshot-v<version>-store.zip`. Pipeline kiểm tra nội dung ZIP theo allowlist để test, source map, tài liệu nội bộ và dependency phát triển không lọt vào gói phát hành.

Bộ cài Windows được tạo tại `release/Region-Snap-Setup-<version>.exe`. Release có tag chỉ phát hành bộ cài khi đã cấu hình các secret Authenticode được hướng dẫn trong [`desktop/README.md`](desktop/README.md); nếu chưa có, gói Chrome sẽ được phát hành trước và installer unsigned bị loại bỏ.

## Chrome Web Store

- Chạy `npm run store:assets` để tái tạo icon, promo tile và screenshot đúng kích thước.
- Nội dung listing, giải trình quyền và checklist nằm tại `store-assets/STORE_LISTING.md`.
- Chính sách quyền riêng tư: [`PRIVACY_POLICY.md`](PRIVACY_POLICY.md), được publish tại <https://vannt-dev.github.io/region-snap/privacy-policy.html>.
- CI kiểm tra format, lint, test, build, manifest và asset; workflow release tạo GitHub Release khi push tag `v<version>`.

Theo yêu cầu hiện hành của Chrome Web Store, bộ asset đã gồm icon 128×128, small promo 440×280, hai screenshot 1280×800 và marquee 1400×560 tùy chọn.
