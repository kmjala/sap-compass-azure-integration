export {};

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      MESSAGE_ARCHIVE_STORAGE_ACCOUNT_NAME: string;
      MESSAGE_ARCHIVE_BLOB_SERVICE_URI: string;
      CompassServiceBusConnection__fullyQualifiedNamespace: string;
      CompassServiceBusConnection__clientId: string;
      FUNCTIONAPPIDENTITY_CLIENTID: string;
      AZURE_SUBSCRIPTION_ID: string;
      AZURE_RESOURCE_GROUP_NAME: string;
      SAP_BASE_URL: string;
      SAP_API_KEY: string;
      SAP_API_PRODNORDCONF2_DELAY: string;
    }
  }
}
