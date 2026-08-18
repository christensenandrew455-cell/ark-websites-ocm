const STATE_ENTRIES = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
  ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"],
  ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"],
  ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"],
  ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"],
  ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"],
  ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"],
  ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
  ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"],
  ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
];

export const US_STATES = Object.freeze(STATE_ENTRIES.map(([, name]) => name));

const STATE_LOOKUP = new Map(STATE_ENTRIES.flatMap(([abbreviation, name]) => [
  [abbreviation.toLowerCase(), name],
  [name.toLowerCase(), name],
]));

function clean(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function canonicalUsState(value) {
  return STATE_LOOKUP.get(clean(value).toLowerCase()) || "";
}

export function serviceAreaFields(value = []) {
  const items = (Array.isArray(value) ? value : String(value || "").split(/[\n,]/))
    .map(clean)
    .filter(Boolean);
  const stateIndex = items.findIndex((item) => canonicalUsState(item));
  const state = stateIndex >= 0 ? canonicalUsState(items[stateIndex]) : "";
  const countyCandidates = items.filter((_, index) => index !== stateIndex);
  const county = countyCandidates.find((item) => /\bcounty\b/i.test(item)) || countyCandidates[0] || "";
  return { state, county };
}

export function serviceAreaValues(state, county) {
  return [canonicalUsState(state), clean(county)].filter(Boolean);
}

export function normalizeServiceAreas(value) {
  const fields = serviceAreaFields(value);
  return serviceAreaValues(fields.state, fields.county);
}
