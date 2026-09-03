import { Router, type Request, type Response } from "express";
import { requireAdmin } from "../middleware/auth";
import { sendCommandToClient } from "../wsHub";
import { normalizeClientId } from "../clientId";

const router = Router();

function createCommandSender(
  type: string,
  payloadFactory: (req: Request) => unknown,
) {
  return async (req: Request, res: Response) => {
    try {
      const rawClientId = String(req.body?.clientId || "").trim();
      const clientId = normalizeClientId(rawClientId);
      if (!clientId || clientId !== rawClientId) {
        return res.status(400).json({ message: "valid clientId required" });
      }
      const id = sendCommandToClient(clientId, type, payloadFactory(req));
      if (!id) return res.status(404).json({ message: "client not connected" });
      return res.json({ ok: true, id });
    } catch {
      return res.status(500).json({ message: `Failed to request ${type}` });
    }
  };
}

router.post(
  "/send",
  requireAdmin,
  async (req, res) => {
    const type = String(req.body?.type || "").trim();
    if (!type || type.length > 64) {
      return res.status(400).json({ message: "valid type required" });
    }
    return createCommandSender(type, (request) => request.body?.payload ?? {})(
      req,
      res,
    );
  },
);

router.post(
  "/list",
  requireAdmin,
  createCommandSender("list", (req) => {
    const {
      basePath,
      pattern = "*",
      recursive = false,
      maxEntries = 1000,
      includeDirs = true,
    } = req.body;
    return { basePath, pattern, recursive, maxEntries, includeDirs };
  }),
);

router.post(
  "/file",
  requireAdmin,
  createCommandSender("file", (req) => ({ path: req.body?.path })),
);

router.post(
  "/folder",
  requireAdmin,
  createCommandSender("folder", (req) => ({ path: req.body?.path })),
);

export default router;
