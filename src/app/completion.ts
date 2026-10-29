import { appendFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { AppContext } from "../context.ts";
import { ensureDir, readTextIfExists, writeTextAtomic } from "../fs-utils.ts";

export type SupportedShell = "bash" | "zsh" | "fish" | "powershell";

export function detectShell(env: Record<string, string | undefined> = process.env): SupportedShell {
  const shell = basename(env.SHELL ?? "bash").toLowerCase();
  if (shell === "zsh" || shell === "fish") return shell;
  if (shell === "pwsh" || shell === "powershell") return "powershell";
  return "bash";
}

export function completionScript(shell: SupportedShell): string {
  const commands = "get upgrade ls info rm config state pull hold me";
  switch (shell) {
    case "bash":
      return `# bash completion for hi
_hi_complete() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local commands="${commands}"
  COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
}
complete -F _hi_complete hi
`;
    case "zsh":
      return `#compdef hi
_hi() {
  local -a commands
  commands=(${commands
    .split(" ")
    .map((name) => `'${name}'`)
    .join(" ")})
  _describe 'command' commands
}
compdef _hi hi
`;
    case "fish":
      return `complete -c hi -f -a "${commands}"
`;
    case "powershell":
      return `Register-ArgumentCompleter -Native -CommandName hi -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $commands = '${commands}'.Split(' ')
  $commands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
  }
}
`;
  }
}

export function showCompletion(ctx: AppContext, shell: SupportedShell = detectShell()): void {
  ctx.io.print(completionScript(shell));
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export async function installCompletion(
  ctx: AppContext,
  shell: SupportedShell = detectShell(),
): Promise<void> {
  const script = completionScript(shell);

  if (shell === "fish") {
    const path = join(ctx.paths.home, ".config", "fish", "completions", "hi.fish");
    await ensureDir(join(ctx.paths.home, ".config", "fish", "completions"), 0o755);
    await writeTextAtomic(path, script, 0o644);
    ctx.io.print(`Installed completion for fish at ${path}`);
    return;
  }

  if (shell === "powershell") {
    ctx.io.print("Add the following to your PowerShell profile:\n");
    ctx.io.print(script);
    return;
  }

  const completionDir = join(ctx.paths.home, ".local", "share", "hacker-install", "completions");
  const completionFile = join(completionDir, `hi.${shell}`);
  await ensureDir(completionDir, 0o755);
  await writeTextAtomic(completionFile, script, 0o644);

  const rcFile = shell === "zsh" ? join(ctx.paths.home, ".zshrc") : join(ctx.paths.home, ".bashrc");
  const marker = "# hacker-install completion";
  const existing = (await readTextIfExists(rcFile)) ?? "";
  if (!existing.includes(marker)) {
    const line = `\n${marker}\nsource ${shellQuote(completionFile)}\n`;
    await appendFile(rcFile, line, "utf8");
  }
  ctx.io.print(`Installed completion for ${shell} at ${completionFile}`);
  ctx.io.print(`Sourcing it from ${rcFile}`);
}
