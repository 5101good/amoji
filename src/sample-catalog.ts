import { readFile } from 'node:fs/promises';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { fullFormats } from 'ajv-formats/dist/formats.js';
import schema from '../docs/specs/amoji-v0.1.schema.json' with { type: 'json' };
import type { ExpressionText } from './projection.js';
import { searchExpressions } from './search.js';
import { validateExpressionMedia } from './media.js';

export interface ExpressionRef { asset_id: string; revision_id: string }
export interface BlobRef { sha256: string; mime: string; bytes: number; width: number; height: number }
export interface Expression extends ExpressionText {
  kind: 'amoji.expression';
  schema_version: '0.1';
  created_at: string;
  tags?: string[];
  visual: { primary: BlobRef; animated: boolean; duration_ms?: number; poster?: BlobRef };
  rights: { license: string; creator?: string; source?: string };
}

/** Read-only fixture catalog for ticket 01; user-library persistence belongs to ticket 02. */
export class SampleCatalog {
  private constructor(private readonly expressions: Expression[], readonly root: URL) {}

  static async load(root: URL): Promise<SampleCatalog> {
    const manifest: unknown = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
    const ajv = new Ajv2020({ strict: false, formats: fullFormats });
    const validate = ajv.compile(schema);
    if (!validate(manifest)) throw new Error(`样本格式错误：${ajv.errorsText(validate.errors)}`);
    const pack = manifest as { kind: string; expressions: Expression[] };
    if (pack.kind !== 'amoji.pack') throw new Error('样本必须是 Amoji 包');
    for (const expression of pack.expressions) {
      if (Buffer.byteLength(JSON.stringify({ name: expression.name, semantics: expression.semantics })) > 4096) throw new Error('语义超出 4 KiB');
      await validateExpressionMedia(expression, blob => readFile(new URL(`blobs/${blob.sha256}`, root)));
    }
    return new SampleCatalog(pack.expressions, root);
  }

  all(): Expression[] { return structuredClone(this.expressions); }

  resolve(ref: ExpressionRef): Expression {
    const found = this.expressions.find(e => e.asset_id === ref.asset_id && e.revision_id === ref.revision_id);
    if (!found) throw new Error('精确版本不存在');
    return structuredClone(found);
  }

  search(query: string, limit = 3): Expression[] {
    return searchExpressions(this.expressions, query, limit);
  }
}
