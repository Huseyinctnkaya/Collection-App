import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useSearchParams } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Banner,
  Divider,
  IndexTable,
  Thumbnail,
  Badge,
  TextField,
  useIndexResourceState,
  Pagination,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback, type KeyboardEvent } from "react";
import { authenticate } from "../shopify.server";
import { COLLECTIONS_LIST, COLLECTION_DELETE } from "../graphql/mutations";

interface ShopifyCollection {
  id: string;
  title: string;
  handle: string;
  updatedAt: string;
  image: { src: string; altText: string | null } | null;
  productsCount: { count: number };
  ruleSet: { rules: unknown[] } | null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const direction = url.searchParams.get("dir") ?? "next";
  const q = url.searchParams.get("q") ?? "";

  const variables: Record<string, unknown> = { first: 25, query: q || undefined };
  if (cursor && direction === "next") variables.after = cursor;

  const res = await admin.graphql(COLLECTIONS_LIST, { variables });
  const { data } = await res.json();
  const edges: Array<{ node: ShopifyCollection }> = data?.collections?.edges ?? [];
  const pageInfo = data?.collections?.pageInfo ?? {};

  return json({
    collections: edges.map((e) => e.node),
    pageInfo,
    q,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const ids = (formData.get("ids") as string).split(",").filter(Boolean);

  if (intent === "delete") {
    const errors: string[] = [];
    await Promise.all(
      ids.map(async (id) => {
        const res = await admin.graphql(COLLECTION_DELETE, { variables: { input: { id } } });
        const { data } = await res.json();
        if (data?.collectionDelete?.userErrors?.length > 0) {
          errors.push(data.collectionDelete.userErrors[0].message);
        }
      })
    );
    return json({ deleted: ids.length - errors.length, errors });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
}

export default function CollectionsPage() {
  const { collections, pageInfo, q: initialQ } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  const [searchValue, setSearchValue] = useState(initialQ);

  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } =
    useIndexResourceState(collections);

  const handleSearch = useCallback(() => {
    setSearchParams({ q: searchValue });
    clearSelection();
  }, [searchValue, setSearchParams, clearSelection]);

  const handleBulkDelete = useCallback(() => {
    if (!confirm(`Delete ${selectedResources.length} collection(s)? This cannot be undone.`)) return;
    const fd = new FormData();
    fd.append("intent", "delete");
    fd.append("ids", selectedResources.join(","));
    submit(fd, { method: "post" });
    clearSelection();
  }, [selectedResources, submit, clearSelection]);

  const promotedBulkActions = [
    { content: `Delete ${selectedResources.length} collection(s)`, onAction: handleBulkDelete, destructive: true },
  ];

  return (
    <Page
      title="Collection Manager"
      subtitle="View, search and bulk manage your Shopify collections"
      primaryAction={{ content: "Create Collection", url: "/app/create-collection" }}
      backAction={{ content: "Home", url: "/app" }}
    >
      <TitleBar title="Collection Manager" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="300" blockAlign="end">
                <div
                  style={{ flex: 1 }}
                  onKeyDown={(e: KeyboardEvent) => e.key === "Enter" && handleSearch()}
                >
                  <TextField
                    label=""
                    labelHidden
                    placeholder="Search collections..."
                    value={searchValue}
                    onChange={setSearchValue}
                    autoComplete="off"
                  />
                </div>
                <Button onClick={handleSearch} loading={isLoading}>Search</Button>
                {initialQ && (
                  <Button variant="plain" onClick={() => { setSearchValue(""); setSearchParams({}); }}>
                    Clear
                  </Button>
                )}
              </InlineStack>
              <Divider />
              <IndexTable
                resourceName={{ singular: "collection", plural: "collections" }}
                itemCount={collections.length}
                selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
                onSelectionChange={handleSelectionChange}
                promotedBulkActions={promotedBulkActions}
                loading={isLoading}
                headings={[
                  { title: "" },
                  { title: "Title" },
                  { title: "Handle" },
                  { title: "Products" },
                  { title: "Type" },
                  { title: "Updated" },
                ]}
              >
                {collections.map((c, index) => (
                  <IndexTable.Row
                    id={c.id}
                    key={c.id}
                    selected={selectedResources.includes(c.id)}
                    position={index}
                  >
                    <IndexTable.Cell>
                      <Thumbnail
                        source={c.image?.src ?? ""}
                        alt={c.image?.altText ?? c.title}
                        size="small"
                      />
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" fontWeight="semibold">{c.title}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" tone="subdued">{c.handle}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {c.productsCount.count}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge>{c.ruleSet ? "Smart" : "Manual"}</Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" tone="subdued">
                        {new Date(c.updatedAt).toLocaleDateString()}
                      </Text>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>

              <InlineStack align="center">
                <Pagination
                  hasPrevious={pageInfo.hasPreviousPage}
                  hasNext={pageInfo.hasNextPage}
                  onPrevious={() => setSearchParams({ q: initialQ, cursor: pageInfo.startCursor, dir: "prev" })}
                  onNext={() => setSearchParams({ q: initialQ, cursor: pageInfo.endCursor, dir: "next" })}
                />
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
