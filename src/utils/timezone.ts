export interface Address {
  country: string;
  state?: string;
  city?: string;
}

const US_STATE_TIMEZONES: Record<string, string> = {
  CA: "America/Los_Angeles",
  OR: "America/Los_Angeles",
  WA: "America/Los_Angeles",
  NV: "America/Los_Angeles",
  AZ: "America/Phoenix",
  CO: "America/Denver",
  UT: "America/Denver",
  NM: "America/Denver",
  MT: "America/Denver",
  ID: "America/Denver",
  ND: "America/Chicago",
  SD: "America/Chicago",
  NE: "America/Chicago",
  KS: "America/Chicago",
  OK: "America/Chicago",
  TX: "America/Chicago",
  MN: "America/Chicago",
  IA: "America/Chicago",
  MO: "America/Chicago",
  AR: "America/Chicago",
  LA: "America/Chicago",
  WI: "America/Chicago",
  IL: "America/Chicago",
  MI: "America/Detroit",
  IN: "America/Indiana/Indianapolis",
  KY: "America/New_York",
  TN: "America/Chicago",
  MS: "America/Chicago",
  AL: "America/Chicago",
  GA: "America/New_York",
  FL: "America/New_York",
  SC: "America/New_York",
  NC: "America/New_York",
  VA: "America/New_York",
  WV: "America/New_York",
  OH: "America/New_York",
  PA: "America/New_York",
  NY: "America/New_York",
  MD: "America/New_York",
  DE: "America/New_York",
  NJ: "America/New_York",
  CT: "America/New_York",
  RI: "America/New_York",
  MA: "America/New_York",
  VT: "America/New_York",
  NH: "America/New_York",
  ME: "America/New_York",
  AK: "America/Anchorage",
  HI: "Pacific/Honolulu",
  PR: "America/Puerto_Rico"
};

const COUNTRY_DEFAULT_TIMEZONES: Record<string, string> = {
  US: "America/New_York",
  CA: "America/Toronto",
  GB: "Europe/London",
  IE: "Europe/Dublin",
  FR: "Europe/Paris",
  DE: "Europe/Berlin",
  ES: "Europe/Madrid",
  IT: "Europe/Rome",
  AU: "Australia/Sydney",
  NZ: "Pacific/Auckland"
};

export const inferTimezoneFromAddress = (address: Address): string => {
  const country = address.country?.toUpperCase();
  if (!country) {
    return "UTC";
  }

  if (country === "US" && address.state) {
    const state = address.state.toUpperCase();
    if (US_STATE_TIMEZONES[state]) {
      return US_STATE_TIMEZONES[state];
    }
  }

  return COUNTRY_DEFAULT_TIMEZONES[country] ?? "UTC";
};

