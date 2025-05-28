import { InvocationContext } from "@azure/functions";
import * as fs from "fs";
import { ContainerClient } from "@azure/storage-blob";
import { handler } from "../../../src/functions/sap-to-compass/material-master-to-compass";
import { ServiceBusClient } from "@azure/service-bus";
import { createBlobNamePrefix } from "../../../src/message-archive-client";
import { initialiseConversionTable } from "../../../src/conversions/conversion-table";
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

describe("material-master-to-compass.feature", () => {
  const uploadMockFn = jest.fn();
  const sendMessagesMockFns = new Map<string, jest.Mock>();
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

  test("Material Master event occurs in SAP", async () => {
    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
        correlationId: "my-correlation-id",
      },
    });
    const inputMessage = JSON.parse(readFile("input.json"));
    await handler(inputMessage, context);

    // Assert the incoming message was archived
    const expectedInputMessage = JSON.parse(readFile("input.json"));
    expect(uploadMockFn).toHaveBeenCalledWith(
      JSON.stringify(expectedInputMessage),
      JSON.stringify(expectedInputMessage).length,
      {
        blobHTTPHeaders: { blobContentType: "application/json" },
        tags: {
          correlationId: "my-correlation-id",
          materialNumber: "VE2021",
          mesMessageType: "ERPProductNew ERPProductChange",
          plant: "1015",
        },
      },
    );

    // Assert the XML files for Compass file were archived
    const expectedCreateXml = readFile("expected-create.xml");
    expect(uploadMockFn).toHaveBeenCalledWith(
      expectedCreateXml,
      expectedCreateXml.length,
      {
        blobHTTPHeaders: { blobContentType: "application/xml" },
        tags: {
          correlationId: "my-correlation-id",
          materialNumber: "VE2021",
          mesMessageType: "ERPProductNew ERPProductChange",
          plant: "1015",
        },
      },
    );
    const expectedUpdateXml = readFile("expected-update.xml");
    expect(uploadMockFn).toHaveBeenCalledWith(
      expectedUpdateXml,
      expectedUpdateXml.length,
      {
        blobHTTPHeaders: { blobContentType: "application/xml" },
        tags: {
          correlationId: "my-correlation-id",
          materialNumber: "VE2021",
          mesMessageType: "ERPProductNew ERPProductChange",
          plant: "1015",
        },
      },
    );

    // Assert the message for Compass was sent to the Service Bus
    const sendMessagesMock = sendMessagesMockFns.get(
      "material-master-to-compass",
    );
    expect(sendMessagesMock).toHaveBeenCalledWith({
      body: {
        MaterialNumber: "VE2021",
        Plant: "B024",
        Filename: "MM-VE2021-B024-my-message-id.xml",
        CreateXmlBlob: `${createBlobNamePrefix(context, "material-master-to-compass")}/create-B024.xml`,
        UpdateXmlBlob: `${createBlobNamePrefix(context, "material-master-to-compass")}/update-B024.xml`,
      },
      contentType: "application/json",
      correlationId: "my-correlation-id",
      sessionId: "VE2021",
    });
  });

  // This test is skipped because we do not have multiple plants yet
  test.skip("SAP messages for multiple Compass plants", async () => {
    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
        correlationId: "my-correlation-id",
      },
    });
    const inputMessage = JSON.parse(readFile("multiple-plants-input.json"));
    await handler(inputMessage, context);

    // Assert the incoming message was archived
    const expectedInputMessage = JSON.parse(
      readFile("multiple-plants-input.json"),
    );
    expect(uploadMockFn).toHaveBeenCalledWith(
      JSON.stringify(expectedInputMessage),
      JSON.stringify(expectedInputMessage).length,
      {
        blobHTTPHeaders: { blobContentType: "application/json" },
        tags: { correlationId: "my-correlation-id" },
      },
    );

    // Assert the XML files for Compass file were archived
    const expectedUploads = [
      "multiple-plants-create-B005.xml",
      "multiple-plants-update-B005.xml",
      "multiple-plants-create-B024.xml",
      "multiple-plants-update-B024.xml",
    ];
    for (const expectedFiles of expectedUploads) {
      const expectedXml = readFile(expectedFiles);
      expect(uploadMockFn).toHaveBeenCalledWith(
        expectedXml,
        expectedXml.length,
        {
          blobHTTPHeaders: { blobContentType: "application/xml" },
          tags: {
            correlationId: "my-correlation-id",
            materialNumber: "VE2021",
          },
        },
      );
    }

    // Assert the message for Compass was sent to the Service Bus
    const sendMessagesMock = sendMessagesMockFns.get(
      "production-order-to-compass",
    );
    expect(sendMessagesMock).toHaveBeenCalledWith({
      body: {
        materialNumber: "VE2021",
        Plant: "B005",
        CreateXmlBlob: `${createBlobNamePrefix(context, "material-master-to-compass")}/create-B005.xml`,
        UpdateXmlBlob: `${createBlobNamePrefix(context, "material-master-to-compass")}/update-B005.xml`,
      },
      contentType: "application/json",
      correlationId: "my-correlation-id",
    });
    expect(sendMessagesMock).toHaveBeenCalledWith({
      body: {
        materialNumber: "VE2021",
        Plant: "B024",
        Filename: "MM-VE2021-B024.xml",
        CreateXmlBlob: `${createBlobNamePrefix(context, "material-master-to-compass")}/create-B024.xml`,
        UpdateXmlBlob: `${createBlobNamePrefix(context, "material-master-to-compass")}/update-B024.xml`,
      },
      contentType: "application/json",
      correlationId: "my-correlation-id",
    });
  });

  test("Skip plants that do not use Compass", async () => {
    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
        correlationId: "my-correlation-id",
      },
    });
    const inputMessage = JSON.parse(readFile("skip-plants-input.json"));
    await handler(inputMessage, context);

    // Assert the incoming message was archived
    const expectedInputMessage = JSON.parse(readFile("skip-plants-input.json"));
    expect(uploadMockFn).toHaveBeenCalledWith(
      JSON.stringify(expectedInputMessage),
      JSON.stringify(expectedInputMessage).length,
      {
        blobHTTPHeaders: { blobContentType: "application/json" },
        tags: {
          correlationId: "my-correlation-id",
          materialNumber: "VE2021",
          mesMessageType: "ERPProductNew ERPProductChange",
          plant: "1047 1015",
        },
      },
    );

    // Assert the XML files for Compass file were archived
    const expectedUploads = [
      "skip-plants-create-B024.xml",
      "skip-plants-update-B024.xml",
    ];
    for (const expectedFiles of expectedUploads) {
      const expectedXml = readFile(expectedFiles);
      expect(uploadMockFn).toHaveBeenCalledWith(
        expectedXml,
        expectedXml.length,
        {
          blobHTTPHeaders: { blobContentType: "application/xml" },
          tags: {
            correlationId: "my-correlation-id",
            materialNumber: "VE2021",
            mesMessageType: "ERPProductNew ERPProductChange",
            plant: "1047 1015",
          },
        },
      );
    }

    // Assert the message for Compass was sent to the Service Bus
    const sendMessagesMock = sendMessagesMockFns.get(
      "material-master-to-compass",
    );
    expect(sendMessagesMock).toHaveBeenCalledWith({
      body: {
        MaterialNumber: "VE2021",
        Plant: "B024",
        Filename: "MM-VE2021-B024-my-message-id.xml",
        CreateXmlBlob: `${createBlobNamePrefix(context, "material-master-to-compass")}/create-B024.xml`,
        UpdateXmlBlob: `${createBlobNamePrefix(context, "material-master-to-compass")}/update-B024.xml`,
      },
      contentType: "application/json",
      correlationId: "my-correlation-id",
      sessionId: "VE2021",
    });
  });

  test.each([
    "no-plant-input.json",
    "no-plant-empty-list-input.json",
    "no-plant-empty-string-input.json",
    "no-plant-null-input.json",
  ])("Skip plants that do not use Compass", async (inputFile) => {
    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
        correlationId: "my-correlation-id",
      },
    });
    const inputMessage = JSON.parse(readFile(inputFile));
    await handler(inputMessage, context);

    // Assert the incoming message was archived
    const expectedInputMessage = JSON.parse(readFile(inputFile));
    expect(uploadMockFn).toHaveBeenCalledWith(
      JSON.stringify(expectedInputMessage),
      JSON.stringify(expectedInputMessage).length,
      {
        blobHTTPHeaders: { blobContentType: "application/json" },
        tags: {
          correlationId: "my-correlation-id",
          materialNumber: "VE2021",
          mesMessageType: "ERPProductNew ERPProductChange",
          plant: expect.any(String),
        },
      },
    );

    // Assert the message for Compass was not sent to the Service Bus
    const sendMessagesMock = sendMessagesMockFns.get(
      "material-master-to-compass",
    );
    expect(sendMessagesMock).not.toHaveBeenCalled();
  });

  test("should throw an error if the input is invalid", async () => {
    // Prepare inputs
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
        correlationId: "my-correlation-id",
      },
    });
    const input = "invalid input";

    // Invoke the handler and assert the error is thrown
    await expect(handler(input, context)).rejects.toThrow();

    // Assert the incoming message was archived
    expect(uploadMockFn).toHaveBeenCalledWith(input, input.length, {
      blobHTTPHeaders: { blobContentType: "application/json" },
      tags: {
        correlationId: "my-correlation-id",
        materialNumber: "undefined",
        mesMessageType: "ERPProductNew ERPProductChange",
        plant: "undefined",
      },
    });

    const sendMessagesMock = sendMessagesMockFns.get(
      "material-master-to-compass",
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

  function readFile(name: string) {
    return fs.readFileSync(
      `test/sap-to-compass/material-master-to-compass/${name}`,
      "utf8",
    );
  }

  function readJson(name: string) {
    return JSON.parse(readFile(name));
  }

  function readJsonString(name: string) {
    return JSON.stringify(readJson(name));
  }

  test("Create no files when no plant uses Compass", async () => {
    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
        correlationId: "my-correlation-id",
      },
    });
    const inputMessage = JSON.parse(readFile("invalid-plant-input.json"));
    await handler(inputMessage, context);

    // Assert the incoming message was archived
    const expectedInputMessage = JSON.parse(
      readFile("invalid-plant-input.json"),
    );
    expect(uploadMockFn).toHaveBeenCalledWith(
      JSON.stringify(expectedInputMessage),
      JSON.stringify(expectedInputMessage).length,
      {
        blobHTTPHeaders: { blobContentType: "application/json" },
        tags: {
          correlationId: "my-correlation-id",
          materialNumber: "VE2021",
          mesMessageType: "ERPProductNew ERPProductChange",
          plant: "invalid-plant",
        },
      },
    );

    expect(uploadMockFn).toHaveBeenCalledTimes(1);
    const sendMessagesMock = sendMessagesMockFns.get(
      "material-master-to-compass",
    );
    expect(sendMessagesMock).not.toHaveBeenCalled();
  });

  test("Fail when no english description exists", async () => {
    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
        correlationId: "my-correlation-id",
      },
    });
    const inputMessage = readJson("no-en-description-input.json");
    expect(handler(inputMessage, context)).rejects.toThrow(
      "No english description found",
    );

    // Assert the incoming message was archived
    const expectedInputMessage = JSON.parse(
      readFile("no-en-description-input.json"),
    );
    expect(uploadMockFn).toHaveBeenCalledWith(
      JSON.stringify(expectedInputMessage),
      JSON.stringify(expectedInputMessage).length,
      {
        blobHTTPHeaders: { blobContentType: "application/json" },
        tags: {
          correlationId: "my-correlation-id",
          materialNumber: "VE2021",
          mesMessageType: "ERPProductNew ERPProductChange",
          plant: "1015",
        },
      },
    );

    const sendMessagesMock = sendMessagesMockFns.get(
      "material-master-to-compass",
    );
    expect(sendMessagesMock).not.toHaveBeenCalled();
  });

  test("should replace special characters in filename", async () => {
    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
        correlationId: "my-correlation-id",
      },
    });
    const inputMessage = JSON.parse(readFile("special-characters-input.json"));
    await handler(inputMessage, context);

    // Assert the incoming message was archived
    const expectedInputMessage = JSON.parse(
      readFile("special-characters-input.json"),
    );
    expect(uploadMockFn).toHaveBeenCalledWith(
      JSON.stringify(expectedInputMessage),
      JSON.stringify(expectedInputMessage).length,
      {
        blobHTTPHeaders: { blobContentType: "application/json" },
        tags: {
          correlationId: "my-correlation-id",
          mesMessageType: "ERPProductNew ERPProductChange",
          plant: "1015",
        },
      },
    );

    // Assert the XML files for Compass file were archived
    const expectedCreateXml = readFile(
      "special-characters-expected-create.xml",
    );
    expect(uploadMockFn).toHaveBeenCalledWith(
      expectedCreateXml,
      expectedCreateXml.length,
      {
        blobHTTPHeaders: { blobContentType: "application/xml" },
        tags: {
          correlationId: "my-correlation-id",
          mesMessageType: "ERPProductNew ERPProductChange",
          plant: "1015",
        },
      },
    );
    const expectedUpdateXml = readFile(
      "special-characters-expected-update.xml",
    );
    expect(uploadMockFn).toHaveBeenCalledWith(
      expectedUpdateXml,
      expectedUpdateXml.length,
      {
        blobHTTPHeaders: { blobContentType: "application/xml" },
        tags: {
          correlationId: "my-correlation-id",
          mesMessageType: "ERPProductNew ERPProductChange",
          plant: "1015",
        },
      },
    );

    // Assert the message for Compass was sent to the Service Bus
    const sendMessagesMock = sendMessagesMockFns.get(
      "material-master-to-compass",
    );
    expect(sendMessagesMock).toHaveBeenCalledWith({
      body: {
        MaterialNumber: 'VE2021@#$%^&*()[\\/:*?""<>|]meh',
        Plant: "B024",
        Filename: "MM-VE2021_____________________meh-B024-my-message-id.xml",
        CreateXmlBlob: `${createBlobNamePrefix(context, "material-master-to-compass")}/create-B024.xml`,
        UpdateXmlBlob: `${createBlobNamePrefix(context, "material-master-to-compass")}/update-B024.xml`,
      },
      contentType: "application/json",
      correlationId: "my-correlation-id",
      sessionId: 'VE2021@#$%^&*()[\\/:*?""<>|]meh',
    });
  });

  test("should skip materials that are not MES relevant", async () => {
    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
        correlationId: "my-correlation-id",
      },
    });
    const inputMessage = readJson("not-mes-relevant-input.json");
    await handler(inputMessage, context);

    // Assert the incoming message was archived
    const expectedInputMessage = readJsonString("not-mes-relevant-input.json");
    expect(uploadMockFn).toHaveBeenCalledWith(
      expectedInputMessage,
      expectedInputMessage.length,
      {
        blobHTTPHeaders: { blobContentType: "application/json" },
        tags: {
          correlationId: "my-correlation-id",
          materialNumber: "VE2021",
          mesMessageType: "ERPProductNew ERPProductChange",
          plant: "1015",
        },
      },
    );

    expect(uploadMockFn).toHaveBeenCalledTimes(1);
    const sendMessagesMock = sendMessagesMockFns.get(
      "material-master-to-compass",
    );
    expect(sendMessagesMock).not.toHaveBeenCalled();
  });

  test("should skip materials without product class characteristics", async () => {
    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
        correlationId: "my-correlation-id",
      },
    });
    const inputMessage = readJson(
      "materials-without-class-characteristics-input.json",
    );
    await handler(inputMessage, context);

    // Assert the incoming message was archived
    const expectedInputMessage = readJsonString(
      "materials-without-class-characteristics-input.json",
    );
    expect(uploadMockFn).toHaveBeenCalledWith(
      expectedInputMessage,
      expectedInputMessage.length,
      {
        blobHTTPHeaders: { blobContentType: "application/json" },
        tags: {
          correlationId: "my-correlation-id",
          materialNumber: "VE2021",
          mesMessageType: "ERPProductNew ERPProductChange",
          plant: "1015",
        },
      },
    );

    expect(uploadMockFn).toHaveBeenCalledTimes(1);
    const sendMessagesMock = sendMessagesMockFns.get(
      "material-master-to-compass",
    );
    expect(sendMessagesMock).not.toHaveBeenCalled();
  });

  test("Create no files when plant profile code is invalid", async () => {
    // Invoke the handler
    const context = new InvocationContext({
      triggerMetadata: {
        messageId: "my-message-id",
        correlationId: "my-correlation-id",
      },
    });
    const inputMessage = JSON.parse(readFile("invalid-profile-code.json"));
    await handler(inputMessage, context);

    // Assert the incoming message was archived
    const expectedInputMessage = JSON.parse(
      readFile("invalid-profile-code.json"),
    );
    expect(uploadMockFn).toHaveBeenCalledWith(
      JSON.stringify(expectedInputMessage),
      JSON.stringify(expectedInputMessage).length,
      {
        blobHTTPHeaders: { blobContentType: "application/json" },
        tags: {
          correlationId: "my-correlation-id",
          materialNumber: "VE2021",
          mesMessageType: "ERPProductNew ERPProductChange",
          plant: "1015",
        },
      },
    );

    expect(uploadMockFn).toHaveBeenCalledTimes(1);
    const sendMessagesMock = sendMessagesMockFns.get(
      "material-master-to-compass",
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
    const inputMessage = JSON.parse(readFile("send-to-compass1-input.json"));
    await handler(inputMessage, context);

    // Assert the message for Compass was sent to the Service Bus
    const sendMessagesCompass1Mock = sendMessagesMockFns.get(
      "material-master-to-compass1",
    );
    expect(sendMessagesCompass1Mock).toHaveBeenCalledWith({
      body: {
        MaterialNumber: "VE2021",
        Plant: "B041",
        Filename: "MM-VE2021-B041-my-message-id.xml",
        CreateXmlBlob: `${createBlobNamePrefix(context, "material-master-to-compass")}/create-B041.xml`,
        UpdateXmlBlob: `${createBlobNamePrefix(context, "material-master-to-compass")}/update-B041.xml`,
      },
      contentType: "application/json",
      correlationId: "my-correlation-id",
      sessionId: "VE2021",
    });

    // Assert nothing was sent to Compass2
    const sendMessagesCompass2Mock = sendMessagesMockFns.get(
      "material-master-to-compass",
    );
    expect(sendMessagesCompass2Mock).not.toHaveBeenCalled();
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
    const inputMessage = JSON.parse(readFile("send-to-compass1-input.json"));
    await handler(inputMessage, context);

    // Assert nothing was sent to Compass1 and Compass2
    const sendMessagesCompass1Mock = sendMessagesMockFns.get(
      "material-master-to-compass1",
    );
    expect(sendMessagesCompass1Mock).not.toHaveBeenCalled();
    const sendMessagesCompass2Mock = sendMessagesMockFns.get(
      "material-master-to-compass",
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
    const inputMessage = JSON.parse(readFile("send-to-compass2-input.json"));
    await handler(inputMessage, context);

    // Assert the message for Compass was sent to the Service Bus
    const sendMessagesMock = sendMessagesMockFns.get(
      "material-master-to-compass",
    );
    expect(sendMessagesMock).toHaveBeenCalledWith({
      body: {
        MaterialNumber: "VE2021",
        Plant: "B024",
        Filename: "MM-VE2021-B024-my-message-id.xml",
        CreateXmlBlob: `${createBlobNamePrefix(context, "material-master-to-compass")}/create-B024.xml`,
        UpdateXmlBlob: `${createBlobNamePrefix(context, "material-master-to-compass")}/update-B024.xml`,
      },
      contentType: "application/json",
      correlationId: "my-correlation-id",
      sessionId: "VE2021",
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
            "Product eq 'VE2021' and CharcInternalID eq '1337'"
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
    const inputMessage = JSON.parse(readFile("1017-B005-input.json"));
    await handler(inputMessage, context);

    // Assert the message for Compass was sent to the Service Bus
    const sendMessagesMock = sendMessagesMockFns.get(
      "material-master-to-compass1",
    );
    expect(sendMessagesMock).toHaveBeenCalledWith({
      body: {
        MaterialNumber: "VE2021",
        Plant: "B005",
        Filename: "MM-VE2021-B005-my-message-id.xml",
        CreateXmlBlob: `${createBlobNamePrefix(context, "material-master-to-compass")}/create-B005.xml`,
        UpdateXmlBlob: `${createBlobNamePrefix(context, "material-master-to-compass")}/update-B005.xml`,
      },
      contentType: "application/json",
      correlationId: "my-correlation-id",
      sessionId: "VE2021",
    });
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
            "Product eq 'VE2021' and CharcInternalID eq '1337'"
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
    const inputMessage = JSON.parse(readFile("1017-B346-input.json"));
    await handler(inputMessage, context);

    // Assert the message for Compass was sent to the Service Bus
    const sendMessagesCompass1Mock = sendMessagesMockFns.get(
      "material-master-to-compass1",
    );
    expect(sendMessagesCompass1Mock).not.toHaveBeenCalled();
    const sendMessagesCompass2Mock = sendMessagesMockFns.get(
      "material-master-to-compass",
    );
    expect(sendMessagesCompass2Mock).not.toHaveBeenCalled();
  });
});
