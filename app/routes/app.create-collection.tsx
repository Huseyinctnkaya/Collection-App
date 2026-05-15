import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { useActionData, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Select,
  Checkbox,
  Button,
  Banner,
  Divider,
  Badge,
  Thumbnail,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { RulesBuilder, type Rule } from "../components/RulesBuilder";
import { COLLECTION_CREATE } from "../graphql/mutations";

const SORT_ORDERS = [
  { label: "Manual", value: "MANUAL" },
  { label: "Best Selling", value: "BEST_SELLING" },
  { label: "Alphabetically A–Z", value: "ALPHA_ASC" },
  { label: "Alphabetically Z–A", value: "ALPHA_DESC" },
  { label: "Price: Low to High", value: "PRICE_ASC" },
  { label: "Price: High to Low", value: "PRICE_DESC" },
  { label: "Newest", value: "CREATED_DESC" },
  { label: "Oldest", value: "CREATED" },
];

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const title = (formData.get("title") as string)?.trim();
  const handle = (formData.get("handle") as string)?.trim() || undefined;
  const description = (formData.get("description") as string)?.trim();
  const imageUrl = (formData.get("imageUrl") as string)?.trim();
  const sortOrder = formData.get("sortOrder") as string;
  const published = formData.get("published") === "true";
  const seoTitle = (formData.get("seoTitle") as string)?.trim();
  const seoDescription = (formData.get("seoDescription") as string)?.trim();
  const rulesJson = formData.get("rules") as string;
  const disjunctive = formData.get("disjunctive") === "true";

  if (!title) return json({ error: "Title is required" }, { status: 400 });

  let parsedRules: Rule[] = [];
  try {
    parsedRules = JSON.parse(rulesJson || "[]");
  } catch {
    return json({ error: "Invalid rules data" }, { status: 400 });
  }

  const input: Record<string, unknown> = {
    title,
    handle,
    descriptionHtml: description ?? "",
    sortOrder,
    published,
    seo: seoTitle ? { title: seoTitle, description: seoDescription } : undefined,
    image: imageUrl ? { src: imageUrl } : undefined,
  };

  const validRules = parsedRules.filter((r) => r.condition.trim());
  if (validRules.length > 0) {
    input.ruleSet = { appliedDisjunctively: disjunctive, rules: validRules };
  }

  const response = await admin.graphql(COLLECTION_CREATE, { variables: { input } });
  const { data } = await response.json();
  const errors: Array<{ field: string[]; message: string }> = data?.collectionCreate?.userErrors ?? [];

  if (errors.length > 0) {
    // Retry without image if image is the only problem
    if (errors.every((e) => e.message.toLowerCase().includes("image"))) {
      const retryInput = { ...input, image: undefined };
      const retry = await admin.graphql(COLLECTION_CREATE, { variables: { input: retryInput } });
      const retryData = await retry.json();
      if (retryData?.data?.collectionCreate?.userErrors?.length > 0) {
        return json({ error: retryData.data.collectionCreate.userErrors[0].message }, { status: 422 });
      }
      const col = retryData?.data?.collectionCreate?.collection;
      return json({ created: true, collection: col, imageWarning: true });
    }
    return json({ error: errors[0].message }, { status: 422 });
  }

  const col = data?.collectionCreate?.collection;
  return json({ created: true, collection: col, imageWarning: false });
}

