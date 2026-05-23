import { json, unstable_parseMultipartFormData, unstable_createMemoryUploadHandler } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Button,
  Banner,
  DropZone,
  InlineStack,
  DataTable,
  Badge,
  Divider,
  Select,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { PlanGate } from "../components/PlanGate";
import prisma from "../db.server";
import { getCachedPlan, getLimits } from "../services/plan.server";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const [scheduled, currentPlan] = await Promise.all([
    prisma.scheduledImport.findMany({
      where: { shop: session.shop },
      orderBy: { scheduledAt: "asc" },
      take: 20,
    }),
    getCachedPlan(session.shop),
  ]);

  const limits = getLimits(currentPlan);
  return json({ scheduled, currentPlan, limits });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const uploadHandler = unstable_createMemoryUploadHandler({ maxPartSize: MAX_FILE_SIZE });
  const formData = await unstable_parseMultipartFormData(request, uploadHandler);

  const intent = formData.get("intent") as string;

  if (intent === "delete") {
    const id = formData.get("id") as string;
    await prisma.scheduledImport.deleteMany({
      where: { id, shop: session.shop, status: "PENDING" },
    });
    return json({ deleted: true });
  }

  const file = formData.get("file") as File | null;
  const scheduledAt = formData.get("scheduledAt") as string;
  const duplicateStrategy = formData.get("duplicateStrategy") === "overwrite" ? "overwrite" : "skip";
  const recurrence = (["daily", "weekly", "monthly"].includes(formData.get("recurrence") as string)
    ? formData.get("recurrence")
    : "none") as string;

  if (!file) return json({ error: "No file provided" }, { status: 400 });
  if (!scheduledAt) return json({ error: "No scheduled time provided" }, { status: 400 });

  const scheduledDate = new Date(scheduledAt);
  if (scheduledDate <= new Date()) {
    return json({ error: "Scheduled time must be in the future" }, { status: 400 });
  }

  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext !== "csv" && ext !== "xlsx") {
    return json({ error: "Only CSV and XLSX files are supported" }, { status: 400 });
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());

  const scheduled = await prisma.scheduledImport.create({
    data: {
      shop: session.shop,
      scheduledAt: scheduledDate,
      fileName: file.name,
      fileData: fileBuffer,
      fileType: ext,
      duplicateStrategy,
      recurrence,
      nextRunAt: recurrence !== "none" ? scheduledDate : null,
    },
  });

  return json({ scheduled: scheduled.id, scheduledAt: scheduledDate.toISOString(), recurrence });
}

