import * as fs from "fs";
import { jest, test } from "@jest/globals";
import { InvocationContext } from "@azure/functions";
import { ContainerClient } from "@azure/storage-blob";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { initialiseConversionTable } from "../../../src/conversions/conversion-table";
import { ServiceBusClient } from "@azure/service-bus";

jest.mock("@azure/functions", () => ({
  ...(jest.requireActual("@azure/functions") as object),
  // Mock "app" to avoid registering the functions
  app: {
    serviceBusTopic: jest.fn(),
  },
}));
jest.mock("@azure/storage-blob");
jest.mock("@azure/service-bus");
// Mock applicationinsights defaultClient methods
jest.mock("applicationinsights", () => ({
  defaultClient: {
    trackDependency: jest.fn(),
    trackRequest: jest.fn(),
    trackTrace: jest.fn(),
  },
}));

const server = setupServer();

describe("components-goods-issues-to-sap.feature", () => {
  const uploadMockFn = jest.fn<() => Promise<string>>();
  const transactionManagerStatusUpdateMockFn = jest.fn();
  let context: InvocationContext;
  const originalProcessEnv = process.env;

  beforeAll(async () => {
    server.listen({ onUnhandledRequest: "error" });
    await initialiseConversionTable();
    jest.useFakeTimers().setSystemTime(new Date("2001-02-03T04:05:06.789"));
  });

  beforeEach(async () => {
    (ContainerClient as jest.Mock).mockImplementation(() => ({
      getBlockBlobClient: jest.fn().mockImplementation(() => ({
        upload: uploadMockFn,
      })),
    }));
    (ServiceBusClient as jest.Mock).mockImplementation(() => ({
      createSender: (queueOrTopicName: string) => {
        if (queueOrTopicName.startsWith("transaction-manager-status-updates")) {
          return {
            sendMessages: transactionManagerStatusUpdateMockFn,
          };
        }
        throw new Error(`Unexpected queue or topic name: ${queueOrTopicName}`);
      },
    }));

    // Create a fresh context for each test
    context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
        correlationId: "my-correlation-id",
      },
    });

    // Restore the original environment variables
    process.env = {
      ...originalProcessEnv,
      SAP_BASE_URL: "https://my-sap-url.wlgore.com",
      SAP_API_KEY: "my-sap-api-key",
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    // Reset sap api mocking
    server.resetHandlers();
  });

  afterAll(() => {
    jest.useRealTimers();
    server.close();

    // Restore original environment variables
    process.env = originalProcessEnv;
  });

  test("Components goods issues event occurs in Compass", async () => {
    // import fetch-retry after msw server.listen so it wraps the correct fetch implementation
    const { default: createFetchRetry } = await import("fetch-retry");
    global.fetch = createFetchRetry(global.fetch);

    // import function handler after fetch is mocked and wrapped
    const { handler } = await import(
      "../../../src/functions/compass-to-sap/components-goods-issues-to-sap"
    );

    // Read expected SAP API response for the GET request
    const expectedGetSapBody = readFile(
      "production-order-components-1004143.json",
    );
    const expectedSapRespBody = { status: "success" };
    let apiRequest: Request | undefined;

    // Mocking the SAP API
    server.use(
      // Intercept GET request for the SAP API
      http.get(
        /https:\/\/my-sap-url\.wlgore\.com\/productionorder\/v1\/A_ProductionOrder_2\('\d+'\)\/to_ProductionOrderComponent/,
        ({ request }) => {
          // store the request for later assertions
          apiRequest = request.clone();
          return HttpResponse.text(expectedGetSapBody);
        },
      ),
      // Intercept Production Order Confirmation POST request for the SAP API
      http.post(
        "https://my-sap-url.wlgore.com/prodorderconf/v1/ProdnOrdConf2",
        ({ request }) => {
          apiRequest = request.clone();
          return HttpResponse.json(expectedSapRespBody, { status: 200 });
        },
      ),
    );

    // Invoke the handler
    const input = readFile("input.xml");
    await handler(input, context);

    // Assert Request Headers
    expect(apiRequest?.headers.get("APIKey")).toBe("my-sap-api-key");
    expect(apiRequest?.headers.get("Content-Type")).toBe("application/json");
    expect(apiRequest?.headers.get("Accept")).toBe("application/json");

    // Assert POST Request Body
    const expectedRequestBody = JSON.parse(
      readFile("expected-request-body.json"),
    );
    expect(apiRequest?.json()).resolves.toEqual(expectedRequestBody);

    // Assert the request body sent to SAP was archived
    expect(uploadMockFn).toHaveBeenCalledWith(
      JSON.stringify(expectedRequestBody),
      JSON.stringify(expectedRequestBody).length,
      {
        blobHTTPHeaders: { blobContentType: "application/json" },
        tags: {
          correlationId: "my-correlation-id",
          materialNumber: "TP10935ALT-17.15",
          plant: "B024",
          productionOrder: "1004143",
          user: "dbirney",
          fileGuid: "my-file-guid",
        },
      },
    );

    const expected =
      '<?xml version="1.0" encoding="utf-8"?><Request>    <FileGuiId>my-file-guid</FileGuiId>    <AppName>Azure</AppName>    <Status>1</Status>    <StatusMessage>Successfully confirmed Components Goods Issues</StatusMessage></Request>';
    expect(transactionManagerStatusUpdateMockFn).toHaveBeenCalledWith({
      body: Buffer.from(expected),
      contentType: "application/xml",
      sessionId: "my-file-guid",
      correlationId: "my-correlation-id",
    });
  });

  test("Material reservations parse correctly", async () => {
    // import fetch-retry after msw server.listen so it wraps the correct fetch implementation
    const { default: createFetchRetry } = await import("fetch-retry");
    global.fetch = createFetchRetry(global.fetch);

    // import function handler after fetch is mocked and wrapped
    const { handler } = await import(
      "../../../src/functions/compass-to-sap/components-goods-issues-to-sap"
    );

    // Read expected SAP API response for the GET request
    const expectedGetSapBody = readFile(
      "production-order-components-1030264.json",
    );
    const expectedSapRespBody = { status: "success" };
    let apiRequest: Request | undefined;

    // Mocking the SAP API
    server.use(
      // Intercept GET request for the SAP API
      http.get(
        /https:\/\/my-sap-url\.wlgore\.com\/productionorder\/v1\/A_ProductionOrder_2\('\d+'\)\/to_ProductionOrderComponent/,
        ({ request }) => {
          // store the request for later assertions
          apiRequest = request.clone();
          return HttpResponse.text(expectedGetSapBody);
        },
      ),
      // Intercept Production Order Confirmation POST request for the SAP API
      http.post(
        "https://my-sap-url.wlgore.com/prodorderconf/v1/ProdnOrdConf2",
        ({ request }) => {
          apiRequest = request.clone();
          return HttpResponse.json(expectedSapRespBody, { status: 200 });
        },
      ),
    );

    // Invoke the handler
    const input = readFile("input-reservations.xml");
    await handler(input, context);

    // Assert Request Headers
    expect(apiRequest?.headers.get("APIKey")).toBe("my-sap-api-key");
    expect(apiRequest?.headers.get("Content-Type")).toBe("application/json");
    expect(apiRequest?.headers.get("Accept")).toBe("application/json");

    // Assert POST Request Body
    const expectedRequestBody = JSON.parse(
      readFile("reservations-expected-body.json"),
    );
    expect(apiRequest?.json()).resolves.toEqual(expectedRequestBody);

    // Assert the request body sent to SAP was archived
    expect(uploadMockFn).toHaveBeenCalledWith(
      JSON.stringify(expectedRequestBody),
      JSON.stringify(expectedRequestBody).length,
      {
        blobHTTPHeaders: { blobContentType: "application/json" },
        tags: {
          correlationId: "my-correlation-id",
          materialNumber: "10066697",
          plant: "B024",
          productionOrder: "1030264",
          user: "kvennard",
          fileGuid: "my-file-guid",
        },
      },
    );

    // Assert the transaction manager status was updated
    const expected =
      '<?xml version="1.0" encoding="utf-8"?><Request>    <FileGuiId>my-file-guid</FileGuiId>    <AppName>Azure</AppName>    <Status>1</Status>    <StatusMessage>Successfully confirmed Components Goods Issues</StatusMessage></Request>';
    expect(transactionManagerStatusUpdateMockFn).toHaveBeenCalledWith({
      body: Buffer.from(expected),
      contentType: "application/xml",
      sessionId: "my-file-guid",
      correlationId: "my-correlation-id",
    });
  });

  test("should not send component goods issues for invalid plants", async () => {
    // import function handler after fetch is mocked and wrapped
    const { handler } = await import(
      "../../../src/functions/compass-to-sap/components-goods-issues-to-sap"
    );

    // Mocking console to assert the log message
    // Invoke the handler
    const input = readFile("invalid-plant-input.xml");
    await handler(input, context);

    // Assert the transaction manager status was updated
    const expected = `<?xml version="1.0" encoding="utf-8"?><Request>    <FileGuiId>my-file-guid</FileGuiId>    <AppName>Azure</AppName>    <Status>1</Status>    <StatusMessage>Skipped this message, 'BXYZ' is not for an SAP plant</StatusMessage></Request>`;
    expect(transactionManagerStatusUpdateMockFn).toHaveBeenCalledWith({
      body: Buffer.from(expected),
      contentType: "application/xml",
      sessionId: "my-file-guid",
      correlationId: "my-correlation-id",
    });
  });

  test("should throw an error if the container blob upload fails", async () => {
    // import function handler after fetch is mocked and wrapped
    const { handler } = await import(
      "../../../src/functions/compass-to-sap/components-goods-issues-to-sap"
    );

    // Prepare mocks
    const thrownError = new Error("Invalid input");
    uploadMockFn.mockRejectedValueOnce(thrownError);

    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: { messageId: "my-message-id" },
    });
    await handler("invalid input", context);

    // Assert no Transaction Manager updates were sent, since the payload does not have a file GUID
    expect(transactionManagerStatusUpdateMockFn).toHaveBeenCalledTimes(0);
  });

  test("Components goods issues event with negative quantities occurs in Compass", async () => {
    // import fetch-retry after msw server.listen so it wraps the correct fetch implementation
    const { default: createFetchRetry } = await import("fetch-retry");
    global.fetch = createFetchRetry(global.fetch);

    // import function handler after fetch is mocked and wrapped
    const { handler } = await import(
      "../../../src/functions/compass-to-sap/components-goods-issues-to-sap"
    );

    // Read expected SAP API response for the GET request
    const expectedGetSapBody = readFile(
      "production-order-components-1004143.json",
    );
    const expectedSapRespBody = { status: "success" };
    let apiRequest: Request | undefined;

    // Mocking the SAP API
    server.use(
      // Intercept GET request for the SAP API
      http.get(
        /https:\/\/my-sap-url\.wlgore\.com\/productionorder\/v1\/A_ProductionOrder_2\('\d+'\)\/to_ProductionOrderComponent/,
        ({ request }) => {
          // store the request for later assertions
          apiRequest = request.clone();
          return HttpResponse.text(expectedGetSapBody);
        },
      ),
      // Intercept Production Order Confirmation POST request for the SAP API
      http.post(
        "https://my-sap-url.wlgore.com/prodorderconf/v1/ProdnOrdConf2",
        ({ request }) => {
          apiRequest = request.clone();
          return HttpResponse.json(expectedSapRespBody, { status: 200 });
        },
      ),
    );

    // Invoke the handler
    const input = readFile("input-negative-quantity.xml");
    await handler(input, context);

    // Assert Request Headers
    expect(apiRequest?.headers.get("APIKey")).toBe("my-sap-api-key");
    expect(apiRequest?.headers.get("Content-Type")).toBe("application/json");
    expect(apiRequest?.headers.get("Accept")).toBe("application/json");

    // Assert POST Request Body
    const expectedRequestBody = JSON.parse(
      readFile("expected-negative-quantity-request-body.json"),
    );
    expect(apiRequest?.json()).resolves.toEqual(expectedRequestBody);

    // Assert the request body sent to SAP was archived
    expect(uploadMockFn).toHaveBeenCalledWith(
      JSON.stringify(expectedRequestBody),
      JSON.stringify(expectedRequestBody).length,
      {
        blobHTTPHeaders: { blobContentType: "application/json" },
        tags: {
          correlationId: "my-correlation-id",
          materialNumber: "TP10935ALT-17.15",
          plant: "B024",
          productionOrder: "1004143",
          user: "dbirney",
          fileGuid: "my-file-guid",
        },
      },
    );

    // Assert the transaction manager status was updated
    const expected =
      '<?xml version="1.0" encoding="utf-8"?><Request>    <FileGuiId>my-file-guid</FileGuiId>    <AppName>Azure</AppName>    <Status>1</Status>    <StatusMessage>Successfully confirmed Components Goods Issues</StatusMessage></Request>';
    expect(transactionManagerStatusUpdateMockFn).toHaveBeenCalledWith({
      body: Buffer.from(expected),
      contentType: "application/xml",
      sessionId: "my-file-guid",
      correlationId: "my-correlation-id",
    });
  });

  function readFile(name: string) {
    return fs.readFileSync(
      `test/compass-to-sap/components-goods-issues-to-sap/${name}`,
      "utf8",
    );
  }
});
