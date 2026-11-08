import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const platforms = ['cloudflare', 'edgeone', 'esa', 'state-service', 'cloudflare-remote', 'self-hosted-state'];
const edgeStateModules = new Set(['remote.mjs', 'service.mjs']);
const templateFiles = new Set(['README.md', 'wrangler.toml', 'edgeone.json', 'esa.jsonc', 'Dockerfile', '.dockerignore', 'compose.yaml', 'Caddyfile']);

function contains(parent, child) {
  const path = relative(parent, child);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep));
}

async function statIfPresent(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

async function rejectLinkedAncestors(path) {
  for (let current = resolve(path); ; current = dirname(current)) {
    if ((await statIfPresent(current))?.isSymbolicLink()) throw new Error('Build paths must not contain symbolic links or junctions.');
    if (dirname(current) === current) break;
  }
}

async function collectModules(root, prefix = '') {
  const files = new Map();
  for (const entry of (await readdir(join(root, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Source modules must not contain symbolic links or junctions.');
    if (entry.isDirectory()) {
      for (const [name, content] of await collectModules(root, path)) files.set(name, content);
    } else if (entry.isFile() && /\.(?:mjs|js)$/.test(entry.name)) {
      files.set(path, await readFile(join(root, path)));
    }
  }
  return files;
}

async function verifyExistingOutput(root, expected, prefix = '') {
  const info = await statIfPresent(join(root, prefix));
  if (!info) return;
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Build output must be a regular directory.');
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Build output must not contain symbolic links or junctions.');
    if (entry.isDirectory()) {
      if (![...expected.keys()].some(file => file.startsWith(path + sep))) {
        // An empty public directory is intentionally the complete static site.
        if (path !== join('edgeone', 'public')) throw new Error('Build output contains unrelated files; choose a fresh --out-dir.');
      }
      await verifyExistingOutput(root, expected, path);
    } else if (!entry.isFile() || !expected.has(path)) {
      throw new Error('Build output contains unrelated files; choose a fresh --out-dir.');
    } else if ((await lstat(join(root, path))).nlink !== 1) {
      // Truncating a hard-linked output would also overwrite its other names,
      // including files outside the selected build directory.
      throw new Error('Build output must not contain hard-linked files.');
    }
  }
}

/** Build deployment projects. Does not install packages, read secrets or deploy. */
export async function buildPlatforms({ outDir = join(repositoryRoot, 'dist') } = {}) {
  const output = resolve(outDir);
  if (contains(output, repositoryRoot) || (contains(repositoryRoot, output) && !contains(join(repositoryRoot, 'dist'), output))) {
    throw new Error('Inside the repository, build output must stay under dist.');
  }
  await rejectLinkedAncestors(output);
  const worker = await readFile(join(repositoryRoot, '_worker.js'));
  if (/^\s*import\s|^\s*export\s+[^\n]+\sfrom\s*['"]/m.test(worker.toString('utf8'))) {
    throw new Error('The native Cloudflare worker must remain a standalone module.');
  }
  const modules = await collectModules(join(repositoryRoot, 'src'));
  for (const entry of ['platforms/cloudflare.mjs', 'platforms/edgeone.mjs', 'platforms/esa.mjs', 'state/service.mjs', 'state/sqlite.mjs', 'self-hosted/server.mjs']) {
    if (!modules.has(join(...entry.split('/')))) throw new Error('Missing platform source: ' + entry);
  }
  const files = new Map();
  for (const platform of platforms) {
    const selfHosted = platform === 'self-hosted-state';
    const app = platform === 'cloudflare' || selfHosted ? platform : join(platform, 'app');
    files.set(join(app, '_worker.js'), worker);
    for (const [path, content] of modules) {
      const [directory, filename] = path.split(sep);
      const isEdgeModule = directory === 'platforms' || (directory === 'state' && edgeStateModules.has(filename));
      if (selfHosted ? directory === 'state' || directory === 'self-hosted' : isEdgeModule) {
        files.set(join(app, 'src', path), content);
      }
    }
    if (selfHosted) files.set(join(app, 'tools', 'state-admin.mjs'), await readFile(join(repositoryRoot, 'tools', 'state-admin.mjs')));
    files.set(join(platform, 'package.json'), JSON.stringify({
      name: 'modelbridge-' + platform, private: true, type: 'module',
      ...(selfHosted ? { engines: { node: '>=24' }, scripts: { start: 'node src/self-hosted/server.mjs' } } : {}),
    }, null, 2) + '\n');
    for (const entry of await readdir(join(repositoryRoot, 'deploy', platform), { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink() || !templateFiles.has(entry.name)) {
        throw new Error('Unexpected deployment template file.');
      }
      files.set(join(platform, entry.name), await readFile(join(repositoryRoot, 'deploy', platform, entry.name)));
    }
  }
  const banner = '// Generated by tools/build-platforms.mjs; edit source modules instead.\n';
  for (const route of ['index.js', '[[default]].js']) {
    files.set(join('edgeone', 'edge-functions', route), banner + "export { default } from '../app/src/platforms/edgeone.mjs';\n");
  }
  files.set(join('esa', 'worker.js'), banner + "export { default } from './app/src/platforms/esa.mjs';\n");
  files.set(join('state-service', 'worker.js'), banner + "export { default } from './app/src/state/service.mjs';\n");
  files.set(join('cloudflare-remote', 'worker.js'), banner + "export { default } from './app/src/platforms/cloudflare.mjs';\n");
  await verifyExistingOutput(output, files);
  for (const [path, content] of files) {
    const destination = join(output, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  await mkdir(join(output, 'edgeone', 'public'), { recursive: true });
  return { outDir: output, platforms: [...platforms], files: [...files.keys()].sort() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--out-dir')) throw new Error('Usage: node tools/build-platforms.mjs [--out-dir <directory>]');
    const result = await buildPlatforms(args.length ? { outDir: args[1] } : {});
    console.log('Built ' + result.platforms.join(', ') + ' in ' + result.outDir);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
