import { InvocationContext } from "@azure/functions";
import * as fs from "fs";
import { ContainerClient } from "@azure/storage-blob";
import { ServiceBusClient } from "@azure/service-bus";
import { handler } from "../../../src/functions/sap-to-compass/inventory-location-move-to-compass";
import { initialiseConversionTable } from "../../../src/conversions/conversion-table";
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

describe("inventory-location-move-to-compass.feature", () => {
  const uploadMockFn = jest.fn();
  const sendMessagesMockFns = new Map<string, jest.Mock>([
    ["inventory-location-move-to-compass", jest.fn()],
    ["inventory-location-move-to-compass1", jest.fn()],
  ]);
  const originalProcessEnv = process.env;

  beforeAll(async () => {
    await initialiseConversionTable();
    server.listen({ onUnhandledRequest: "error" });
  });

  beforeEach(() => {
    (ContainerClient as jest.Mock).mockImplementation(() => ({
      getBlockBlobClient: jest.fn(() => ({
        upload: uploadMockFn,
      })),
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

  test("Inventory Location Move event occurs in SAP - F2 status + Unrestricted", async () => {
    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
        correlationId: "my-correlation-id",
      },
    });
    const input = JSON.parse(readFile("input-f2-unrestricted.json"));
    await handler(input, context);

    // Assert the incoming message was archived
    expect(uploadMockFn).toHaveBeenCalledWith(
      JSON.stringify(input),
      JSON.stringify(input).length,
      {
        blobHTTPHeaders: { blobContentType: "application/json" },
        tags: {
          batch: "0000004083",
          correlationId: "my-correlation-id",
          location: "DCAXLEVENT-01",
          materialNumber: "TP10935-17.15",
          mesMessageType: "ipdERPLotMasterUpdate",
          plant: "1015",
        },
      },
    );

    // Assert the XML for Compass file was archived
    const expected = readFile("expected-f2-unrestricted.xml");
    expect(uploadMockFn).toHaveBeenCalledWith(expected, expected.length, {
      blobHTTPHeaders: { blobContentType: "application/xml" },
      tags: {
        batch: "0000004083",
        correlationId: "my-correlation-id",
        location: "DCAXLEVENT-01",
        materialNumber: "TP10935-17.15",
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
        Batch: "0000004083",
        Filename: "IM-0000004083-my-message-id.xml",
        UpdateXmlBlob: `${createBlobNamePrefix(context, "inventory-location-move-to-compass")}/update.xml`,
      },
      contentType: "application/xml",
      correlationId: "my-correlation-id",
      sessionId: "0000004083",
    });
  });

  test("Inventory Location Move event occurs in SAP - F2 status + Restricted", async () => {
    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
        correlationId: "my-correlation-id",
      },
    });
    const input = JSON.parse(readFile("input-f2-restricted.json"));
    await handler(input, context);

    // Assert the incoming message was archived
    expect(uploadMockFn).toHaveBeenCalledWith(
      JSON.stringify(input),
      JSON.stringify(input).length,
      {
        blobHTTPHeaders: { blobContentType: "application/json" },
        tags: {
          batch: "0000004083",
          correlationId: "my-correlation-id",
          location: "DCAXLEVENT-01",
          materialNumber: "TP10935-17.15",
          mesMessageType: "ipdERPLotMasterUpdate",
          plant: "1015",
        },
      },
    );

    // Assert the XML for Compass file was archived
    const expected = readFile("expected-f2-restricted.xml");
    expect(uploadMockFn).toHaveBeenCalledWith(expected, expected.length, {
      blobHTTPHeaders: { blobContentType: "application/xml" },
      tags: {
        batch: "0000004083",
        correlationId: "my-correlation-id",
        location: "DCAXLEVENT-01",
        materialNumber: "TP10935-17.15",
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
        Batch: "0000004083",
        Filename: "IM-0000004083-my-message-id.xml",
        UpdateXmlBlob: `${createBlobNamePrefix(context, "inventory-location-move-to-compass")}/update.xml`,
      },
      contentType: "application/xml",
      correlationId: "my-correlation-id",
      sessionId: "0000004083",
    });
  });

  test("Inventory Location Move event occurs in SAP - B6 status", async () => {
    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
        correlationId: "my-correlation-id",
      },
    });
    const input = JSON.parse(readFile("input-b6.json"));
    await handler(input, context);

    // Assert the incoming message was archived
    expect(uploadMockFn).toHaveBeenCalledWith(
      JSON.stringify(input),
      JSON.stringify(input).length,
      {
        blobHTTPHeaders: { blobContentType: "application/json" },
        tags: {
          batch: "0000004083",
          correlationId: "my-correlation-id",
          location: "DCAXLEVENT-01",
          materialNumber: "TP10935-17.15",
          mesMessageType: "ipdERPLotMasterUpdate",
          plant: "1015",
        },
      },
    );

    // Assert the XML for Compass file was archived
    const expected = readFile("expected-b6.xml");
    expect(uploadMockFn).toHaveBeenCalledWith(expected, expected.length, {
      blobHTTPHeaders: { blobContentType: "application/xml" },
      tags: {
        batch: "0000004083",
        correlationId: "my-correlation-id",
        location: "DCAXLEVENT-01",
        materialNumber: "TP10935-17.15",
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
        Batch: "0000004083",
        Filename: "IM-0000004083-my-message-id.xml",
        UpdateXmlBlob: `${createBlobNamePrefix(context, "inventory-location-move-to-compass")}/update.xml`,
      },
      contentType: "application/xml",
      correlationId: "my-correlation-id",
      sessionId: "0000004083",
    });
  });

  test("Inventory Location Move event occurs in SAP - Q4 status", async () => {
    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
        correlationId: "my-correlation-id",
      },
    });
    const input = JSON.parse(readFile("input-q4.json"));
    await handler(input, context);

    // Assert the incoming message was archived
    expect(uploadMockFn).toHaveBeenCalledWith(
      JSON.stringify(input),
      JSON.stringify(input).length,
      {
        blobHTTPHeaders: { blobContentType: "application/json" },
        tags: {
          batch: "0000004083",
          correlationId: "my-correlation-id",
          location: "DCAXLEVENT-01",
          materialNumber: "TP10935-17.15",
          mesMessageType: "ipdERPLotMasterUpdate",
          plant: "1015",
        },
      },
    );

    // Assert the XML for Compass file was archived
    const expected = readFile("expected-q4.xml");
    expect(uploadMockFn).toHaveBeenCalledWith(expected, expected.length, {
      blobHTTPHeaders: { blobContentType: "application/xml" },
      tags: {
        batch: "0000004083",
        correlationId: "my-correlation-id",
        location: "DCAXLEVENT-01",
        materialNumber: "TP10935-17.15",
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
        Batch: "0000004083",
        Filename: "IM-0000004083-my-message-id.xml",
        UpdateXmlBlob: `${createBlobNamePrefix(context, "inventory-location-move-to-compass")}/update.xml`,
      },
      contentType: "application/xml",
      correlationId: "my-correlation-id",
      sessionId: "0000004083",
    });
  });

  test("should ignore materials that are not MES relevant", async () => {
    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
        correlationId: "my-correlation-id",
      },
    });
    const input = readJson("not-mes-relevant-input.json");
    await handler(input, context);

    // Assert the incoming message was archived
    expect(uploadMockFn).toHaveBeenCalledWith(
      JSON.stringify(input),
      JSON.stringify(input).length,
      {
        blobHTTPHeaders: { blobContentType: "application/json" },
        tags: {
          batch: "0000004083",
          correlationId: "my-correlation-id",
          location: "DCAXLEVENT-01",
          materialNumber: "TP10935-17.15",
          mesMessageType: "ipdERPLotMasterUpdate",
          plant: "1015",
        },
      },
    );

    const sendMessagesMock = sendMessagesMockFns.get(
      "inventory-location-move-to-compass",
    );
    expect(sendMessagesMock).not.toHaveBeenCalled();
  });

  /**
   * Additional test to ignore messages without the classification that
   * indicates that they are MES relevant
   */
  test("should ignore materials without product class characteristics", async () => {
    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
        correlationId: "my-correlation-id",
      },
    });
    const input = readJson("no-product-class-characteristics-input.json");
    await handler(input, context);

    // Assert the incoming message was archived
    expect(uploadMockFn).toHaveBeenCalledWith(
      JSON.stringify(input),
      JSON.stringify(input).length,
      {
        blobHTTPHeaders: { blobContentType: "application/json" },
        tags: {
          batch: "0000004083",
          correlationId: "my-correlation-id",
          location: "DCAXLEVENT-01",
          materialNumber: "TP10935-17.15",
          mesMessageType: "ipdERPLotMasterUpdate",
          plant: "1015",
        },
      },
    );

    const sendMessagesMock = sendMessagesMockFns.get(
      "inventory-location-move-to-compass",
    );
    expect(sendMessagesMock).not.toHaveBeenCalled();
  });

  test("should ignore message with invalid input", async () => {
    // Prepare inputs
    const context = new InvocationContext({
      invocationId: "my-invocation-id",
      triggerMetadata: { messageId: "my-message-id" },
    });
    const input = "invalid input";

    // Invoke the handler and assert the error is thrown
    await expect(handler(input, context)).rejects.toThrow();

    // Assert the incoming message was archived
    expect(uploadMockFn).toHaveBeenCalledWith(input, input.length, {
      blobHTTPHeaders: { blobContentType: "application/json" },
      tags: {
        batch: "undefined",
        correlationId: "my-invocation-id",
        location: "undefined",
        materialNumber: "undefined",
        mesMessageType: "ipdERPLotMasterUpdate",
        plant: "undefined",
      },
    });

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

  test.each([
    "no-batch-input.json",
    "no-batch-null-input.json",
    "no-batch-empty-string-input.json",
  ])("should ignore messages without batch", async (inputFile) => {
    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
        correlationId: "my-correlation-id",
      },
    });
    const input = readJson(inputFile);
    await handler(input, context);

    // Assert the incoming message was archived
    expect(uploadMockFn).toHaveBeenCalledWith(
      JSON.stringify(input),
      JSON.stringify(input).length,
      {
        blobHTTPHeaders: { blobContentType: "application/json" },
        tags: {
          batch: "undefined",
          correlationId: "my-correlation-id",
          location: "DCAXLEVENT-01",
          materialNumber: "TP10935-17.15",
          mesMessageType: "ipdERPLotMasterUpdate",
          plant: "1015",
        },
      },
    );

    const sendMessagesMock = sendMessagesMockFns.get(
      "inventory-location-move-to-compass",
    );
    expect(sendMessagesMock).not.toHaveBeenCalled();
  });

  test("should send to Compass1", async () => {
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
    const sendMessagesMock = sendMessagesMockFns.get(
      "inventory-location-move-to-compass1",
    );
    expect(sendMessagesMock).toHaveBeenCalledWith({
      body: {
        Plant: "B041",
        Batch: "0000004083",
        Filename: "IM-0000004083-my-message-id.xml",
        UpdateXmlBlob: `${createBlobNamePrefix(context, "inventory-location-move-to-compass")}/update.xml`,
      },
      contentType: "application/xml",
      correlationId: "my-correlation-id",
      sessionId: "0000004083",
    });
  });

  test("should send not to Compass1 when Compass1 is disabled", async () => {
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

    // Assert nothing was sent to Compass
    const sendMessagesCompass1Mock = sendMessagesMockFns.get(
      "inventory-location-move-to-compass1",
    );
    expect(sendMessagesCompass1Mock).not.toHaveBeenCalled();
    const sendMessagesCompass2Mock = sendMessagesMockFns.get(
      "inventory-location-move-to-compass",
    );
    expect(sendMessagesCompass2Mock).not.toHaveBeenCalled();
  });

  test("should send to Compass2", async () => {
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
        Batch: "0000004083",
        Filename: "IM-0000004083-my-message-id.xml",
        UpdateXmlBlob: `${createBlobNamePrefix(context, "inventory-location-move-to-compass")}/update.xml`,
      },
      contentType: "application/xml",
      correlationId: "my-correlation-id",
      sessionId: "0000004083",
    });
  });

  test("should send 1017 (B005) to Compass", async () => {
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
          return HttpResponse.text(`Unexpected request: ${request.url}`, {
            status: 400,
          });
        },
      ),
      http.get(
        "https://my-sap-url.wlgore.com/materialclassification/v1/A_ProductCharcValue",
        ({ request }) => {
          const url = new URL(request.url);

          // Return the response for the expected request
          if (
            url.searchParams.get("$filter") ===
            "Product eq 'TP10935-17.15' and CharcInternalID eq '1337'"
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
    const sendMessagesMock = sendMessagesMockFns.get(
      "inventory-location-move-to-compass1",
    );
    expect(sendMessagesMock).toHaveBeenCalledWith({
      body: {
        Plant: "B005",
        Batch: "0000004083",
        Filename: "IM-0000004083-my-message-id.xml",
        UpdateXmlBlob: `${createBlobNamePrefix(context, "inventory-location-move-to-compass")}/update.xml`,
      },
      contentType: "application/xml",
      correlationId: "my-correlation-id",
      sessionId: "0000004083",
    });

    // Assert nothing was sent to Compass2
    const sendMessagesCompass2Mock = sendMessagesMockFns.get(
      "inventory-location-move-to-compass",
    );
    expect(sendMessagesCompass2Mock).not.toHaveBeenCalled();
  });

  test("should not send 1017 (B346) to Compass", async () => {
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
          return HttpResponse.text(`Unexpected request: ${request.url}`, {
            status: 400,
          });
        },
      ),
      http.get(
        "https://my-sap-url.wlgore.com/materialclassification/v1/A_ProductCharcValue",
        ({ request }) => {
          const url = new URL(request.url);

          // Return the response for the expected request
          if (
            url.searchParams.get("$filter") ===
            "Product eq 'TP10935-17.15' and CharcInternalID eq '1337'"
          ) {
            return HttpResponse.json({
              d: { results: [{ CharcValue: "1017 MES" }] },
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

    // Assert nothing was sent to Compass
    const sendMessagesMock = sendMessagesMockFns.get(
      "inventory-location-move-to-compass1",
    );
    expect(sendMessagesMock).not.toHaveBeenCalled();
    const sendMessagesCompass2Mock = sendMessagesMockFns.get(
      "inventory-location-move-to-compass",
    );
    expect(sendMessagesCompass2Mock).not.toHaveBeenCalled();
  });

  function readFile(name: string) {
    return fs.readFileSync(
      `test/sap-to-compass/inventory-location-move-to-compass/${name}`,
      "utf8",
    );
  }

  function readJson(name: string) {
    return JSON.parse(readFile(name));
  }
});
