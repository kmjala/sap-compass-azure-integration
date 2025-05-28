import { InvocationContext } from "@azure/functions";

/**
 * Prepares the trace context, e.g. with the correlation ID.
 *
 * The trace context can then be used in logging and telemetry, e.g. to
 * correlate logs.
 *
 * It also logs the correlation id to correlate logs across different
 * components, e.g. between the MES Azure Client, the route-compass-output
 * function, and the components-goods-issues-to-sap function.
 *
 * @example
 *  context.info("My log message", context.traceContext.attributes);
 */
export function populateTraceContext(context: InvocationContext) {
  // Create the trace context object if it does not exist
  if (!context.traceContext) {
    context.traceContext = {};
  }
  if (!context.traceContext.attributes) {
    context.traceContext.attributes = {};
  }

  // Add the correlation id to the trace context
  context.traceContext.attributes.correlationId = getCorrelationId(context);

  // Log the correlation id for easier debugging
  context.info("Trace context attributes", context.traceContext.attributes);
}

/**
 * @returns Correlation ID from the incoming SAP message, or a new ID if not present.
 */
function getCorrelationId(context: InvocationContext): string {
  if (context.triggerMetadata.correlationId) {
    return String(context.triggerMetadata.correlationId);
  } else if (context.triggerMetadata.correlationid) {
    return String(context.triggerMetadata.correlationid);
  }
  // If SAP did not provide a correlation ID, use the invocation ID instead
  else {
    return context.invocationId;
  }
}
