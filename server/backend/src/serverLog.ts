import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { withLock } from "./locks";

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function ts(): string {
  return new Date().toISOString();
}

export function initServerLogToStorage(storageDir: string): void {
  const logsDir = path.join(storageDir, "logs", "server");
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

  const orig = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug
      ? console.debug.bind(console)
      : console.log.bind(console),
  };

  const write = async (level: string, args: any[]) => {
    try {
      const line =
        `[${ts()}] [${level}] ` +
        args
          .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
          .join(" ");
      const fp = path.join(logsDir, `${dayKey(new Date())}.log`);
      await withLock(`file:${fp}`, async () => {
        await fsPromises.appendFile(fp, line + "\n", "utf-8");
      });
    } catch {}
  };

  console.log = (...args: any[]) => {
    orig.log(...args);
    void write("INFO", args);
  };
  console.info = (...args: any[]) => {
    orig.info(...args);
    void write("INFO", args);
  };
  console.warn = (...args: any[]) => {
    orig.warn(...args);
    void write("WARN", args);
  };
  console.error = (...args: any[]) => {
    orig.error(...args);
    void write("ERROR", args);
  };
  console.debug = (...args: any[]) => {
    orig.debug(...args);
    void write("DEBUG", args);
  };

  process.on("unhandledRejection", (reason: any) => {
    console.error("[unhandledRejection]", reason);
  });
  process.on("uncaughtException", (err: any) => {
    console.error("[uncaughtException]", err);
  });
}
