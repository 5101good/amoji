// Prints a parameterized, privately executed D1 request; never calls a public route.
// Use an immutable market_account UUID, not an email or editable display name.
const [account, operator, reason] = process.argv.slice(2);
if (
  !/^[a-f0-9-]{36}$/.test(account ?? "") ||
  !operator?.trim() ||
  !reason?.trim()
) {
  throw Error(
    "Usage: node scripts/bootstrap-reviewer.mjs ACCOUNT_UUID OPERATOR REASON",
  );
}
process.stdout.write(
  JSON.stringify(
    {
      sql: "INSERT INTO market_role_bootstrap(id,account_id,operator,reason,created_at) VALUES('initial',?,?,?,?)",
      params: [account, operator, reason, Date.now()],
    },
    null,
    2,
  ) + "\n",
);
