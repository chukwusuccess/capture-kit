import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

async function packageExtension(): Promise<void> {
  const rootDir = process.cwd();
  const extDistDir = path.resolve(rootDir, 'apps/extension/dist');

  if (!fs.existsSync(extDistDir)) {
    throw new Error(`Extension dist directory not found at: ${extDistDir}. Run build first.`);
  }

  const manifestPath = path.join(extDistDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json not found in ${extDistDir}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const version = manifest.version || '0.1.0';
  const name = manifest.name || 'capture-kit';

  const zip = new JSZip();

  function addDirectory(currentDir: string, zipFolder: JSZip) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        const subFolder = zipFolder.folder(entry.name);
        if (subFolder) {
          addDirectory(fullPath, subFolder);
        }
      } else if (entry.isFile()) {
        const data = fs.readFileSync(fullPath);
        zipFolder.file(entry.name, data);
      }
    }
  }

  addDirectory(extDistDir, zip);

  const outDir = path.resolve(rootDir, 'dist');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const versionedZipName = `${name}-extension-v${version}.zip`;
  const versionedZipPath = path.join(outDir, versionedZipName);
  const latestZipPath = path.join(outDir, `${name}-extension.zip`);

  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  fs.writeFileSync(versionedZipPath, zipBuffer);
  fs.writeFileSync(latestZipPath, zipBuffer);

  const sizeKb = (zipBuffer.length / 1024).toFixed(1);
  console.log(`Packaged Chrome extension:`);
  console.log(`- Versioned: ${versionedZipPath} (${sizeKb} KB)`);
  console.log(`- Latest:    ${latestZipPath}`);
}

packageExtension().catch((err) => {
  console.error('Packaging failed:', err);
  process.exit(1);
});
