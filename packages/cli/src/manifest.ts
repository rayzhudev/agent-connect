import path from 'path';
import Ajv, { type ErrorObject } from 'ajv';
import type { AppManifest } from '@agentconnect/host';
import { readJson, fileExists } from './fs-utils.js';
import { findSchemaDir } from './paths.js';
import { readZipEntry } from './zip.js';

export async function readManifestFromDir(appPath: string): Promise<AppManifest> {
  const manifestPath = path.join(appPath, 'agentconnect.app.json');
  if (!(await fileExists(manifestPath))) {
    throw new Error('agentconnect.app.json not found in app directory.');
  }
  return readJson<AppManifest>(manifestPath);
}

export async function readManifestFromZip(zipPath: string): Promise<AppManifest> {
  const content = await readZipEntry(zipPath, 'agentconnect.app.json');
  if (!content) {
    throw new Error('agentconnect.app.json not found in zip.');
  }
  return JSON.parse(content) as AppManifest;
}

export async function loadManifestSchema(): Promise<object> {
  const schemaDir = await findSchemaDir();
  if (!schemaDir) {
    throw new Error('Unable to locate schemas directory.');
  }
  const schemaPath = path.join(schemaDir, 'app-manifest.json');
  return readJson<object>(schemaPath);
}

export interface ManifestValidationResult {
  valid: boolean;
  errors: ErrorObject[];
}

export async function validateManifest(manifest: unknown): Promise<ManifestValidationResult> {
  const schema = await loadManifestSchema();
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const valid = validate(manifest);
  return { valid: Boolean(valid), errors: validate.errors || [] };
}
