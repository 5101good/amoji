import { mkdir, copyFile, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { SampleCatalog, type BlobRef } from './sample-catalog.js';
import { SampleRuntime } from './sample-runtime.js';
import { MessageJournal } from './message-journal.js';

export async function openPrototypeState(source: URL, directory: string): Promise<{ runtime: SampleRuntime; journal: MessageJournal }> {
  const catalog = await SampleCatalog.load(source);
  const sampleDirectory = join(directory, 'samples');
  await mkdir(join(sampleDirectory, 'blobs'), { recursive: true, mode: 0o700 });
  const database = join(directory, 'messages.sqlite');
  const journal = new MessageJournal(database);
  try {
    await chmod(database, 0o600);
    // Seed the guard when upgrading the earlier history-only prototype.
    try {
      const existing = await SampleCatalog.load(pathToFileURL(`${sampleDirectory}/`));
      journal.registerRevisions(existing.all());
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT' && 'path' in error && error.path === join(sampleDirectory, 'manifest.json'))) throw error;
    }
    journal.registerRevisions(catalog.all());
    for (const expression of catalog.all()) {
      for (const blob of [expression.visual.primary, expression.visual.poster].filter((b): b is BlobRef => !!b)) {
        try { await copyFile(new URL(`blobs/${blob.sha256}`, source), join(sampleDirectory, 'blobs', blob.sha256), constants.COPYFILE_EXCL); }
        catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error; }
      }
    }
    const temporary = join(sampleDirectory, `manifest-${randomUUID()}.tmp`);
    await writeFile(temporary, await readFile(new URL('manifest.json', source)), { mode: 0o600 });
    await rename(temporary, join(sampleDirectory, 'manifest.json'));
    const stored = await SampleCatalog.load(pathToFileURL(`${sampleDirectory}/`));
    return { runtime: new SampleRuntime(stored, Date.now, journal), journal };
  } catch (error) {
    journal.close();
    throw error;
  }
}
