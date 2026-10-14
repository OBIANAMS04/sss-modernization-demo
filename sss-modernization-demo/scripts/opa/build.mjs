// STORY-016: builds the API access policy. Checks and tests backend/policy/sss_authz.rego with the Open Policy Agent (OPA)
// command-line tool, compiles it to WebAssembly, and writes backend/policy/sss_authz.wasm plus manifest.json (the OPA version,
// the entry point, and the SHA-256 of the .rego and of the .wasm). The backend runs the .wasm in-process (opa-wasm); the
// .wasm and the manifest are committed because the deployment has no OPA tool. A jest test (policyEngine.test.ts) fails when the
// .rego was edited without rebuilding.
//
//   node scripts/opa/build.mjs           check, test, build, and write the two files
//   node scripts/opa/build.mjs --check   check, test and build, and fail if the committed files differ (nothing is written)
//
// The OPA tool is downloaded once to ~/.cache/sss-opa/v<version>/ (outside the repository, never committed) and its SHA-256 is
// verified against the digest published with the release, and against the digest pinned below, every time before it runs.
// The .rego hash ignores line endings (a checkout that converts them, as git does on Windows, still matches).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const OPA_VERSION = '1.21.0';
const ENTRYPOINT = 'sss/authz/decision';
const POLICY_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend', 'policy');
const REGO = 'sss_authz.rego';
const REGO_TESTS = 'sss_authz_test.rego';
const WASM = 'sss_authz.wasm';
const MANIFEST = 'manifest.json';
const CACHE = process.env.SSS_OPA_CACHE || join(homedir(), '.cache', 'sss-opa', `v${OPA_VERSION}`);
const RELEASE = `https://github.com/open-policy-agent/opa/releases/download/v${OPA_VERSION}`;

// The release file for each platform, and the SHA-256 the release published for it
const ASSETS = {
  'win32-x64': ['opa_windows_amd64.exe', '1e0e9639673615fa3a6d4974b07e335e44827e377ce7c7bffbb1a6605a26479b'],
  'linux-x64': ['opa_linux_amd64_static', '5eef70644868bb04d0556bcc795ee42f2ab379e73f51d1bfa30f83e1305bc9b9'],
  'linux-arm64': ['opa_linux_arm64_static', '0ec34027c15b4d969c21d01ed570fe14fbebd508a08157043ab09f9a0dccbee6'],
  'darwin-x64': ['opa_darwin_amd64', '0ceb96979d259b3ee31711a6b316a592b8ffcfdd4209cc37600ed85a6cd4a55c'],
  'darwin-arm64': ['opa_darwin_arm64_static', 'f1e4da6467a2adb2846bb23eec6ea00d8c3a04786f9270bb11003d22dfd827a5'],
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** The OPA tool for this machine, downloaded on first use. It is never run unless its SHA-256 is the published one. */
async function ensureOpa() {
  const asset = ASSETS[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error(`No OPA ${OPA_VERSION} download is listed for ${process.platform}-${process.arch}; add it to ASSETS`);
  const [name, pinned] = asset;
  const binary = join(CACHE, name);
  mkdirSync(CACHE, { recursive: true });

  if (!existsSync(binary)) {
    console.log(`Downloading ${name} (OPA ${OPA_VERSION}) to ${CACHE}`);
    const published = (await download(`${RELEASE}/${name}.sha256`)).toString().trim().split(/\s+/)[0].toLowerCase();
    if (published !== pinned) throw new Error(`The published SHA-256 of ${name} (${published}) is not the pinned one (${pinned}); not downloading`);
    const bytes = await download(`${RELEASE}/${name}`);
    if (sha256(bytes) !== pinned) throw new Error(`The download of ${name} has SHA-256 ${sha256(bytes)}, expected ${pinned}; not using it`);
    writeFileSync(`${binary}.sha256`, `${pinned}  ${name}\n`);
    writeFileSync(`${binary}.part`, bytes);
    renameSync(`${binary}.part`, binary);
    chmodSync(binary, 0o755);
  }
  const actual = sha256(readFileSync(binary));
  if (actual !== pinned) throw new Error(`${binary} has SHA-256 ${actual}, expected ${pinned}; delete it and run again`);
  console.log(`OPA ${OPA_VERSION}: ${name}, SHA-256 ${pinned} verified`);
  return binary;
}

/** Runs OPA in the policy folder with relative file names: the compiled policy holds its source path, so absolute paths would make the same .rego build differently on each machine. */
function opa(binary, args, what) {
  console.log(`\n$ opa ${args.join(' ')}`);
  const result = spawnSync(binary, args, { cwd: POLICY_DIR, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${what} failed (opa exit code ${result.status})`);
}

/** One file out of a tar archive (a bundle holds only small regular files). */
function fromTar(tar, wanted) {
  const text = (start, length) => tar.toString('utf8', start, start + length).replace(/\0[\s\S]*$/, '');
  for (let at = 0; at + 512 <= tar.length; ) {
    const name = text(at, 100);
    if (!name) break; // the end of an archive is blocks of zeros
    const size = parseInt(text(at + 124, 12).trim() || '0', 8);
    const type = text(at + 156, 1);
    const start = at + 512;
    if ((type === '0' || type === '') && name.replace(/^\.?\//, '') === wanted) return tar.subarray(start, start + size);
    at = start + Math.ceil(size / 512) * 512;
  }
  throw new Error(`${wanted} is not in the bundle`);
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const binary = await ensureOpa();

  opa(binary, ['check', '--strict', REGO, REGO_TESTS], 'opa check');
  opa(binary, ['test', '-v', REGO, REGO_TESTS], 'opa test');

  const work = mkdtempSync(join(tmpdir(), 'sss-opa-'));
  let wasm;
  try {
    const bundle = join(work, 'bundle.tar.gz');
    opa(binary, ['build', '-t', 'wasm', '-e', ENTRYPOINT, REGO, '-o', bundle], 'opa build');
    wasm = fromTar(gunzipSync(readFileSync(bundle)), 'policy.wasm');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const manifest =
    JSON.stringify(
      {
        opaVersion: OPA_VERSION,
        entrypoint: ENTRYPOINT,
        regoSha256: sha256(readFileSync(join(POLICY_DIR, REGO), 'utf8').replace(/\r\n/g, '\n')),
        wasmSha256: sha256(wasm),
      },
      null,
      2
    ) + '\n';

  if (checkOnly) {
    const committed = (file) => (existsSync(join(POLICY_DIR, file)) ? readFileSync(join(POLICY_DIR, file)) : Buffer.alloc(0));
    const stale = [[WASM, wasm], [MANIFEST, Buffer.from(manifest)]].filter(([file, fresh]) => !fresh.equals(committed(file))).map(([file]) => file);
    if (stale.length) throw new Error(`${stale.join(' and ')} differ from a fresh build of ${REGO}; run node scripts/opa/build.mjs and commit the result`);
    console.log(`\n${WASM} and ${MANIFEST} are what ${REGO} builds to`);
    return;
  }
  writeFileSync(join(POLICY_DIR, WASM), wasm);
  writeFileSync(join(POLICY_DIR, MANIFEST), manifest);
  console.log(`\nWrote ${WASM} (${wasm.length} bytes) and ${MANIFEST}:\n${manifest}`);
}

main().catch((error) => {
  console.error(`\nERROR ${error.message}`);
  process.exit(1);
});
