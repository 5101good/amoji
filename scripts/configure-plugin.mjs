import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Codex's legacy plugin loader does not interpolate PLUGIN_ROOT in MCP args.
// Materialize for each installation; never check machine-specific paths in.
export async function configurePlugin(directory) {
  const config = {
    mcpServers: {
      amoji: {
        command: process.execPath,
        args: [resolve(directory, 'runtime/src/main.js')],
        env_vars: ['AMOJI_DATA_DIR'],
        startup_timeout_sec: 30,
        tool_timeout_sec: 360,
      },
    },
  };
  await writeFile(resolve(directory, '.mcp.json'), JSON.stringify(config, null, 2) + '\n');
}
