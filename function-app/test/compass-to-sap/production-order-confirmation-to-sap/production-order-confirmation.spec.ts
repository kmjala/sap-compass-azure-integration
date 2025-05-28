import { expect, jest, test } from "@jest/globals";
import { InvocationContext } from "@azure/functions";
import * as fs from "fs";
import { ContainerClient } from "@azure/storage-blob";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { initialiseConversionTable } from "../../../src/conversions/conversion-table";
import { handler } from "../../../src/functions/compass-to-sap/production-order-confirmation-to-sap";
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

describe("production-order-confirmation-to-sap.feature", () => {
  const uploadMockFn = jest.fn<() => Promise<string>>();
  const transactionManagerStatusUpdateMockFn = jest.fn();
  let context: InvocationContext;
  const originalProcessEnv = process.env;

  beforeAll(async () => {
    server.listen({ onUnhandledRequest: "error" });

    // Import fetch-retry after msw server.listen so it wraps the correct fetch implementation
    const { default: createFetchRetry } = await import("fetch-retry");
    global.fetch = createFetchRetry(global.fetch);
    await initialiseConversionTable();
    jest.useFakeTimers().setSystemTime(new Date(981173106789));
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
    process.env = { ...originalProcessEnv };

    process.env.SAP_BASE_URL = "https://my-sap-url.wlgore.com";
    process.env.SAP_API_KEY = "my-sap-api-key";
    process.env.AZURE_SUBSCRIPTION_ID = "my-subscription-id";
    process.env.AZURE_RESOURCE_GROUP_NAME = "my-resource-group";
    process.env.MESSAGE_ARCHIVE_STORAGE_ACCOUNT_NAME = "my-storage-account";
  });

  afterEach(() => {
    jest.restoreAllMocks();
    // reset sap api mocking
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
    jest.useRealTimers();

    // Restore original environment variables
    process.env = originalProcessEnv;
  });

  test("Production order confirmation event occurs in Compass", async () => {
    const expectedSapResponseBody = { status: "success" };

    server.use(
      // Intercept getconfproposal request for the SAP API
      http.post(
        "https://my-sap-url.wlgore.com/prodorderconf/v1/GetConfProposal",
        ({ request }) => {
          // parse incoming url
          const url = new URL(request.url);

          // get the order id and operation from the url
          const orderId = url.searchParams.get("OrderID").split("'").join("");
          const operation = url.searchParams
            .get("OrderOperation")
            .split("'")
            .join("");

          // return the correct mock response
          return HttpResponse.text(
            readFile(`getconfproposal-${orderId}-${operation}.json`),
          );
        },
      ),
      // Mock the SAP Production Order Confirmation API
      http.post(
        "https://my-sap-url.wlgore.com/prodorderconf/v1/ProdnOrdConf2",
        async ({ request }) => {
          // Return an error if the API keys were not set
          if (request.headers.get("APIKey") !== "my-sap-api-key") {
            return HttpResponse.text("Invalid API key", { status: 401 });
          }
          // Return an error if the content type is incorrect
          else if (request.headers.get("Content-Type") !== "application/json") {
            return HttpResponse.text("Invalid content type", { status: 400 });
          } else if (request.headers.get("Accept") !== "application/json") {
            return HttpResponse.text("Invalid accept type", { status: 400 });
          }

          // Return a valid response for the expected request
          const requestBody = await request.json();
          const expectedRequestBody = readJsonString(
            "expected-request-body.json",
          );
          if (JSON.stringify(requestBody) === expectedRequestBody) {
            return HttpResponse.json(expectedSapResponseBody, { status: 200 });
          }

          // Not a valid reqeuest, therefore return an error response
          return HttpResponse.text("Invalid request", { status: 400 });
        },
      ),
    );

    // Invoke the handler
    const input = readFile("input.xml");
    await handler(input, context);

    // Assert the SAP API response was archived
    expect(uploadMockFn).toHaveBeenCalledWith(
      JSON.stringify(expectedSapResponseBody),
      expect.any(Number),
      expect.any(Object),
    );

    // Assert the status was logged
    const expected = `<?xml version="1.0" encoding="utf-8"?><Request>    <FileGuiId>my-file-guid</FileGuiId>    <AppName>Azure</AppName>    <Status>1</Status>    <StatusMessage>Finished processing Production Order Confirmations</StatusMessage></Request>`;
    expect(transactionManagerStatusUpdateMockFn).toHaveBeenCalledWith({
      body: Buffer.from(expected),
      contentType: "application/xml",
      sessionId: "my-file-guid",
      correlationId: "my-correlation-id",
    });
  });

  test("should confirm SuperBackFlush with multiple sequence numbers", async () => {
    // Assert the SAP API request body was archived
    const expectedRequestBodies = [
      readJsonString("multiple-expected-request-body-1.json"),
      readJsonString("multiple-expected-request-body-2.json"),
    ];
    const expectedSapResponseBody = { status: "success" };

    server.use(
      // Intercept getconfproposal request for the SAP API
      http.post(
        "https://my-sap-url.wlgore.com/prodorderconf/v1/GetConfProposal",
        ({ request }) => {
          // parse incoming url
          const url = new URL(request.url);

          // get the order id and operation from the url
          const orderId = url.searchParams.get("OrderID").split("'").join("");
          const operation = url.searchParams
            .get("OrderOperation")
            .split("'")
            .join("");

          // return the correct mock response
          return HttpResponse.text(
            readFile(`getconfproposal-${orderId}-${operation}.json`),
          );
        },
      ),
      // Mock the SAP Production Order Confirmation API
      http.post(
        "https://my-sap-url.wlgore.com/prodorderconf/v1/ProdnOrdConf2",
        async ({ request }) => {
          // Return an error if the API keys were not set
          if (request.headers.get("APIKey") !== "my-sap-api-key") {
            return HttpResponse.text("Invalid API key", { status: 401 });
          }
          // Return an error if the content type is incorrect
          else if (request.headers.get("Content-Type") !== "application/json") {
            return HttpResponse.text("Invalid content type", { status: 400 });
          } else if (request.headers.get("Accept") !== "application/json") {
            return HttpResponse.text("Invalid accept type", { status: 400 });
          }

          // Return a valid response for the expected request
          const requestBody = JSON.stringify(await request.json());
          if (expectedRequestBodies.includes(requestBody)) {
            return HttpResponse.json(expectedSapResponseBody, { status: 200 });
          }

          // Not a valid reqeuest, therefore return an error response
          return HttpResponse.text(`Invalid request body: ${requestBody}`, {
            status: 400,
          });
        },
      ),
    );

    // Invoke the handler
    const input = readFile("multiple-input.xml");
    await handler(input, context);

    // Assert the SAP API response was archived
    expect(uploadMockFn).toHaveBeenCalledWith(
      JSON.stringify(expectedSapResponseBody),
      expect.any(Number),
      expect.any(Object),
    );

    // Assert the status was logged
    const expected = `<?xml version="1.0" encoding="utf-8"?><Request>    <FileGuiId>my-file-guid</FileGuiId>    <AppName>Azure</AppName>    <Status>1</Status>    <StatusMessage>Finished processing Production Order Confirmations</StatusMessage></Request>`;
    expect(transactionManagerStatusUpdateMockFn).toHaveBeenCalledWith({
      body: Buffer.from(expected),
      contentType: "application/xml",
      sessionId: "my-file-guid",
      correlationId: "my-correlation-id",
    });
  });

  test("should throw an error if the input is invalid", async () => {
    // Prepare inputs
    const input = "invalid input";
    context.error = jest.fn();

    // Invoke the handler and assert the error is thrown
    await handler(input, context);

    // Assert the error was logged
    expect(context.error).toHaveBeenCalledWith(
      "Failed to process Production Order Confirmation: TypeError: Cannot read properties of undefined (reading 'TxnWrapper')",
    );
  });

  test("should throw an error if the container blob upload fails", async () => {
    // Prepare mocks
    const thrownError = new Error("Invalid input");
    uploadMockFn.mockRejectedValueOnce(thrownError);

    // Invoke the handler and assert the error is thrown
    await handler("invalid input", context);

    // Assert no Transaction Manager updates were sent, since the payload does not have a file GUID
    expect(transactionManagerStatusUpdateMockFn).toHaveBeenCalledTimes(0);
  });

  test("Final production order confirmation event", async () => {
    const expectedSapResponseBody = { status: "success" };

    server.use(
      // Intercept getconfproposal request for the SAP API
      http.post(
        "https://my-sap-url.wlgore.com/prodorderconf/v1/GetConfProposal",
        ({ request }) => {
          // parse incoming url
          const url = new URL(request.url);

          // get the order id and operation from the url
          const orderId = url.searchParams.get("OrderID").split("'").join("");
          const operation = url.searchParams
            .get("OrderOperation")
            .split("'")
            .join("");

          // return the correct mock response
          return HttpResponse.text(
            readFile(`getconfproposal-${orderId}-${operation}.json`),
          );
        },
      ),
      // Intercept POST request for the SAP API to handle components goods issues
      http.post(
        "https://my-sap-url.wlgore.com/prodorderconf/v1/ProdnOrdConf2",
        async ({ request }) => {
          // Return an error if the API keys were not set
          if (request.headers.get("APIKey") !== "my-sap-api-key") {
            return HttpResponse.text("Invalid API key", { status: 401 });
          }
          // Return an error if the content type is incorrect
          else if (request.headers.get("Content-Type") !== "application/json") {
            return HttpResponse.text("Invalid content type", { status: 400 });
          } else if (request.headers.get("Accept") !== "application/json") {
            return HttpResponse.text("Invalid accept type", { status: 400 });
          }

          // Return a valid response for the expected request
          const requestBody = await request.json();
          const expectedRequestBody = readJsonString(
            "final-confirmation-expected-request-body.json",
          );
          // Check if the request body matches the expected request body
          if (JSON.stringify(requestBody) === expectedRequestBody) {
            return HttpResponse.json(expectedSapResponseBody, { status: 200 });
          }

          // Not a valid reqeuest, therefore return an error response
          return HttpResponse.text("Invalid request", { status: 400 });
        },
      ),
    );

    // Invoke the handler
    const input = readFile("final-confirmation-input.xml");
    await handler(input, context);

    // Assert the SAP API response was archived
    expect(uploadMockFn).toHaveBeenCalledWith(
      JSON.stringify(expectedSapResponseBody),
      expect.any(Number),
      expect.any(Object),
    );

    // Assert the status was logged
    const expected = `<?xml version="1.0" encoding="utf-8"?><Request>    <FileGuiId>my-file-guid</FileGuiId>    <AppName>Azure</AppName>    <Status>1</Status>    <StatusMessage>Finished processing Production Order Confirmations</StatusMessage></Request>`;
    expect(transactionManagerStatusUpdateMockFn).toHaveBeenCalledWith({
      body: Buffer.from(expected),
      contentType: "application/xml",
      sessionId: "my-file-guid",
      correlationId: "my-correlation-id",
    });
  });

  test("should not send goods receipts", async () => {
    // Invoke the handler
    const input = readFile("goods-receipt-input.xml");
    await handler(input, context);

    // No SAP API assertions required: if the test passes, the handler did not throw an error.
    // MSW will throw an error if any HTTP requests are made without a matching handler.
    // Since we haven't set up any handlers, this test will fail if any API requests are made.

    // Assert the status was logged
    expect(transactionManagerStatusUpdateMockFn).toBeCalledTimes(0);
  });

  test("should throw an error if the SAP API call fails", async () => {
    server.use(
      // Mock the SAP Production Order API
      http.all("https://my-sap-url.wlgore.com/*", () =>
        HttpResponse.json(
          { error: { message: { value: "Some API Error" } } },
          { status: 400 },
        ),
      ),
    );

    // Invoke the handler and assert the error is thrown
    const input = readFile("input.xml");
    await handler(input, context);

    // Assert the status was logged
    const expected = `<?xml version="1.0" encoding="utf-8"?><Request>    <FileGuiId>my-file-guid</FileGuiId>    <AppName>Azure</AppName>    <Status>0</Status>    <StatusMessage>Failed to process Production Order Confirmation: Error: Failed to retrieve proposed work hours (400): Some API Error. For more details, see the archived response: https://portal.azure.com/#view/Microsoft_Azure_Storage/BlobPropertiesBladeV2/storageAccountId/%2Fsubscriptions%2Fmy-subscription-id%2FresourceGroups%2Fmy-resource-group%2Fproviders%2FMicrosoft.Storage%2FstorageAccounts%2Fmy-storage-account/path/message-archive%2Ftopic%3Dproduction-order-confirmation-to-sap%2Fyear%3D2001%2Fmonth%3D02%2Fday%3D03%2Fmid%3Dmy-message-id%2Fsap-api-getconfproposal-response-body.json/isDeleted~/false/tabToload~/0</StatusMessage></Request>`;
    expect(transactionManagerStatusUpdateMockFn).toHaveBeenCalledWith({
      body: Buffer.from(expected),
      contentType: "application/xml",
      sessionId: "my-file-guid",
      correlationId: "my-correlation-id",
    });
  });

  test("should log invalid plant code", async () => {
    // import function handler after fetch is mocked and wrapped
    const { handler } = await import(
      "../../../src/functions/compass-to-sap/production-order-confirmation-to-sap"
    );

    // Mocking console to assert the log message
    const consoleSpy = jest.spyOn(global.console, "info");

    // Invoke the handler
    const input = readFile("invalid-plant-input.xml");
    await handler(input, context);

    // Assert the log message for invalid plant code
    expect(consoleSpy.mock.calls).toContainEqual([
      "Skipping order 3750714, operation 20, because BXYZ is not an SAP plant",
    ]);

    consoleSpy.mockRestore();

    // Assert the status was logged
    const expected =
      '<?xml version="1.0" encoding="utf-8"?><Request>    <FileGuiId>my-file-guid</FileGuiId>    <AppName>Azure</AppName>    <Status>1</Status>    <StatusMessage>Finished processing Production Order Confirmations</StatusMessage></Request>';
    expect(transactionManagerStatusUpdateMockFn).toHaveBeenCalledWith({
      body: Buffer.from(expected),
      contentType: "application/xml",
      sessionId: "my-file-guid",
      correlationId: "my-correlation-id",
    });
  });

  function readFile(name: string) {
    return fs.readFileSync(
      `test/compass-to-sap/production-order-confirmation-to-sap/${name}`,
      "utf8",
    );
  }

  function readJsonString(name: string) {
    const content = readFile(name);
    const parsedContent = JSON.parse(content);
    return JSON.stringify(parsedContent);
  }
});
