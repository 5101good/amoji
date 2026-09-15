// Real independent adapter process. Only this test driver exposes RPC over IPC.
let client;
try {
  const { SharedClient } = await import('../../src/shared-client.ts');
  client = await SharedClient.connect({ directory: process.env.AMOJI_DATA_DIR });
  process.send({ ready: client.identity });
} catch (error) {
  process.send({ startup_error: error.message });
  process.exit(1);
}
process.on('message', async ({ id, operation, args = [] }) => {
  try {
    const value = await client[operation](...args);
    process.send({ id, value });
    if (operation === 'close') process.exit(0);
  } catch (error) { process.send({ id, error: error.message, code: error.code }); }
});
process.on('disconnect', () => { void client.close().finally(() => process.exit(0)); });
