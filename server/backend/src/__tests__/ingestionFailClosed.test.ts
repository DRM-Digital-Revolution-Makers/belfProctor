import fs from "fs";
import path from "path";

describe("device ingestion authentication ordering", () => {
  const routes = [
    "activity.ts",
    "browserActivity.ts",
    "events.ts",
    "heartbeat.ts",
    "logs.ts",
    "pcSession.ts",
  ];

  it.each(routes)("%s performs no client mutation in its decryption-failure branch", (name) => {
    const source = fs.readFileSync(path.join(process.cwd(), "src", "routes", name), "utf8")
      .replace(/\r\n/g, "\n");
    const failureStart = source.indexOf("if (!usedKey)");
    expect(failureStart).toBeGreaterThanOrEqual(0);
    const failureEnd = source.indexOf("\n    }", failureStart);
    expect(failureEnd).toBeGreaterThan(failureStart);
    const failureBranch = source.slice(failureStart, failureEnd);
    expect(failureBranch).toContain("Decryption failed");
    expect(failureBranch).not.toContain("saveClient(");
  });
});
