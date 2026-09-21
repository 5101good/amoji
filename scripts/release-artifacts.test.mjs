import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { inspectTarball, validatePublicFile, validateReleaseVersion } from './release-artifacts.mjs';

test('release rejects stale or mismatched tags and allows branch validation', () => {
  validateReleaseVersion('1.0.0', '1.0.0', 'v1.0.0');
  validateReleaseVersion('0.1.0-dev.1', '0.1.0-dev.1');
  assert.throws(() => validateReleaseVersion('1.0.0', '0.1.0-dev.1', 'v1.0.0'));
  assert.throws(() => validateReleaseVersion('1.0.0', '1.0.0', 'v1.1.0'));
  assert.throws(() => validateReleaseVersion('1.0.0-dev.1', '1.0.0-dev.1', 'v1.0.0-dev.1'));
});

test('public files reject local paths, credentials, private files and native binaries', () => {
  validatePublicFile('runtime/host.js', Buffer.from('const home = process.env.HOME;'));
  for (const path of ['.env', 'web/.npmrc', 'runtime/state.sqlite', 'runtime/private.pem', 'runtime/sharp.node', 'node_modules/test.js']) {
    assert.throws(() => validatePublicFile(path, Buffer.from('')));
  }
  for (const content of ['/Users/example/private/file', '/home/example/work/file', 'C:\\Users\\example\\private', `ghp_${'x'.repeat(36)}`, '-----BEGIN PRIVATE KEY-----']) {
    assert.throws(() => validatePublicFile('client.js', Buffer.from(content)));
  }
});

function archive(name, type = '0') {
  const header = Buffer.alloc(512);
  header.write(name);
  header.write('00000000002\0', 124);
  header.write(type, 156);
  return gzipSync(Buffer.concat([header, Buffer.from('{}'), Buffer.alloc(510), Buffer.alloc(1024)]));
}

test('archive checks reject escaping paths and links before reading payload', () => {
  assert.equal(inspectTarball(archive('package/package.json')).get('package.json').toString(), '{}');
  for (const path of ['package/../secret', '/tmp/secret', 'package/..\\secret']) assert.throws(() => inspectTarball(archive(path)));
  assert.throws(() => inspectTarball(archive('package/link', '2')));
});
