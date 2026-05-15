import {
  BlockStack,
  InlineStack,
  Select,
  TextField,
  Button,
  Text,
  Divider,
  Badge,
  Checkbox,
} from "@shopify/polaris";
import { useCallback } from "react";

export interface Rule {
  column: string;
  relation: string;
  condition: string;
}

interface RulesBuilderProps {
  rules: Rule[];
  disjunctive: boolean;
  onChange: (rules: Rule[], disjunctive: boolean) => void;
}

const COLUMNS = [
  { label: "Tag", value: "TAG" },
  { label: "Vendor", value: "VENDOR" },
  { label: "Product Type", value: "TYPE" },
  { label: "Title", value: "TITLE" },
  { label: "Variant Title", value: "VARIANT_TITLE" },
  { label: "Price", value: "VARIANT_PRICE" },
  { label: "Compare-at Price", value: "VARIANT_COMPARE_AT_PRICE" },
  { label: "Weight", value: "VARIANT_WEIGHT" },
  { label: "Inventory Stock", value: "VARIANT_INVENTORY" },
];

const TEXT_RELATIONS = [
  { label: "is equal to", value: "EQUALS" },
  { label: "is not equal to", value: "NOT_EQUALS" },
  { label: "starts with", value: "STARTS_WITH" },
  { label: "ends with", value: "ENDS_WITH" },
  { label: "contains", value: "CONTAINS" },
  { label: "does not contain", value: "NOT_CONTAINS" },
];

const NUMERIC_RELATIONS = [
  { label: "is equal to", value: "EQUALS" },
  { label: "is not equal to", value: "NOT_EQUALS" },
  { label: "is greater than", value: "GREATER_THAN" },
  { label: "is less than", value: "LESS_THAN" },
];

const NUMERIC_COLUMNS = new Set([
  "VARIANT_PRICE",
  "VARIANT_COMPARE_AT_PRICE",
  "VARIANT_WEIGHT",
  "VARIANT_INVENTORY",
]);

const COLUMN_PLACEHOLDERS: Record<string, string> = {
  TAG: "e.g. summer",
  VENDOR: "e.g. Nike",
  TYPE: "e.g. T-Shirt",
  TITLE: "e.g. Sale",
  VARIANT_TITLE: "e.g. Small",
  VARIANT_PRICE: "e.g. 29.99",
  VARIANT_COMPARE_AT_PRICE: "e.g. 49.99",
  VARIANT_WEIGHT: "e.g. 0.5",
  VARIANT_INVENTORY: "e.g. 10",
};

function relationsFor(column: string) {
  return NUMERIC_COLUMNS.has(column) ? NUMERIC_RELATIONS : TEXT_RELATIONS;
}

export function rulesBuilderToString(rules: Rule[]): string {
  return rules
    .filter((r) => r.condition.trim())
    .map((r) => `${r.column}:${r.condition.trim()}`)
    .join(",");
}

export function RulesBuilder({ rules, disjunctive, onChange }: RulesBuilderProps) {
  const updateRule = useCallback(
    (index: number, patch: Partial<Rule>) => {
      const next = rules.map((r, i) => {
        if (i !== index) return r;
        const updated = { ...r, ...patch };
        // Reset relation when column type changes between text/numeric
        if (
          patch.column &&
          NUMERIC_COLUMNS.has(patch.column) !== NUMERIC_COLUMNS.has(r.column)
        ) {
          updated.relation = "EQUALS";
        }
        return updated;
      });
      onChange(next, disjunctive);
    },
    [rules, disjunctive, onChange]
  );

  const addRule = useCallback(() => {
    onChange([...rules, { column: "TAG", relation: "EQUALS", condition: "" }], disjunctive);
  }, [rules, disjunctive, onChange]);

  const removeRule = useCallback(
    (index: number) => {
      onChange(rules.filter((_, i) => i !== index), disjunctive);
    },
    [rules, disjunctive, onChange]
  );

  const toggleDisjunctive = useCallback(
    (v: boolean) => onChange(rules, v),
    [rules, onChange]
  );

  return (
    <BlockStack gap="400">
      <InlineStack align="space-between" blockAlign="center">
        <Text as="p" variant="bodyMd" fontWeight="semibold">Smart Collection Rules</Text>
        <Badge tone="info">Auto-match products</Badge>
      </InlineStack>

      {rules.length === 0 ? (
        <Text as="p" tone="subdued">No rules yet. Add a rule to define which products belong to this collection.</Text>
      ) : (
        <BlockStack gap="300">
          {rules.map((rule, i) => (
            <div key={i}>
              {i > 0 && (
                <div style={{ paddingBlock: "8px" }}>
                  <Text as="span" tone="subdued" variant="bodySm">
                    {disjunctive ? "OR" : "AND"}
                  </Text>
                </div>
              )}
              <InlineStack gap="200" blockAlign="end" wrap={false}>
                <div style={{ minWidth: 160 }}>
                  <Select
                    label="Column"
                    labelHidden
                    options={COLUMNS}
                    value={rule.column}
                    onChange={(v) => updateRule(i, { column: v })}
                  />
                </div>
                <div style={{ minWidth: 180 }}>
                  <Select
                    label="Relation"
                    labelHidden
                    options={relationsFor(rule.column)}
                    value={rule.relation}
                    onChange={(v) => updateRule(i, { relation: v })}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <TextField
                    label="Value"
                    labelHidden
                    value={rule.condition}
                    onChange={(v) => updateRule(i, { condition: v })}
                    placeholder={COLUMN_PLACEHOLDERS[rule.column] ?? "Value"}
                    autoComplete="off"
                  />
                </div>
                <Button
                  variant="plain"
                  tone="critical"
                  onClick={() => removeRule(i)}
                  accessibilityLabel="Remove rule"
                >
                  ✕
                </Button>
              </InlineStack>
            </div>
          ))}
        </BlockStack>
      )}

      <InlineStack gap="400" blockAlign="center">
        <Button onClick={addRule} size="slim">+ Add Rule</Button>
        {rules.length > 1 && (
          <>
            <Divider />
            <Checkbox
              label="Products must match ANY condition (OR logic)"
              checked={disjunctive}
              onChange={toggleDisjunctive}
            />
          </>
        )}
      </InlineStack>

      {rules.filter((r) => r.condition.trim()).length > 0 && (
        <BlockStack gap="100">
          <Text as="p" variant="bodySm" tone="subdued">Generated rules string:</Text>
          <Text as="p" variant="bodySm" fontWeight="bold">
            {rulesBuilderToString(rules)}
          </Text>
        </BlockStack>
      )}
    </BlockStack>
  );
}
