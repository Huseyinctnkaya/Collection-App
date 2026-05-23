// This file has NO server-only imports — safe to use in both client and server code.

export type PlanName = "free" | "pro" | "premium";

export interface PlanLimits {
  maxRowsPerImport: number;
  maxImportsPerMonth: number;
  maxScheduledImports: number;
  allowedFileTypes: string[];
  googleSheetsEnabled: boolean;
  bulkOperationsEnabled: boolean;
  rollbackEnabled: boolean;
  externalWebhookEnabled: boolean;
  flowWebhookEnabled: boolean;
  healthCheckerEnabled: boolean;
}

export const PLANS: Record<PlanName, { label: string; price: number; limits: PlanLimits }> = {
  free: {
    label: "Free",
    price: 0,
    limits: {
      maxRowsPerImport: 100,
      maxImportsPerMonth: 5,
      maxScheduledImports: 0,
      allowedFileTypes: ["csv"],
      googleSheetsEnabled: false,
      bulkOperationsEnabled: false,
      rollbackEnabled: false,
      externalWebhookEnabled: false,
      flowWebhookEnabled: false,
      healthCheckerEnabled: false,
    },
  },
  pro: {
    label: "Pro",
    price: 9.99,
    limits: {
      maxRowsPerImport: 2000,
      maxImportsPerMonth: -1,
      maxScheduledImports: 5,
      allowedFileTypes: ["csv", "xlsx"],
      googleSheetsEnabled: true,
      bulkOperationsEnabled: true,
      rollbackEnabled: true,
      externalWebhookEnabled: false,
      flowWebhookEnabled: true,
      healthCheckerEnabled: true,
    },
  },
  premium: {
    label: "Premium",
    price: 29.99,
    limits: {
      maxRowsPerImport: -1,
      maxImportsPerMonth: -1,
      maxScheduledImports: -1,
      allowedFileTypes: ["csv", "xlsx"],
      googleSheetsEnabled: true,
      bulkOperationsEnabled: true,
      rollbackEnabled: true,
      externalWebhookEnabled: true,
      flowWebhookEnabled: true,
      healthCheckerEnabled: true,
    },
  },
};
