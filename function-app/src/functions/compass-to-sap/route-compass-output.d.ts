export type CompassMessage<
  T extends SuperBackFlushXml | ComponentsGoodsIssuesXml | CompassXml,
> = {
  TxnList: {
    TxnWrapper: {
      FileGuid?: string;
      UserName?: string;
      Txn: {
        Request: T;
      };
    }[];
  };
};

export type CompassXml = {
  MessageHeader: {
    MessageType: string;
  };
};

export type SuperBackFlushXml = {
  MessageHeader: {
    MessageType: string;
  };
  MessageDetail: {
    mnInputQtyCompleted_QT01: number;
    mnInputQtyCanceled_TRQT: number;
    mnSequenceNumber_SEQU: string;
    szInputOpStatusCode_OPST: number;
    InterfaceControlBranchPlant: string;
    mnOrderNumber_DOCO: string;
    szLot_LOTN: string;
    szSAPReceiptFlag: boolean;
    szMemoLotField1: string;
    szLocation_LOCN: string;
  };
};

export type ComponentsGoodsIssuesXml = {
  MessageHeader: {
    Environment: string;
    MessageType: string;
    MessageID: string;
    MessageVersion: string;
    MessageReferenceID: string;
    UserID: string;
    UserPassword: string;
    SourceSystemName: string;
    Operation: string;
  };
  MessageDetail: {
    cdcLINKActionCode_EV01: number;
    szUserId_USER: string;
    szWorkStationId_JOBN: string;
    mnJobNumber_JOBS: string;
    szVersion_VERS: string;
    szBranchPlant_MCU: string;
    mnDocumentOrderInvoiceE_DOCO: number;
    mnQuantityToIssue_QNTOW: number;
    szItemNoUnknownFormat_UITM: string;
    mnSequenceNoOperations_OPSQ: number;
    szBranchComponent_CMCU: string;
    szLocation_LOCN: string;
    szLot_LOTN: string;
    mnCompletionIssueQty_QNTOW: number;
    szUnitOfMeasureAsInput_UOM: string;
    cBTNSelectLocation_EV01: number;
    szSLIssueBranchPlant_MCU: string;
    szSLIssueLocation_LOCN: string;
    szSLIssueLot_LOTN: string;
    mnSLIssueQuantity_SOQS: number;
  };
};
