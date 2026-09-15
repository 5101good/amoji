// Widen the real scheduling window between discovery removal and kernel-lock release.
// This preload is inherited only by this test's independently spawned service.
import { DatabaseSync } from 'node:sqlite';
const close = DatabaseSync.prototype.close;
DatabaseSync.prototype.close = function () {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 600);
  return close.call(this);
};
