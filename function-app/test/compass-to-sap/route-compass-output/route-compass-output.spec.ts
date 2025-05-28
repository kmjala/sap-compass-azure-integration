import { jest, test } from "@jest/globals";
import { InvocationContext } from "@azure/functions";
import * as fs from "fs";
import { ContainerClient } from "@azure/storage-blob";
import { ServiceBusClient } from "@azure/service-bus";
import { handler } from "../../../src/functions/compass-to-sap/route-compass-output";
import { createBlobNamePrefix } from "../../../src/message-archive-client";

jest.mock("@azure/functions", () => ({
  ...(jest.requireActual("@azure/functions") as object),
  // Mock "app" to avoid registering the functions
  app: {
    serviceBusTopic: jest.fn(),
  },
}));
jest.mock("@azure/storage-blob");
jest.mock("@azure/service-bus");

describe("route-compass-output", () => {
  const uploadMockFn = jest.fn<() => Promise<string>>();
  const sendMessagesSuperBackFlushMockFn = jest.fn();
  const sendMessagesWorkOderIssuesMockFn = jest.fn();
  const transactionManagerStatusUpdateMockFn = jest.fn();

  beforeEach(() => {
    (ContainerClient as jest.Mock).mockImplementation(() => ({
      getBlockBlobClient: jest.fn().mockImplementation(() => ({
        upload: uploadMockFn,
      })),
    }));
    (ServiceBusClient as jest.Mock).mockImplementation(() => ({
      createSender: (queueOrTopicName: string) => {
        if (queueOrTopicName.startsWith("superbackflush-from-compass")) {
          return {
            sendMessages: sendMessagesSuperBackFlushMockFn,
          };
        } else if (
          queueOrTopicName.startsWith("workorderissues-from-compass")
        ) {
          return {
            sendMessages: sendMessagesWorkOderIssuesMockFn,
          };
        } else if (
          queueOrTopicName.startsWith("transaction-manager-status-updates")
        ) {
          return {
            sendMessages: transactionManagerStatusUpdateMockFn,
          };
        }
        throw new Error(`Unexpected queue or topic name: ${queueOrTopicName}`);
      },
    }));

    jest.useFakeTimers().setSystemTime(new Date(981173106789));
    process.env.SAP_BASE_URL = "https://my-sap-url.wlgore.com";
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();

    // Shouldn't be set while executing the tests anyway, so no need
    // to restore the original value but just unset them.
    process.env.SAP_BASE_URL = undefined;
  });

  test("should route SuperBackFlush", async () => {
    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
      },
      invocationId: "my-invocation-id",
    });
    const input = readFile("SuperBackFlush-input.xml");
    await handler(input, context);

    // Assert the incoming message was archived
    expect(uploadMockFn).toHaveBeenCalledWith(input, input.length, {
      blobHTTPHeaders: { blobContentType: "application/xml" },
      tags: { correlationId: "my-invocation-id" },
    });

    // Assert the message was routed
    expect(sendMessagesSuperBackFlushMockFn).toHaveBeenCalledWith({
      body: input,
      contentType: "application/xml",
      correlationId: "my-invocation-id",
      sessionId: "3074005",
    });

    // Assert the status were always logged
    const expected =
      '<?xml version="1.0" encoding="utf-8"?><Request>    <FileGuiId>SuperBackFlush-input.xml-guid</FileGuiId>    <AppName>MES-Azure-Client</AppName>    <Status>1</Status>    <StatusMessage>XML file is being processed in Azure</StatusMessage></Request>';
    expect(transactionManagerStatusUpdateMockFn).toHaveBeenCalledWith({
      body: Buffer.from(expected),
      contentType: "application/xml",
      sessionId: "SuperBackFlush-input.xml-guid",
      correlationId: "my-invocation-id",
    });
  });

  test("should route SuperBackFlush (multiple transactions)", async () => {
    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
      },
      invocationId: "my-invocation-id",
    });
    const input = readFile("multiple-SuperBackFlush-input.xml");
    await handler(input, context);

    // Assert the incoming message was archived
    expect(uploadMockFn).toHaveBeenCalledWith(input, input.length, {
      blobHTTPHeaders: { blobContentType: "application/xml" },
      tags: { correlationId: "my-invocation-id" },
    });

    // Assert the message was routed
    expect(sendMessagesSuperBackFlushMockFn).toHaveBeenCalledWith({
      body: input,
      contentType: "application/xml",
      correlationId: "my-invocation-id",
      sessionId: "3074005",
    });

    // Assert the status were always logged
    const expected =
      '<?xml version="1.0" encoding="utf-8"?><Request>    <FileGuiId>multiple-SuperBackFlush-input.xml-guid</FileGuiId>    <AppName>MES-Azure-Client</AppName>    <Status>1</Status>    <StatusMessage>XML file is being processed in Azure</StatusMessage></Request>';
    expect(transactionManagerStatusUpdateMockFn).toHaveBeenCalledWith({
      body: Buffer.from(expected),
      contentType: "application/xml",
      sessionId: "multiple-SuperBackFlush-input.xml-guid",
      correlationId: "my-invocation-id",
    });
  });

  test("should drop messages that are not XML", async () => {
    // Prepare inputs
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
      },
      invocationId: "my-invocation-id",
    });
    const input = "invalid input";

    // Invoke the handler
    await handler(input, context);

    // Assert the incoming message was archived
    expect(uploadMockFn).toHaveBeenCalledWith(input, input.length, {
      blobHTTPHeaders: { blobContentType: "application/xml" },
      tags: { correlationId: "my-invocation-id" },
    });

    expect(transactionManagerStatusUpdateMockFn).toHaveBeenCalledTimes(0);
  });

  test("should throw an error if the message type is unknown", async () => {
    // Prepare inputs
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
      },
      invocationId: "my-invocation-id",
    });
    const input = readFile("unknown-messagetype-input.xml");

    // Invoke the handler and assert the error is thrown
    createBlobNamePrefix(context, "route-compass-output");
    await handler(input, context);

    // Assert the incoming message was archived
    expect(uploadMockFn).toHaveBeenCalledWith(input, input.length, {
      blobHTTPHeaders: { blobContentType: "application/xml" },
      tags: { correlationId: "my-invocation-id" },
    });

    // Assert the status were always logged
    const expectedMesAzureClientStatus =
      '<?xml version="1.0" encoding="utf-8"?><Request>    <FileGuiId>unknown-messagetype-input.xml-guid</FileGuiId>    <AppName>MES-Azure-Client</AppName>    <Status>1</Status>    <StatusMessage>XML file is being processed in Azure</StatusMessage></Request>';
    expect(transactionManagerStatusUpdateMockFn).toHaveBeenCalledWith({
      body: Buffer.from(expectedMesAzureClientStatus),
      contentType: "application/xml",
      sessionId: "unknown-messagetype-input.xml-guid",
      correlationId: "my-invocation-id",
    });
    const expectedAzureStatus =
      '<?xml version="1.0" encoding="utf-8"?><Request>    <FileGuiId>unknown-messagetype-input.xml-guid</FileGuiId>    <AppName>Azure</AppName>    <Status>0</Status>    <StatusMessage>Unable to identify the message type "unknown message type"</StatusMessage></Request>';
    expect(transactionManagerStatusUpdateMockFn).toHaveBeenCalledWith({
      body: Buffer.from(expectedAzureStatus),
      contentType: "application/xml",
      sessionId: "unknown-messagetype-input.xml-guid",
      correlationId: "my-invocation-id",
    });
  });

  test("should throw an error if the container blob upload fails", async () => {
    // Prepare mocks
    const thrownError = new Error("Upload failed");
    uploadMockFn.mockRejectedValueOnce(thrownError);

    // Prepare inputs
    const context = new InvocationContext({
      triggerMetadata: { messageId: "my-message-id" },
    });

    // Invoke the handler and assert the error is thrown
    await expect(handler("<some><xml/></some>", context)).rejects.toThrow(
      thrownError.message,
    );
  });

  test("should route WorkOrderIssues", async () => {
    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
      },
      invocationId: "my-invocation-id",
    });
    const input = readFile("WorkOrderIssues-input.xml");
    await handler(input, context);

    // Assert the incoming message was archived
    expect(uploadMockFn).toHaveBeenCalledWith(input, input.length, {
      blobHTTPHeaders: { blobContentType: "application/xml" },
      tags: { correlationId: "my-invocation-id" },
    });

    // Assert the message was routed
    expect(sendMessagesWorkOderIssuesMockFn).toHaveBeenCalledWith({
      body: input,
      contentType: "application/xml",
      correlationId: "my-invocation-id",
      sessionId: "1030483",
    });

    // Assert the status were always logged
    const expected =
      '<?xml version="1.0" encoding="utf-8"?><Request>    <FileGuiId>WorkOrderIssues-input.xml-guid</FileGuiId>    <AppName>MES-Azure-Client</AppName>    <Status>1</Status>    <StatusMessage>XML file is being processed in Azure</StatusMessage></Request>';
    expect(transactionManagerStatusUpdateMockFn).toHaveBeenCalledWith({
      body: Buffer.from(expected),
      contentType: "application/xml",
      sessionId: "WorkOrderIssues-input.xml-guid",
      correlationId: "my-invocation-id",
    });
  });

  function readFile(name: string) {
    return fs.readFileSync(
      `test/compass-to-sap/route-compass-output/${name}`,
      "utf8",
    );
  }
});
