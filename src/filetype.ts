import { open } from "node:fs/promises";
import { extname } from "node:path";

export type FileKind =
  | "elf"
  | "macho"
  | "pe"
  | "javascript"
  | "script"
  | "gzip"
  | "bzip2"
  | "xz"
  | "zstd"
  | "zip"
  | "7z"
  | "tar"
  | "ar"
  | "unknown";

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

export async function readHeader(path: string, length = 512): Promise<Uint8Array> {
  const handle = await open(path, "r");
  try {
    const buffer = new Uint8Array(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export function hasNodeShebang(bytes: Uint8Array): boolean {
  const text = new TextDecoder().decode(bytes.subarray(0, 128));
  const firstLine = text.split("\n", 1)[0] ?? "";
  return /^#!.*\bnode\b/.test(firstLine);
}

export function isJavaScriptPath(path: string): boolean {
  return [".js", ".mjs", ".cjs"].includes(extname(path).toLowerCase());
}

export function isSharedLibraryPath(path: string): boolean {
  const name = path.toLowerCase();
  if (
    name.endsWith(".so") ||
    name.includes(".so.") ||
    name.endsWith(".dylib") ||
    name.endsWith(".dll") ||
    name.endsWith(".a") ||
    name.endsWith(".o") ||
    name.endsWith(".obj") ||
    name.endsWith(".lib") ||
    name.endsWith(".la") ||
    name.endsWith(".ko")
  ) {
    return true;
  }
  return false;
}

export function detectFileKind(path: string, bytes: Uint8Array): FileKind {
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) return "elf";
  if (
    startsWith(bytes, [0xfe, 0xed, 0xfa, 0xce]) ||
    startsWith(bytes, [0xfe, 0xed, 0xfa, 0xcf]) ||
    startsWith(bytes, [0xce, 0xfa, 0xed, 0xfe]) ||
    startsWith(bytes, [0xcf, 0xfa, 0xed, 0xfe]) ||
    startsWith(bytes, [0xca, 0xfe, 0xba, 0xbe])
  ) {
    return "macho";
  }
  if (startsWith(bytes, [0x4d, 0x5a])) return "pe";
  if (startsWith(bytes, [0x1f, 0x8b])) return "gzip";
  if (startsWith(bytes, [0x42, 0x5a, 0x68])) return "bzip2";
  if (startsWith(bytes, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return "xz";
  if (startsWith(bytes, [0x28, 0xb5, 0x2f, 0xfd])) return "zstd";
  if (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])
  ) {
    return "zip";
  }
  if (startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return "7z";
  if (asciiAt(bytes, 257, "ustar")) return "tar";
  if (asciiAt(bytes, 0, "!<arch>")) return "ar";

  if (isJavaScriptPath(path)) return "javascript";
  if (asciiAt(bytes, 0, "#!")) return "script";
  return "unknown";
}

export async function detectFileKindFromPath(path: string): Promise<FileKind> {
  const header = await readHeader(path);
  return detectFileKind(path, header);
}

export function isNativeExecutable(kind: FileKind): boolean {
  return kind === "elf" || kind === "macho" || kind === "pe";
}

export async function isExecutableFile(path: string): Promise<boolean> {
  if (isSharedLibraryPath(path)) return false;
  const header = await readHeader(path);
  const kind = detectFileKind(path, header);
  if (isNativeExecutable(kind)) return true;
  if (kind === "javascript") return true;
  if (hasNodeShebang(header)) return true;
  return false;
}

export async function isInstallCandidate(path: string): Promise<boolean> {
  if (isSharedLibraryPath(path)) return false;
  const header = await readHeader(path);
  const kind = detectFileKind(path, header);
  if (isNativeExecutable(kind)) return true;

  const ext = extname(path).toLowerCase();
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs" || ext === ".ts") {
    return hasNodeShebang(header);
  }
  return false;
}
