import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  resetMocks: true,
  testRegex: "test/.*\\.spec\\.ts$",
  verbose: true,
};

export default config;
