import "express-async-errors";
import express from "express";
import request from "supertest";
import multer from "multer";
import { jsonErrorHandler } from "../middleware/error";

describe("async route error handling", () => {
  it("turns a rejected route promise into a bounded JSON 500", async () => {
    const app = express();
    app.get("/fails", async () => {
      throw new Error("database details must not leak");
    });
    app.use(jsonErrorHandler);

    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await request(app).get("/fails").expect(500);
      expect(response.body).toEqual({ message: "Internal server error" });
      expect(response.text).not.toContain("database details");
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("maps an oversized multipart upload to 413 instead of 500", async () => {
    const app = express();
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 } });
    app.post("/upload", upload.single("file"), (_req, res) => res.json({ ok: true }));
    app.use(jsonErrorHandler);

    const response = await request(app)
      .post("/upload")
      .attach("file", Buffer.from("12345"), "too-large.bin")
      .expect(413);

    expect(response.body).toEqual({
      message: "Uploaded file is too large",
      code: "LIMIT_FILE_SIZE",
    });
  });
});
