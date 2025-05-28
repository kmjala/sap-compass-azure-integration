export type SAPAPIObjectResponse<T> = {
  d: T;
};

export type SAPAPIListResponse<T> = {
  d: SAPAPIList<T>;
};

export type SAPAPIList<T> = {
  results: T[];
};

export type SAPAPIErrorResponse = {
  error: {
    code: string;
    message:
      | {
          lang: string;
          value: string;
        }
      | {
          lang: string;
          value: string;
        }[];
    innererror: {
      application: {
        component_id: string;
        service_namespace: string;
        service_id: string;
        service_version: string;
      };
      transactionid: string;
      timestamp: string;
      Error_Resolution: {
        SAP_Transaction: string;
        SAP_Note: string;
      };
      errordetails: [];
    };
  };
};

// Production Order Confirmation Requests
export type ProductionOrderConfirmationRequest = {
  OrderID?: string;
  Plant?: string;
  OrderOperation?: string;
  Sequence?: string;
  ConfirmationYieldQuantity?: string;
  ConfirmationScrapQuantity?: string;
  OpConfirmedWorkQuantity1?: string;
  OpConfirmedWorkQuantity2?: string;
  OpConfirmedWorkQuantity3?: string;
  OpConfirmedWorkQuantity4?: string;
  OpConfirmedWorkQuantity5?: string;
  OpConfirmedWorkQuantity6?: string;
  IsFinalConfirmation?: boolean;
  FinalConfirmationType?: string;
  OpenReservationsIsCleared?: boolean;
  to_ProdnOrdConfMatlDocItm?: {
    OrderID?: string;
    OrderItem?: string;
    Material?: string;
    Plant?: string;
    StorageLocation?: string;
    GoodsMovementType?: string;
    GoodsMovementRefDocType?: string;
    EntryUnit?: string;
    EntryUnitISOCode?: string;
    QuantityInEntryUnit: string;
    Batch?: string;
    ProductionSupplyArea?: string;
    EWMStorageBin?: string;
    EWMWarehouse?: string;
    ManufactureDate?: string;
    to_ProdnOrderConfBatchCharc?: {
      Characteristic: string;
      CharcValue: string;
    }[];
  }[];
};

export type ProductionOrderResponse = SAPAPIObjectResponse<{
  Material: string;
  ProductionUnit: string;
}>;

export type Components = {
  Material: string;
  Reservation: string;
  ReservationItem: string;
  QuantityIsFixed?: boolean;
};

// Get Conf Proposal Request
export type GetConfProposalRequest = {
  OrderID: string;
  OrderOperation: string;
  Sequence: string;
  ConfirmationYieldQuantity: string;
  ConfirmationScrapQuantity: string;
  ActivityIsToBeProposed: boolean;
};

export type GetConfProposalResponse = SAPAPIObjectResponse<{
  GetConfProposal: {
    OpConfirmedWorkQuantity1: string;
    OpConfirmedWorkQuantity2: string;
    OpConfirmedWorkQuantity3: string;
    OpConfirmedWorkQuantity4: string;
    OpConfirmedWorkQuantity5: string;
    OpConfirmedWorkQuantity6: string;
  };
}>;

// Components Goods Issues Request
export type ComponentGoodsIssuesRequest = {
  OrderID: string;
  OrderOperation: string;
  Sequence: string;
  to_ProdnOrdConfMatlDocItm: {
    OrderID: string;
    Material: string;
    Plant: string;
    StorageLocation: string;
    GoodsMovementType: string;
    EntryUnitISOCode: string;
    QuantityInEntryUnit: string;
    Batch: string;
    EWMStorageBin: string;
    EWMWarehouse: string;
  }[];
};

/**
 * API_CLFN_CHARACTERISTIC_SRV.A_ClfnCharcDescForKeyDateType
 */
export type A_ClfnCharcDescForKeyDateType = {
  CharcInternalID: string;
  Language: string;
  CharcDescription: string;
};

/**
 * API_CLFN_PRODUCT_SRV.A_ClfnClassForKeyDateType
 */
export type A_ClfnClassForKeyDateType = {
  Class: string;
};

/**
 * API_CLFN_PRODUCT_SRV.A_ProductClassCharcType
 */
export type A_ProductClassCharcType = {
  Product: string;
  ClassInternalID: string;
  CharcInternalID: string;
  to_Valuation: SAPAPIList<A_ProductCharcValueType>;
};

/**
 * API_CLFN_PRODUCT_SRV.A_ProductCharcValueType
 */
export type A_ProductCharcValueType = {
  CharcValue: string;
};

export type A_ProductClassType = {
  Product: string;
  ClassInternalID: string;
  to_ClassDetails: A_ClfnClassForKeyDateType;
  to_Characteristics: SAPAPIList<A_ProductClassCharcType>;
};
