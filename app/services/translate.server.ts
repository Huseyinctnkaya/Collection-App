import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { TRANSLATABLE_RESOURCE, TRANSLATIONS_REGISTER } from "../graphql/mutations";

interface TranslatableContentItem {
  key: string;
  value: string;
  digest: string;
  locale: string;
}

interface TranslationInput {
  locale: string;
  key: string;
  value: string;
  translatableContentDigest: string;
}

const TRANSLATABLE_KEYS = ["title", "body_html", "meta_title", "meta_description"] as const;

const KEY_MAP: Record<string, string> = {
  title: "title",
  description: "body_html",
  seo_title: "meta_title",
  seo_description: "meta_description",
};

export async function registerCollectionTranslations(
  admin: AdminApiContext,
  collectionId: string,
  translations: Record<string, Record<string, string>>
): Promise<void> {
  if (Object.keys(translations).length === 0) return;

  const res = await admin.graphql(TRANSLATABLE_RESOURCE, {
    variables: { resourceId: collectionId },
  });
  const data = await res.json();
  const content: TranslatableContentItem[] =
    data?.data?.translatableResource?.translatableContent ?? [];

  const digestMap: Record<string, string> = {};
  for (const item of content) {
    digestMap[item.key] = item.digest;
  }

  const inputs: TranslationInput[] = [];

  for (const [locale, fields] of Object.entries(translations)) {
    for (const [fieldName, value] of Object.entries(fields)) {
      if (!value) continue;
      const shopifyKey = KEY_MAP[fieldName];
      if (!shopifyKey || !(TRANSLATABLE_KEYS as readonly string[]).includes(shopifyKey)) continue;
      const digest = digestMap[shopifyKey];
      if (!digest) continue;

      inputs.push({ locale, key: shopifyKey, value, translatableContentDigest: digest });
    }
  }

  if (inputs.length === 0) return;

  await admin.graphql(TRANSLATIONS_REGISTER, {
    variables: { resourceId: collectionId, translations: inputs },
  });
}

export function extractLocaleFields(
  row: Record<string, string>
): Record<string, Record<string, string>> {
  const localeData: Record<string, Record<string, string>> = {};

  for (const [key, value] of Object.entries(row)) {
    const match = /^([a-z_]+)_([a-z]{2}(?:-[A-Z]{2})?)$/.exec(key);
    if (!match || !value) continue;
    const [, fieldName, locale] = match;
    if (!KEY_MAP[fieldName]) continue;

    if (!localeData[locale]) localeData[locale] = {};
    localeData[locale][fieldName] = value;
  }

  return localeData;
}
