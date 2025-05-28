import { jest, test } from "@jest/globals";
import { InvocationContext } from "@azure/functions";
import * as fs from "fs";
import { ContainerClient } from "@azure/storage-blob";
import { ServiceBusClient } from "@azure/service-bus";
import { handler } from "../../../src/functions/sap-to-compass/production-order-to-compass";
import { initialiseConversionTable } from "../../../src/conversions/conversion-table";
import { createBlobNamePrefix } from "../../../src/message-archive-client";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

jest.mock("@azure/functions", () => ({
  ...(jest.requireActual("@azure/functions") as object),
  // Mock "app" to avoid registering the functions
  app: {
    serviceBusTopic: jest.fn(),
  },
}));

// Mock applicationinsights defaultClient methods
jest.mock("applicationinsights", () => ({
  defaultClient: {
    trackDependency: jest.fn(),
    trackRequest: jest.fn(),
    trackTrace: jest.fn(),
  },
}));

jest.mock("@azure/storage-blob");
jest.mock("@azure/service-bus");

const server = setupServer();

describe("production-order-to-compass.feature", () => {
  const uploadMockFn = jest.fn<() => Promise<string>>();
  const sendMessagesMockFns = new Map<string, jest.Mock>([
    ["production-order-to-compass", jest.fn()],
    ["production-order-to-compass1", jest.fn()],
  ]);
  const originalProcessEnv = process.env;

  beforeAll(async () => {
    await initialiseConversionTable();
    server.listen({ onUnhandledRequest: "error" });
  });

  beforeEach(() => {
    (ContainerClient as jest.Mock).mockImplementation(() => ({
      getBlockBlobClient: jest.fn().mockImplementation(() => ({
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

  test("Production order event occurs in SAP", async () => {
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
          correlationId: "my-correlation-id",
          materialNumber: "MZ-FG-C900",
          mesMessageType:
            "ERPWOStart ERPWOChange ERPRouteStart ERPRouteChange ERPMatlListChange",
          plant: "1015",
          productionOrder: "1003981",
        },
      },
    );

    // Assert the XML for Compass file was archived
    const expectedBlobs = [
      "expected-create-production-order.xml",
      "expected-update-production-order.xml",
      "expected-create-production-order-operations.xml",
      "expected-update-production-order-operations.xml",
      "expected-update-production-order-components.xml",
    ];
    for (const expectedBlob of expectedBlobs) {
      const expectedBlobContent = readFile(expectedBlob);

      expect(uploadMockFn).toHaveBeenCalledWith(
        expectedBlobContent,
        expectedBlobContent.length,
        {
          blobHTTPHeaders: { blobContentType: "application/xml" },
          tags: {
            correlationId: "my-correlation-id",
            materialNumber: "MZ-FG-C900",
            mesMessageType:
              "ERPWOStart ERPWOChange ERPRouteStart ERPRouteChange ERPMatlListChange",
            plant: "1015",
            productionOrder: "1003981",
          },
        },
      );
    }

    // Assert the XML for Compass was sent to the Service Bus
    const blobNamePrefix = createBlobNamePrefix(
      context,
      "production-order-to-compass",
    );
    const sendMessagesMock = sendMessagesMockFns.get(
      "production-order-to-compass",
    );
    expect(sendMessagesMock).toHaveBeenCalledWith({
      body: {
        Plant: "B024",
        ProductionOrder: "1003981",
        ProductionOrderFilename: "WO-1003981-B024-my-message-id.xml",
        CreateProductionOrder: `${blobNamePrefix}/create-production-order.xml`,
        UpdateProductionOrder: `${blobNamePrefix}/update-production-order.xml`,
        ProductionOrderOperationsFilename:
          "WOO-1003981-B024-route-my-message-id.xml",
        CreateProductionOrderOperations: `${blobNamePrefix}/create-production-order-operations.xml`,
        UpdateProductionOrderOperations: `${blobNamePrefix}/update-production-order-operations.xml`,
        ProductionOrderComponentsFilename:
          "WOC-1003981-B024-components-my-message-id.xml",
        UpdateProductionOrderComponents: `${blobNamePrefix}/update-production-order-components.xml`,
      },
      contentType: "application/json",
      correlationId: "my-correlation-id",
      sessionId: "1003981",
    });
  });

  test("should skip messages if the input is invalid", async () => {
    // Prepare inputs
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
        correlationId: "my-correlation-id",
      },
    });
    const input = "invalid input";

    // Invoke the handler
    await handler(input, context);

    // Assert the incoming message was archived
    expect(uploadMockFn).toHaveBeenCalledWith(input, input.length, {
      blobHTTPHeaders: {
        blobContentType: "application/json",
      },
      tags: {
        correlationId: "my-correlation-id",
        materialNumber: "undefined",
        mesMessageType:
          "ERPWOStart ERPWOChange ERPRouteStart ERPRouteChange ERPMatlListChange",
        plant: "undefined",
        productionOrder: "undefined",
      },
    });

    // Assert no message was sent to Compass
    const sendMessagesMock = sendMessagesMockFns.get(
      "production-order-to-compass",
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
    const blobNamePrefix = createBlobNamePrefix(
      context,
      "production-order-to-compass",
    );
    const sendMessagesCompass1Mock = sendMessagesMockFns.get(
      "production-order-to-compass1",
    );
    expect(sendMessagesCompass1Mock).toHaveBeenCalledWith({
      body: {
        Plant: "B041",
        ProductionOrder: "1003981",
        ProductionOrderFilename: "WO-1003981-B041-my-message-id.xml",
        CreateProductionOrder: `${blobNamePrefix}/create-production-order.xml`,
        UpdateProductionOrder: `${blobNamePrefix}/update-production-order.xml`,
        ProductionOrderOperationsFilename:
          "WOO-1003981-B041-route-my-message-id.xml",
        CreateProductionOrderOperations: `${blobNamePrefix}/create-production-order-operations.xml`,
        UpdateProductionOrderOperations: `${blobNamePrefix}/update-production-order-operations.xml`,
        ProductionOrderComponentsFilename:
          "WOC-1003981-B041-components-my-message-id.xml",
        UpdateProductionOrderComponents: `${blobNamePrefix}/update-production-order-components.xml`,
      },
      contentType: "application/json",
      correlationId: "my-correlation-id",
      sessionId: "1003981",
    });

    // Assert the message was not sent to Compass2
    const sendMessagesCompass2Mock = sendMessagesMockFns.get(
      "production-order-to-compass",
    );
    expect(sendMessagesCompass2Mock).not.toHaveBeenCalled();
  });

  test("should not send to Compass1 when Compass1 is disabled", async () => {
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
      "production-order-to-compass1",
    );
    expect(sendMessagesCompass1Mock).not.toHaveBeenCalled();
    const sendMessagesCompass2Mock = sendMessagesMockFns.get(
      "production-order-to-compass",
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

    // Assert the message was not sent to Compass1
    const sendMessagesCompass1Mock = sendMessagesMockFns.get(
      "production-order-to-compass1",
    );
    expect(sendMessagesCompass1Mock).not.toHaveBeenCalled();

    // Assert the XML for Compass was sent to the Service Bus
    const blobNamePrefix = createBlobNamePrefix(
      context,
      "production-order-to-compass",
    );
    const sendMessagesCompass2Mock = sendMessagesMockFns.get(
      "production-order-to-compass",
    );
    expect(sendMessagesCompass2Mock).toHaveBeenCalledWith({
      body: {
        Plant: "B024",
        ProductionOrder: "1003981",
        ProductionOrderFilename: "WO-1003981-B024-my-message-id.xml",
        CreateProductionOrder: `${blobNamePrefix}/create-production-order.xml`,
        UpdateProductionOrder: `${blobNamePrefix}/update-production-order.xml`,
        ProductionOrderOperationsFilename:
          "WOO-1003981-B024-route-my-message-id.xml",
        CreateProductionOrderOperations: `${blobNamePrefix}/create-production-order-operations.xml`,
        UpdateProductionOrderOperations: `${blobNamePrefix}/update-production-order-operations.xml`,
        ProductionOrderComponentsFilename:
          "WOC-1003981-B024-components-my-message-id.xml",
        UpdateProductionOrderComponents: `${blobNamePrefix}/update-production-order-components.xml`,
      },
      contentType: "application/json",
      correlationId: "my-correlation-id",
      sessionId: "1003981",
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
            "Product eq 'MZ-FG-C900' and CharcInternalID eq '1337'"
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
    const inputMessage = JSON.parse(readFile("1017-input.json"));
    await handler(inputMessage, context);

    // Assert the message for Compass was sent to the Service Bus
    const blobNamePrefix = createBlobNamePrefix(
      context,
      "production-order-to-compass",
    );
    const sendMessagesCompass1Mock = sendMessagesMockFns.get(
      "production-order-to-compass1",
    );
    expect(sendMessagesCompass1Mock).toHaveBeenCalledWith({
      body: {
        Plant: "B005",
        ProductionOrder: "1003981",
        ProductionOrderFilename: "WO-1003981-B005-my-message-id.xml",
        CreateProductionOrder: `${blobNamePrefix}/create-production-order.xml`,
        UpdateProductionOrder: `${blobNamePrefix}/update-production-order.xml`,
        ProductionOrderOperationsFilename:
          "WOO-1003981-B005-route-my-message-id.xml",
        CreateProductionOrderOperations: `${blobNamePrefix}/create-production-order-operations.xml`,
        UpdateProductionOrderOperations: `${blobNamePrefix}/update-production-order-operations.xml`,
        ProductionOrderComponentsFilename:
          "WOC-1003981-B005-components-my-message-id.xml",
        UpdateProductionOrderComponents: `${blobNamePrefix}/update-production-order-components.xml`,
      },
      contentType: "application/json",
      correlationId: "my-correlation-id",
      sessionId: "1003981",
    });

    // Assert nothing was sent to Compass2
    const sendMessagesCompass2Mock = sendMessagesMockFns.get(
      "production-order-to-compass",
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
            "Product eq 'MZ-FG-C900' and CharcInternalID eq '1337'"
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
    const inputMessage = JSON.parse(readFile("1017-input.json"));
    await handler(inputMessage, context);

    // Assert nothing was sent to Compass
    const sendMessagesCompass1Mock = sendMessagesMockFns.get(
      "production-order-to-compass1",
    );
    expect(sendMessagesCompass1Mock).not.toHaveBeenCalled();
    const sendMessagesCompass2Mock = sendMessagesMockFns.get(
      "production-order-to-compass",
    );
    expect(sendMessagesCompass2Mock).not.toHaveBeenCalled();
  });

  test("should not send alternative sequence operations", async () => {
    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
        correlationId: "my-correlation-id",
      },
    });
    const input = JSON.parse(
      readFile("should-not-send-alternative-sequence-operations/input.json"),
    );
    await handler(input, context);

    // Assert the XML for Compass file was archived
    const expectedBlobs = [
      "should-not-send-alternative-sequence-operations/expected-create-production-order-operations.xml",
      "should-not-send-alternative-sequence-operations/expected-update-production-order-operations.xml",
    ];
    for (const expectedBlob of expectedBlobs) {
      const expectedBlobContent = readFile(expectedBlob);

      expect(uploadMockFn).toHaveBeenCalledWith(
        expectedBlobContent,
        expectedBlobContent.length,
        {
          blobHTTPHeaders: { blobContentType: "application/xml" },
          tags: {
            correlationId: "my-correlation-id",
            materialNumber: "MZ-FG-C900",
            mesMessageType:
              "ERPWOStart ERPWOChange ERPRouteStart ERPRouteChange ERPMatlListChange",
            plant: "1015",
            productionOrder: "1003981",
          },
        },
      );
    }

    // Assert the XML for Compass was sent to the Service Bus
    const blobNamePrefix = createBlobNamePrefix(
      context,
      "production-order-to-compass",
    );
    const sendMessagesMock = sendMessagesMockFns.get(
      "production-order-to-compass",
    );
    expect(sendMessagesMock).toHaveBeenCalledWith({
      body: {
        Plant: "B024",
        ProductionOrder: "1003981",
        ProductionOrderFilename: "WO-1003981-B024-my-message-id.xml",
        CreateProductionOrder: `${blobNamePrefix}/create-production-order.xml`,
        UpdateProductionOrder: `${blobNamePrefix}/update-production-order.xml`,
        ProductionOrderOperationsFilename:
          "WOO-1003981-B024-route-my-message-id.xml",
        CreateProductionOrderOperations: `${blobNamePrefix}/create-production-order-operations.xml`,
        UpdateProductionOrderOperations: `${blobNamePrefix}/update-production-order-operations.xml`,
        ProductionOrderComponentsFilename:
          "WOC-1003981-B024-components-my-message-id.xml",
        UpdateProductionOrderComponents: `${blobNamePrefix}/update-production-order-components.xml`,
      },
      contentType: "application/json",
      correlationId: "my-correlation-id",
      sessionId: "1003981",
    });
  });

  function readFile(name: string) {
    return fs.readFileSync(
      `test/sap-to-compass/production-order-to-compass/${name}`,
      "utf8",
    );
  }
});
