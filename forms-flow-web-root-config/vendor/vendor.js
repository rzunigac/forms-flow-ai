// Copies the third-party files index.ejs loads into <out>/<name>@<version>/<path>, from npm tarballs
// checked against packages.txt (see there). A CSS file also brings the files it references.
// Any reference that is not pinned, not in the package or outside it stops the build.
//
// Usage: node vendor.js <index.ejs> <packages.txt> <out>
const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const [ejsFile, listFile, out] = process.argv.slice(2);

function fail(message) {
  console.error(`vendor: ${message}`);
  process.exit(1);
}

const pinned = new Map(); // "<name>@<version>" -> integrity
for (const line of fs.readFileSync(listFile, "utf8").split("\n")) {
  const fields = line.trim().split(/\s+/);
  if (fields[0] && !fields[0].startsWith("#")) pinned.set(fields[0], fields[1]);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "vendor-"));
const roots = new Map(); // "<name>@<version>" -> unpacked package directory

function unpack(spec) {
  if (roots.has(spec)) return roots.get(spec);
  const integrity = pinned.get(spec);
  if (!integrity) fail(`${spec} is referenced in index.ejs but not pinned in packages.txt`);
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

function copy(spec, file, from) {
  const key = `${spec}/${file}`;
  if (copied.has(key)) return;
  copied.add(key);
  const root = unpack(spec);
  const src = path.resolve(root, file);
  if (!src.startsWith(root + path.sep)) fail(`${key} (from ${from}) is outside the package`);
  if (!fs.existsSync(src)) fail(`${key} (from ${from}) is not in the package`);
  const dest = path.join(out, spec, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);

  if (file.endsWith(".css")) {
    const css = fs.readFileSync(src, "utf8");
    const refs = [
      ...[...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((m) => m[2]),
      ...[...css.matchAll(/@import\s+(['"])([^'"]+)\1/g)].map((m) => m[2]),
    ];
    for (const ref of refs) {
      if (/^(data:|[a-z]+:\/\/|\/\/|#)/i.test(ref)) {
        if (/^([a-z]+:)?\/\//i.test(ref)) fail(`${key} loads ${ref} from another origin`);
        continue;
      }
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), ref.replace(/[?#].*$/, "")));
      copy(spec, target, key);
    }
  }
}

const ejs = fs.readFileSync(ejsFile, "utf8");
const refs = [...ejs.matchAll(/<%=\s*vendor\s*%>\/((?:@[^/]+\/)?[^/@]+@[^/]+)\/([^"'\s]+)/g)];
if (refs.length === 0) fail(`no <%= vendor %> references in ${ejsFile}`);
for (const [, spec, file] of refs) copy(spec, file, path.basename(ejsFile));

const unused = [...pinned.keys()].filter((spec) => !roots.has(spec));
if (unused.length) fail(`pinned but not referenced in index.ejs: ${unused.join(", ")}`);

console.log(`vendor: ${copied.size} files from ${roots.size} packages into ${out}`);
