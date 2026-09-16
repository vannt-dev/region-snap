import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { ROOT } from "./project-config.mjs";

const iconSource = await fs.readFile(path.join(ROOT, "store-assets/templates/icon.svg"), "utf8");
const iconInlineData = `data:image/svg+xml;base64,${Buffer.from(iconSource).toString("base64")}`;
const popupCss = await fs.readFile(path.join(ROOT, "popup.css"), "utf8");
const popupSource = (await fs.readFile(path.join(ROOT, "popup.html"), "utf8"))
  .replace(/<link rel="stylesheet" href="popup\.css"\s*\/?>/, `<style>${popupCss}</style>`)
  .replace('class="is-loading"', 'data-state="idle"')
  .replace(" disabled", "")
  .replace('src="icons/icon48.png"', `src="${iconInlineData}"`)
  .replace(/<script src="shared\.js"><\/script>/, "")
  .replace(/<script src="popup\.js"><\/script>/, "");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function screenshotHtml(html, width, height, output) {
  await page.setViewportSize({ width, height });
  await page.setContent(html, { waitUntil: "load" });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(ROOT, output), omitBackground: true });
  console.log(output);
}

function iconDataUrl() {
  return iconInlineData;
}

await fs.mkdir(path.join(ROOT, "icons"), { recursive: true });
await fs.mkdir(path.join(ROOT, "store-assets/screenshots"), { recursive: true });

for (const size of [16, 32, 48, 128, 256]) {
  await screenshotHtml(
    `<style>*{box-sizing:border-box}html,body,img{width:100%;height:100%;margin:0;display:block}</style><img src="${iconDataUrl()}">`,
    size,
    size,
    `icons/icon${size}.png`,
  );
}
await fs.copyFile(
  path.join(ROOT, "icons/icon128.png"),
  path.join(ROOT, "store-assets/icon-128.png"),
);

const selectionGraphic = `
  <div class="selection">
    <i class="nw"></i><i class="ne"></i><i class="sw"></i><i class="se"></i>
    <div class="picture"><div class="sun"></div><div class="hill one"></div><div class="hill two"></div></div>
  </div>`;

const sharedPromoCss = `
  *{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden}
  body{display:grid;place-items:center;background:radial-gradient(circle at 22% 18%,#93c5fd 0,transparent 34%),linear-gradient(145deg,#eff6ff,#bfdbfe 55%,#60a5fa)}
  .stage{position:relative;width:72%;height:70%}.selection{position:absolute;inset:0;border:4px solid #2563eb;border-radius:24px;box-shadow:0 24px 55px rgba(30,64,175,.22);background:#fff}
  .selection i{position:absolute;z-index:3;width:18px;height:18px;border:3px solid white;border-radius:50%;background:#2563eb;box-shadow:0 2px 7px #1e3a8a66}
  .nw{left:0;top:0;transform:translate(-50%,-50%)}.ne{right:0;top:0;transform:translate(50%,-50%)}.sw{left:0;bottom:0;transform:translate(-50%,50%)}.se{right:0;bottom:0;transform:translate(50%,50%)}
  .picture{position:absolute;inset:14%;overflow:hidden;border-radius:18px;background:linear-gradient(#dbeafe 0 58%,#bfdbfe 58%)}
  .sun{position:absolute;top:15%;right:16%;width:18%;aspect-ratio:1;border-radius:50%;background:#fbbf24}
  .hill{position:absolute;bottom:-18%;width:72%;height:62%;border-radius:50% 50% 0 0;background:#3b82f6;transform:rotate(-8deg)}.hill.one{left:-8%}.hill.two{right:-18%;bottom:-25%;background:#1d4ed8;transform:rotate(10deg)}
  .logo{position:absolute;left:-12%;top:-17%;width:25%;filter:drop-shadow(0 10px 18px #1e3a8a44)}
`;

await screenshotHtml(
  `<style>${sharedPromoCss}</style><div class="stage">${selectionGraphic}<img class="logo" src="${iconDataUrl()}"></div>`,
  440,
  280,
  "store-assets/small-promo-440x280.png",
);

await screenshotHtml(
  `<style>${sharedPromoCss}.stage{width:47%;height:72%}.logo{left:-22%;top:18%;width:30%}</style><div class="stage">${selectionGraphic}<img class="logo" src="${iconDataUrl()}"></div>`,
  1400,
  560,
  "store-assets/marquee-promo-1400x560.png",
);

