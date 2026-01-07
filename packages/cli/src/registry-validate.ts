import path from 'path';
import { createPublicKey, verify as verifySignature } from 'crypto';
import type {
  RegistryValidationResult,
  ValidationError,
  ValidationWarning,
  SignatureData,
} from './types.js';
import { readJson, fileExists } from './fs-utils.js';
import { hashFile } from './zip.js';
import { validateManifest } from './manifest.js';

function compareSemver(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v
      .split('-')[0]
      .split('.')
      .map((n) => Number(n));
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function resolveEntry(registryPath: string, entryPath: unknown): string | null {
  if (!entryPath || typeof entryPath !== 'string') return null;
  return path.resolve(registryPath, entryPath);
}

function normalizeSignatureAlg(signatureAlg: unknown): string | null {
  const value = String(signatureAlg || '').toLowerCase();
  if (value === 'ed25519') return null;
  if (value === 'rsa-sha256') return 'sha256';
  if (value === 'ecdsa-sha256') return 'sha256';
  return 'sha256';
}

interface SignatureFile extends SignatureData {
  hash?: string;
  signatureAlg?: string;
}

interface VerifySignatureResult {
  ok: boolean;
  message: string;
}

async function verifySignatureFile({
  signaturePath,
  hash,
}: {
  signaturePath: string;
  hash: string;
}): Promise<VerifySignatureResult> {
  const signature = await readJson<SignatureFile>(signaturePath);
  if (!signature || typeof signature !== 'object') {
    return { ok: false, message: 'Signature payload is not valid JSON.' };
  }
  if (signature.hash !== hash) {
    return { ok: false, message: 'Signature hash does not match app hash.' };
  }
  const publicKey = signature.publicKey;
  if (!publicKey || typeof publicKey !== 'string') {
    return { ok: false, message: 'Signature is missing public key.' };
  }
  const signatureValue = signature.signature;
  if (!signatureValue || typeof signatureValue !== 'string') {
    return { ok: false, message: 'Signature is missing signature bytes.' };
  }
  const algorithm = normalizeSignatureAlg(signature.signatureAlg);
  const key = createPublicKey(publicKey);
  const payload = Buffer.from(hash, 'hex');
  const sigBuffer = Buffer.from(signatureValue, 'base64');
  const ok = verifySignature(algorithm, payload, key, sigBuffer);
  return { ok, message: ok ? '' : 'Signature verification failed.' };
}

interface RegistryIndex {
  apps?: Record<string, RegistryAppEntry>;
}

interface RegistryAppEntry {
  latest?: string;
  versions?: Record<string, RegistryVersionEntry>;
}

interface RegistryVersionEntry {
  path?: string;
  manifest?: string;
  signature?: string;
  hash?: string;
}

export interface ValidateRegistryOptions {
  registryPath: string;
  requireSignature?: boolean;
}

export async function validateRegistry({
  registryPath,
  requireSignature = false,
}: ValidateRegistryOptions): Promise<RegistryValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const indexPath = path.join(registryPath, 'index.json');

  if (!(await fileExists(indexPath))) {
    return {
      valid: false,
      errors: [{ path: 'index.json', message: 'index.json not found.' }],
      warnings,
    };
  }

  const index = await readJson<RegistryIndex>(indexPath).catch(() => null);
  if (!index || typeof index !== 'object') {
    return {
      valid: false,
      errors: [{ path: 'index.json', message: 'index.json is not valid JSON.' }],
      warnings,
    };
  }

  const apps = index.apps;
  if (!apps || typeof apps !== 'object') {
    return {
      valid: false,
      errors: [{ path: 'index.json', message: 'index.json missing apps map.' }],
      warnings,
    };
  }

  for (const [appId, appEntry] of Object.entries(apps)) {
    if (!appEntry || typeof appEntry !== 'object') {
      errors.push({
        path: `apps.${appId}`,
        message: `App entry for ${appId} is invalid.`,
      });
      continue;
    }
    const versions = appEntry.versions;
    if (!versions || typeof versions !== 'object') {
      errors.push({
        path: `apps.${appId}`,
        message: `App entry for ${appId} missing versions.`,
      });
      continue;
    }

    const versionKeys = Object.keys(versions);
    if (!versionKeys.length) {
      errors.push({
        path: `apps.${appId}`,
        message: `App entry for ${appId} has no versions.`,
      });
      continue;
    }

    const latest = appEntry.latest;
    if (latest && !versions[latest]) {
      errors.push({
        path: `apps.${appId}`,
        message: `App ${appId} latest (${latest}) not found in versions.`,
      });
    }

    const sorted = [...versionKeys].sort(compareSemver);
    const expectedLatest = sorted[sorted.length - 1];
    if (latest && expectedLatest && compareSemver(latest, expectedLatest) !== 0) {
      warnings.push({
        path: `apps.${appId}`,
        message: `App ${appId} latest (${latest}) is not the newest (${expectedLatest}).`,
      });
    }

    for (const [version, entry] of Object.entries(versions)) {
      if (!entry || typeof entry !== 'object') {
        errors.push({
          path: `apps.${appId}.versions.${version}`,
          message: `App ${appId}@${version} entry is invalid.`,
        });
        continue;
      }

      const zipPath = resolveEntry(registryPath, entry.path);
      const manifestPath = resolveEntry(registryPath, entry.manifest);
      const signaturePath = entry.signature ? resolveEntry(registryPath, entry.signature) : null;
      if (!zipPath || !(await fileExists(zipPath))) {
        errors.push({
          path: `apps.${appId}.versions.${version}`,
          message: `App ${appId}@${version} app.zip missing.`,
        });
        continue;
      }
      if (!manifestPath || !(await fileExists(manifestPath))) {
        errors.push({
          path: `apps.${appId}.versions.${version}`,
          message: `App ${appId}@${version} manifest missing.`,
        });
        continue;
      }

      const hash = await hashFile(zipPath);
      if (entry.hash && entry.hash !== hash) {
        errors.push({
          path: `apps.${appId}.versions.${version}`,
          message: `App ${appId}@${version} hash mismatch.`,
        });
      }

      const manifest = await readJson<{ id?: string; version?: string }>(manifestPath).catch(
        () => null
      );
      if (!manifest) {
        errors.push({
          path: `apps.${appId}.versions.${version}`,
          message: `App ${appId}@${version} manifest invalid JSON.`,
        });
        continue;
      }

      const manifestValidation = await validateManifest(manifest);
      if (!manifestValidation.valid) {
        errors.push({
          path: `apps.${appId}.versions.${version}`,
          message: `App ${appId}@${version} manifest failed schema validation.`,
        });
      }

      if (manifest.id !== appId || manifest.version !== version) {
        errors.push({
          path: `apps.${appId}.versions.${version}`,
          message: `App ${appId}@${version} manifest id/version mismatch.`,
        });
      }

      if (signaturePath) {
        if (!(await fileExists(signaturePath))) {
          errors.push({
            path: `apps.${appId}.versions.${version}`,
            message: `App ${appId}@${version} signature file missing.`,
          });
        } else {
          const verification = await verifySignatureFile({ signaturePath, hash });
          if (!verification.ok) {
            errors.push({
              path: `apps.${appId}.versions.${version}`,
              message: `App ${appId}@${version} signature invalid: ${verification.message}`,
            });
          }
        }
      } else if (requireSignature) {
        errors.push({
          path: `apps.${appId}.versions.${version}`,
          message: `App ${appId}@${version} is missing a signature.`,
        });
      } else {
        warnings.push({
          path: `apps.${appId}.versions.${version}`,
          message: `App ${appId}@${version} has no signature.`,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
