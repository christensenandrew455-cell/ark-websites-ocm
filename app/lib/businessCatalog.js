export const BUSINESS_TYPES = Object.freeze([
  "Plumbing",
  "Drain & Sewer",
  "HVAC",
  "Electrical",
  "Pest & Termite Control",
  "Appliance Repair",
  "Garage & Overhead Door",
  "Commercial Refrigeration",
  "Commercial Kitchen Equipment",
  "Painting",
  "Handyman",
]);

export const SERVICE_SUGGESTIONS_BY_BUSINESS_TYPE = Object.freeze({
  Plumbing: Object.freeze([
    "Leak repair",
    "Pipe repair",
    "Drain repair",
    "Water heater service",
    "Water heater replacement",
    "Toilet repair",
    "Fixture repair",
    "Repiping",
    "Sump pump service",
    "Gas line service",
  ]),
  "Drain & Sewer": Object.freeze([
    "Drain clearing",
    "Sewer backup",
    "Drain inspection",
    "Hydro jetting",
    "Sewer repair",
    "Sewer replacement",
    "Trenchless repair",
    "Root removal",
    "Drain repair",
    "Sewer cleanout",
    "Storm drain service",
  ]),
  HVAC: Object.freeze([
    "Air conditioning service",
    "Heating service",
    "Furnace service",
    "Boiler service",
    "Heat pump service",
    "HVAC replacement",
    "HVAC installation",
    "Ductwork service",
    "Thermostat service",
    "Air quality service",
    "HVAC maintenance",
  ]),
  Electrical: Object.freeze([
    "Electrical repair",
    "Electrical troubleshooting",
    "Wiring repair",
    "Electrical panel service",
    "Circuit repair",
    "Outlet and switch service",
    "Rewiring",
    "Lighting installation",
    "Generator service",
    "EV charger installation",
  ]),
  "Pest & Termite Control": Object.freeze([
    "Pest inspection",
    "General pest control",
    "Termite inspection",
    "Termite treatment",
    "Rodent control",
    "Bed bug treatment",
    "Cockroach treatment",
    "Ant control",
    "Stinging insect removal",
    "Flea and tick treatment",
    "Mosquito control",
    "Preventive treatment",
  ]),
  "Appliance Repair": Object.freeze([
    "Kitchen appliance repair",
    "Refrigeration appliance repair",
    "Laundry appliance repair",
    "Gas appliance repair",
    "Appliance installation",
  ]),
  "Garage & Overhead Door": Object.freeze([
    "Garage door repair",
    "Broken spring replacement",
    "Garage door opener service",
    "Garage door replacement",
    "Garage door installation",
    "Commercial door repair",
    "Loading dock repair",
    "Garage door maintenance",
  ]),
  "Commercial Refrigeration": Object.freeze([
    "Refrigeration repair",
    "Cooler repair",
    "Freezer repair",
    "Ice machine repair",
    "Temperature control repair",
    "Refrigeration installation",
    "Refrigeration maintenance",
  ]),
  "Commercial Kitchen Equipment": Object.freeze([
    "Cooking equipment repair",
    "Dishwashing equipment repair",
    "Ice machine repair",
    "Warming equipment repair",
    "Gas equipment repair",
    "Electrical equipment repair",
    "Equipment installation",
    "Equipment maintenance",
  ]),
  Painting: Object.freeze([
    "Interior painting",
    "Exterior painting",
    "Residential painting",
    "Commercial painting",
    "Cabinet painting",
    "Staining",
    "Drywall repair",
    "Wallpaper removal",
    "Touch-up painting",
    "Epoxy floor coating",
  ]),
  Handyman: Object.freeze([
    "Handyman services",
    "Home repairs",
    "Furniture assembly",
    "TV mounting",
    "Picture and shelf hanging",
    "Door repair",
    "Drywall repair",
    "Trim and molding repair",
    "Fixture installation",
    "Caulking",
    "Deck and fence repair",
  ]),
});

const BUSINESS_TYPE_LOOKUP = new Map(BUSINESS_TYPES.map((businessType) => [businessType.toLowerCase(), businessType]));
const LEGACY_BUSINESS_TYPE_ALIASES = new Map([
  ["pest control", "Pest & Termite Control"],
]);

export function canonicalBusinessType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return BUSINESS_TYPE_LOOKUP.get(normalized) || LEGACY_BUSINESS_TYPE_ALIASES.get(normalized) || "";
}

export function isSupportedBusinessType(value) {
  return Boolean(canonicalBusinessType(value));
}

export function serviceSuggestionsForBusinessType(value) {
  const businessType = canonicalBusinessType(value);
  return businessType ? SERVICE_SUGGESTIONS_BY_BUSINESS_TYPE[businessType] : [];
}
