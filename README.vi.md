# Region Snap

[![Downloads](https://img.shields.io/github/downloads/vannt-dev/region-snap/total)](https://github.com/vannt-dev/region-snap/releases)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/gdcpiocagphfbomdokhfomjnecnjfcon?label=Chrome%20Web%20Store&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/region-snap-interactive-s/gdcpiocagphfbomdokhfomjnecnjfcon)

_[Read in English](README.md)_

Region Snap là công cụ chụp vùng riêng tư cho Chrome và Windows. Extension có thể khóa vùng nội dung web đang chạy, còn ứng dụng desktop chụp xuyên nhiều màn hình với DPI khác nhau.

Các bản build chính thức được liệt kê tại [vannt-dev.github.io/official.html](https://vannt-dev.github.io/official.html);
bản nào không có ở đó thì không phải do vannt-dev phát hành.

## Tính năng

- Chọn nhanh một phần tử bằng cách bấm chuột.
- Kéo để chọn vùng tự do.
- Di chuyển và đổi kích thước vùng đã khóa.
- Trang bên dưới vẫn tương tác bình thường sau khi khóa vùng.
- Chụp bằng toolbar, phím `Enter` hoặc `Alt+Shift+C`.
- Đánh dấu lên vùng đã khoá trước khi chụp: thanh công cụ vẽ **mũi tên** `↗`, **khung** `▢`, hoặc
  **che một vùng** `▒` bằng mosaic; `↶` (hoặc `Ctrl+Z` khi đang cầm công cụ) bỏ nét vẽ gần nhất. Khi
  đã chọn công cụ, kéo trong vùng chọn để vẽ; nhấn `Esc` để bỏ công cụ và trang tương tác lại như
  thường. Nét vẽ được vẽ vào ảnh ở đúng độ phân giải của ảnh, và chi tiết trong vùng bị che không
  còn trong file đã lưu.
- **Chữ** `T` thêm ghi chú: bấm trong vùng chọn rồi gõ; `Enter` để giữ, `Shift+Enter` xuống dòng,
  `Esc` để hủy. Bấm vào ghi chú để sửa, kéo để di chuyển, và chọn cỡ nhỏ, vừa hoặc lớn bằng nút
  `A`. **Bước** `①` đặt các vòng tròn đánh số 1, 2, 3… sau mỗi lần bấm; hoàn tác bỏ bước cuối và
  lần bấm tiếp theo dùng lại số đó.
- **Tô sáng** `▬` phủ màu lên một vùng như bút dạ quang, mặc định màu vàng: chữ bên dưới vẫn đọc
  được, trên trang lẫn trong ảnh. Khi đang cầm một công cụ vẽ có màu, thanh công cụ có năm màu
  (đỏ, vàng, xanh lá, xanh dương, đen) và đánh dấu màu mà công cụ đó sẽ dùng. Bút tô sáng có màu
  riêng; mũi tên, khung, ghi chú và bước dùng chung một màu khác, mặc định màu đỏ, áp dụng cả cho
  ghi chú đang gõ. Cả hai màu được nhớ cho vùng chọn sau và các trang khác; số và viền chữ chuyển
  sang mực tối trên màu sáng.
- Nút **Sao chép** đưa PNG vào clipboard thay vì tải về; trang không dùng được clipboard (ví dụ
  `http://` thường) sẽ tự chuyển sang tải file.
- **Chụp toàn trang** (popup, hoặc `Alt+Shift+F`) cuộn tài liệu từng khung nhìn một và ghép các
  lát thành một ảnh, không kèm thanh cuộn. Header cố định chỉ nằm ở lát đầu và footer cố định chỉ
  nằm ở lát cuối thay vì lặp lại suốt ảnh; phần tử sticky nằm đúng vị trí trong luồng. Chụp xong
  trang được cuộn về chỗ cũ, và `Esc` dừng việc chụp.
- **Chụp vùng cuộn** `⇣` (thanh công cụ) chụp toàn bộ nội dung của một khung tự cuộn khi vùng
  đã khóa nằm trong đó (luồng chat, danh sách thư, khung bên), hoặc một phần tử cao hơn cửa sổ.
  Extension cuộn từng khung một rồi ghép các lát, giữ đúng các cột của vùng chọn và toàn bộ
  chiều cao nội dung; nét vẽ nằm yên trên nội dung đã vẽ lên. Tiêu đề sticky trong khung nằm
  đúng chỗ trong luồng thay vì lặp lại, phần tử cố định xung quanh bị bỏ ra, mọi thứ được cuộn
  về chỗ cũ, vùng chọn vẫn được khóa, và `Esc` dừng việc chụp.
- **Chụp liên tiếp** `⧉` (thanh công cụ) chụp vùng đã khóa nhiều lần liền nhau: 3, 5, 10 hoặc
  20 ảnh, cách nhau 1, 2 hoặc 5 giây (trong cài đặt), sau thời gian hẹn giờ nếu có.
- **Chụp khi thay đổi** `◉` (thanh công cụ) theo dõi vùng chọn và lưu ảnh mỗi lần nội dung thay
  đổi, khi thay đổi đã lắng xuống (một loạt thay đổi nhanh chỉ lưu một ảnh). Tự dừng sau 5, 10,
  25 hoặc 50 ảnh (trong cài đặt), hoặc khi bấm lại nút hay nhấn `Esc`. Trong lúc chạy, viền vùng
  chọn chuyển màu hổ phách và thanh công cụ đếm số ảnh.
- Ảnh của một lượt chụp liên tiếp hoặc theo dõi được tải về thành các tệp đánh số chung một mốc
  thời gian (`region-snap-20261020-101500-01.png`, `-02`, …), theo định dạng đã chọn, kể cả khi
  thao tác mặc định là sao chép. Chrome có thể hỏi một lần để cho phép trang tải nhiều tệp.
- **Hẹn giờ chụp** 3, 5 hoặc 10 giây (trong cài đặt) đếm ngược trước khi chụp vùng chọn, đủ để
  mở menu hoặc rê chuột lên một phần tử. `Esc` dừng đếm ngược và giữ nguyên vùng chọn.
- Trang cài đặt (popup → **Cài đặt**) cho chọn định dạng ảnh (PNG, JPEG hoặc WebP), tắt bo góc, đặt
  tiền tố tên tệp, và đổi phím `Enter` cùng phím tắt sang sao chép thay vì tải về.
- Khi nút di chuyển `⠿` đang được focus, dùng phím mũi tên để tinh chỉnh; giữ `Shift` để di chuyển 10 px.
- Crop theo kích thước ảnh thật để hoạt động đúng với zoom và scale màn hình.
- Mặc định lưu PNG bo góc 12 px với góc trong suốt; định dạng và bo góc đổi được trong cài đặt.
- Giao diện mặc định bằng tiếng Anh; tự chuyển sang tiếng Việt theo ngôn ngữ Chrome.
- Chỉ inject vào tab khi người dùng yêu cầu; extension không chạy thường trực trên mọi website.

## Ứng dụng Windows desktop

- Chạy trong system tray với phím tắt toàn hệ thống có thể cấu hình.
- Chọn vùng xuyên nhiều màn hình và giữ đúng chất lượng khi mixed-DPI.
- Ẩn overlay rồi lấy frame mới, phù hợp với video và nội dung động.
- Lưu PNG cục bộ và có thể copy trực tiếp vào clipboard.
- Hỗ trợ giao diện tiếng Việt/Anh, di chuyển–resize bằng bàn phím và tùy chọn khởi động cùng Windows.

Dùng `npm run desktop:start` khi phát triển hoặc `npm run desktop:dist` để tạo bộ cài NSIS. Xem [`desktop/README.md`](desktop/README.md) để biết cách sử dụng, đóng gói và ký số.

## Cài đặt

Cài Region Snap từ [Chrome Web Store](https://chromewebstore.google.com/detail/region-snap-interactive-s/gdcpiocagphfbomdokhfomjnecnjfcon). Tiện ích cũng chạy được trên Microsoft Edge và các
trình duyệt Chromium khác cho phép cài tiện ích từ Chrome Web Store.

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

Muốn chụp cả trang thay vì một vùng, chọn **Chụp toàn trang** trong popup hoặc nhấn `Alt+Shift+F`;
ảnh dùng định dạng và hành động mặc định trong cài đặt.

Có thể thay đổi phím tắt tại `chrome://extensions/shortcuts`.

## Quyền truy cập

- `activeTab`: chỉ truy cập tab hiện tại sau hành động trực tiếp của người dùng.
- `scripting`: inject giao diện chọn vùng vào tab đang được kích hoạt.
- `storage`: lưu các cài đặt (định dạng ảnh, bo góc, tiền tố tên tệp, thao tác mặc định, hẹn giờ
  chụp, số ảnh chụp liên tiếp và chụp khi thay đổi) trên chính thiết bị này. Không lưu gì khác.

Extension xử lý ảnh ngay trong trình duyệt và không gửi ảnh ra máy chủ.

Privacy Policy công khai: <https://vannt-dev.github.io/region-snap/privacy-policy.html>

## Kiến trúc và hiệu năng

Chi tiết ranh giới module và hướng dẫn mở rộng nằm tại [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

- `background.js` điều phối lệnh, chống inject trùng trên cùng tab và gọi API chụp của Chrome.
- `shared.js` là contract duy nhất cho message, state, command và phím tắt giữa các context.
- `annotations.js` chứa các nét đánh dấu: hình học của chúng và cách vẽ lên ảnh đã cắt; cũng không truy cập DOM và được unit test độc lập.
- `schedule.js` quyết định khi nào tới lượt một ảnh chụp liên tiếp hoặc một ảnh chụp khi thay đổi (thời gian lắng, thời gian chờ tối đa, giới hạn chụp của Chrome); đồng hồ và bộ hẹn giờ được truyền vào nên unit test không phải chờ.
- `geometry.js` chứa toàn bộ phép tính vùng, resize, di chuyển và tỷ lệ crop; module này không truy cập DOM và được unit test độc lập.
- `content.js` chỉ tồn tại trong tab sau khi người dùng yêu cầu chọn vùng.
- Các sự kiện chuột tốc độ cao được gộp và render tối đa một lần trong mỗi animation frame.
- Overlay dùng CSS custom properties và transform tăng tốc phần cứng, không đọc layout trong vòng lặp rê/kéo chuột.
- Sau khi hủy, content script chỉ giữ listener nhận message rất nhẹ; không còn listener chuột, cuộn hoặc resize.

## Giới hạn của Chrome

Chrome không cho extension inject vào một số trang nội bộ như `chrome://`, trang Chrome Web Store và một số PDF/tab đặc biệt. Với URL `file://`, người dùng có thể cần bật **Allow access to file URLs** trong phần chi tiết extension.

Chụp toàn trang lấy phần mà chính tài liệu cuộn. Với trang cuộn bên trong một khung con (nhiều web app làm vậy), hãy khóa một vùng trong khung đó rồi dùng **Chụp vùng cuộn** `⇣`. Ở cả hai cách, nội dung tải thêm khi cuộn có thể làm chiều cao đổi sau khi đã tính xong, và chỉ cuộn dọc được ghép. Chrome cho chụp hai ảnh mỗi giây nên vùng dài mất một lúc, và một canvas cao tối đa 32.767 px (thấp hơn với ảnh rất rộng): vùng dài hơn bị cắt ở đó và toast có báo.

Chụp vùng cuộn chọn khung cuộn gần nhất quanh phần tử đã bấm chọn, hoặc quanh tâm vùng chọn nếu vùng được kéo. Khung nằm một phần ngoài màn hình sẽ được cuộn vào tầm nhìn trước; nếu vẫn còn phần không bao giờ hiện lên, ảnh dừng ở chỗ cuộn tới được và toast có báo. Phần tử sticky của khung được đặt về chỗ của nó trong luồng, nên tiêu đề bảng sticky chỉ hiện một lần ở đầu. Phần tử cố định nằm trong khung, và những gì script vẽ đè lên trang trong lúc cuộn, vẫn có thể lặp lại.

Chụp khi thay đổi lắng nghe thay đổi của phần tử, chữ và thuộc tính của trang dưới vùng chọn. Thay đổi được vẽ mà không chạm tới chúng, như video đang phát hay hoạt ảnh canvas, sẽ không được nhận ra; còn việc rê chuột làm đổi kiểu một phần tử dưới vùng chọn thì có.

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
