export interface ExecResult {
  stdout: string[];
  stderr: string[];
  stdoutText: string;
  stderrText: string;
  code: number;
}

export interface BufferExecResult {
  stdout: Uint8Array;
  stderrText: string;
  code: number;
}

export interface ExecOptions {
  interactive?: boolean;
  cwd?: string;
  env?: Record<string, string>;
}

export interface ExecRunner {
  run(command: string, options?: ExecOptions): Promise<ExecResult>;
  runArgs(args: string[], options?: ExecOptions): Promise<ExecResult>;
  captureBytes(args: string[], options?: ExecOptions): Promise<BufferExecResult>;
}

function splitLines(text: string): string[] {
  return text.split("\n").filter((line) => line.length > 0);
}

export class BunExecRunner implements ExecRunner {
  async run(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    return this.runArgs(["/bin/sh", "-c", command], options);
  }

  async runArgs(args: string[], options: ExecOptions = {}): Promise<ExecResult> {
    const interactive = options.interactive ?? false;
    try {
      const proc = Bun.spawn({
        cmd: args,
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : undefined,
        stdin: interactive ? "inherit" : "ignore",
        stdout: interactive ? "inherit" : "pipe",
        stderr: interactive ? "inherit" : "pipe",
      });

      const code = await proc.exited;
      if (interactive) {
        return { stdout: [], stderr: [], stdoutText: "", stderrText: "", code };
      }

      const [stdoutText, stderrText] = await Promise.all([
        new Response(proc.stdout as ReadableStream).text(),
        new Response(proc.stderr as ReadableStream).text(),
      ]);

      return {
        stdout: splitLines(stdoutText),
        stderr: splitLines(stderrText),
        stdoutText,
        stderrText,
        code,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        stdout: [],
        stderr: [message],
        stdoutText: "",
        stderrText: message,
        code: 127,
      };
    }
  }

  async captureBytes(args: string[], options: ExecOptions = {}): Promise<BufferExecResult> {
    try {
      const proc = Bun.spawn({
        cmd: args,
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : undefined,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderrText, code] = await Promise.all([
        new Response(proc.stdout as ReadableStream).bytes(),
        new Response(proc.stderr as ReadableStream).text(),
        proc.exited,
      ]);
      return { stdout, stderrText, code };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { stdout: new Uint8Array(), stderrText: message, code: 127 };
    }
  }
}

export const defaultExecRunner = new BunExecRunner();
