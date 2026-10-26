import pc from "picocolors";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  level: LogLevel;
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  setLevel(level: LogLevel): void;
}

type Sink = (text: string) => void;

function defaultSink(text: string): void {
  process.stderr.write(text);
}

export function initialLogLevel(env: Record<string, string | undefined> = process.env): LogLevel {
  const debugEnv = env.HI_DEBUG ?? env.IR_DEBUG ?? "";
  if (debugEnv.toLowerCase() === "true" || env.LOG_LEVEL) return "debug";
  return "info";
}

export function createLogger(
  level: LogLevel = initialLogLevel(),
  sink: Sink = defaultSink,
): Logger {
  let current = level;

  function write(kind: LogLevel, message: string): void {
    if (LEVEL_ORDER[kind] < LEVEL_ORDER[current]) return;
    const label =
      kind === "debug"
        ? pc.dim("DEBUG")
        : kind === "info"
          ? pc.cyan("INFO ")
          : kind === "warn"
            ? pc.yellow("WARN ")
            : pc.red("ERROR");
    sink(`${label}    ${message}\n`);
  }

  return {
    get level() {
      return current;
    },
    set level(value: LogLevel) {
      current = value;
    },
    debug: (message) => write("debug", message),
    info: (message) => write("info", message),
    warn: (message) => write("warn", message),
    error: (message) => write("error", message),
    setLevel(value: LogLevel) {
      current = value;
    },
  };
}
