import { InvocationContext } from "@azure/functions";
import { getServiceBusSender } from "../../service-bus-client";
import { CompassMessage, CompassXml } from "./route-compass-output.d";

const queueName = "transaction-manager-status-updates-to-compass";

/**
 * Sets the file status in the Compass Transaction Manager to completed for the
 * Compass Azure Client, given the file handover to Azure was successful.
 */
export async function setTransactionManagerInProcessStatus(
  fileGuid: string,
  context: InvocationContext,
) {
  context.info(
    `Setting TransactionManager in-process status for fileGuid '${fileGuid}'`,
  );
  try {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<Request>
    <FileGuiId>${fileGuid}</FileGuiId>
    <AppName>MES-Azure-Client</AppName>
    <Status>1</Status>
    <StatusMessage>XML file is being processed in Azure</StatusMessage>
</Request>
`;
    await sendMessage(body, fileGuid, context);
  } catch (error) {
    // Gracefully handle the error, as this error should not interrupt
    // processing the message to SAP.
    context.error(
      `Failed to set Transaction Manager in-progress status for file ${fileGuid}`,
      error,
    );
  }
}

async function sendMessage(
  body: string,
  fileGuid: string,
  context: InvocationContext,
) {
  // Don't send messages if the Transaction Manager cannot relate it to a file
  if (!fileGuid) {
    return;
  }

  // Removes the newline characters from the given string.
  //
  // Required, since newline characters cause an error in the Compass Transaction
  // Manager. Adding the Windows-style \r characters to the XML message is just
  // more logic than necessary, since this works just as well and we don't have
  // to consider future cases where non-Windows consumers process the message.
  body = body.replace(/\n/g, "");

  // Convert the string to a buffer, as the message otherwise automatically
  // adds double-quotes around the message and escapes the quotes inside the
  // body... as if it calls JSON.stringify() on the body.
  const bufferedBody = Buffer.from(body);

  return await getServiceBusSender(queueName).sendMessages({
    body: bufferedBody,
    contentType: "application/xml",
    sessionId: fileGuid,
    correlationId: context.traceContext.attributes.correlationId,
  });
}

/**
 * Sets the file status in the Compass Transaction Manager to failed.
 *
 * @param error The error message shown to the user
 */
export async function setTransactionManagerFailedStatus(
  fileGuid: string,
  error: string,
  context: InvocationContext,
) {
  try {
    context.info(
      `Setting TransactionManager failed status for fileGuid '${fileGuid}'`,
    );
    const body = `<?xml version="1.0" encoding="utf-8"?>
<Request>
    <FileGuiId>${fileGuid}</FileGuiId>
    <AppName>Azure</AppName>
    <Status>0</Status>
    <StatusMessage>${error}</StatusMessage>
</Request>
`;
    await sendMessage(body, fileGuid, context);
  } catch (error) {
    // Gracefully handle the error, as this error should not interrupt
    // processing the message to SAP.
    context.error(
      `Failed to set Transaction Manager failed status for file ${fileGuid}`,
      error,
    );
  }
}

export async function setTransactionManagerCompletedStatus(
  fileGuid: string,
  message: string,
  context: InvocationContext,
) {
  context.info(
    `Setting TransactionManager completed status for fileGuid '${fileGuid}'`,
  );
  try {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<Request>
    <FileGuiId>${fileGuid}</FileGuiId>
    <AppName>Azure</AppName>
    <Status>1</Status>
    <StatusMessage>${message}</StatusMessage>
</Request>
`;
    sendMessage(body, fileGuid, context);
  } catch (error) {
    // Gracefully handle the error, as this error should not interrupt
    // processing the message to SAP.
    context.error(
      `Failed to set Transaction Manager success status for file ${fileGuid}`,
      error,
    );
  }
}

/**
 * @returns File GUID field from the incoming XML message
 */
export function getXmlFileGuid(
  xml: CompassMessage<CompassXml>,
  context: InvocationContext,
) {
  try {
    const fileGuid = xml.TxnList?.TxnWrapper[0]?.FileGuid;
    context.traceContext.attributes.fileGuid = fileGuid;
    return fileGuid;
  } catch (error) {
    context.warn("Failed to extract FileGuid from the XML message", error);
    return undefined;
  }
}
