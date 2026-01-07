import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import yazl from 'yazl';
import yauzl from 'yauzl';
import { collectFiles } from './fs-utils.js';

export async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export interface ZipDirectoryOptions {
  inputDir: string;
  outputPath: string;
  ignoreNames?: string[];
  ignorePaths?: string[];
}

export async function zipDirectory({
  inputDir,
  outputPath,
  ignoreNames = [],
  ignorePaths = [],
}: ZipDirectoryOptions): Promise<void> {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  const zipfile = new yazl.ZipFile();
  const files = await collectFiles(inputDir, { ignoreNames, ignorePaths });

  for (const file of files) {
    zipfile.addFile(file.fullPath, file.rel);
  }

  return new Promise((resolve, reject) => {
    const outStream = fs.createWriteStream(outputPath);
    zipfile.outputStream.pipe(outStream);
    outStream.on('close', () => resolve());
    outStream.on('error', reject);
    zipfile.end();
  });
}

export async function readZipEntry(zipPath: string, entryName: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err || new Error('Unable to open zip'));
        return;
      }

      let found = false;
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (entry.fileName === entryName || entry.fileName.endsWith(`/${entryName}`)) {
          found = true;
          zipfile.openReadStream(entry, (streamErr, stream) => {
            if (streamErr || !stream) {
              zipfile.close();
              reject(streamErr || new Error('Unable to read zip entry'));
              return;
            }
            const chunks: Buffer[] = [];
            stream.on('data', (chunk: Buffer) => chunks.push(chunk));
            stream.on('end', () => {
              const content = Buffer.concat(chunks).toString('utf8');
              zipfile.close();
              resolve(content);
            });
            stream.on('error', reject);
          });
        } else {
          zipfile.readEntry();
        }
      });

      zipfile.on('end', () => {
        if (!found) {
          zipfile.close();
          resolve(null);
        }
      });
    });
  });
}
