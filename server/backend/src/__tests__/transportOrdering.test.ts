import fs from "fs";
import path from "path";

describe("transport middleware ordering", () => {
  it("applies the API rate limiter before allocating JSON bodies", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src", "index.ts"), "utf8");
    const limiter = source.indexOf('app.use("/api/", limiter)');
    const json = source.indexOf("app.use(express.json");
    const urlencoded = source.indexOf("app.use(express.urlencoded");
    expect(limiter).toBeGreaterThanOrEqual(0);
    expect(json).toBeGreaterThan(limiter);
    expect(urlencoded).toBeGreaterThan(limiter);
    expect(source).not.toContain('express.json({ limit: "50mb" })');
  });
});
