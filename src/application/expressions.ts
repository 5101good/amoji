import type { AdapterRuntime } from "../adapter-runtime.js";
import type { SharedClient } from "../shared-client.js";
import type { BindingContext } from "../shared-contract.js";
import { fail } from "../shared-contract.js";
import { actEntry, searchableText, type ExpressionRef, type Family } from "../protocol/index.js";
import type { LibraryEntry } from "../library-management.js";
import type { ExpressInput, ReceiveInput } from "../library-store.js";

export const PAGE_SIZE = 6;
/** Picker categories are act families (RFC §5.2). */
export const FAMILY_ORDER: Family[] = ["grounding", "steering", "progress", "epistemic", "social"];
export type ExpressionPort = Pick<
  AdapterRuntime,
  "catalog" | "search" | "express" | "messages" | "receive"
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
  category?: string;
}
export interface ExpressionPage {
  items: LibraryEntry[];
  page: number;
  pages: number;
  total: number;
}
export interface BrowseWindowQuery {
  query: string;
  offset: number;
  limit: number;
  library?: boolean;
  archived?: boolean;
  category?: string;
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
    const matches = await this.matches(input);
    const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
    const page = Math.min(input.page, pages - 1);
    return {
      items: matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
      page,
      pages,
      total: matches.length,
    };
  }
  async browseWindow(input: BrowseWindowQuery) {
    if (typeof input.query !== "string" || input.query.length > 240 ||
        !Number.isSafeInteger(input.offset) || input.offset < 0 ||
        !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100)
      fail("INVALID_ARGUMENT", "无效的搜索窗口");
    if (input.category !== undefined && !["all", ...FAMILY_ORDER].includes(input.category))
      fail("INVALID_ARGUMENT", "无效的表情类别");
    const all = await this.matches(input);
    const categoryOf = (entry: LibraryEntry): Family => actEntry(entry.expression.realizes).family;
    const categories = FAMILY_ORDER.filter(category => all.some(entry => categoryOf(entry) === category));
    const matches = input.category && input.category !== "all" ? all.filter(entry => categoryOf(entry) === input.category) : all;
    return { items: matches.slice(input.offset, input.offset + input.limit),
      categories, offset: input.offset, total: matches.length };
  }
  private async matches(input: Pick<BrowseQuery, "query" | "library" | "archived">) {
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
      .filter(({ expression: e }) => {
        if (!query) return true;
        const text = searchableText(e);
        return [e.realizes, ...text.name, ...text.meaning, ...text.fallback, ...text.tags].some((v) => v.toLocaleLowerCase().includes(query));
      });
    return matches;
  }
  receive(context: BindingContext, ref: ExpressionRef, requestId: string, extras: Omit<ReceiveInput, "ref"> = {}) {
    return this.expressions.receive(context, { ...extras, ref: { asset_id: ref.asset_id, revision_id: ref.revision_id } }, requestId);
  }
  history(context: BindingContext) {
    return this.expressions.messages(context);
  }
  async search(context: BindingContext, query: string) {
    if (!context.turnId)
      return Promise.reject(new Error("TURN_REQUIRED: AI 选择需要真实回合"));
    return this.expressions.search(context, query, 3);
  }
  async express(context: BindingContext, input: ExpressInput) {
    if (!context.turnId)
      return Promise.reject(new Error("TURN_REQUIRED: AI 发送需要真实回合"));
    return this.expressions.express(context, input);
  }
  async confirmDraft(id: string, version: number, reviewed: boolean) {
    if (reviewed !== true)
      fail("REVIEW_REQUIRED", "请核对图片与固定语义后确认");
    return this.library.confirmDraft(id, version);
  }
}
