import { cp, mkdir } from 'node:fs/promises';

/** Both host packages ship the same service, library, web panel and native dependencies. */
export async function copyRuntime(root, destination) {
  await mkdir(`${destination}/runtime`, { recursive: true });
  await cp(`${root}/dist/src`, `${destination}/runtime/src`, { recursive: true });
  await cp(`${root}/dist/docs`, `${destination}/runtime/docs`, { recursive: true });
  await mkdir(`${destination}/assets/samples`, { recursive: true });
  await cp(`${root}/assets/samples/blobs`, `${destination}/assets/samples/blobs`, { recursive: true });
  await cp(`${root}/assets/samples/manifest.json`, `${destination}/assets/samples/manifest.json`);
  await cp(`${root}/assets/base-library`, `${destination}/assets/base-library`, { recursive: true });
  await cp(`${root}/web`, `${destination}/web`, { recursive: true });
  await cp(`${root}/package.json`, `${destination}/runtime/package.json`);
  await cp(`${root}/package-lock.json`, `${destination}/runtime/package-lock.json`);
  // Keep npm's links relative to the distributed tree, including native optional packages.
  await cp(`${root}/node_modules`, `${destination}/runtime/node_modules`, { recursive: true, verbatimSymlinks: true });
}
