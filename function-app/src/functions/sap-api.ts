import { InvocationContext } from "@azure/functions";
import { MyContainerClient } from "../message-archive-client";
import {
  ProductionOrderConfirmationRequest,
  ComponentGoodsIssuesRequest,
  ProductionOrderResponse,
  SAPAPIErrorResponse,
  GetConfProposalResponse,
  SAPAPIListResponse,
  Components,
} from "./sap-api.d";
import * as appInsights from "applicationinsights";

// Retry fetch requests, see https://www.npmjs.com/package/fetch-retry
import fetchRetry from "fetch-retry";

/**
 * See https://api.sap.com/api/OP_API_PROD_ORDER_CONFIRMATIO_2_SRV_0001/path/post_ProdnOrdConf2
 */
export async function sendProductionOrderConfirmation(
  body: ProductionOrderConfirmationRequest | ComponentGoodsIssuesRequest,
  containerClient: MyContainerClient,
  context: InvocationContext,
  addWorkHours: boolean,
) {
  // Check if work hours need to be added, and type is ProductionOrderConfirmationRequest
  if (addWorkHours && "ConfirmationYieldQuantity" in body) {
    const workHours = await getConfProposal(body, containerClient, context);

    // Copy over proposed work hours values
    body.OpConfirmedWorkQuantity1 =
      workHours.d.GetConfProposal.OpConfirmedWorkQuantity1;
    body.OpConfirmedWorkQuantity2 =
      workHours.d.GetConfProposal.OpConfirmedWorkQuantity2;
    body.OpConfirmedWorkQuantity3 =
      workHours.d.GetConfProposal.OpConfirmedWorkQuantity3;
    body.OpConfirmedWorkQuantity4 =
      workHours.d.GetConfProposal.OpConfirmedWorkQuantity4;
    body.OpConfirmedWorkQuantity5 =
      workHours.d.GetConfProposal.OpConfirmedWorkQuantity5;
    body.OpConfirmedWorkQuantity6 =
      workHours.d.GetConfProposal.OpConfirmedWorkQuantity6;
  }

  // Archive the request body
  const requestBlobName = await containerClient.upload(
    body,
    `sap-api-ProdnOrdConf2-request-${body.OrderID}-${body.OrderOperation}.json`,
  );
  const requestBlobLink = containerClient.getBrowserLink(requestBlobName);
  context.info(
    `Archived SAP Production Order Confirmation API request body for ${body.OrderID}, operation ${body.OrderOperation}, at ${requestBlobLink}`,
  );

  // Timer for the SAP API call
  let durationStart = Date.now();

  // Retry configuration
  const fetchWithRetry = fetchRetry(global.fetch, {
    retryOn: [423],
    retries: 3,
    retryDelay: (attempt) => {
      context.warn(
        `Production Order Confirmation POST attempt ${attempt} failed, retrying...`,
      );

      // Track the dependency telemetry for the SAP API call
      appInsights.defaultClient.trackDependency({
        name: "POST /prodorderconf/v1/ProdnOrdConf2",
        resultCode: 423,
        data: url.toString(),
        dependencyTypeName: "HTTP",
        target: process.env.SAP_BASE_URL,
        duration: Date.now() - durationStart,
        success: false,
      });

      const delay = Math.pow(2, attempt) * 2000;
      durationStart = Date.now() + delay;
      return delay;
    },
  });
  const url = new URL(
    "/prodorderconf/v1/ProdnOrdConf2",
    process.env.SAP_BASE_URL,
  );
  context.info(
    `Sending Production Order Confirmation to SAP API for ${body.OrderID}, operation ${body.OrderOperation}: ${url}`,
  );
  const response = await fetchWithRetry(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      APIKey: process.env.SAP_API_KEY,
    },
    body: JSON.stringify(body),
  });
  trackSAPDependency("POST", url, response, durationStart);

  // Archive the SAP API response for debugging purposes
  const responseText = await response.text();
  const responseBlobName = await containerClient.upload(
    responseText,
    `sap-api-ProdnOrdConf2-response-${body.OrderOperation}.json`,
  );
  const responseBlobLink = containerClient.getBrowserLink(responseBlobName);
  context.info(
    `Archived SAP Production Order Confirmation API response (${response.status}) for ${body.OrderID}, operation ${body.OrderOperation}, at ${responseBlobLink}`,
  );

  if (!response.ok) {
    throw new Error(
      `Failed to confirm Production Order ${body.OrderID}, operation ${body.OrderOperation} (${response.status}): ${getPrettyErrorMessage(responseText)}. For more details, see the archived response: ${responseBlobLink}`,
    );
  }

  // Production Order Confirmations are processed in the background in SAP,
  // so we wait a little to allow SAP to finish processing the request.
  // This is a workaround for the SAP API being asynchronous and us seeing
  // COGI errors when we are sending too many Production Order Confirmations
  // in a short period of time, e.g. for 10 batches of the same PO.
  const delay = parseInt(process.env.SAP_API_PRODNORDCONF2_DELAY);
  if (!isNaN(delay) && delay > 0) {
    await new Promise((f) => setTimeout(f, delay));
  }
}

/**
 * @returns a human readable error message from the SAP API response
 */
export function getPrettyErrorMessage(responseText: string) {
  try {
    const responseJson = JSON.parse(responseText) as SAPAPIErrorResponse;

    // Return the error message if only one is provided
    if (!Array.isArray(responseJson.error.message)) {
      return responseJson.error.message.value;
    }

    // Return the first English message
    for (const message of responseJson.error.message) {
      if (message.lang === "en") {
        return message.value;
      }
    }

    // If no English message is found, return the first message
    if (responseJson.error.message) {
      return responseJson.error.message[0].value;
    }
  } catch {
    console.warn("Failed to parse SAP API error response as JSON");
  }

  // If no message is found, return the entire error
  return responseText;
}

