import path from 'path';
import { promises as fs } from 'fs';
import { createPrivateKey, createPublicKey, sign as signData } from 'crypto';
import type { AppManifest } from './types.js';
import { startDevHost } from './host.js';
import { resolveAppPath } from './paths.js';
import { zipDirectory, hashFile } from './zip.js';
import { readManifestFromDir, readManifestFromZip, validateManifest } from './manifest.js';
import { publishPackage } from './registry.js';
import { validateRegistry } from './registry-validate.js';

const args = process.argv.slice(2);
const command = args[0];

const helpText = `agentconnect <command>

Commands:
  dev     Start a local AgentConnect host
  pack    Package an app
  verify  Verify an app package
  sign    Sign an app package
  publish Publish to registry
  registry-verify  Validate a registry

Dev options:
  --host <host>   Host to bind (default: 127.0.0.1)
  --port <port>   Port to bind (default: 9630)
  --app <path>    App path (optional)
  --ui <url>      UI dev server URL (optional)

Pack options:
  --app <path>    App directory (default: cwd)
  --out <path>    Output zip path (default: dist/app.zip)

Verify options:
  --app <path>    App directory or zip
  --json          Output JSON

Sign options:
  --app <path>    Zip path
  --key <path>    Private key path (PEM)
  --out <path>    Signature output path (default: dist/app.sig.json)

Publish options:
  --app <path>        Zip path
  --registry <path>   Registry directory
  --signature <path>  Signature file (optional)

Registry-verify options:
  --registry <path>        Registry directory
  --require-signature      Fail if any entry lacks a signature
  --json                   Output JSON
`;

function getFlag(name: string, alias?: string): string | null {
  const idx = args.findIndex((arg) => arg === name || arg === alias);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
}

