const LEAD_EMAIL_FIELDS = Object.freeze([
  "Email",
  "email",
  "Emails",
  "emails",
  "EmailAddress",
  "emailAddress",
  "email_address",
  "callerEmail",
  "caller_email",
  "customerEmail",
  "customer_email",
]);

const LEAD_CONTACT_METHOD_FIELDS = Object.freeze([
  "BestContactMethod",
  "bestContactMethod",
  "best_contact_method",
  "BestFormOfContact",
  "bestFormOfContact",
  "best_form_of_contact",
  "BestWayToContact",
  "bestWayToContact",
  "best_way_to_contact",
  "PreferredContactMethod",
  "preferredContactMethod",
  "preferred_contact_method",
  "ContactMethod",
  "contactMethod",
  "contact_method",
]);

export const REMOVED_LEAD_CONTACT_FIELDS = Object.freeze([
  ...LEAD_EMAIL_FIELDS,
  ...LEAD_CONTACT_METHOD_FIELDS,
]);

const REMOVED_FIELD_SET = new Set(REMOVED_LEAD_CONTACT_FIELDS);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function stripLeadContactFields(value) {
  if (Array.isArray(value)) return value.map((item) => stripLeadContactFields(item));
  if (!isPlainObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([field]) => !REMOVED_FIELD_SET.has(field))
      .map(([field, item]) => [field, stripLeadContactFields(item)])
  );
}

export function leadContactFieldDeletionPatch(deleteValue) {
  return Object.fromEntries(
    REMOVED_LEAD_CONTACT_FIELDS.map((field) => [field, deleteValue])
  );
}
