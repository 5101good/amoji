import { validatePackSchema } from "amoji-schema";
import { Problems, checkPackRules } from "../../../src/protocol/rules";
import type { Pack } from "../../../src/protocol/types";

/**
 * Every violation of the Amoji 0.1 pack contract, empty when valid. The JSON
 * Schema is compiled at build time (Workers cannot compile it at runtime); the
 * semantic rules are the same module the local core uses.
 */
export function packProblems(manifest: unknown): string[] {
  if (!validatePackSchema(manifest))
    return (validatePackSchema.errors ?? [{ instancePath: "", message: "invalid" }]).map(
      (e) => `pack${e.instancePath}: ${e.message ?? "invalid"}`,
    );
  const problems = new Problems();
  checkPackRules(manifest as Pack, problems);
  return problems.items;
}
