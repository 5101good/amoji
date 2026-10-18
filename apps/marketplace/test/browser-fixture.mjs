// Local HTTP fixtures for UI tests; never included in the production Worker.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { unzipSync } from "fflate";
const root = resolve(import.meta.dirname, "..");
const catalog = JSON.parse(await readFile(resolve(root, "../../assets/official-packs/catalog.json"), "utf8"));
async function loadPack(directory, name) {
      const bytes = await readFile(
        resolve(root, "../../assets", directory, name + ".amoji"),
      );
      const files = unzipSync(bytes),
        manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
      return {
        pack_id: manifest.pack_id,
        release_id: manifest.release_id,
        manifest,
        files,
        bytes,
        archive_sha256: createHash("sha256").update(bytes).digest("hex"),
        author: manifest.rights.creator,
        row_version: 1,
      };
}
const packs = await Promise.all(catalog.packs.map(p => loadPack("official-packs", p.slug)));
// Keep old exact links usable, but do not advertise the superseded groupings.
const legacyPacks = await Promise.all(["make-it-clear", "work-well-together", "collaborate-comfortably"].map(name => loadPack("scenario-packs", name)));
const sessions = new Map();
const json = (res, body, status = 200) => {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost"),
      path = url.pathname;
    let sid = /(?:^|; )fixture=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
    if (!sid || !sessions.has(sid)) {
      sid = randomUUID();
      sessions.set(sid, { role: null, mode: "normal", submissions: [] });
      res.setHeader(
        "set-cookie",
        `fixture=${sid}; Path=/; HttpOnly; SameSite=Lax`,
      );
    }
    const state = sessions.get(sid);
    if (path === "/__test/state") {
      state.role = url.searchParams.get("role");
      state.mode = url.searchParams.get("mode") ?? "normal";
      return json(res, {
        ok: true,
        packs: packs.map((p) => ({
          pack_id: p.pack_id,
          release_id: p.release_id,
        })),
      });
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    let body = {};
    if (req.headers["content-type"]?.includes("application/json"))
      body = JSON.parse(raw.toString() || "{}");
    if (path === "/v1/auth/csrf") return json(res, { csrf: "fixture" });
    if (path === "/v1/auth/login" || path === "/v1/auth/register") {
      if (body.email === "fail@example.test")
        return json(res, { error: { code: "INVALID" } }, 401);
      state.role = body.email?.startsWith("admin")
        ? "admin"
        : body.email?.startsWith("reviewer")
          ? "reviewer"
          : "creator";
      return json(res, {});
    }
    if (path === "/v1/auth/logout") {
      state.role = null;
      return json(res, {});
    }
    if (path === "/v1/me")
      return state.role
        ? json(res, {
            account: {
              id: "fixture-" + state.role,
              name: state.role === "creator" ? "Amoji 创作者" : "Amoji 审核者",
              email: state.role + "@example.test",
              role: state.role,
            },
          })
        : json(res, { error: { code: "UNAUTHENTICATED" } }, 401);
    if (path === "/v1/packs") {
      if (state.mode === "error")
        return json(res, { error: { code: "UNAVAILABLE" } }, 503);
      const q = url.searchParams.get("q") ?? "";
      const rows =
        state.mode === "empty"
          ? []
          : packs.filter((p) => {
              const m = p.manifest;
              const search = [m.name, m.description, ...m.scenario, ...m.expressions.map(e => e.name)].join(" ").normalize("NFKC").toLowerCase();
              return search.includes(q.normalize("NFKC").toLowerCase()) &&
                (!url.searchParams.get("scenario") || m.scenario.includes(url.searchParams.get("scenario"))) &&
                (!url.searchParams.get("style") || m.styles.includes(url.searchParams.get("style"))) &&
                (!url.searchParams.get("locale") || m.expressions.some(e => e.semantics.locale === url.searchParams.get("locale"))) &&
                (!url.searchParams.get("actions") || String(m.actions.length > 0) === url.searchParams.get("actions"));
            });
      return json(res, {
        packs: rows.map((p) => ({
          pack_id: p.pack_id,
          release_id: p.release_id,
          author: p.author,
          cover: {
            sha256: (
              p.manifest.expressions[0].visual.poster ??
              p.manifest.expressions[0].visual.primary
            ).sha256,
          },
          expression_count: p.manifest.expressions.length,
          action_count: p.manifest.actions?.length ?? 0,
          manifest: {
            name: p.manifest.name,
            description: p.manifest.description,
            scenario: p.manifest.scenario,
            version: p.manifest.version,
          },
        })),
        cursor: null,
      });
    }
    if (path.startsWith("/v1/packs/")) {
      const p = [...packs, ...legacyPacks].find((p) => path.includes(p.pack_id) && (!path.includes("/releases/") || path.includes(p.release_id)));
      if (!p) return json(res, {}, 404);
      if (state.mode === "removed")
        return json(
          res,
          { tombstone: { release_id: p.release_id, state: "safety_removed" } },
          410,
        );
      if (path.endsWith("/archive")) {
        res.writeHead(200, {
          "content-type": "application/zip",
          "content-disposition": "attachment; filename=example.amoji",
        });
        return res.end(p.bytes);
      }
      if (path.endsWith("/cover")) {
        const media =
          p.manifest.expressions[0].visual.poster ??
          p.manifest.expressions[0].visual.primary;
        res.writeHead(200, { "content-type": media.mime });
        return res.end(p.files["blobs/" + media.sha256]);
      }
      if (path.includes("/media/")) {
        const digest = path.split("/").at(-1),
          media = p.manifest.expressions
            .flatMap((e) => [e.visual.primary, e.visual.poster].filter(Boolean))
            .find((m) => m.sha256 === digest);
        if (!media) return json(res, {}, 404);
        res.writeHead(200, { "content-type": media.mime });
        return res.end(p.files["blobs/" + digest]);
      }
      const { files, bytes, ...value } = p;
      return json(res, {
        ...value,
        share_url: `http://127.0.0.1:${server.address().port}/packs/${p.pack_id}/releases/${p.release_id}`,
      });
    }
    if (path.startsWith("/v1/") && !state.role)
      return json(res, { error: { code: "UNAUTHENTICATED" } }, 401);
    if (path === "/v1/me/deletion-policy") return json(res, { row_version: 1 });
    if (path === "/v1/me/delete") {
      state.role = null;
      return json(res, {});
    }
    if (path === "/v1/me/submissions")
      return json(res, { submissions: state.submissions, cursor: null });
    if (path === "/v1/review/submissions")
      return json(res, {
        submissions:
          state.mode === "empty"
            ? []
            : [{ id: "review-fixture", pack_id: packs[0].pack_id, version: 1 }],
        cursor: null,
      });
    if (path === "/v1/review/submissions/review-fixture") {
      const { bytes, files, ...p } = packs[0];
      return json(res, {
        manifest: p.manifest,
        submission: {
          id: "review-fixture",
          row_version: 1,
          archive_sha256: p.archive_sha256,
        },
        previous: null,
      });
    }
    if (
      path.startsWith("/v1/review/submissions/") &&
      path.includes("/media/")
    ) {
      const digest = path.split("/").at(-1);
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(packs[0].files["blobs/" + digest]);
    }
    if (path.endsWith("/decision")) return json(res, {});
    if (path === "/v1/admin/accounts")
      return json(res, {
        accounts: [
          {
            id: "fixture-creator",
            display_name: "Amoji 创作者",
            role: "creator",
            row_version: 1,
          },
        ],
        cursor: null,
      });
    if (path === "/v1/review/reports")
      return json(res, { reports: [], cursor: null });
    if (path.startsWith("/v1/device-authorizations/"))
      return json(res, {
        state: req.method === "POST" ? "approved" : "pending",
        device_name: "本地 dsh",
        user_code: "AMOJI-42",
      });
    if (path.startsWith("/v1/"))
      return json(res, { error: { code: "NOT_FOUND" } }, 404);
    const publicRoot = resolve(root, "dist/public"),
      file = resolve(
        publicRoot,
        path === "/" || !extname(path) ? "index.html" : "." + path,
      );
    if (!file.startsWith(publicRoot + "/")) return json(res, {}, 404);
    const bytes = await readFile(file);
    // Match production's exact inline-style hash after every local rebuild.
    const headers = await readFile(resolve(publicRoot, "_headers"), "utf8");
    const csp = /^\s*Content-Security-Policy:\s*(.+)$/m.exec(headers)?.[1];
    if (!csp) throw Error("MISSING_BUILD_CSP");
    res.writeHead(200, {
      "content-type":
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".webp": "image/webp",
        }[extname(file)] ?? "application/octet-stream",
      "content-security-policy": csp,
    });
    res.end(bytes);
  } catch (e) {
    json(res, { error: { code: "FIXTURE_ERROR", message: e.message } }, 500);
  }
});
server.listen(Number(process.env.PORT ?? 4173), "127.0.0.1", () =>
  console.log(`Amoji UI fixture: http://127.0.0.1:${server.address().port}`),
);
