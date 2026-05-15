import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { parseFile } from "./parser.server";
import { runImport } from "./importer.server";

function nextRunDate(from: Date, recurrence: string): Date {
  const d = new Date(from);
  if (recurrence === "daily") d.setDate(d.getDate() + 1);
  else if (recurrence === "weekly") d.setDate(d.getDate() + 7);
  else if (recurrence === "monthly") d.setMonth(d.getMonth() + 1);
  return d;
}

export async function runDueScheduledImports() {
  const now = new Date();

  // Find all pending one-time imports that are due
  const dueOneTime = await prisma.scheduledImport.findMany({
    where: { status: "PENDING", recurrence: "none", scheduledAt: { lte: now } },
  });

  // Find recurring imports that are due
  const dueRecurring = await prisma.scheduledImport.findMany({
    where: {
      recurrence: { not: "none" },
      status: { not: "RUNNING" },
      nextRunAt: { lte: now },
    },
  });

  const due = [...dueOneTime, ...dueRecurring];
  if (due.length === 0) return { ran: 0 };

  let ran = 0;

  for (const item of due) {
    try {
      await prisma.scheduledImport.update({
        where: { id: item.id },
        data: { status: "RUNNING" },
      });

      const { admin } = await unauthenticated.admin(item.shop);
      const buffer = Buffer.from(item.fileData);
      const parseResult = await parseFile(buffer as Buffer<ArrayBufferLike>, item.fileType as "csv" | "xlsx");

      const job = await prisma.importJob.create({
        data: {
          shop: item.shop,
          fileName: item.fileName,
          fileType: item.fileType,
          status: "PARSING",
          totalRows: parseResult.totalRows,
        },
      });

      await runImport({
        jobId: job.id,
        shop: item.shop,
        admin,
        rows: parseResult.rows,
        useBulk: parseResult.validRows > 50,
        duplicateStrategy: item.duplicateStrategy as "skip" | "overwrite",
      });

      const nextStatus = item.recurrence !== "none" ? "PENDING" : "COMPLETED";
      const nextRun = item.recurrence !== "none" ? nextRunDate(now, item.recurrence) : null;

      await prisma.scheduledImport.update({
        where: { id: item.id },
        data: { status: nextStatus, jobId: job.id, nextRunAt: nextRun, scheduledAt: nextRun ?? item.scheduledAt },
      });

      ran++;
    } catch (err) {
      await prisma.scheduledImport.update({
        where: { id: item.id },
        data: { status: "FAILED" },
      }).catch(() => null);
      console.error(`Scheduled import ${item.id} failed:`, err);
    }
  }

  return { ran };
}
