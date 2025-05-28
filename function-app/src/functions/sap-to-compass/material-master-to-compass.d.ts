/**
 * Message received from the SAP Service Bus Material Master topic
 */
export type SAPMessage = {
  Product: string;
  ProductDescription: {
    Language: string;
    ProductDescription: string;
  }[];
  BaseUnit: string;
  BaseUnitISOCode: string;
  countryOfOrigin: string;
  PlantData: PlantData[];
  ProductClass?: ClassAssignment[];
};

export type PlantData = {
  CountryOfOrigin: string;
  Plant: string;
  ProfileCode: string;
};

export type ClassAssignment = {
  ClassDetails?: {
    ClassTypeName?: string;
    Class?: string;
  };
  ProductClassCharc?: {
    Description?: {
      CharcDescription?: string;
    };
    Valuation?: {
      CharcValue?: string;
    }[];
  }[];
};

export type CompassMessage = {
  MaterialNumber: string;
  Filename: string;
  Plant: string;
  CreateXmlBlob: string;
  UpdateXmlBlob: string;
};
