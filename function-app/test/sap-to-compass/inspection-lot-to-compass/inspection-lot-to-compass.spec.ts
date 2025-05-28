import { InvocationContext } from "@azure/functions";
import * as fs from "fs";
import { ContainerClient } from "@azure/storage-blob";
import { ServiceBusClient } from "@azure/service-bus";
import { initialiseConversionTable } from "../../../src/conversions/conversion-table";
import { handler } from "../../../src/functions/sap-to-compass/inspection-lot-to-compass";
import { createBlobNamePrefix } from "../../../src/message-archive-client";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

// Mock applicationinsights defaultClient methods
jest.mock("applicationinsights", () => ({
  defaultClient: {
    trackDependency: jest.fn(),
    trackRequest: jest.fn(),
    trackTrace: jest.fn(),
  },
}));
jest.mock("@azure/functions", () => ({
  ...(jest.requireActual("@azure/functions") as object),
  // Mock "app" to avoid registering the functions
  app: {
    serviceBusTopic: jest.fn(),
  },
}));
jest.mock("@azure/storage-blob");
jest.mock("@azure/service-bus");

const server = setupServer();

describe("inspection-lot-to-compass.feature", () => {
  const uploadMockFn = jest.fn();
  const sendMessagesMockFns = new Map<string, jest.Mock>();
  const originalProcessEnv = process.env;

  beforeAll(async () => {
    await initialiseConversionTable();
    server.listen({ onUnhandledRequest: "error" });
  });

  beforeEach(() => {
    (ContainerClient as jest.Mock).mockImplementation(() => ({
      getBlockBlobClient: () => ({
        upload: uploadMockFn,
      }),
    }));
    (ServiceBusClient as jest.Mock).mockImplementation(() => ({
      createSender: (queueOrTopicName: string) => {
        if (!sendMessagesMockFns.has(queueOrTopicName)) {
          sendMessagesMockFns.set(queueOrTopicName, jest.fn());
        }
        return {
          sendMessages: sendMessagesMockFns.get(queueOrTopicName),
        };
      },
    }));

    // Restore the original environment variables
    process.env = {
      ...originalProcessEnv,
      SAP_BASE_URL: "https://my-sap-url.wlgore.com",
      SAP_API_KEY: "my-sap-api-key",
    };
  });

  afterEach(() => {
    jest.clearAllMocks();

    // Reset sap api mocking
    server.resetHandlers();
  });

  afterAll(() => {
    jest.restoreAllMocks();
    server.close();

    // Restore original environment variables
    process.env = originalProcessEnv;
  });

  test("Inspection Lot event occurs in SAP", async () => {
    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
        correlationId: "my-correlation-id",
      },
    });
    const input = JSON.parse(readFile("input.json"));
    await handler(input, context);

    // Assert the incoming message was archived
    expect(uploadMockFn).toHaveBeenCalledWith(
      JSON.stringify(input),
      JSON.stringify(input).length,
      {
        blobHTTPHeaders: { blobContentType: "application/json" },
        tags: {
          batch: "0000004352",
          correlationId: "my-correlation-id",
          materialNumber: "VE0020GMC",
          mesMessageType: "ipdERPLotMasterUpdate",
          plant: "1015",
        },
      },
    );

    // Assert the XML for Compass file was archived
    const expected = readFile("expected.xml");
    expect(uploadMockFn).toHaveBeenCalledWith(expected, expected.length, {
      blobHTTPHeaders: { blobContentType: "application/xml" },
      tags: {
        batch: "0000004352",
        correlationId: "my-correlation-id",
        materialNumber: "VE0020GMC",
        mesMessageType: "ipdERPLotMasterUpdate",
        plant: "1015",
      },
    });

    // Assert the XML for Compass was sent to the Service Bus
    const sendMessagesMock = sendMessagesMockFns.get(
      "inventory-location-move-to-compass",
    );
    expect(sendMessagesMock).toHaveBeenCalledWith({
      body: {
        Plant: "B024",
        Batch: "0000004352",
        Filename: "IL-0000004352-B024-my-message-id.xml",
        UpdateXmlBlob: `${createBlobNamePrefix(context, "inspection-lot-to-compass")}/output.xml`,
      },
      contentType: "application/xml",
      correlationId: "my-correlation-id",
      sessionId: "0000004352",
    });
  });

  test("should skip messages if the input is invalid", async () => {
    // Prepare inputs
    const context = new InvocationContext({
      invocationId: "my-invocation-id",
      triggerMetadata: {
        messageId: "my-message-id",
      },
    });
    const input = "invalid input";

    // Invoke the handler and assert the error is thrown
    await handler(input, context);

    // Assert the incoming message was archived
    expect(uploadMockFn).toHaveBeenCalledWith(input, input.length, {
      blobHTTPHeaders: { blobContentType: "application/json" },
      tags: {
        batch: "undefined",
        correlationId: "my-invocation-id",
        materialNumber: "undefined",
        mesMessageType: "ipdERPLotMasterUpdate",
        plant: "undefined",
      },
    });

    // Assert no message was sent to Compass
    const sendMessagesMock = sendMessagesMockFns.get(
      "inventory-location-move-to-compass",
    );
    expect(sendMessagesMock).not.toHaveBeenCalled();
  });

  test("should throw an error if the container blob upload fails", async () => {
    // Prepare mocks
    const thrownError = new Error("Invalid input");
    uploadMockFn.mockRejectedValueOnce(thrownError);

    // Prepare inputs
    const context = new InvocationContext({
      triggerMetadata: { messageId: "my-message-id" },
    });

    // Invoke the handler and assert the error is thrown
    await expect(handler("invalid input", context)).rejects.toThrow(
      thrownError.message,
    );
  });

  test("Inspection Lot is sent to Compass1", async () => {
    process.env.ENABLE_SAP_TO_COMPASS1 = "true";

    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
        correlationId: "my-correlation-id",
      },
    });
    const input = JSON.parse(readFile("send-to-compass1-input.json"));
    await handler(input, context);

    // Assert the XML for Compass was sent to the Service Bus
    const sendMessagesCompass1Mock = sendMessagesMockFns.get(
      "inventory-location-move-to-compass1",
    );
    expect(sendMessagesCompass1Mock).toHaveBeenCalledWith({
      body: {
        Plant: "B041",
        Batch: "0000004352",
        Filename: "IL-0000004352-B041-my-message-id.xml",
        UpdateXmlBlob: `${createBlobNamePrefix(context, "inspection-lot-to-compass")}/output.xml`,
      },
      contentType: "application/xml",
      correlationId: "my-correlation-id",
      sessionId: "0000004352",
    });

    // Assert nothing was sent to Compass2
    const sendMessagesCompass2Mock = sendMessagesMockFns.get(
      "inventory-location-move-to-compass",
    );
    expect(sendMessagesCompass2Mock).not.toHaveBeenCalled();
  });

  test("Inspection Lot is not sent to Compass1 when Compass1 is disabled", async () => {
    process.env.ENABLE_SAP_TO_COMPASS1 = "false";

    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
        correlationId: "my-correlation-id",
      },
    });
    const input = JSON.parse(readFile("send-to-compass1-input.json"));
    await handler(input, context);

    // Assert nothing was sent to Compass1 and Compass2
    const sendMessagesCompass1Mock = sendMessagesMockFns.get(
      "inventory-location-move-to-compass1",
    );
    expect(sendMessagesCompass1Mock).not.toHaveBeenCalled();

    const sendMessagesCompass2Mock = sendMessagesMockFns.get(
      "inventory-location-move-to-compass",
    );
    expect(sendMessagesCompass2Mock).not.toHaveBeenCalled();
  });

  test("Inspection Lot is sent to Compass2", async () => {
    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
        correlationId: "my-correlation-id",
      },
    });
    const input = JSON.parse(readFile("send-to-compass2-input.json"));
    await handler(input, context);

    // Assert the XML for Compass was sent to the Service Bus
    const sendMessagesMock = sendMessagesMockFns.get(
      "inventory-location-move-to-compass",
    );
    expect(sendMessagesMock).toHaveBeenCalledWith({
      body: {
        Plant: "B024",
        Batch: "0000004352",
        Filename: "IL-0000004352-B024-my-message-id.xml",
        UpdateXmlBlob: `${createBlobNamePrefix(context, "inspection-lot-to-compass")}/output.xml`,
      },
      contentType: "application/xml",
      correlationId: "my-correlation-id",
      sessionId: "0000004352",
    });
  });

  test("should use fallback BatchBySupplier lot", async () => {
    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
        correlationId: "my-correlation-id",
      },
    });
    const input = JSON.parse(readFile("fallback-batchbysupplier-input.json"));
    await handler(input, context);

    // Assert the XML for Compass file was archived
    const expected = readFile("fallback-batchbysupplier-expected.xml");
    expect(uploadMockFn).toHaveBeenCalledWith(expected, expected.length, {
      blobHTTPHeaders: { blobContentType: "application/xml" },
      tags: {
        batch: "0000004352",
        correlationId: "my-correlation-id",
        materialNumber: "VE0020GMC",
        mesMessageType: "ipdERPLotMasterUpdate",
        plant: "1015",
      },
    });

    // Assert the XML for Compass was sent to the Service Bus
    const sendMessagesMock = sendMessagesMockFns.get(
      "inventory-location-move-to-compass",
    );
    expect(sendMessagesMock).toHaveBeenCalledWith({
      body: {
        Plant: "B024",
        Batch: "0000004352",
        Filename: "IL-0000004352-B024-my-message-id.xml",
        UpdateXmlBlob: `${createBlobNamePrefix(context, "inspection-lot-to-compass")}/output.xml`,
      },
      contentType: "application/xml",
      correlationId: "my-correlation-id",
      sessionId: "0000004352",
    });
  });

  test("should send 1017 (B005) Compass1", async () => {
    process.env.ENABLE_SAP_TO_COMPASS1 = "true";

    // Mocking the SAP API
    server.use(
      http.get(
        "https://my-sap-url.wlgore.com/classificationcharacteristic/v1/A_ClfnCharcDescForKeyDate",
        ({ request }) => {
          const url = new URL(request.url);

          // Return the response for the expected request
          if (
            url.searchParams.get("$filter") ===
            "CharcDescription eq 'MES_SYSTEM' and Language eq 'EN'"
          ) {
            return HttpResponse.json({
              d: { results: [{ CharcInternalID: "1337" }] },
            });
          }
          // Return an error if we received an unexpected request
          return HttpResponse.text(
            `Unexpected $filter: ${url.searchParams.get("$filter")}`,
            { status: 400 },
          );
        },
      ),
      http.get(
        "https://my-sap-url.wlgore.com/materialclassification/v1/A_ProductCharcValue",
        ({ request }) => {
          const url = new URL(request.url);

          // Return the response for the expected request
          if (
            url.searchParams.get("$filter") ===
            "Product eq 'VE0020GMC' and CharcInternalID eq '1337'"
          ) {
            return HttpResponse.json({
              d: { results: [{ CharcValue: "1017_COMPASS" }] },
            });
          }

          // Return an error if we received an unexpected request
          return HttpResponse.text(
            `Unexpected $filter: ${url.searchParams.get("$filter")}`,
            { status: 400 },
          );
        },
      ),
    );

    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
        correlationId: "my-correlation-id",
      },
    });
    const input = JSON.parse(readFile("1017-input.json"));
    await handler(input, context);

    // Assert the XML for Compass was sent to the Service Bus
    const sendMessagesCompass1Mock = sendMessagesMockFns.get(
      "inventory-location-move-to-compass1",
    );
    expect(sendMessagesCompass1Mock).toHaveBeenCalledWith({
      body: {
        Plant: "B005",
        Batch: "0000004352",
        Filename: "IL-0000004352-B005-my-message-id.xml",
        UpdateXmlBlob: `${createBlobNamePrefix(context, "inspection-lot-to-compass")}/output.xml`,
      },
      contentType: "application/xml",
      correlationId: "my-correlation-id",
      sessionId: "0000004352",
    });

    // Assert nothing was sent to Compass2
    const sendMessagesCompass2Mock = sendMessagesMockFns.get(
      "inventory-location-move-to-compass",
    );
    expect(sendMessagesCompass2Mock).not.toHaveBeenCalled();
  });

  test("should not send 1017 (B346) Compass1", async () => {
    process.env.ENABLE_SAP_TO_COMPASS1 = "true";

    // Mocking the SAP API
    server.use(
      http.get(
        "https://my-sap-url.wlgore.com/classificationcharacteristic/v1/A_ClfnCharcDescForKeyDate",
        ({ request }) => {
          const url = new URL(request.url);

          // Return the response for the expected request
          if (
            url.searchParams.get("$filter") ===
            "CharcDescription eq 'MES_SYSTEM' and Language eq 'EN'"
          ) {
            return HttpResponse.json({
              d: { results: [{ CharcInternalID: "1337" }] },
            });
          }
          // Return an error if we received an unexpected request
          return HttpResponse.text(
            `Unexpected $filter: ${url.searchParams.get("$filter")}`,
            { status: 400 },
          );
        },
      ),
      http.get(
        "https://my-sap-url.wlgore.com/materialclassification/v1/A_ProductCharcValue",
        ({ request }) => {
          const url = new URL(request.url);

          // Return the response for the expected request
          if (
            url.searchParams.get("$filter") ===
            "Product eq 'VE0020GMC' and CharcInternalID eq '1337'"
          ) {
            return HttpResponse.json({
              d: { results: [{ CharcValue: "1017_COMPASS" }] },
            });
          }

          // Return an error if we received an unexpected request
          return HttpResponse.text(
            `Unexpected $filter: ${url.searchParams.get("$filter")}`,
            { status: 400 },
          );
        },
      ),
    );

    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
        correlationId: "my-correlation-id",
      },
    });
    const input = JSON.parse(readFile("1017-input.json"));
    await handler(input, context);

    // Assert the XML for Compass was sent to the Service Bus
    const sendMessagesCompass1Mock = sendMessagesMockFns.get(
      "inventory-location-move-to-compass1",
    );
    expect(sendMessagesCompass1Mock).toHaveBeenCalledWith({
      body: {
        Plant: "B005",
        Batch: "0000004352",
        Filename: "IL-0000004352-B005-my-message-id.xml",
        UpdateXmlBlob: `${createBlobNamePrefix(context, "inspection-lot-to-compass")}/output.xml`,
      },
      contentType: "application/xml",
      correlationId: "my-correlation-id",
      sessionId: "0000004352",
    });

    // Assert nothing was sent to Compass2
    const sendMessagesCompass2Mock = sendMessagesMockFns.get(
      "inventory-location-move-to-compass",
    );
    expect(sendMessagesCompass2Mock).not.toHaveBeenCalled();
  });

  function readFile(name: string) {
    return fs.readFileSync(
      `test/sap-to-compass/inspection-lot-to-compass/${name}`,
      "utf8",
    );
  }
});
