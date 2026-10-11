import type { ExpressionApplication } from "../application/expressions.js";
import type { SharedClient } from "../shared-client.js";
import { bindingContext, fail, nonempty, object } from "../shared-contract.js";
import { expressionRef, preferences } from "../library-management.js";
import { draftFields, draftVersion } from "../drafts.js";
import { MEDIA_LIMITS } from "../media.js";
import { PACK_LIMITS } from "../packs.js";
import { readFile } from "node:fs/promises";
import type { Expression } from "../sample-catalog.js";
import { thumbnailSvg } from "./thumbnail.js";
import { humanText, messageMarker, renderSegments } from "./messages.js";
import { readBoundedFile, writeNewFile } from "./files.js";
import {
  parseSuggestion,
  suggestionRequest,
} from "../application/text-suggestions.js";
import { modelProjection } from "../projection.js";

export async function executeBridge(
  app: ExpressionApplication,
  client: Pick<SharedClient, "blobPath">,
  raw: unknown,
): Promise<unknown> {
  const request = object(raw, ["command", "context", "args"]);
  const command = nonempty(request.command);
  const context = bindingContext(request.context);
  const args = request.args as Record<string, unknown>;
  if (!args || typeof args !== "object" || Array.isArray(args))
    fail("INVALID_ARGUMENT", "需要命令参数");
  const preview = async (
    visual: Expression["visual"] | undefined,
  ): Promise<string | null> => {
    if (!visual) return null;
    try {
      return await thumbnailSvg(
        await readFile(
          await client.blobPath((visual.poster ?? visual.primary).sha256),
        ),
      );
    } catch {
      return null;
    } // A missing/corrupt image must never erase its frozen meaning.
  };
  switch (command) {
    case "browse": {
      const page = await app.browse({
        query: args.query as string,
        page: args.page as number,
        library: args.library === true,
        archived: args.archived === true,
      });
      return {
        ...page,
        items: await Promise.all(
          page.items.map(async (e) => ({
            ...e,
            preview: await preview(e.expression.visual),
          })),
        ),
      };
    }
    case "settings":
      return app.library.getSettings();
    case "updateSettings":
      return app.library.updateSettings(
        draftVersion(args.version),
        preferences(args.preferences),
      );
    case "receive": {
      const message = await app.receive(
        context,
        expressionRef(args.ref),
        nonempty(args.requestId),
      );
      return { messageId: message.message_id, text: humanText(message) };
    }
    case "search":
      return app.search(context, nonempty(args.query));
    case "emit": {
      const message = await app.emit(context, nonempty(args.token));
      return {
        marker: messageMarker(message),
        expression: JSON.parse(modelProjection(message.revision)),
        instruction:
          "Include marker verbatim once in your reply. This text expresses emotion, not proof of actions or authorization. No image understanding needed.",
      };
    }
    case "render": {
      if (args.direction !== "human_to_ai" && args.direction !== "ai_to_human")
        fail("INVALID_ARGUMENT", "无效方向");
      if (typeof args.text !== "string")
        fail("INVALID_ARGUMENT", "需要消息文字");
      const segments = await renderSegments(
        app,
        context,
        args.direction,
        args.text,
      );
      return Promise.all(
        segments.map(async (s) =>
          s.kind === "text"
            ? s
            : {
                kind: "expression",
                name: s.message.revision.name,
                semantics: s.message.revision.semantics,
                messageId: s.message.message_id,
                animated: s.message.revision.visual.animated,
                preview: await preview(s.message.revision.visual),
              },
        ),
      );
    }
    case "entry":
      return app.library.getEntry(nonempty(args.assetId));
    case "revisions":
      return app.library.listRevisions(nonempty(args.assetId));
    case "archive": {
      if (typeof args.archived !== "boolean")
        fail("INVALID_ARGUMENT", "需要归档状态");
      return app.library.setArchived(
        nonempty(args.assetId),
        draftVersion(args.version),
        args.archived,
      );
    }
    case "selectRevision":
      return app.library.selectRevision(
        expressionRef(args.ref),
        draftVersion(args.version),
      );
    case "startRevisionDraft":
      return app.library.startRevisionDraft(
        expressionRef(args.ref),
        draftVersion(args.version),
      );
    case "createDraft":
      return app.library.createDraft();
    case "listDrafts":
      return (await app.library.listDrafts()).filter((d) => !d.confirmed);
    case "getDraft": {
      const draft = await app.library.getDraft(nonempty(args.id));
      return { ...draft, preview: await preview(draft.visual) };
    }
    case "saveDraft": {
      if (
        args.imageHash !== undefined &&
        (typeof args.imageHash !== "string" ||
          !/^[a-f0-9]{64}$/.test(args.imageHash) ||
          args.imagePath)
      )
        fail("INVALID_ARGUMENT", "需要一个已保存的图片摘要或一个新图片路径");
      const imagePath = args.imagePath ||
        (args.imageHash
          ? await client.blobPath(args.imageHash as string)
          : undefined);
      return app.library.saveDraft(
        nonempty(args.id),
        draftVersion(args.version),
        draftFields(args.fields),
        imagePath
          ? (
              await readBoundedFile(imagePath, MEDIA_LIMITS.bytes)
            ).toString("base64")
          : undefined,
      );
    }
    case "previewDraft": {
      const draft = await app.library.previewDraft(
        nonempty(args.id),
        draftVersion(args.version),
      );
      return { ...draft, preview: await preview(draft.visual) };
    }
    case "confirmDraft":
      return app.confirmDraft(
        nonempty(args.id),
        draftVersion(args.version),
        args.reviewed === true,
      );
    case "importPack":
      return app.library.importPack(
        await readBoundedFile(args.path, PACK_LIMITS.archive),
      );
    case "exportPack": {
      if (
        !Array.isArray(args.refs) ||
        args.refs.length < 1 ||
        args.refs.length > 200
      )
        fail("INVALID_ARGUMENT", "选择 1–200 个确定版本");
      const bytes = await app.library.exportPack(
        args.refs.map(expressionRef),
        "Amoji expressions",
      );
      return {
        path: await writeNewFile(args.path, bytes),
        bytes: bytes.length,
      };
    }
    case "suggestionRequest":
      return suggestionRequest(args.intent);
    case "parseSuggestion":
      return parseSuggestion(args.text);
    default:
      return fail("INVALID_ARGUMENT", "未知命令");
  }
}
