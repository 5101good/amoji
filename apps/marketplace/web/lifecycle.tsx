import React, { useEffect, useState } from "react";
const api = async (
  path: string,
  data?: unknown,
  version?: number,
  key = crypto.randomUUID(),
  token?: string,
) => {
  const headers: Record<string, string> = {};
  if (token) headers["x-receipt-token"] = token;
  if (data !== undefined) {
    const csrf: any = await (await fetch("/v1/auth/csrf")).json();
    Object.assign(headers, {
      "content-type": "application/json",
      "x-csrf-token": csrf.csrf,
      "idempotency-key": key,
      ...(version === undefined ? {} : { "if-match": `"${version}"` }),
    });
  }
  const response = await fetch(path, {
    method: data === undefined ? "GET" : "POST",
    headers,
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const value: any = await response.json();
  if (response.status === 410 && value.tombstone) return value.tombstone;
  if (!response.ok) throw Error(value.error?.code ?? "UNAVAILABLE");
  return value;
};
export function Report({ pack, locale }: { pack: any; locale: "zh" | "en" }) {
  const [reason, setReason] = useState(""),
    [receipt, setReceipt] = useState<any>(),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const zh = locale === "zh";
  return (
    <section>
      <h3>{zh ? "举报此版本" : "Report this release"}</h3>
      <p>
        {zh
          ? "回执凭据仅显示给你，请保存。举报不会自动下架内容。"
          : "Keep your private receipt. A report does not automatically remove content."}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            setReceipt(
              await api("/v1/reports", {
                pack_id: pack.pack_id,
                release_id: pack.release_id,
                reason,
              }),
            );
            setMessage(zh ? "举报已接收" : "Report received");
          } catch (error) {
            setMessage((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          {zh ? "举报理由" : "Reason"}
          <textarea
            required
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <button disabled={busy || !!receipt}>
          {zh ? "提交举报" : "Submit report"}
        </button>
      </form>
      {receipt && (
        <>
          <p>
            {zh ? "回执编号" : "Receipt ID"}: {receipt.report_id}
          </p>
          <label>
            {zh ? "私密回执凭据" : "Private receipt token"}
            <input readOnly value={receipt.receipt_token} />
          </label>
          <button
            disabled={busy}
            onClick={async () => {
              try {
                const r = await api(
                  `/v1/reports/${receipt.report_id}/receipt`,
                  undefined,
                  undefined,
                  undefined,
                  receipt.receipt_token,
                );
                setMessage(
                  r.receipt.state + " " + (r.receipt.resolution ?? ""),
                );
              } catch (error) {
                setMessage((error as Error).message);
              }
            }}
          >
            {zh ? "查看处理状态" : "Check status"}
          </button>
        </>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
export function Lifecycle({
  account,
  locale,
  onDeleted,
}: {
  account: any;
  locale: "zh" | "en";
  onDeleted: () => void;
}) {
  const zh = locale === "zh",
    [accounts, setAccounts] = useState<any[]>([]),
    [reports, setReports] = useState<any[]>([]),
    [accountsCursor,setAccountsCursor]=useState<string|null>(null),
    [reportsCursor,setReportsCursor]=useState<string|null>(null),
    [reason, setReason] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [policy, setPolicy] = useState<any>(),
    [pack, setPack] = useState(""),
    [release, setRelease] = useState(""),
    [kind, setKind] = useState("unpublished");
  const admin = account.role === "admin",
    moderator = admin || account.role === "moderator";
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    if (admin) {const value=await api('/v1/admin/accounts');setAccounts(value.accounts);setAccountsCursor(value.cursor);}
    if (moderator) {const value=await api('/v1/review/reports');setReports(value.reports);setReportsCursor(value.cursor);}
  };
  const more=async(kind:'accounts'|'reports')=>{const cursor=kind==='accounts'?accountsCursor:reportsCursor;if(!cursor)return;const value=await api((kind==='accounts'?'/v1/admin/accounts':'/v1/review/reports')+'?cursor='+encodeURIComponent(cursor));if(kind==='accounts'){setAccounts(old=>[...old,...value.accounts]);setAccountsCursor(value.cursor);}else{setReports(old=>[...old,...value.reports]);setReportsCursor(value.cursor);}};
  useEffect(() => {
    void run(async () => {
      await refresh();
      setPolicy(await api("/v1/me/deletion-policy"));
    });
  }, [account.id]);
  return (
    <section>
      <h3>{zh ? "发布与账号管理" : "Publication and account management"}</h3>
      <p role="status">{message}</p>
      <label>
        {zh ? "操作理由" : "Reason"}
        <textarea
          value={reason}
          maxLength={1000}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const current = await api(`/v1/packs/${pack}/releases/${release}`);
            await api(
              `/v1/packs/${pack}/unpublish`,
              { release_id: release, type: kind, reason },
              current.row_version,
            );
            setMessage(
              zh
                ? "已下架；已开始下载或保存的副本不能收回。"
                : "Removed. In-flight downloads and saved copies cannot be recalled.",
            );
          });
        }}
      >
        <h4>{zh ? "下架精确版本" : "Remove an exact release"}</h4>
        <label>
          Pack ID
          <input
            required
            value={pack}
            onChange={(e) => setPack(e.target.value)}
          />
        </label>
        <label>
          Release ID
          <input
            required
            value={release}
            onChange={(e) => setRelease(e.target.value)}
          />
        </label>
        <select
          aria-label={zh ? "下架类型" : "Removal type"}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="unpublished">{zh ? "普通下架" : "Unpublish"}</option>
          {moderator && (
            <option value="safety_removed">
              {zh
                ? "安全下架（不可恢复此版本）"
                : "Safety removal (permanent for this release)"}
            </option>
          )}
        </select>
        <button disabled={busy || !reason.trim()}>
          {zh ? "下架" : "Remove"}
        </button>
      </form>
      {moderator && (
        <section>
          <h4>{zh ? "举报处理" : "Reports"}</h4>{reportsCursor&&<button disabled={busy} onClick={()=>void run(()=>more('reports'))}>{zh?'加载更多举报':'More reports'}</button>}
          <button disabled={busy} onClick={() => void run(refresh)}>
            {zh ? "刷新" : "Refresh"}
          </button>
          {reports.map((r) => (
            <article key={r.id}>
              <p>
                {r.pack_id} / {r.release_id}
              </p>
              <p>{r.reason}</p>
              <p>
                {r.state} {r.resolution}
              </p>
              <button
                disabled={busy || r.state !== "open" || !reason.trim()}
                onClick={() =>
                  void run(async () => {
                    await api(
                      `/v1/review/reports/${r.id}/resolve`,
                      { reason },
                      r.row_version,
                    );
                    await refresh();
                  })
                }
              >
                {zh ? "记录处理结果" : "Record resolution"}
              </button>
            </article>
          ))}
        </section>
      )}
      {admin && (
        <section>
          <h4>{zh ? "角色管理" : "Account roles"}</h4>{accountsCursor&&<button disabled={busy} onClick={()=>void run(()=>more('accounts'))}>{zh?'加载更多账号':'More accounts'}</button>}
          {accounts.map((a) => (
            <label key={a.id}>
              {a.display_name} · {a.id}
              <select
                aria-label={a.id}
                value={a.role}
                disabled={busy || !reason.trim()}
                onChange={(e) => {
                  const role = e.target.value;
                  void run(async () => {
                    await api(
                      `/v1/admin/accounts/${a.id}/roles`,
                      { role, reason },
                      a.row_version,
                    );
                    await refresh();
                  });
                }}
              >
                {["creator", "reviewer", "moderator", "admin"].map((role) => (
                  <option key={role}>{role}</option>
                ))}
              </select>
            </label>
          ))}
        </section>
      )}
      <section>
        <h4>{zh ? "删除账号" : "Delete account"}</h4>
        <p>
          {zh
            ? "立即撤销登录并下架本人内容，30 天内清理私有数据。已公开许可和署名保留，必要安全审计最多保留 180 天；不能收回已下载副本。"
            : "Immediately revoke sign-in and remove your publications; clear private data within 30 days. Public licenses and attribution remain, and necessary safety audits remain up to 180 days. Downloaded copies cannot be recalled."}
        </p>
        <label>
          <input
            type="checkbox"
            checked={confirm}
            onChange={(e) => setConfirm(e.target.checked)}
          />
          {zh
            ? "我已阅读并确认删除账号"
            : "I have read this notice and confirm account deletion"}
        </label>
        <button
          disabled={busy || !confirm || !policy}
          onClick={() =>
            void run(async () => {
              await api(
                "/v1/me/delete",
                { confirm: true, policy_version: "1" },
                policy.row_version,
              );
              onDeleted();
            })
          }
        >
          {zh ? "删除我的账号" : "Delete my account"}
        </button>
      </section>
    </section>
  );
}
