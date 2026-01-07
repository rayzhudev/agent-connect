import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function getArg(name, alias, args) {
  const idx = args.findIndex((arg) => arg === name || arg === alias);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function pathExists(target) {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

async function replacePlaceholders(filePath, map) {
  const content = await fs.readFile(filePath, 'utf8');
  let updated = content;
  for (const [key, value] of Object.entries(map)) {
    updated = updated.replaceAll(key, value);
  }
  if (updated !== content) {
    await fs.writeFile(filePath, updated, 'utf8');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const name = getArg('--name', '-n', args);
  const out = getArg('--out', '-o', args);

  if (!name || !out) {
    console.error('Usage: bun scripts/new-app.mjs --name "My App" --out /path/to/app');
    process.exit(1);
  }

  const slug = slugify(name);
  if (!slug) {
    console.error('Error: app name must include at least one letter or number.');
    process.exit(1);
  }

  const appId = `com.agentconnect.${slug}`;
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const templateDir = path.join(__dirname, '..', 'templates', 'app');
  const targetDir = path.resolve(out);

  if (await pathExists(targetDir)) {
    console.error(`Error: output path already exists: ${targetDir}`);
    process.exit(1);
  }

  await fs.cp(templateDir, targetDir, { recursive: true });

  const replacements = {
    __APP_NAME__: name,
    __APP_SLUG__: slug,
    __APP_ID__: appId,
  };

  const filesToUpdate = [
    path.join(targetDir, 'agentconnect.app.json'),
    path.join(targetDir, 'package.json'),
    path.join(targetDir, 'README.md'),
    path.join(targetDir, 'src', 'main.js'),
    path.join(targetDir, 'index.html'),
  ];

  for (const filePath of filesToUpdate) {
    if (await pathExists(filePath)) {
      await replacePlaceholders(filePath, replacements);
    }
  }

  console.log(`App created at ${targetDir}`);
  console.log('Next steps:');
  console.log(`  cd ${targetDir}`);
  console.log('  bun install');
  console.log('  bun run dev');
}

main();