export default function CreateCollectionPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [title, setTitle] = useState("");
  const [handle, setHandle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [sortOrder, setSortOrder] = useState("MANUAL");
  const [published, setPublished] = useState(true);
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [isSmartCollection, setIsSmartCollection] = useState(false);
  const [rules, setRules] = useState<Rule[]>([]);
  const [disjunctive, setDisjunctive] = useState(false);

  const handleRulesChange = useCallback(
    (r: Rule[], d: boolean) => { setRules(r); setDisjunctive(d); },
    []
  );

  const handleTitleChange = useCallback((v: string) => {
    setTitle(v);
    if (!handle) {
      // Auto-generate handle preview
    }
  }, [handle]);

  const handleSubmit = useCallback(() => {
    const fd = new FormData();
    fd.append("title", title);
    fd.append("handle", handle);
    fd.append("description", description);
    fd.append("imageUrl", imageUrl);
    fd.append("sortOrder", sortOrder);
    fd.append("published", String(published));
    fd.append("seoTitle", seoTitle);
    fd.append("seoDescription", seoDescription);
    fd.append("rules", JSON.stringify(isSmartCollection ? rules : []));
    fd.append("disjunctive", String(disjunctive));
    const form = document.createElement("form");
    form.method = "post";
    Object.fromEntries(fd.entries()); // not used, just submitting via fetch
    // Trigger Remix form submit
    const submitEvent = new Event("submit", { bubbles: true, cancelable: true });
    document.querySelector("form[data-collection-form]")?.dispatchEvent(submitEvent);
  }, [title, handle, description, imageUrl, sortOrder, published, seoTitle, seoDescription, isSmartCollection, rules, disjunctive]);

  const created = actionData && "created" in actionData ? (actionData as { created: true; collection: { id: string; title: string; handle: string }; imageWarning: boolean }) : null;

  return (
    <Page
      title="Create Collection"
      subtitle="Build a new collection with a visual rule editor"
      backAction={{ content: "Collections", url: "/app/collections" }}
    >
      <TitleBar title="Create Collection" />

      <form method="post" data-collection-form>
        <input type="hidden" name="rules" value={JSON.stringify(isSmartCollection ? rules : [])} />
        <input type="hidden" name="disjunctive" value={String(disjunctive)} />
        <input type="hidden" name="published" value={String(published)} />

        <Layout>
          <Layout.Section>
            <BlockStack gap="500">
              {created && (
                <Banner tone={created.imageWarning ? "warning" : "success"} title="Collection created">
                  <BlockStack gap="100">
                    <Text as="p">
                      <strong>{created.collection.title}</strong> was created with handle{" "}
                      <em>/{created.collection.handle}</em>.
                    </Text>
                    {created.imageWarning && (
                      <Text as="p">The image could not be uploaded — collection was created without it.</Text>
                    )}
                  </BlockStack>
                </Banner>
              )}

              {actionData && "error" in actionData && (
                <Banner tone="critical">
                  <p>{(actionData as { error: string }).error}</p>
                </Banner>
              )}

              {/* Basic info */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Basic Information</Text>
                  <Divider />
                  <TextField
                    label="Title"
                    name="title"
                    value={title}
                    onChange={handleTitleChange}
                    placeholder="e.g. Summer Collection"
                    autoComplete="off"
                    requiredIndicator
                  />
                  <TextField
                    label="Handle (URL slug)"
                    name="handle"
                    value={handle}
                    onChange={setHandle}
                    placeholder="Auto-generated from title"
                    helpText="Leave blank to auto-generate. Used in collection URL."
                    autoComplete="off"
                  />
                  <TextField
                    label="Description"
                    name="description"
                    value={description}
                    onChange={setDescription}
                    multiline={4}
                    placeholder="Describe this collection..."
                    autoComplete="off"
                  />
                  <TextField
                    label="Cover Image URL"
                    name="imageUrl"
                    value={imageUrl}
                    onChange={setImageUrl}
                    placeholder="https://cdn.shopify.com/..."
                    helpText="Must be a publicly accessible HTTPS URL"
                    autoComplete="off"
                    connectedRight={
                      imageUrl ? (
                        <div style={{ padding: "4px" }}>
                          <Thumbnail source={imageUrl} alt="Preview" size="small" />
                        </div>
                      ) : undefined
                    }
                  />
                  <Select
                    label="Sort order"
                    name="sortOrder"
                    options={SORT_ORDERS}
                    value={sortOrder}
                    onChange={setSortOrder}
                  />
                  <Checkbox
                    label="Visible in storefront"
                    checked={published}
                    onChange={setPublished}
                  />
                </BlockStack>
              </Card>

              {/* Collection type & rules */}
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">Collection Type</Text>
                    <Badge tone={isSmartCollection ? "success" : "new"}>
                      {isSmartCollection ? "Smart" : "Manual"}
                    </Badge>
                  </InlineStack>
                  <Divider />
                  <Checkbox
                    label="Smart collection — automatically add products matching rules"
                    checked={isSmartCollection}
                    onChange={setIsSmartCollection}
                  />
                  {isSmartCollection && (
                    <RulesBuilder
                      rules={rules}
                      disjunctive={disjunctive}
                      onChange={handleRulesChange}
                    />
                  )}
                  {!isSmartCollection && (
                    <Text as="p" tone="subdued">
                      Manual collection — products are added individually via the Shopify admin or via CSV import.
                    </Text>
                  )}
                </BlockStack>
              </Card>

              {/* SEO */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Search Engine Optimization</Text>
                  <Divider />
                  <TextField
                    label="SEO Title"
                    name="seoTitle"
                    value={seoTitle}
                    onChange={setSeoTitle}
                    placeholder="Defaults to collection title"
                    helpText={`${seoTitle.length}/70 characters`}
                    autoComplete="off"
                  />
                  <TextField
                    label="SEO Description"
                    name="seoDescription"
                    value={seoDescription}
                    onChange={setSeoDescription}
                    multiline={3}
                    placeholder="Defaults to collection description"
                    helpText={`${seoDescription.length}/320 characters`}
                    autoComplete="off"
                  />
                </BlockStack>
              </Card>

              <InlineStack gap="300">
                <Button variant="primary" submit loading={isSaving} disabled={isSaving || !title.trim()}>
                  Create Collection
                </Button>
                <Button url="/app/collections">Cancel</Button>
              </InlineStack>
            </BlockStack>
          </Layout.Section>

          {/* Preview sidebar */}
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Preview</Text>
                <Divider />
                <div style={{
                  aspectRatio: "16/9",
                  background: imageUrl ? `url(${imageUrl}) center/cover` : "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                  borderRadius: "8px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  {!imageUrl && (
                    <Text as="p" tone="subdued" fontWeight="bold">No image</Text>
                  )}
                </div>
                <Text as="p" variant="headingMd" fontWeight="bold">{title || "Collection Title"}</Text>
                {handle && (
                  <Text as="p" variant="bodySm" tone="subdued">/{handle}</Text>
                )}
                <InlineStack gap="200">
                  <Badge tone={isSmartCollection ? "success" : "new"}>{isSmartCollection ? "Smart" : "Manual"}</Badge>
                  <Badge tone={published ? "success" : "new"}>{published ? "Visible" : "Hidden"}</Badge>
                </InlineStack>
                {isSmartCollection && rules.filter((r) => r.condition.trim()).length > 0 && (
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" fontWeight="semibold">Rules ({disjunctive ? "OR" : "AND"}):</Text>
                    {rules.filter((r) => r.condition.trim()).map((r, i) => (
                      <Text key={i} as="p" variant="bodySm" tone="subdued">
                        {r.column.replace(/_/g, " ").toLowerCase()} {r.relation.replace(/_/g, " ").toLowerCase()} &quot;{r.condition}&quot;
                      </Text>
                    ))}
                  </BlockStack>
                )}
                {seoTitle && (
                  <>
                    <Divider />
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" fontWeight="semibold">SEO Preview</Text>
                      <Text as="p" variant="bodySm" tone="success">{seoTitle}</Text>
                      {seoDescription && <Text as="p" variant="bodySm" tone="subdued">{seoDescription}</Text>}
                    </BlockStack>
                  </>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </form>
    </Page>
  );
}
