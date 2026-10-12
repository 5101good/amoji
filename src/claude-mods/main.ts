import { SharedClient } from "../shared-client.js";
import { ConnectedRuntime } from "../adapter-runtime.js";
import { ExpressionApplication } from "../application/expressions.js";
import {
  SESSION_BINDINGS_CAPABILITY,
  CREATE_DRAFT_CAPABILITY,
  LIBRARY_MANAGEMENT_CAPABILITY,
  PACKS_CAPABILITY,
  ServiceError,
  dataDirectory,
} from "../shared-contract.js";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { executeBridge } from "./bridge.js";

let client: SharedClient | undefined;
try {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 128 * 1024)
      throw new ServiceError("INVALID_ARGUMENT", "请求过大");
    chunks.push(chunk);
  }
  // A pipe chunk can end inside a Chinese character. Decode only the whole input.
  const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  client = await SharedClient.connect({
    requiredCapabilities: [
      SESSION_BINDINGS_CAPABILITY,
      CREATE_DRAFT_CAPABILITY,
      LIBRARY_MANAGEMENT_CAPABILITY,
      PACKS_CAPABILITY,
    ],
  });
  const result = await executeBridge(
    new ExpressionApplication(new ConnectedRuntime(client), client),
    client,
    request,
    {
      previewDirectory: join(dataDirectory(), "cache", "claude-mods-previews"),
      bundledPreviewDirectory: fileURLToPath(new URL("../../../assets/claude-previews/", import.meta.url)),
    },
  );
  process.stdout.write(JSON.stringify({ ok: true, result }));
} catch (error) {
  // Do not leak environment values, stack traces, provider URLs or filesystem details.
  const code =
    error instanceof ServiceError ? error.code : "BRIDGE_UNAVAILABLE";
  process.stdout.write(
    JSON.stringify({
      ok: false,
      error: {
        code,
        message:
          error instanceof ServiceError
            ? error.message
            : "本地服务暂时不可用，请检查 Node.js 24+ 和插件运行环境",
      },
    }),
  );
} finally {
  await client?.close();
}
