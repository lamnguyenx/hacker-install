import { stderr, stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

export interface IO {
  readonly isTTY: boolean;
  print(text?: string): void;
  error(text?: string): void;
  writeError(text: string): void;
  prompt(question: string): Promise<string>;
}

export class ConsoleIO implements IO {
  readonly isTTY = Boolean(stdout.isTTY);

  print(text = ""): void {
    stdout.write(`${text}\n`);
  }

  error(text = ""): void {
    stderr.write(`${text}\n`);
  }

  writeError(text: string): void {
    stderr.write(text);
  }

  async prompt(question: string): Promise<string> {
    const rl = createInterface({ input: stdin, output: stdout, terminal: Boolean(stdout.isTTY) });
    try {
      const answer = await rl.question(question);
      return answer.trim();
    } finally {
      rl.close();
    }
  }
}
