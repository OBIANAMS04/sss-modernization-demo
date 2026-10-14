import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { LoadedPolicy, loadPolicy } from '@open-policy-agent/opa-wasm';

// STORY-016: the Open Policy Agent policy (backend/policy/sss_authz.rego), compiled to WebAssembly by scripts/opa/build.mjs and
// evaluated in this process. The compiled file is committed because the deployment has no OPA tool. Resolved from here so it
// is found from src/ (ts-node, jest) and from dist/ alike.
const POLICY_DIR = path.resolve(__dirname, '..', '..', 'policy');

export interface Decision {
  allow: boolean;
  /** The rule that decided: a rule id, or no-route, route-roles, not-found or no-matching-rule. */
  rule: string;
  reason: string;
}

export interface EngineInfo {
  name: string;
  version: string;
  format: string;
  wasmSha256: string;
}

let policy: LoadedPolicy | null = null;
let entrypoint = '';
let info: EngineInfo | null = null;
let loading: Promise<EngineInfo> | null = null;

async function read(): Promise<EngineInfo> {
  const manifest = JSON.parse(readFileSync(path.join(POLICY_DIR, 'manifest.json'), 'utf8'));
  const wasm = readFileSync(path.join(POLICY_DIR, 'sss_authz.wasm'));
  // The manifest vouches for one compiled file; anything else is not run
  const wasmSha256 = createHash('sha256').update(wasm).digest('hex');
  if (wasmSha256 !== manifest.wasmSha256) {
    throw new Error(`The compiled access policy (SHA-256 ${wasmSha256}) is not the one manifest.json names; rebuild it with node scripts/opa/build.mjs`);
  }
  policy = await loadPolicy(wasm);
  entrypoint = manifest.entrypoint;
  info = { name: 'Open Policy Agent', version: manifest.opaVersion, format: 'WebAssembly', wasmSha256 };
  return info;
}

/** Loads the compiled policy once; later calls return what was loaded. */
export async function loadEngine(): Promise<EngineInfo> {
  if (info) return info;
  loading ??= read().finally(() => (loading = null));
  return loading;
}

function loaded(): LoadedPolicy {
  if (!policy) throw new Error('The access policy is not loaded');
  return policy;
}

/** Gives the policy its data (data.routes and data.rules); every answer after this call uses it. */
export function setData(data: object): void {
  loaded().setData(data);
}

/** The policy's answer for one request. Anything but a clear answer is a refusal. */
export function evaluate(input: object): Decision {
  let results: { result?: Partial<Decision> }[];
  try {
    results = loaded().evaluate(input, entrypoint);
  } catch (error) {
    // The WebAssembly runtime throws plain strings
    throw new Error(`The access policy could not be evaluated: ${typeof error === 'string' ? error : (error as Error).message}`);
  }
  const answer = results?.[0]?.result;
  if (typeof answer?.allow !== 'boolean' || typeof answer.rule !== 'string' || typeof answer.reason !== 'string') {
    return { allow: false, rule: 'no-decision', reason: 'The policy gave no answer, so the request is refused' };
  }
  return { allow: answer.allow, rule: answer.rule, reason: answer.reason };
}
