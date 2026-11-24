// The Chrome Web Store rejects a package that names a script on another host, wherever the
// address stands, also in a branch the extension never reaches. tesseract.js names jsDelivr as
// the default place for its worker, core and language data; the build takes those addresses out
// and then fails if any script address is left anywhere in dist/.

const SCRIPT_CDN_HOSTS = [
  "cdnjs.cloudflare.com",
  "cdn.jsdelivr.net",
  "fastly.jsdelivr.net",
  "unpkg.com",
  "esm.sh",
  "cdn.skypack.dev",
  "ajax.googleapis.com",
  "code.jquery.com",
];
const HOSTS = SCRIPT_CDN_HOSTS.map((host) => host.replaceAll(".", String.raw`\.`)).join("|");
// An address inside source text ends at a quote, at white space, and at the `$` of a template.
const URL_CHAR = String.raw`[^\s"'${"`"}<>\\$)]`;
const CDN_ADDRESS = String.raw`(?:https?:)?//(?:${HOSTS})(?![\w.-])${URL_CHAR}*`;
// Any address of a script or a style sheet, on any host.
const ANY_SCRIPT_ADDRESS = String.raw`https?://${URL_CHAR}+?\.(?:m?js|css)(?:[?#]${URL_CHAR}*)?(?![\w./-])`;
const REMOTE_CODE = new RegExp(`${CDN_ADDRESS}|${ANY_SCRIPT_ADDRESS}`, "gi");

export function findRemoteCode(code) {
  return code.match(REMOTE_CODE) ?? [];
}

// The code that read a default from one of those addresses is left with an empty string, so a
// path the page forgot to pass fails instead of reaching for a CDN.
export function stripRemoteCode(code) {
  return code.replace(new RegExp(CDN_ADDRESS, "gi"), "");
}
