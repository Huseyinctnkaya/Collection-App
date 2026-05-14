import nodemailer from "nodemailer";
import prisma from "../db.server";

interface JobSummary {
  id: string;
  fileName: string;
  status: string;
  successCount: number;
  errorCount: number;
  totalRows: number;
}

function buildMessage(job: JobSummary, shop: string) {
  const emoji = job.status === "COMPLETED" ? "✅" : job.status === "PARTIAL" ? "⚠️" : "❌";
  const title = `${emoji} Import ${job.status.toLowerCase()} — ${shop}`;
  const body = [
    `File: ${job.fileName}`,
    `Total rows: ${job.totalRows}`,
    `Imported: ${job.successCount}`,
    job.errorCount > 0 ? `Errors: ${job.errorCount}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return { title, body };
}

async function sendSlack(webhookUrl: string, title: string, body: string) {
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `*${title}*\n${body}` }),
  });
}

async function sendEmail(to: string, title: string, body: string) {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT ?? 587);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM ?? smtpUser;

  if (!smtpHost || !smtpUser || !smtpPass) return;

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });

  await transporter.sendMail({
    from: smtpFrom,
    to,
    subject: title,
    text: body,
  });
}

export async function notifyImportFinished(shop: string, job: JobSummary) {
  const settings = await prisma.notificationSetting.findUnique({ where: { shop } });
  if (!settings) return;

  const isSuccess = job.status === "COMPLETED" || job.status === "PARTIAL";
  const shouldSend = (isSuccess && settings.notifyOnComplete) || (!isSuccess && settings.notifyOnFail);
  if (!shouldSend) return;

  const { title, body } = buildMessage(job, shop);

  const tasks: Promise<unknown>[] = [];

  if (settings.slackWebhookUrl) {
    tasks.push(sendSlack(settings.slackWebhookUrl, title, body).catch(console.error));
  }

  if (settings.email) {
    tasks.push(sendEmail(settings.email, title, body).catch(console.error));
  }

  await Promise.all(tasks);
}
