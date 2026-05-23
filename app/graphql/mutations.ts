export const COLLECTION_CREATE = `#graphql
  mutation collectionCreate($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection {
        id
        title
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const COLLECTION_ADD_PRODUCTS = `#graphql
  mutation collectionAddProductsV2($id: ID!, $productIds: [ID!]!) {
    collectionAddProductsV2(id: $id, productIds: $productIds) {
      job {
        id
        done
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const STAGED_UPLOADS_CREATE = `#graphql
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const BULK_OPERATION_RUN_MUTATION = `#graphql
  mutation bulkOperationRunMutation($mutation: String!, $stagedUploadPath: String!) {
    bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $stagedUploadPath) {
      bulkOperation {
        id
        status
        url
        errorCode
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const BULK_OPERATION_STATUS = `#graphql
  query currentBulkOperation {
    currentBulkOperation(type: MUTATION) {
      id
      status
      errorCode
      createdAt
      completedAt
      objectCount
      fileSize
      url
      partialDataUrl
    }
  }
`;

export const COLLECTION_UPDATE = `#graphql
  mutation collectionUpdate($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection {
        id
        title
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const COLLECTION_BY_HANDLE = `#graphql
  query collectionByHandle($handle: String!) {
    collectionByHandle(handle: $handle) {
      id
      handle
      title
      descriptionHtml
      sortOrder
      image { src altText }
      seo { title description }
      ruleSet {
        appliedDisjunctively
        rules { column relation condition }
      }
    }
  }
`;

export const COLLECTION_DELETE = `#graphql
  mutation collectionDelete($input: CollectionDeleteInput!) {
    collectionDelete(input: $input) {
      deletedCollectionId
      userErrors { field message }
    }
  }
`;

export const COLLECTIONS_LIST = `#graphql
  query collectionsList($first: Int!, $after: String, $query: String) {
    collections(first: $first, after: $after, query: $query) {
      edges {
        node {
          id
          title
          handle
          updatedAt
          image { src altText }
          productsCount { count }
          ruleSet { rules { column relation condition } }
          seo { title description }
        }
      }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }
`;

export const METAFIELDS_SET = `#graphql
  mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id namespace key value }
      userErrors { field message }
    }
  }
`;

export const PRODUCTS_BY_HANDLES = `#graphql
  query productsByHandles($query: String!) {
    products(first: 250, query: $query) {
      edges {
        node {
          id
          handle
        }
      }
    }
  }
`;

export const TRANSLATABLE_RESOURCE = `#graphql
  query translatableResource($resourceId: ID!) {
    translatableResource(resourceId: $resourceId) {
      resourceId
      translatableContent {
        key
        value
        digest
        locale
      }
    }
  }
`;

export const APP_SUBSCRIPTION_CREATE = `#graphql
  mutation appSubscriptionCreate($name: String!, $returnUrl: URL!, $lineItems: [AppSubscriptionLineItemInput!]!, $test: Boolean) {
    appSubscriptionCreate(name: $name, returnUrl: $returnUrl, lineItems: $lineItems, test: $test) {
      appSubscription { id status }
      confirmationUrl
      userErrors { field message }
    }
  }
`;

export const APP_SUBSCRIPTION_CANCEL = `#graphql
  mutation appSubscriptionCancel($id: ID!) {
    appSubscriptionCancel(id: $id) {
      appSubscription { id status }
      userErrors { field message }
    }
  }
`;

export const CURRENT_APP_SUBSCRIPTION = `#graphql
  query currentAppSubscription {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
      }
    }
  }
`;

export const TRANSLATIONS_REGISTER = `#graphql
  mutation translationsRegister($resourceId: ID!, $translations: [TranslationInput!]!) {
    translationsRegister(resourceId: $resourceId, translations: $translations) {
      translations {
        key
        value
        locale
      }
      userErrors {
        field
        message
      }
    }
  }
`;
