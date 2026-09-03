import type { ErrorRequestHandler } from "express";
import multer from "multer";

export const jsonErrorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    res.status(status).json({
      message: err.code === "LIMIT_FILE_SIZE" ? "Uploaded file is too large" : "Invalid upload",
      code: err.code,
    });
    return;
  }
  console.error("[HTTP] Unhandled route error:", err);
  if (res.headersSent) return;
  res.status(500).json({ message: "Internal server error" });
};
