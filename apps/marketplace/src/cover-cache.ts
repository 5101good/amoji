/** Per-runtime, bounded cache of verified public cover bytes, never whole archives.
 * Publication permissions must be checked before every lookup, including hits.
 * Eviction/restart only loses an optimization; the sealed archive stays authoritative.
 */
export class CoverCache {
  private readonly entries = new Map<
    string,
    { blob: Blob; headers: [string, string][] }
  >();
  private size = 0;
  get(key: string): Response | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return new Response(entry.blob.stream(), {
      headers: entry.headers,
    });
  }
  async remember(key: string, response: Response): Promise<Response> {
    if (!response.ok) return response;
    const blob = await response.blob();
    const headers = [...response.headers] as [string, string][];
    if (blob.size <= 1024 * 1024) {
      const previous = this.entries.get(key);
      if (previous) {
        this.size -= previous.blob.size;
        this.entries.delete(key);
      }
      while (
        this.entries.size &&
        (this.size + blob.size > 8 * 1024 * 1024 || this.entries.size >= 64)
      ) {
        const oldest = this.entries.keys().next().value!;
        this.size -= this.entries.get(oldest)!.blob.size;
        this.entries.delete(oldest);
      }
      this.entries.set(key, { blob, headers });
      this.size += blob.size;
    }
    return new Response(blob.stream(), { headers });
  }
}
