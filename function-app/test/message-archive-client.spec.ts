import { jest, test } from "@jest/globals";
import { InvocationContext } from "@azure/functions";
import {
  createBlobNamePrefix,
  MyContainerClient,
} from "../src/message-archive-client";
import { ContainerClient } from "@azure/storage-blob";

jest.mock("@azure/storage-blob");

describe("message-archive-client", () => {
  const uploadMockFn = jest.fn<() => Promise<string>>();

  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date("2001-02-03T04:05:06.789"));
  });
  afterAll(() => {
    jest.useRealTimers();
  });
  beforeEach(() => {
    (ContainerClient as jest.Mock).mockImplementation(() => ({
      getBlockBlobClient: jest.fn().mockImplementation(() => ({
        upload: uploadMockFn,
      })),
    }));
  });
  afterEach(() => {
    jest.clearAllMocks();
  });

  test("should create prefix for current date", () => {
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
      },
    });
    const actual = createBlobNamePrefix(context, "my-topic");

    expect(actual).toMatch(
      /^topic=my-topic\/year=2001\/month=02\/day=03\/mid=my-message-id$/,
    );
  });

  test("should upload JSON blob", async () => {
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
      },
      traceContext: {
        attributes: {
          correlationId: "my-correlation-id",
          tag1: "value1",
          tag2: "value2",
        },
      },
    });
    const blob = JSON.stringify({ ada: "lovelace" });
    const blobName = "my-blob-name.json";

    // Invoke the method
    const containerClient = new MyContainerClient(context, "my-test");
    const actualBlobName = await containerClient.upload(blob, blobName);

    // Assert the blob name
    expect(actualBlobName).toBe(
      "topic=my-test/year=2001/month=02/day=03/mid=my-message-id/my-blob-name.json",
    );
    expect(uploadMockFn).toHaveBeenCalledWith(blob, blob.length, {
      blobHTTPHeaders: { blobContentType: "application/json" },
      tags: {
        correlationId: "my-correlation-id",
        tag1: "value1",
        tag2: "value2",
      },
    });
  });

  test("should upload XML blob", async () => {
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
      },
      traceContext: {
        attributes: {
          correlationId: "my-correlation-id",
          tag1: "value1",
          tag2: "value2",
        },
      },
    });
    const blob = "<xml>my-xml</xml>";
    const blobName = "my-blob-name.xml";

    // Invoke the method
    const containerClient = new MyContainerClient(context, "my-test");
    const actualBlobName = await containerClient.upload(blob, blobName);

    // Assert the blob name
    expect(actualBlobName).toBe(
      "topic=my-test/year=2001/month=02/day=03/mid=my-message-id/my-blob-name.xml",
    );
    expect(uploadMockFn).toHaveBeenCalledWith(blob, blob.length, {
      blobHTTPHeaders: { blobContentType: "application/xml" },
      tags: {
        correlationId: "my-correlation-id",
        tag1: "value1",
        tag2: "value2",
      },
    });
  });

  test("should upload XML blob with max. 10 tags", async () => {
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
      },
      traceContext: {
        attributes: {
          atag1: "a value 1",
          correlationId: "my-correlation-id",
          tag1: "value 1",
          tag2: "value 2",
          tag3: "value 3",
          tag4: "value 4",
          tag5: "value 5",
          tag6: "value 6",
          tag7: "value 7",
          tag8: "value 8",
          tag9: "value 9",
          tag10: "value 10",
          tag11: "value 11",
          atag2: "a value 2",
        },
      },
    });
    const blob = "<xml>my-xml</xml>";
    const blobName = "my-blob-name.xml";

    // Invoke the method
    const containerClient = new MyContainerClient(context, "my-test");
    const actualBlobName = await containerClient.upload(blob, blobName);

    // Assert the blob name
    expect(actualBlobName).toBe(
      "topic=my-test/year=2001/month=02/day=03/mid=my-message-id/my-blob-name.xml",
    );
    expect(uploadMockFn).toHaveBeenCalledWith(blob, blob.length, {
      blobHTTPHeaders: { blobContentType: "application/xml" },
      tags: {
        atag1: "a value 1",
        correlationId: "my-correlation-id",
        tag1: "value 1",
        tag2: "value 2",
        tag3: "value 3",
        tag4: "value 4",
        tag5: "value 5",
        tag6: "value 6",
        tag7: "value 7",
        tag8: "value 8",
      },
    });
  });

  test("should log link to blob", async () => {
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
      },
    });
    const infoMock = jest.fn();
    context.info = infoMock;
    process.env.AZURE_SUBSCRIPTION_ID = "my-subscription-id";
    process.env.AZURE_RESOURCE_GROUP_NAME = "my-resource-group";
    process.env.MESSAGE_ARCHIVE_STORAGE_ACCOUNT_NAME = "my-storage-account";
    const blobName = "my-blob-name.txt";

    // Invoke the method
    const containerClient = new MyContainerClient(context, "link-test");
    const actualBlobName = await containerClient.upload(
      JSON.stringify({ ada: "lovelace" }),
      blobName,
    );

    expect(actualBlobName).toBe(
      `topic=link-test/year=2001/month=02/day=03/mid=my-message-id/${blobName}`,
    );
    const actualLink = containerClient.getBrowserLink(actualBlobName);
    expect(actualLink).toBe(
      "https://portal.azure.com/#view/Microsoft_Azure_Storage/BlobPropertiesBladeV2/storageAccountId/%2Fsubscriptions%2Fmy-subscription-id%2FresourceGroups%2Fmy-resource-group%2Fproviders%2FMicrosoft.Storage%2FstorageAccounts%2Fmy-storage-account/path/message-archive%2Ftopic%3Dlink-test%2Fyear%3D2001%2Fmonth%3D02%2Fday%3D03%2Fmid%3Dmy-message-id%2Fmy-blob-name.txt/isDeleted~/false/tabToload~/0",
    );
  });
});
