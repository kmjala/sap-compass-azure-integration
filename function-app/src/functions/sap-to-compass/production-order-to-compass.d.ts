export type SAPMessage = {
  Material: string;
  OrderLongText: string;
  ManufacturingOrder: string;
  ProductionPlant: string;
  Plant: string;
  TotalQuantity: string;
  RequiredQuantity: string;
  ProductionUnitISOCode: string;
  ProductionOrderStatuses: {
    results: ProductionOrderStatus[];
  };
  MfgOrderPlannedStartDateTimeISO: string;
  MfgOrderPlannedEndDateTimeISO: string;
  MfgOrderScheduledStartDateTimeISO: string;
  MfgOrderScheduledEndDateTimeISO: string;
  ProductionOrderComponents: ProductionOrderComponent[];
  ProductionOrderOperations: ProductionOrderOperation[];
  OrderIsCreated: string;
  OrderIsReleased: string;
  OrderIsPartiallyConfirmed: string;
  OrderIsConfirmed: string;
  OrderIsDelivered: string;
  OrderIsPartiallyDelivered: string;
  OrderIsTechnicallyCompleted: string;
};

export type ProductionOrderComponent = {
  RequiredQuantity: string;
  BOMItem: string;
  ManufacturingOrderSequence: string;
  ManufacturingOrderOperation: string;
  BaseUnitISOCode: string;
  StorageLocation: string;
  MatlCompIsMarkedForBackflush: boolean;
  IsBulkMaterialComponent: boolean;
  Material: string;
  MatlCompIsMarkedForDeletion: boolean;
  MaterialComponentIsPhantomItem: boolean;
};

export type ProductionOrderOperation = {
  WorkCenter: string;
  ManufacturingOrderOperation: string;
  ManufacturingOrderSequence: string;
  OrderOperationLongText: string;
  MfgOrderOperationText: string;
  OpErlstSchedldExecStrtDteTmeISO: string;
  OpErlstSchedldExecEndDteTmeISO: string;
  OpPlannedTotalQuantity: number;
  OpTotalConfirmedYieldQty: number;
  OperationIsPartiallyConfirmed: string;
  OperationIsReleased: string;
  OperationIsClosed: string;
  OperationIsDeleted: string;
};

export type ProductionOrderStatus = {
  StatusCode: string;
  StatusShortName: string;
};
