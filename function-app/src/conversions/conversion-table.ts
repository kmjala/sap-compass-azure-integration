import { parseFile } from "@fast-csv/parse";

class Conversions {
  private name: string;
  private s4ToMes = new Map<string, string>();
  private mesToS4 = new Map<string, string>();

  constructor(name: string) {
    this.name = name;
  }

  /**
   * @returns true if the given Compass Value has a SAP S4 value
   */
  hasSAPValue(compass: string) {
    return this.mesToS4.has(`${compass}`);
  }

  /**
   * @returns SAP S4 value for the given Compass value
   */
  getSAPValue(compass: string) {
    // Convert the key to a string to ensure it's a string
    if (!this.mesToS4.has(`${compass}`)) {
      throw new Error(
        `SAP S4 ${this.name} value not found for SAP S4 value "${compass}"`,
      );
    }
    return this.mesToS4.get(`${compass}`);
  }

  /**
   * @returns true if the given SAP S4 value has a Compass value
   */
  hasCompassValue(s4: string) {
    return this.s4ToMes.has(`${s4}`);
  }

  /**
   * @returns Compass value for the given S4 value
   */
  getCompassValue(s4: string) {
    // Convert the key to a string to ensure it's a string
    if (!this.s4ToMes.has(`${s4}`)) {
      throw new Error(
        `Compass ${this.name} value not found for SAP S4 value "${s4}"`,
      );
    }
    return this.s4ToMes.get(`${s4}`);
  }

  addConversion(compass: string, s4: string) {
    /*
     * Only add the conversion if it's not already in the map. This takes
     * care of cases where multiple Compass values are mapped to a single
     * S4 value.
     *
     * A typical example is the UOM conversion table, where Compass has
     * both "kg" and "KG" mapped to "KG" in SAP.
     */
    if (!this.s4ToMes.has(s4)) {
      this.s4ToMes.set(s4, compass);
    }
    if (!this.mesToS4.has(compass)) {
      this.mesToS4.set(compass, s4);
    }
  }
}

export let uomConversions: Conversions;
export let plantConversions: Conversions;
export let locationConversions: Conversions;
export let inventoryLocationMoveStatusConversions: Conversions;

export async function initialiseConversionTable() {
  uomConversions = await readCsv("uom.csv", "UOM");
  plantConversions = await readCsv("plant.csv", "Plant");
  locationConversions = await readCsv("location.csv", "Location");
  inventoryLocationMoveStatusConversions = await readCsv(
    "inventory-location-move-status.csv",
    "Inventory Location Move Status",
  );
}

/**
 * @param name the name of the conversion table used for logging
 * @returns the parsed CSV file as a map
 */
function readCsv(file: string, name: string): Promise<Conversions> {
  return new Promise((resolve, reject) => {
    const conversions = new Conversions(name);
    parseFile(`./src/conversions/${file}`, { headers: true })
      .on("error", (error) => {
        console.error(`Failed to parse ${file}: ${error}`);
        reject(error);
      })
      .on("data", (row) => {
        // Only add the conversion if it's enabled
        if (row.Enabled !== undefined && !JSON.parse(row.Enabled)) {
          return;
        }
        conversions.addConversion(row.Compass, row.S4);
      })
      .on("end", (rowCount: number) => {
        console.debug(`Parsed ${rowCount} rows from ${file}`);
        resolve(conversions);
      });
  });
}

/**
 * @returns true if the given S4 plant is a Compass1 plant, false otherwise
 */
export function isCompass1Plant(s4plant: string) {
  // Compass1 plants are all plants except APN (1015)
  return s4plant !== "1015";
}
