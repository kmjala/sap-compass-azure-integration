import { ClassAssignment } from "./material-master-to-compass.d";

/**
 * Message received from the SAP Service Bus Inventory Location Move topic
 */
export type SAPMessage = {
  EWMWarehouse: string;
  Batch: {
    Batch: string;
    BatchBySupplier: string;
  };
  Product: {
    Product: string;
    ProductClass: ClassAssignment[];
  };
  AvailableEWMStockQty: number;
  EWMStockQtyBaseUnitISOCode: string;
  EWMStorageBin: string;
  EWMStockType: string;
  ShelfLifeExpirationDate: string | undefined;
  ParentBatchValue: string;
  EWMBatchIsInRestrictedUseStock: boolean;
};
