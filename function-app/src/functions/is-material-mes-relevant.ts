import { ClassAssignment } from "./sap-to-compass/material-master-to-compass.d";

/**
 * @returns true if the given class assignment indicates that the material is MES relevant, false otherwise
 */
export function isMaterialMesRelevant(classAssignmentsList: ClassAssignment[]) {
  const classAssignment = classAssignmentsList
    // Get all Material class assignments
    ?.filter(
      (a) =>
        a.ClassDetails?.ClassTypeName == "Material Class" &&
        a.ClassDetails?.Class == "INTERFACE_DATA",
    )
    // Get the product class characteristics
    .map((classAssignment) => classAssignment?.ProductClassCharc)
    .flat()
    // Get all class characteristics that are MES relevant
    .filter((c) => c?.Description?.CharcDescription == "IS MES RELEVANT")
    // Ignore all characteristics that do not have a valuation
    .filter((characteristic) => characteristic?.Valuation.length > 0)
    // Find a characteristic that has a value of "YES", i.e. it is MES relevant
    .find(
      (characteristic) => characteristic?.Valuation[0]?.CharcValue == "YES",
    );

  // Result is true if a characteristic was found, false otherwise
  return classAssignment !== undefined;
}
