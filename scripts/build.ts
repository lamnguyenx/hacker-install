#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface Target {
  name: string;
  target: string;
}

const TARGETS: Target[] = [
  { name: "hacker-install-linux-x86_64", target: "bun-linux-x64" },
  { name: "hacker-install-linux-aarch64", target: "bun-linux-arm64" },
  { name: "hacker-install-linux-x86_64-musl", target: "bun-linux-x64-musl" },
  { name: "hacker-install-linux-aarch64-musl", target: "bun-linux-arm64-musl" },
  { name: "hacker-install-darwin-x86_64", target: "bun-darwin-x64" },
  { name: "hacker-install-darwin-arm64", target: "bun-darwin-arm64" },
];

function nativeTarget(): Target {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return TARGETS.find((target) => target.target === "bun-darwin-arm64") as Target;
  }
  if (process.platform === "darwin") {
    return TARGETS.find((target) => target.target === "bun-darwin-x64") as Target;
  }
  if (process.arch === "arm64") {
    return TARGETS.find((target) => target.target === "bun-linux-arm64") as Target;
  }
  return TARGETS.find((target) => target.target === "bun-linux-x64") as Target;
}

async function compile(target: Target): Promise<string> {
  const outfile = join("dist", target.name);
  console.log(`Building ${target.name} (${target.target})...`);
  const proc = Bun.spawn({
    cmd: [
      "bun",
      "build",
      "--compile",
      `--target=${target.target}`,
      "src/index.ts",
      "--outfile",
      outfile,
    ],
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`Build failed for ${target.name} (exit ${code})`);
  await chmod(outfile, 0o755);
  return outfile;
}

async function buildNpm(): Promise<string> {
  const outfile = join("dist", "npm", "index.js");
  console.log("Building npm bundle...");
  const proc = Bun.spawn({
    cmd: ["bun", "build", "--target=bun", "src/index.ts", "--outfile", outfile],
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`npm bundle build failed (exit ${code})`);

  const content = await readFile(outfile, "utf8");
  if (!content.startsWith("#!/usr/bin/env bun")) {
    await writeFile(outfile, `#!/usr/bin/env bun\n${content}`);
  }
  await chmod(outfile, 0o755);
  return outfile;
}

async function writeChecksums(files: string[]): Promise<void> {
  const lines: string[] = [];
  for (const file of files) {
    const bytes = await readFile(file);
    lines.push(`${createHash("sha256").update(bytes).digest("hex")}  ${file.split("/").pop()}`);
  }
  await writeFile(join("dist", "checksums.txt"), `${lines.join("\n")}\n`);
  console.log("Wrote dist/checksums.txt");
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  await mkdir("dist", { recursive: true });
  await mkdir(join("dist", "npm"), { recursive: true });

  if (args.has("--npm")) {
    const outfile = await buildNpm();
    console.log(`Built ${outfile}`);
    return;
  }

  const targets = args.has("--all") ? TARGETS : [nativeTarget()];
  const files: string[] = [];
  for (const target of targets) {
    files.push(await compile(target));
  }

  if (args.has("--all")) {
    await writeChecksums(files);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
