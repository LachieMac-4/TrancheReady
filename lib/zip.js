// lib/zip.js — named export + default wrapper (Node 18–22 ESM)
import archiver from 'archiver';
import { PassThrough } from 'stream';

/**
 * Zip an object of { filename: Buffer } into a single Buffer.
 * @param {Record<string, Buffer>} named
 * @returns {Promise<Buffer>}
 */
export async function zipNamedBuffers(named) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });

    // Collect the zip bytes in memory
    const out = new PassThrough();
    const chunks = [];

    out.on('data', (c) => chunks.push(c));
    out.on('finish', () => resolve(Buffer.concat(chunks)));
    out.on('error', reject);

    archive.on('warning', (err) => {
      if (err.code !== 'ENOENT') reject(err);
    });
    archive.on('error', reject);

    archive.pipe(out);

    for (const [name, buf] of Object.entries(named)) {
      archive.append(buf, { name });
    }

    archive.finalize().catch(reject);
  });
}

// Optional default export so other import styles also work
export default { zipNamedBuffers };

