/** Stable, displayable failures shared by every runtime, including browsers. */
export class ServiceError extends Error {
  constructor(readonly code: string, message: string, readonly current?: unknown) { super(`${code}：${message}`); }
}
export function fail(code: string, message: string, current?: unknown): never { throw new ServiceError(code, message, current); }
