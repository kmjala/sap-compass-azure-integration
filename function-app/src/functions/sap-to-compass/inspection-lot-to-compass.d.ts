/**
 * Message received from the SAP Service Bus Inventory Location Move topic
 */
export type SAPMessage = {
  Plant: string;
  Batch: Batch;
  Material: string;
  InspectionLotQuantity: string;
  InspectionLotQuantityUnit: string;
  BatchStorageLocation: string;
  StatusObjectCategory: string;
  BatchBySupplier: string;
};

export type Batch = {
  Batch: string;
  BatchBySupplier: string;
};