/**
 * See https://api.sap.com/api/OP_API_PRODUCTION_ORDER_2_SRV_0001/path/get_A_ProductionOrder_2___ManufacturingOrder___
 *
 * @returns Production Order for the given id
 */
export async function getProductionOrder(
  manufacturingOrder: string,
  containerClient: MyContainerClient,
  context: InvocationContext,
): Promise<ProductionOrderResponse> {
  const url = new URL(
    `/productionorder/v1/A_ProductionOrder_2('${encodeURIComponent(manufacturingOrder)}')`,
    process.env.SAP_BASE_URL,
  );
  context.info(`Getting Production Order from SAP API: ${url}`);
  const durationStart = Date.now();
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      APIKey: process.env.SAP_API_KEY,
    },
  });
  trackSAPDependency("GET", url, response, durationStart);

  // Archive the SAP API response for debugging purposes
  const responseText = await response.text();
  const blobName = await containerClient.upload(
    responseText,
    "sap-api-production-order-response-body.json",
  );
  const link = containerClient.getBrowserLink(blobName);
  context.info(
    `Archived SAP Production Order API response (${response.status}) at ${link}`,
  );

  if (!response.ok) {
    throw new Error(
      `Failed to retrieve Production Order ${manufacturingOrder} (${response.status}): ${getPrettyErrorMessage(responseText)}. For more details, see the archived response: ${link}`,
    );
  }

  return JSON.parse(responseText);
}

/**
 * See https://api.sap.com/api/OP_API_PRODUCTION_ORDER_2_SRV_0001/path/get_A_ProductionOrder_2___ManufacturingOrder___
 *
 * @returns Production Order Components for the given Production Order id
 */
export async function getProductionOrderComponents(
  manufacturingOrder: string,
  containerClient: MyContainerClient,
  context: InvocationContext,
): Promise<SAPAPIListResponse<Components>> {
  const url = new URL(
    `/productionorder/v1/A_ProductionOrder_2('${encodeURIComponent(manufacturingOrder)}')/to_ProductionOrderComponent`,
    process.env.SAP_BASE_URL,
  );
  context.info(`Getting Production Order Components from SAP API: ${url}`);
  const durationStart = Date.now();
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      APIKey: process.env.SAP_API_KEY,
    },
  });
  trackSAPDependency("GET", url, response, durationStart);

  // Archive the SAP API response for debugging purposes
  const responseText = await response.text();
  const blobName = await containerClient.upload(
    responseText,
    "sap-api-production-order-components-response-body.json",
  );
  const link = containerClient.getBrowserLink(blobName);
  context.info(
    `Archived SAP Production Order Components API response (${response.status}) at ${link}`,
  );

  if (!response.ok) {
    throw new Error(
      `Failed to retrieve Production Order ${manufacturingOrder} Components (${response.status}): ${getPrettyErrorMessage(responseText)}. For more details, see the archived response: ${link}`,
    );
  }

  return JSON.parse(responseText);
}

/**
 * See https://api.sap.com/api/API_PROD_ORDER_CONFIRMATION_2_SRV/path/post_GetConfProposal
 *
 * @returns Proposed work quantities for the given Production Order confirmation
 */
export async function getConfProposal(
  body: ProductionOrderConfirmationRequest,
  containerClient: MyContainerClient,
  context: InvocationContext,
): Promise<GetConfProposalResponse> {
  const url = new URL(
    "/prodorderconf/v1/GetConfProposal",
    process.env.SAP_BASE_URL,
  );
  url.searchParams.append("OrderID", `'${body.OrderID}'`); // wrap string parameters in single quotes
  url.searchParams.append("OrderOperation", `'${body.OrderOperation}'`); // wrap string parameters in single quotes
  url.searchParams.append("Sequence", `'${body.Sequence}'`); // wrap string parameters in single quotes
  url.searchParams.append(
    "ConfirmationYieldQuantity",
    `${body.ConfirmationYieldQuantity}M`,
  );
  url.searchParams.append(
    "ConfirmationScrapQuantity",
    `${body.ConfirmationScrapQuantity}M`,
  );
  url.searchParams.append("ActivityIsToBeProposed", "true");

  context.info(`Getting proposed work hours from SAP API: ${url.toString()}`);
  const durationStart = Date.now();
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      APIKey: process.env.SAP_API_KEY,
    },
  });
  trackSAPDependency("POST", url, response, durationStart);

  // Archive the SAP API response for debugging purposes
  const responseText = await response.text();
  const blobName = await containerClient.upload(
    responseText,
    "sap-api-getconfproposal-response-body.json",
  );
  const link = containerClient.getBrowserLink(blobName);
  context.info(
    `Archived SAP Work Hours Proposal API response (${response.status}) at ${link}`,
  );

  if (!response.ok) {
    throw new Error(
      `Failed to retrieve proposed work hours (${response.status}): ${getPrettyErrorMessage(responseText)}. For more details, see the archived response: ${link}`,
    );
  }

  return JSON.parse(responseText);
}

/**
 * Track the dependency telemetry for the SAP API call
 */
export function trackSAPDependency(
  method: string,
  url: URL,
  response: Response,
  durationStart: number,
) {
  appInsights.defaultClient.trackDependency({
    name: `${method} ${url.pathname}`,
    resultCode: response.status,
    data: url.toString(),
    dependencyTypeName: "HTTP",
    target: process.env.SAP_BASE_URL,
    duration: Date.now() - durationStart,
    success: response.ok,
  });
}