const demoScreenshot = `
<!doctype html><style>
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;font-family:Inter,Arial,sans-serif;color:#0f172a}body{background:#eaf2ff;padding:34px}
.browser{height:100%;overflow:hidden;border:1px solid #cbd5e1;border-radius:18px;background:white;box-shadow:0 28px 70px #1e3a8a2b}.bar{height:58px;display:flex;align-items:center;gap:9px;padding:0 20px;background:#f8fafc;border-bottom:1px solid #e2e8f0}.dot{width:12px;height:12px;border-radius:50%;background:#cbd5e1}.address{width:55%;height:30px;margin-left:15px;border-radius:8px;background:#e2e8f0}
.page{position:relative;height:calc(100% - 58px);padding:58px 86px;background:linear-gradient(135deg,#fff,#eff6ff)}h1{width:620px;margin:0;font-size:54px;line-height:1.06;letter-spacing:-.04em}.lead{width:600px;color:#64748b;font-size:20px;line-height:1.55}.cards{display:flex;gap:24px;margin-top:48px}.card{width:300px;height:245px;padding:28px;border-radius:22px;background:white;box-shadow:0 15px 40px #1e3a8a1a}.card b{font-size:19px}.line{height:10px;margin-top:18px;border-radius:9px;background:#dbeafe}.line.short{width:62%}
.shade{position:absolute;inset:0;background:#0f172a77}.selection{position:absolute;left:62px;top:260px;width:664px;height:294px;border:3px solid #60a5fa;border-radius:12px;box-shadow:0 0 0 1px #0f172a66}.handle{position:absolute;width:11px;height:11px;border:2px solid white;border-radius:50%;background:#2563eb;box-shadow:0 2px 7px #0f172a66}.h1{left:62px;top:260px;transform:translate(-50%,-50%)}.h2{left:726px;top:260px;transform:translate(-50%,-50%)}.h3{left:62px;top:554px;transform:translate(-50%,-50%)}.h4{left:726px;top:554px;transform:translate(-50%,-50%)}
.clear{position:absolute;left:62px;top:260px;width:664px;height:294px;overflow:hidden;border-radius:12px;background:linear-gradient(135deg,#fff,#eff6ff)}.clear .cards{margin:32px 24px}.clear .card{height:220px}.toolbar{position:absolute;left:62px;top:207px;display:flex;align-items:center;gap:5px;height:42px;padding:6px;border-radius:10px;color:white;background:#0f172af5;box-shadow:0 10px 28px #02061766}.toolbar span{padding:0 7px;color:#cbd5e1;font:12px ui-monospace,monospace}.toolbar button{height:30px;padding:0 13px;border:0;border-radius:7px;color:white;background:#2563eb;font-weight:700}.toolbar button:last-child{width:30px;padding:0;color:#cbd5e1;background:transparent;font-size:18px}
.caption{position:absolute;right:70px;top:125px;width:350px}.caption img{width:78px}.caption h2{margin:24px 0 12px;font-size:42px;line-height:1.05}.caption p{color:#475569;font-size:19px;line-height:1.5}
</style><div class="browser"><div class="bar"><i class="dot"></i><i class="dot"></i><i class="dot"></i><div class="address"></div></div><div class="page"><h1>Capture exactly what matters.</h1><p class="lead">Select any element or draw a custom region, interact with the live page, then save the precise moment.</p><div class="cards"><div class="card"><b>Live page</b><div class="line"></div><div class="line short"></div></div><div class="card"><b>Precise crop</b><div class="line"></div><div class="line short"></div></div></div><div class="shade"></div><div class="clear"><div class="cards"><div class="card"><b>Live page</b><div class="line"></div><div class="line short"></div></div><div class="card"><b>Precise crop</b><div class="line"></div><div class="line short"></div></div></div></div><div class="selection"></div><i class="handle h1"></i><i class="handle h2"></i><i class="handle h3"></i><i class="handle h4"></i><div class="toolbar"><span>⠿</span><span>664 × 294</span><button>Capture</button><button>×</button></div><aside class="caption"><img src="${iconDataUrl()}"><h2>Pick. Interact. Capture.</h2><p>Region Snap keeps your selected area ready while the page stays fully interactive.</p></aside></div></div>`;
await screenshotHtml(
  demoScreenshot,
  1280,
  800,
  "store-assets/screenshots/01-select-region-1280x800.png",
);

const popupData = Buffer.from(popupSource).toString("base64");
const popupScreenshot = `<!doctype html><style>*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;font-family:Inter,Arial,sans-serif}body{display:flex;align-items:center;justify-content:space-between;padding:90px 130px;background:radial-gradient(circle at 20% 20%,#93c5fd55,transparent 38%),linear-gradient(135deg,#eff6ff,#dbeafe)}.copy{width:520px;color:#0f172a}.copy img{width:82px}.copy h1{margin:26px 0 16px;font-size:55px;line-height:1.02;letter-spacing:-.04em}.copy p{color:#475569;font-size:21px;line-height:1.55}.shell{padding:18px;border:1px solid #bfdbfe;border-radius:24px;background:#ffffffaa;box-shadow:0 28px 70px #1e3a8a30;backdrop-filter:blur(12px)}iframe{display:block;width:320px;height:430px;border:0;border-radius:14px;background:#f8fafc}</style><section class="copy"><img src="${iconDataUrl()}"><h1>A focused screenshot workflow.</h1><p>Choose a region, keep interacting with the page, and capture when the state is exactly right.</p></section><div class="shell"><iframe src="data:text/html;base64,${popupData}"></iframe></div>`;
await screenshotHtml(popupScreenshot, 1280, 800, "store-assets/screenshots/02-popup-1280x800.png");

await browser.close();
console.log("Generated runtime icons and Chrome Web Store artwork.");
