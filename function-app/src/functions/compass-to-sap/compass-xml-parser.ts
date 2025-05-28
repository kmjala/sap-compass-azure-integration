import { XMLParser } from "fast-xml-parser";

/**
 * Provides an XMLParser with the necessary configuration to parse incoming
 * Compass XML messages, e.g. to handle TxnWrapper nodes always as arrays.
 */
export function getCompassXmlParser() {
  return new XMLParser({
    removeNSPrefix: true,
    isArray: (name, jpath) => {
      return ["TxnList.TxnWrapper"].includes(jpath);
    },
    numberParseOptions: {
      leadingZeros: false,
      hex: false,
    },
  });
}
