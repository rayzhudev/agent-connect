import path from 'path';
import { promises as fs } from 'fs';
import type { AppManifest, RegistryIndex } from './types.js';
import { readJson, writeJson, fileExists } from './fs-utils.js';
import { hashFile } from './zip.js';
import { readManifestFromZip } from './manifest.js';

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

export interface PublishPackageOptions {
  zipPath: string;
  signaturePath?: string;
  registryPath: string;
  manifest?: AppManifest;
}

export interface PublishPackageResult {
  appId: string;
  version: string;
  hash: string;
  targetZip: string;
  manifestPath: string;
  signaturePath: string | null;
  indexPath: string;
}

export async function publishPackage({
  zipPath,
  signaturePath,
  registryPath,
  manifest,
}: PublishPackageOptions): Promise<PublishPackageResult> {
  const resolvedManifest = manifest || (await readManifestFromZip(zipPath));
  const appId = resolvedManifest.id;
  const version = resolvedManifest.version;
  if (!appId || !version) {
    throw new Error('Manifest must include id and version.');
  }

  const entryDir = path.join(registryPath, 'apps', appId, version);
  await fs.mkdir(entryDir, { recursive: true });

  const targetZip = path.join(entryDir, 'app.zip');
  await fs.copyFile(zipPath, targetZip);

  const manifestPath = path.join(entryDir, 'manifest.json');
  await writeJson(manifestPath, resolvedManifest);

  let signatureOut: string | null = null;
  if (signaturePath) {
    signatureOut = path.join(entryDir, 'signature.json');
    await fs.copyFile(signaturePath, signatureOut);
  }

  const hash = await hashFile(zipPath);

  const indexPath = path.join(registryPath, 'index.json');
  const index: RegistryIndex = (await fileExists(indexPath))
    ? await readJson<RegistryIndex>(indexPath)
    : { apps: {} };

  if (!index.apps) index.apps = {};
  if (!index.apps[appId]) {
    index.apps[appId] = { latest: version, versions: {} };
  }

  index.apps[appId].versions[version] = {
    path: path.relative(registryPath, targetZip).replace(/\\/g, '/'),
    manifest: resolvedManifest,
    signature: signatureOut
      ? {
          algorithm: 'unknown',
          publicKey: '',
          signature: '',
        }
      : undefined,
    hash,
  };

  const currentLatest = index.apps[appId].latest;
  if (!currentLatest || compareSemver(version, currentLatest) > 0) {
    index.apps[appId].latest = version;
  }

  await writeJson(indexPath, index);

  return { appId, version, hash, targetZip, manifestPath, signaturePath: signatureOut, indexPath };
}
