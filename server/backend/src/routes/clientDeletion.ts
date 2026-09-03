import { Router } from "express";
import bcrypt from "bcryptjs";
import { AuthRequest, requireAdmin } from "../middleware/auth";
import { deleteClient, getUser } from "../store";
import { requestClientUninstall } from "../wsHub";

const router = Router();

router.delete("/:id", requireAdmin, async (req: AuthRequest, res) => {
  const id = String(req.params.id);
  try {
    const password = String((req.body as any)?.password || "").trim();
    if (!password) return res.status(400).json({ message: "Password required" });

    const actorEmail = req.user?.email;
    if (!actorEmail) return res.status(401).json({ message: "Unauthorized" });
    const user = await getUser(actorEmail);
    if (!user) return res.status(500).json({ message: "User record not found" });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(403).json({ message: "Invalid password" });

    const uninstall = await requestClientUninstall(id, { serviceName: "BelfProctor" });
    await deleteClient(id);
    return res.json({ ok: true, uninstall });
  } catch {
    return res.status(404).json({ message: "Not found" });
  }
});

export default router;
