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

function unique(values, normalize = (value) => value.toLowerCase()) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = normalize(value);
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function items(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(/[\n,]/);
  return source.map(clean).filter(Boolean);
}

export function canonicalUsState(value) {
  return STATE_LOOKUP.get(clean(value).toLowerCase()) || "";
}

export function serviceAreaFields(value = []) {
  const values = items(value);
  const states = unique(values.map(canonicalUsState).filter(Boolean));
  const areaCandidates = values.filter((item) => !canonicalUsState(item)).map(clean);
  const counties = unique(areaCandidates);
  return {
    states,
    counties,
    state: states[0] || "",
    county: counties[0] || "",
  };
}

export function serviceAreaValues(states, counties = []) {
  const normalizedStates = unique(items(states).map(canonicalUsState).filter(Boolean));
  if (!normalizedStates.length) return [];
  if (normalizedStates.length > 1) return normalizedStates;
  const normalizedCounties = unique(items(counties).filter((item) => !canonicalUsState(item)).map(clean));
  return [...normalizedStates, ...normalizedCounties];
}

export function normalizeServiceAreas(value) {
  const fields = serviceAreaFields(value);
  return serviceAreaValues(fields.states, fields.counties);
}

export function serviceAreaValidationError(value) {
  const { states, counties } = serviceAreaFields(value);
  if (!states.length) return "Choose at least one state.";
  if (states.length > 1 && counties.length) return "Remove all counties before adding more than one state.";
  return "";
}
