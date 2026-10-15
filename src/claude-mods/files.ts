import { constants } from "node:fs";
import { open, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { fail, ServiceError } from "../shared-contract.js";

export function localPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.includes("\0") ||
    value.length > 4096
  )
    fail("INVALID_PATH", "需要本地文件的绝对路径");
  const path = value.trim().replace(/^~\//, `${homedir()}/`);
  if (!isAbsolute(path)) fail("INVALID_PATH", "需要本地文件的绝对路径");
  return resolve(path);
}
/** Only explicit UI file operations use these helpers; never registered as model tools. */
export async function readBoundedFile(
  value: unknown,
  maximum: number,
): Promise<Buffer> {
  const path = localPath(value);
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch {
    return fail("FILE_READ_FAILED", "无法读取文件，请检查路径和读取权限");
  }
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maximum)
      fail("FILE_LIMIT", "文件类型或大小不符合要求");
    const bytes = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(
        bytes,
        offset,
        bytes.length - offset,
        null,
      );
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== info.size)
      fail("FILE_CHANGED", "读取期间文件发生变化，请重试");
    return bytes.subarray(0, offset);
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    return fail("FILE_READ_FAILED", "无法读取文件，请检查路径和读取权限");
  } finally {
    await file.close().catch(() => {});
  }
}
export async function writeNewFile(
  value: unknown,
  bytes: Uint8Array,
): Promise<string> {
  const path = localPath(value);
  if (!path.toLowerCase().endsWith(".amoji"))
    fail("INVALID_PATH", "导出文件名须以 .amoji 结尾");
  let file;
  try {
    file = await open(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      fail("EXPORT_EXISTS", "文件已存在，请选择新文件名");
    return fail("FILE_WRITE_FAILED", "无法创建文件，请检查目标目录和写入权限");
  }
  try {
    await file.writeFile(bytes);
    await file.sync();
  } catch (error) {
    await file.close();
    await unlink(path).catch(() => {});
    return fail("FILE_WRITE_FAILED", "文件写入失败，未完成的导出已清理");
  }
  await file.close();
  return path;
}
