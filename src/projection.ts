export interface ExpressionText {
  asset_id: string;
  revision_id: string;
  name: string;
  semantics: {
    locale: string;
    meaning: string;
    fallback: string;
    tone?: string;
    use_when?: string[];
    avoid_when?: string[];
  };
}

/** Select fields explicitly: visuals and provenance never enter model context. */
export function modelProjection(expression: ExpressionText): string {
  return JSON.stringify({
    asset_id: expression.asset_id,
    revision_id: expression.revision_id,
    name: expression.name,
    semantics: expression.semantics,
  });
}
