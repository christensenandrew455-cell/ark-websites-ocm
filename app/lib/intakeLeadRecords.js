export function mergeablePropertyMatches(sectionKey, matches = []) {
  return sectionKey === "contactedMe" ? [] : matches;
}
