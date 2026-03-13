let PrismaClientCtor: any = null;
try {
  PrismaClientCtor = require("@prisma/client").PrismaClient;
} catch {
  PrismaClientCtor = null;
}

export const prisma = PrismaClientCtor ? new PrismaClientCtor() : null;
