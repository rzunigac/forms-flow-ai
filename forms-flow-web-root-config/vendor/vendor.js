// Copies the third-party browser files into <out>, from npm tarballs checked against packages.txt:
//   - what index.ejs references as <%= vendor %>/<name>@<version>/<path>  -> <out>/<name>@<version>/<path>
//   - the formio runtime libraries in formio-cdn.txt                       -> <out>/formio/<path>
// A CSS file also brings the files it references. Anything not pinned, missing, outside its package or
// not matching its hash stops the build, and so does a <%= formioCdn %> reference not in formio-cdn.txt.
//
// Usage: node vendor.js <index.ejs> <packages.txt> <formio-cdn.txt> <out>
const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const [ejsFile, packagesFile, formioFile, out] = process.argv.slice(2);

function fail(message) {
  console.error(`vendor: ${message}`);
  process.exit(1);
}

// Non-comment lines of a manifest, split into fields
function entries(file) {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields[0] && !fields[0].startsWith("#"));
}

const pinned = new Map(entries(packagesFile)); // "<name>@<version>" -> integrity

const work = fs.mkdtempSync(path.join(os.tmpdir(), "vendor-"));
const roots = new Map(); // "<name>@<version>" -> unpacked package directory

function unpack(spec) {
  if (roots.has(spec)) return roots.get(spec);
  const integrity = pinned.get(spec);
  if (!integrity) fail(`${spec} is referenced but not pinned in packages.txt`);
  const dir = fs.mkdtempSync(path.join(work, "pkg-"));
  const [{ filename }] = JSON.parse(
    execFileSync("npm", ["pack", spec, "--json", "--pack-destination", dir], { encoding: "utf8" })
  );
  const tarball = path.join(dir, filename);
  const actual = "sha512-" + crypto.createHash("sha512").update(fs.readFileSync(tarball)).digest("base64");
  if (actual !== integrity) fail(`${spec}: tarball integrity ${actual}, packages.txt has ${integrity}`);
  execFileSync("tar", ["xzf", tarball, "-C", dir]);
  // npm tarballs hold one top directory, usually package/
  const [top] = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  const root = path.join(dir, top.name);
  roots.set(spec, root);
  return root;
}

const copied = new Set();

// Copy <file> of package <spec> to <dest>; for CSS, also the files it references, next to it.
function copy(spec, file, dest, from) {
  if (copied.has(dest)) return;
  copied.add(dest);
  const root = unpack(spec);
  const src = path.resolve(root, file);
  if (!src.startsWith(root + path.sep)) fail(`${spec}/${file} (from ${from}) is outside the package`);
  if (!fs.existsSync(src)) fail(`${spec}/${file} (from ${from}) is not in the package`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);

  if (file.endsWith(".css")) {
    const css = fs.readFileSync(src, "utf8");
    const refs = [
      ...[...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((m) => m[2]),
      ...[...css.matchAll(/@import\s+(['"])([^'"]+)\1/g)].map((m) => m[2]),
    ];
    for (const ref of refs) {
      if (/^([a-z]+:)?\/\//i.test(ref)) fail(`${spec}/${file} loads ${ref} from another origin`);
      if (/^(data:|#)/i.test(ref)) continue;
      const rel = ref.replace(/[?#].*$/, "");
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), rel));
      copy(spec, target, path.join(path.dirname(dest), rel), `${spec}/${file}`);
    }
  }
}

// "<name>@<version>/<path>" -> [spec, path]
function splitSource(source) {
  const m = source.match(/^((?:@[^/]+\/)?[^/@]+@[^/]+)\/(.+)$/);
  if (!m) fail(`${source} is not <name>@<version>/<path>`);
  return [m[1], m[2]];
}

const ejs = fs.readFileSync(ejsFile, "utf8");
const name = path.basename(ejsFile);

// index.ejs: <%= vendor %>/<name>@<version>/<path>
const vendorRefs = [...ejs.matchAll(/<%=\s*vendor\s*%>\/([^"'\s]+)/g)].map((m) => m[1]);
if (vendorRefs.length === 0) fail(`no <%= vendor %> references in ${ejsFile}`);
for (const ref of vendorRefs) {
  const [spec, file] = splitSource(ref);
  copy(spec, file, path.join(out, spec, file), name);
}

// A file not on npm, checked against its sha256 (a few attempts: one network error should not fail the build)
async function download(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return Buffer.from(await resp.arrayBuffer());
    } catch (err) {
      if (attempt === 5) fail(`${url}: ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
}

async function main() {
  // formio-cdn.txt
  const formio = path.join(out, "formio");
  const formioPaths = [];
  for (const [target, source, sha256] of entries(formioFile)) {
    formioPaths.push(target);
    const dest = path.join(formio, target);
    if (/^https:\/\//.test(source)) {
      if (!/^[0-9a-f]{64}$/.test(sha256 || "")) fail(`${target}: a URL source needs its sha256`);
      const body = await download(source);
      const actual = crypto.createHash("sha256").update(body).digest("hex");
      if (actual !== sha256) fail(`${source}: sha256 ${actual}, formio-cdn.txt has ${sha256}`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, body);
      copied.add(dest);
      continue;
    }
    const [spec, file] = splitSource(source);
    if (!target.endsWith("/")) {
      copy(spec, file, dest, "formio-cdn.txt");
      continue;
    }
    const dir = path.resolve(unpack(spec), file);
    if (!fs.existsSync(dir)) fail(`${source} (formio-cdn.txt) is not in the package`);
    for (const f of fs.readdirSync(dir).filter((f) => /\.(js|css|json)$/.test(f))) {
      copy(spec, path.posix.join(file, f), path.join(dest, f), "formio-cdn.txt");
    }
  }

  // index.ejs: <%= formioCdn %>/<path> must be served from /vendor/formio/
  for (const [, ref] of ejs.matchAll(/<%=\s*formioCdn\s*%>\/([^"'\s]+)/g)) {
    if (!formioPaths.some((p) => p === ref || (p.endsWith("/") && ref.startsWith(p)))) {
      fail(`${name} loads <%= formioCdn %>/${ref}, which formio-cdn.txt does not list`);
    }
  }

  const unused = [...pinned.keys()].filter((spec) => !roots.has(spec));
  if (unused.length) fail(`pinned but not referenced: ${unused.join(", ")}`);

  console.log(`vendor: ${copied.size} files from ${roots.size} packages into ${out}`);
}

main();
