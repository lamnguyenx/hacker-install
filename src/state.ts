import { readTextIfExists, writeTextAtomic } from "./fs-utils.ts";
import { parseJsonc } from "./jsonc.ts";
import {
  defaultConfig,
  defaultToolState,
  type InstalledTool,
  parseConfig,
  parseToolState,
  type ToolConfig,
  type ToolStateFile,
} from "./schemas.ts";

export class ToolStateStore {
  readonly filePath: string;
  loadedFromFile = false;
  private data: ToolStateFile = defaultToolState();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    const text = await readTextIfExists(this.filePath);
    if (!text?.trim()) {
      this.data = defaultToolState();
      this.loadedFromFile = false;
      return;
    }
    try {
      this.data = parseToolState(JSON.parse(text));
      this.loadedFromFile = true;
    } catch (error) {
      throw new Error(`Failed to load state file ${this.filePath}: ${(error as Error).message}`);
    }
  }

  async save(): Promise<void> {
    const text = `${JSON.stringify(this.data, null, 2)}\n`;
    await writeTextAtomic(this.filePath, text, 0o600);
  }

  get(name: string): InstalledTool | undefined {
    return this.data.tools[name];
  }

  has(name: string): boolean {
    return name in this.data.tools;
  }

  all(): InstalledTool[] {
    return Object.values(this.data.tools);
  }

  entries(): Array<[string, InstalledTool]> {
    return Object.entries(this.data.tools);
  }

  set(tool: InstalledTool): void {
    this.data.tools[tool.name] = tool;
  }

  delete(name: string): boolean {
    if (!(name in this.data.tools)) return false;
    delete this.data.tools[name];
    return true;
  }

  get size(): number {
    return Object.keys(this.data.tools).length;
  }

  get state(): ToolStateFile {
    return this.data;
  }
}

export class ConfigStore {
  readonly filePath: string;
  loadedFromFile = false;
  private data: ToolConfig = defaultConfig();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    const text = await readTextIfExists(this.filePath);
    if (!text?.trim()) {
      this.data = defaultConfig();
      this.loadedFromFile = false;
      return;
    }
    try {
      this.data = parseConfig(parseJsonc(text));
      this.loadedFromFile = true;
    } catch (error) {
      throw new Error(`Failed to load config file ${this.filePath}: ${(error as Error).message}`);
    }
  }

  async save(): Promise<void> {
    const text = `${JSON.stringify(this.data, null, 2)}\n`;
    await writeTextAtomic(this.filePath, text, 0o600);
  }

  get config(): ToolConfig {
    return this.data;
  }

  set config(value: ToolConfig) {
    this.data = value;
  }
}