function parsePort(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function main(): Promise<number | null> {
  if (!command || command === '--help' || command === '-h') {
    console.log(helpText);
    return 0;
  }

  if (command === 'dev') {
    const host = getFlag('--host', '-H') ?? '127.0.0.1';
    const port = parsePort(getFlag('--port', '-p'), 9630);
    const appPath = getFlag('--app', '-a') ?? undefined;
    const uiUrl = getFlag('--ui', '-u') ?? undefined;
    startDevHost({ host, port, appPath, uiUrl });
    return null;
  }

  if (command === 'pack') {
    const appPath = resolveAppPath(getFlag('--app', '-a') ?? undefined);
    const outPath = getFlag('--out', '-o') || path.join(appPath, 'dist', 'app.zip');
    const manifest = await readManifestFromDir(appPath);
    const validation = await validateManifest(manifest);
    if (!validation.valid) {
      console.error('Manifest validation failed.');
      console.error(validation.errors);
      return 1;
    }

    const ignoreNames = ['node_modules', '.git', '.DS_Store'];
    const ignorePaths: string[] = [];
    const outputRel = path.relative(appPath, outPath);
    if (!outputRel.startsWith('..') && outputRel !== '') {
      ignorePaths.push(outputRel);
    }

    await zipDirectory({ inputDir: appPath, outputPath: outPath, ignoreNames, ignorePaths });
    console.log(`Packed ${appPath} -> ${outPath}`);
    return 0;
  }

  if (command === 'verify') {
    const appArg = getFlag('--app', '-a');
    const jsonOut = args.includes('--json');
    const appPath = resolveAppPath(appArg ?? undefined);
    const stats = await fs.stat(appPath).catch(() => null);
    if (!stats) {
      console.error('App path not found.');
      return 1;
    }

    let manifest: AppManifest;
    let hash: string | null = null;
    if (stats.isDirectory()) {
      manifest = await readManifestFromDir(appPath);
    } else {
      manifest = await readManifestFromZip(appPath);
      hash = await hashFile(appPath);
    }

    const validation = await validateManifest(manifest);
    const result = {
      valid: validation.valid,
      errors: validation.errors,
      hash,
      manifest,
    };

    if (jsonOut) {
      console.log(JSON.stringify(result, null, 2));
      return validation.valid ? 0 : 1;
    }

    if (validation.valid) {
      console.log('Manifest valid.');
      if (hash) console.log(`SHA256: ${hash}`);
      return 0;
    }

    console.error('Manifest validation failed.');
    console.error(validation.errors);
    return 1;
  }

  if (command === 'sign') {
    const appArg = getFlag('--app', '-a');
    const keyPath = getFlag('--key', '-k');
    if (!appArg || !keyPath) {
      console.error('Usage: agentconnect sign --app <zip> --key <pem> [--out <path>]');
      return 1;
    }
    const appPath = resolveAppPath(appArg);
    const appStats = await fs.stat(appPath).catch(() => null);
    if (!appStats || !appStats.isFile()) {
      console.error('Sign requires a zip file path.');
      return 1;
    }
    const outPath = getFlag('--out', '-o') || path.join(path.dirname(appPath), 'app.sig.json');
    const manifest = await readManifestFromZip(appPath);
    const hash = await hashFile(appPath);
    const hashBuffer = Buffer.from(hash, 'hex');
    const privateKeyPem = await fs.readFile(keyPath, 'utf8');
    const privateKey = createPrivateKey(privateKeyPem);
    const keyType = privateKey.asymmetricKeyType;
    const algorithm = keyType === 'ed25519' ? null : 'sha256';
    const signatureAlg =
      keyType === 'ed25519'
        ? 'ed25519'
        : keyType === 'rsa'
          ? 'rsa-sha256'
          : keyType === 'ec'
            ? 'ecdsa-sha256'
            : 'sha256';
    const signature = signData(algorithm, hashBuffer, privateKey);
    const publicKeyPem = createPublicKey(privateKey).export({
      type: 'spki',
      format: 'pem',
    }) as string;

    const signaturePayload = {
      appId: manifest.id,
      version: manifest.version,
      hash,
      hashAlg: 'sha256',
      signature: signature.toString('base64'),
      signatureAlg,
      publicKey: publicKeyPem,
      createdAt: new Date().toISOString(),
    };

    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(signaturePayload, null, 2), 'utf8');
    console.log(`Signature written to ${outPath}`);
    return 0;
  }

  if (command === 'publish') {
    const appArg = getFlag('--app', '-a');
    const registry = getFlag('--registry', '-r');
    const signaturePath = getFlag('--signature', '-s') ?? undefined;
    if (!appArg || !registry) {
      console.error(
        'Usage: agentconnect publish --app <zip> --registry <path> [--signature <path>]'
      );
      return 1;
    }
    const appPath = resolveAppPath(appArg);
    const appStats = await fs.stat(appPath).catch(() => null);
    if (!appStats || !appStats.isFile()) {
      console.error('Publish requires a zip file path.');
      return 1;
    }
    const registryPath = resolveAppPath(registry);
    const manifest = await readManifestFromZip(appPath);
    const validation = await validateManifest(manifest);
    if (!validation.valid) {
      console.error('Manifest validation failed.');
      console.error(validation.errors);
      return 1;
    }
    const result = await publishPackage({
      zipPath: appPath,
      signaturePath,
      registryPath,
      manifest,
    });
    console.log(`Published ${result.appId}@${result.version}`);
    console.log(`Registry entry: ${result.indexPath}`);
    return 0;
  }

  if (command === 'registry-verify') {
    const registry = getFlag('--registry', '-r');
    const jsonOut = args.includes('--json');
    const requireSignature = args.includes('--require-signature');
    if (!registry) {
      console.error(
        'Usage: agentconnect registry-verify --registry <path> [--require-signature] [--json]'
      );
      return 1;
    }
    const registryPath = resolveAppPath(registry);
    const result = await validateRegistry({ registryPath, requireSignature });
    if (jsonOut) {
      console.log(JSON.stringify(result, null, 2));
      return result.valid ? 0 : 1;
    }
    if (result.valid) {
      console.log('Registry valid.');
      if (result.warnings.length) {
        console.log('Warnings:');
        for (const warning of result.warnings) {
          console.log(`- ${warning.message}`);
        }
      }
      return 0;
    }
    console.error('Registry validation failed.');
    for (const error of result.errors) {
      console.error(`- ${error.message}`);
    }
    if (result.warnings.length) {
      console.error('Warnings:');
      for (const warning of result.warnings) {
        console.error(`- ${warning.message}`);
      }
    }
    return 1;
  }

  console.error(`Unknown command: ${command}`);
  console.log(helpText);
  return 1;
}

main()
  .then((code) => {
    if (typeof code === 'number') {
      process.exitCode = code;
    }
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
