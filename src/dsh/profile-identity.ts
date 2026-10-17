import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface ProfileIdentity { id: string; status: 'created' | 'restored' | 'copy-reset' }
/** UUID is the key; filesystem identity is only a local copy detector, never a session key. */
export async function loadProfileIdentity(directory: string): Promise<ProfileIdentity> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await stat(directory, { bigint: true });
  if (info.ino === 0n || info.birthtimeNs === 0n) throw new Error('Profile filesystem identity unavailable; rules cannot be restored');
  const fingerprint = `${info.dev}:${info.ino}:${info.birthtimeNs}`;
  const path = join(directory, 'amoji-profile-identity.json');
  const lock = join(directory, '.amoji-profile-identity.lock');
  // Do not guess stale ownership. A concurrent/crashed writer leaves restoration fail-closed.
  await mkdir(lock, { mode: 0o700 });
  let temporary: string | undefined;
  try {
    let previous: { id: string; fingerprint: string } | undefined;
    try {
      const value: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string' || !/^[0-9a-f-]{36}$/.test(value.id) || !('fingerprint' in value) || typeof value.fingerprint !== 'string') throw new Error('Invalid profile identity; rules cannot be restored');
      previous = { id: value.id, fingerprint: value.fingerprint };
    } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    if (previous?.fingerprint === fingerprint) return { id: previous.id, status: 'restored' };
    const id = randomUUID(); temporary = join(directory, `.amoji-profile-${id}.tmp`);
    await writeFile(temporary, JSON.stringify({ id, fingerprint }) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, path); temporary = undefined;
    return { id, status: previous ? 'copy-reset' : 'created' };
  } finally { if (temporary) await rm(temporary, { force: true }); await rm(lock, { recursive: true }); }
}
