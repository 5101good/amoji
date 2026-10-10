import type { AdapterRuntime } from "../adapter-runtime.js";
import type { SharedClient } from "../shared-client.js";
import type { BindingContext } from "../shared-contract.js";
import { fail } from "../shared-contract.js";
import type { ExpressionRef } from "../sample-catalog.js";
import type { LibraryEntry } from "../library-management.js";

export const PAGE_SIZE = 6;
export type ExpressionPort = Pick<
  AdapterRuntime,
  "catalog" | "search" | "emit" | "messages" | "receive"
>;
export type LibraryPort = Pick<
  SharedClient,
  | "listEntries"
  | "getSettings"
  | "updateSettings"
  | "listRevisions"
  | "getEntry"
  | "setArchived"
  | "startRevisionDraft"
  | "selectRevision"
  | "createDraft"
  | "getDraft"
  | "listDrafts"
  | "saveDraft"
  | "previewDraft"
  | "confirmDraft"
  | "importPack"
  | "exportPack"
>;
export interface BrowseQuery {
  query: string;
  page: number;
  library?: boolean;
  archived?: boolean;
}
export interface ExpressionPage {
  items: LibraryEntry[];
  page: number;
  pages: number;
  total: number;
}

/** Host-independent use cases. Media/UI encoding and host delivery belong to adapters. */
export class ExpressionApplication {
  constructor(
    private readonly expressions: ExpressionPort,
    readonly library: LibraryPort,
  ) {}
  async browse(input: BrowseQuery): Promise<ExpressionPage> {
    if (
      typeof input.query !== "string" ||
      input.query.length > 240 ||
      !Number.isSafeInteger(input.page) ||
      input.page < 0
    )
      fail("INVALID_ARGUMENT", "搜索最多 240 字，页码须为非负整数");
    const [entries, available] = await Promise.all([
      this.library.listEntries(),
      input.library ? Promise.resolve(null) : this.expressions.catalog.all(),
    ]);
    const visible = available
      ? new Set(available.map((e) => `${e.asset_id}:${e.revision_id}`))
      : null;
    const query = input.query.trim().toLocaleLowerCase();
    const matches = entries
      .filter((entry) =>
        input.library
          ? entry.archived === !!input.archived
          : !entry.archived &&
            visible!.has(
              `${entry.expression.asset_id}:${entry.expression.revision_id}`,
            ),
      )
      .filter(
        ({ expression: e }) =>
          !query ||
          [
            e.name,
            e.semantics.meaning,
            e.semantics.fallback,
            ...(e.tags ?? []),
          ].some((v) => v.toLocaleLowerCase().includes(query)),
      );
    const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
    const page = Math.min(input.page, pages - 1);
    return {
      items: matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
      page,
      pages,
      total: matches.length,
    };
  }
  receive(context: BindingContext, ref: ExpressionRef, requestId: string) {
    return this.expressions.receive(
      context,
      { asset_id: ref.asset_id, revision_id: ref.revision_id },
      requestId,
    );
  }
  history(context: BindingContext) {
    return this.expressions.messages(context);
  }
  async search(context: BindingContext, query: string) {
    if (!context.turnId)
      return Promise.reject(new Error("TURN_REQUIRED: AI 选择需要真实回合"));
    return this.expressions.search(context, query, 3);
  }
  async emit(context: BindingContext, token: string) {
    if (!context.turnId)
      return Promise.reject(new Error("TURN_REQUIRED: AI 发送需要真实回合"));
    return this.expressions.emit(context, token);
  }
  async confirmDraft(id: string, version: number, reviewed: boolean) {
    if (reviewed !== true)
      fail("REVIEW_REQUIRED", "请核对图片与固定语义后确认");
    return this.library.confirmDraft(id, version);
  }
}
