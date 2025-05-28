import { InvocationContext } from "@azure/functions";
import { MyContainerClient } from "../message-archive-client";
import {
  A_ClfnCharcDescForKeyDateType,
  A_ProductCharcValueType,
  SAPAPIListResponse,
} from "./sap-api.d";
import { getPrettyErrorMessage, trackSAPDependency } from "./sap-api";

/**
 * Checks if there is a class characteristics that indicates that it is meant for Compass.
 *
 * This is important for SAP plants that are mapped to multiple physical plants.
 * Example: SAP plant code 1017 -> B005 (COMPASS1) and B346 (MES01).
 *
 * The class characteristic then determines whether it should be sent to
 * Compass (thus processed further) or not (thus skip message).
 *
 * @returns true if class characteristic indicates it is meant for Compass
 */
export async function has1017CompassClassCharacteristic(
  product: string,
  context: InvocationContext,
  containerClient: MyContainerClient,
) {
  // Get the internal ID of the MES_SYSTEM characteristic
  const mesSystemCharcInternalID = await getMES_SYSTEMCharcInternalID(
    context,
    containerClient,
  );

  // Get the product's values for the MES_SYSTEM characteristic
  const mesSystemValues = await getCharacteristicValuations(
    product,
    mesSystemCharcInternalID,
    context,
    containerClient,
  );

  // Return whether or not the product is meant for Compass
  return mesSystemValues.d.results
    .map((v) => v.CharcValue)
    .includes("1017_COMPASS");
}

/**
 * @returns all values of the specified characteristic for the given product
 * @see https://api.sap.com/api/OP_API_CLFN_PRODUCT_SRV/resource/get_A_ProductCharcValue
 */
async function getCharacteristicValuations(
  product: string,
  charcInternalID: string,
  context: InvocationContext,
  containerClient: MyContainerClient,
) {
  const url = new URL(
    "/materialclassification/v1/A_ProductCharcValue",
    process.env.SAP_BASE_URL,
  );
  url.searchParams.append(
    "$filter",
    `Product eq '${encodeURIComponent(product)}' and CharcInternalID eq '${encodeURIComponent(charcInternalID)}'`,
  );

  context.info(
    `Getting characteristic valuations from SAP API: ${url.toString()}`,
  );
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
    "sap-api-get-product-class-response-body.json",
  );
  const link = containerClient.getBrowserLink(blobName);
  context.info(
    `Archived SAP characteristic valuations API response for '${product}' (${response.status}) at ${link}`,
  );

  if (!response.ok) {
    throw new Error(
      `Failed to retrieve characteristic valuations for '${product}' (${response.status}): ${getPrettyErrorMessage(responseText)}. For more details, see the archived response: ${link}`,
    );
  }

  return JSON.parse(
    responseText,
  ) as SAPAPIListResponse<A_ProductCharcValueType>;
}

/**
 * Cached internal ID of the MES_SYSTEM characteristic.
 *
 * This is used to avoid making multiple API calls to get the same characteristic.
 */
let mesSystemCharcInternalID: undefined | string;

/**
 * @returns Characteristic internal ID for the MES_SYSTEM characteristic
 * @see https://api.sap.com/api/OP_API_CLFN_CHARACTERISTIC_SRV/path/get_A_ClfnCharcDescForKeyDate
 */
async function getMES_SYSTEMCharcInternalID(
  context: InvocationContext,
  containerClient: MyContainerClient,
) {
  // Return the cached internal ID if it has already been retrieved
  if (mesSystemCharcInternalID) {
    return mesSystemCharcInternalID;
  }

  // Update the cache if the description has not been retrieved yet
  const url = new URL(
    "/classificationcharacteristic/v1/A_ClfnCharcDescForKeyDate",
    process.env.SAP_BASE_URL,
  );
  url.searchParams.append(
    "$filter",
    "CharcDescription eq 'MES_SYSTEM' and Language eq 'EN'",
  );
  context.info(
    `Getting internal ID of MES_SYSTEM characteristic from SAP API: ${url.toString()}`,
  );
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
    "sap-api-get-mes_system-characteristic-internal-id-response-body.json",
  );
  const link = containerClient.getBrowserLink(blobName);
  context.info(
    `Archived SAP API response for searching MES_SYSTEM characteristic (${response.status}) at ${link}`,
  );

  if (!response.ok) {
    throw new Error(
      `Failed to retrieve MES_SYSTEM characteristic internal ID (${response.status}): ${getPrettyErrorMessage(responseText)}. For more details, see the archived response: ${link}`,
    );
  }

  // Throw an error if the characteristic is not found
  const responseJson = JSON.parse(
    responseText,
  ) as SAPAPIListResponse<A_ClfnCharcDescForKeyDateType>;
  if (responseJson.d.results.length !== 1) {
    throw new Error(
      `Expected exactly one MES_SYSTEM characteristic, but found ${responseJson.d.results.length}. For more details, see the archived response: ${link}`,
    );
  }

  // Cache the characteristic internal ID
  mesSystemCharcInternalID = responseJson.d.results[0].CharcInternalID;
  return mesSystemCharcInternalID;
}
