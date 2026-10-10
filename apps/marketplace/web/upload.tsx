import React, { useState } from "react";
import { unzipSync, zipSync } from "fflate";
type Reservation = {
  id: string;
  pack_id: string;
  release_id: string;
  version: number;
  state: string;
};
/** Only operation IDs live in browser storage; never credentials or signed URLs. */
export function UploadPanel({
  locale,
  accountId,
}: {
  locale: "zh" | "en";
  accountId: string;
}) {
  const zh = locale === "zh",
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const storageKey = `amoji-upload:${accountId}`;
  async function post(path: string, data: object, key: string) {
    const c = await fetch("/v1/auth/csrf");
    if (!c.ok) throw Error("AUTH");
    const { csrf } = (await c.json()) as { csrf: string };
    const r = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrf,
        "idempotency-key": key,
      },
      body: JSON.stringify(data),
    });
    const result = (await r.json()) as {
      upload: Reservation;
      authorization: { url: string; headers: Record<string, string> };
      error?: { code: string };
    };
    if (!r.ok) throw Error(result.error?.code ?? "UPLOAD_FAILED");
    return result;
  }
  async function resume() {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return;
    setBusy(true);
    try {
      const saved = JSON.parse(raw);
      const result = await post(
        `/v1/uploads/${saved.id}/complete`,
        {},
        saved.complete,
      );
      setStatus(
        result.upload.state === "valid"
          ? zh
            ? "校验通过，可用于投稿。"
            : "Validated and ready for submission."
          : result.upload.state,
      );
    } catch (e) {
      setStatus(
        (zh
          ? "尚未完成，可重新选择原文件重试："
          : "Incomplete. Select the original file to retry: ") +
          (e instanceof Error ? e.message : ""),
      );
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    setBusy(true);
    try {
      if (file.size > 10 * 1024 * 1024) throw Error("ARCHIVE_LIMIT");
      const input = new Uint8Array(await file.arrayBuffer());
      let count = 0,
        total = 0;
      const files = unzipSync(input, {
        filter: (f) => {
          count++;
          total += f.originalSize;
          if (
            count > 256 ||
            total > 16 * 1024 * 1024 ||
            f.originalSize >
              (f.name === "manifest.json" ? 512 * 1024 : 1024 * 1024) ||
            !/^(manifest\.json|blobs\/[a-f0-9]{64})$/.test(f.name)
          )
            throw Error("ARCHIVE_LIMIT");
          return true;
        },
      });
      if (!files["manifest.json"]) throw Error("MANIFEST_MISSING");
      const manifest = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          files["manifest.json"],
        ),
      );
      if (!["0.1", "0.2"].includes(manifest.schema_version))
        throw Error("UNSUPPORTED_SCHEMA");
      const fileHash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", input)),
      )
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
      let saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (!saved || saved.fileHash !== fileHash) {
        saved = {
          fileHash,
          reserve: crypto.randomUUID(),
          authorize: crypto.randomUUID(),
          complete: crypto.randomUUID(),
        };
        localStorage.setItem(storageKey, JSON.stringify(saved));
      }
      const { upload: r }: { upload: Reservation } = await post(
        "/v1/uploads",
        {},
        saved.reserve,
      );
      saved.id = r.id;
      localStorage.setItem(storageKey, JSON.stringify(saved));
      if (r.state === "valid") {
        setStatus(
          zh ? "此文件已校验通过。" : "This file has already been validated.",
        );
        return;
      }
      if (
        manifest.schema_version === "0.1" &&
        !manifest.expressions.every(
          (e: { rights: unknown }) =>
            JSON.stringify(e.rights) ===
            JSON.stringify(manifest.expressions[0].rights),
        )
      )
        throw Error("PACK_LICENSE_REQUIRED");
      const snapshot = {
        ...manifest,
        schema_version: "0.2",
        pack_id: r.pack_id,
        release_id: r.release_id,
        version: r.version,
        scenario: manifest.scenario ?? ["imported"],
        actions: manifest.actions ?? [],
        bindings: manifest.bindings ?? [],
        rights: manifest.rights ?? manifest.expressions?.[0]?.rights,
        ...(manifest.schema_version === "0.2"
          ? {
              derived_from: {
                pack_id: manifest.pack_id,
                release_id: manifest.release_id,
              },
            }
          : {}),
      };
      files["manifest.json"] = new TextEncoder().encode(
        JSON.stringify(snapshot),
      );
      const bytes = zipSync(files, {
        level: 0,
        mtime: new Date("2000-01-01T00:00:00Z"),
      });
      if (bytes.length > 10 * 1024 * 1024) throw Error("ARCHIVE_LIMIT");
      const sha256 = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
        ),
      )
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
      const { authorization } = await post(
        `/v1/uploads/${r.id}/authorize`,
        { length: bytes.length, sha256 },
        saved.authorize,
      );
      setStatus(zh ? "正在直传文件…" : "Uploading directly…");
      const put = await fetch(authorization.url, {
        method: "PUT",
        headers: authorization.headers,
        body: new Uint8Array(bytes),
        credentials: "omit",
      });
      if (!put.ok) throw Error("DIRECT_UPLOAD_FAILED");
      setStatus(zh ? "正在验证完整文件…" : "Validating the complete archive…");
      const result = await post(
        `/v1/uploads/${r.id}/complete`,
        {},
        saved.complete,
      );
      setStatus(
        result.upload.state === "valid"
          ? zh
            ? "校验通过，可用于投稿。"
            : "Validated and ready for submission."
          : result.upload.state,
      );
    } catch (e) {
      setStatus(
        (zh ? "上传未完成：" : "Upload incomplete: ") +
          (e instanceof Error ? e.message : "UPLOAD_FAILED"),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2>{zh ? "上传场景包" : "Upload a scenario pack"}</h2>
      <p>
        {zh
          ? "选择 .amoji 文件创建新的发布快照，保留表情、固定语义和素材。市场上限 10 MiB；通过校验后才能投稿。"
          : "Choose an .amoji file to create a new release snapshot, preserving expressions, fixed meanings and media. The market limit is 10 MiB; validation is required before submission."}
      </p>
      <label>
        {zh ? "选择场景包" : "Choose a pack"}
        <input
          type="file"
          accept=".amoji,.zip"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </label>
      <button disabled={busy} onClick={() => void resume()}>
        {zh ? "恢复上次校验" : "Resume last validation"}
      </button>
      <p role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