export default function SchedulePage() {
  const { scheduled, currentPlan, limits } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();

  const [file, setFile] = useState<File | null>(null);
  const [scheduledAt, setScheduledAt] = useState("");
  const [duplicateStrategy, setDuplicateStrategy] = useState<"skip" | "overwrite">("skip");
  const [recurrence, setRecurrence] = useState("none");
  const isSubmitting = navigation.state === "submitting";

  const handleDrop = useCallback((_: File[], accepted: File[]) => {
    setFile(accepted[0] ?? null);
  }, []);

  const handleSchedule = useCallback(() => {
    if (!file || !scheduledAt) return;
    const fd = new FormData();
    fd.append("intent", "schedule");
    fd.append("file", file);
    fd.append("scheduledAt", scheduledAt);
    fd.append("duplicateStrategy", duplicateStrategy);
    fd.append("recurrence", recurrence);
    submit(fd, { method: "post", encType: "multipart/form-data" });
  }, [file, scheduledAt, duplicateStrategy, recurrence, submit]);

  const handleDelete = useCallback((id: string) => {
    const fd = new FormData();
    fd.append("intent", "delete");
    fd.append("id", id);
    submit(fd, { method: "post", encType: "multipart/form-data" });
  }, [submit]);

  const statusTone = (s: string): "success" | "warning" | "critical" | "info" =>
    s === "COMPLETED" ? "success" : s === "FAILED" ? "critical" : s === "RUNNING" ? "info" : "info";

  return (
    <Page
      title="Schedule Import"
      subtitle="Upload a file now, run the import at a future time"
      backAction={{ content: "Import", url: "/app/import" }}
    >
      <TitleBar title="Schedule Import" />
      <Layout>
        <Layout.Section>
          <PlanGate
            currentPlan={currentPlan}
            requiredPlan="pro"
            featureName="Scheduled Imports"
            description="Automate your imports by scheduling them in advance. Available on Pro and Premium plans."
          >
            <BlockStack gap="500">
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">New Scheduled Import</Text>
                    {limits.maxScheduledImports !== -1 && (
                      <Badge tone="info">{`${scheduled.filter(s => s.status === "PENDING").length} / ${limits.maxScheduledImports} active`}</Badge>
                    )}
                  </InlineStack>
                  <Divider />

                  <DropZone accept=".csv,.xlsx" type="file" allowMultiple={false} onDrop={handleDrop}>
                    {file
                      ? <DropZone.FileUpload actionTitle={file.name} actionHint="File ready" />
                      : <DropZone.FileUpload actionTitle="Add CSV or XLSX" actionHint="or drag and drop" />}
                  </DropZone>

                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd" fontWeight="medium">
                      Run at (your local time)
                    </Text>
                    <input
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={(e) => setScheduledAt(e.target.value)}
                      style={{
                        padding: "8px 12px",
                        border: "1px solid #c9cccf",
                        borderRadius: 8,
                        fontSize: 14,
                        width: "100%",
                        maxWidth: 320,
                      }}
                    />
                  </BlockStack>

                  <Select
                    label="If collection already exists"
                    options={[
                      { label: "Skip (keep existing)", value: "skip" },
                      { label: "Overwrite (update existing)", value: "overwrite" },
                    ]}
                    value={duplicateStrategy}
                    onChange={(v) => setDuplicateStrategy(v as "skip" | "overwrite")}
                  />

                  <Select
                    label="Repeat"
                    options={[
                      { label: "No repeat (one-time)", value: "none" },
                      { label: "Daily", value: "daily" },
                      { label: "Weekly", value: "weekly" },
                      { label: "Monthly", value: "monthly" },
                    ]}
                    value={recurrence}
                    onChange={setRecurrence}
                    helpText="Recurring imports re-run automatically using the same file"
                  />

                  {"error" in (actionData ?? {}) && (
                    <Banner tone="critical">
                      <p>{(actionData as { error: string }).error}</p>
                    </Banner>
                  )}

                  {"scheduled" in (actionData ?? {}) && (
                    <Banner tone="success">
                      <p>Import scheduled for {new Date((actionData as { scheduledAt: string }).scheduledAt).toLocaleString()}</p>
                    </Banner>
                  )}

                  <Button
                    variant="primary"
                    disabled={!file || !scheduledAt || isSubmitting}
                    loading={isSubmitting}
                    onClick={handleSchedule}
                  >
                    Schedule Import
                  </Button>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Scheduled Imports</Text>
                  <Divider />
                  {scheduled.length === 0 ? (
                    <Text as="p" tone="subdued">No scheduled imports.</Text>
                  ) : (
                    <DataTable
                      columnContentTypes={["text", "text", "text", "text", "text", "text"]}
                      headings={["File", "Scheduled for", "Status", "Repeat", "Strategy", ""]}
                      rows={scheduled.map((s) => [
                        s.fileName,
                        new Date(s.scheduledAt).toLocaleString(),
                        <Badge tone={statusTone(s.status)} key={s.id}>{s.status}</Badge>,
                        s.recurrence !== "none" ? <Badge key={`r-${s.id}`}>{s.recurrence}</Badge> : "—",
                        s.duplicateStrategy,
                        s.status === "PENDING"
                          ? <Button variant="plain" tone="critical" onClick={() => handleDelete(s.id)} key={s.id}>Cancel</Button>
                          : "—",
                      ])}
                    />
                  )}
                </BlockStack>
              </Card>
            </BlockStack>
          </PlanGate>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
