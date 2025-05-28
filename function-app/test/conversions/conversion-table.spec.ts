import {
  initialiseConversionTable,
  inventoryLocationMoveStatusConversions,
  plantConversions,
  uomConversions,
} from "../../src/conversions/conversion-table";

beforeAll(async () => {
  await initialiseConversionTable();
});

describe("UOM conversion", () => {
  test("should convert S4 UOM to Compass UOM", () => {
    const actual = uomConversions.getCompassValue("EA");
    expect(actual).toMatch("EA");
  });

  test("should throw an error when S4 UOM is unknown", () => {
    expect(() => uomConversions.getCompassValue("not-a-uom")).toThrow(
      'Compass UOM value not found for SAP S4 value "not-a-uom"',
    );
  });
});

describe("Plant conversion", () => {
  test("should indicate that plant uses Compass", () => {
    const actual = plantConversions.hasCompassValue("1015");
    expect(actual).toBe(true);
  });

  test("should indicate that plant does not use Compass", () => {
    const actual = plantConversions.hasCompassValue("not-a-compass-plant");
    expect(actual).toBe(false);
  });
});

describe("Inventory Location Move Status conversion", () => {
  test.each([
    ["R", "R"],
    ["Q4", "X"],
    ["B6", "X"],
    ["F2", ""],
  ])(
    "should convert S4 status '%s' to Compass status '%s'",
    (s4Value, compassValue) => {
      const actual =
        inventoryLocationMoveStatusConversions.getCompassValue(s4Value);
      expect(actual).toMatch(compassValue);
    },
  );

  test("should throw an error when S4 status is unknown", () => {
    expect(() =>
      inventoryLocationMoveStatusConversions.getCompassValue("not-a-status"),
    ).toThrow(
      'Compass Inventory Location Move Status value not found for SAP S4 value "not-a-status"',
    );
  });
});
