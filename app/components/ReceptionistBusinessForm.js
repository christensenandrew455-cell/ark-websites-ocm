"use client";

import { useState } from "react";
import { businessInformationText, normalizeBusinessInformation } from "../lib/receptionistBusinessInformation";
import { dashBusinessName } from "../lib/valueUtils";

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const TIME_ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "America/Anchorage", "Pacific/Honolulu"];
const HOURS = Array.from({ length: 12 }, (_, index) => index + 1);
const PERIODS = ["AM", "PM"];
const RAILWAY_OWNED_FIELDS = new Set([
  "receptionistName",
  "aiVoice",
  "aiModel",
  "aiSpeechSpeed",
  "aiSilenceMs",
  "aiSilenceSeconds",
  "openingLine",
  "closingLine",
]);
const REMOVED_BUSINESS_HOUR_FIELDS = new Set([
  "businessHours",
  "businessWeekdays",
  "businessStartHour",
  "businessStartPeriod",
  "businessEndHour",
  "businessEndPeriod",
]);

function titleCase(value) {
  const text = String(value || "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function parseTime(value) {
  const match = String(value || "").toUpperCase().match(/\b(1[0-2]|[1-9])(?::\d{2})?\s*(AM|PM)\b/);
  return match ? { hour: Number(match[1]), period: match[2] } : { hour: "", period: "" };
}

function formatTime(hour, period) {
  const selectedHour = Number(hour);
  return Number.isInteger(selectedHour) && selectedHour >= 1 && selectedHour <= 12 && PERIODS.includes(period)
    ? `${selectedHour}:00 ${period}`
    : "";
}

function formatDayList(days) {
  const labels = WEEKDAYS.filter((day) => days.includes(day)).map(titleCase);
  if (labels.length === 7) return "every day";
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

function Field({ label, hint = "", children, wide = false }) {
  return (
    <label className={wide ? "min-w-0 md:col-span-2" : "min-w-0"}>
      <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.12em] text-slate-500 sm:text-xs">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] font-semibold leading-4 text-slate-500">{hint}</span>}
    </label>
  );
}

function Input({ value, onChange, type = "text", placeholder = "", readOnly = false }) {
  return <input type={type} value={value ?? ""} onChange={onChange} placeholder={placeholder} readOnly={readOnly} className={readOnly ? "h-11 w-full rounded-xl border border-slate-200 bg-slate-100 px-3 text-sm text-slate-600" : "h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-950"} />;
}

function Select({ value, onChange, children, ariaLabel }) {
  return <select aria-label={ariaLabel} value={value ?? ""} onChange={onChange} className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-950">{children}</select>;
}

function DayCheckboxes({ label, hint, selected, onChange }) {
  const values = Array.isArray(selected) ? selected : [];
  function toggle(day) {
    const next = new Set(values);
    if (next.has(day)) next.delete(day); else next.add(day);
    onChange(WEEKDAYS.filter((item) => next.has(item)));
  }
  return (
    <div className="md:col-span-2">
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500 sm:text-xs">{label}</p>
      <p className="mt-1 text-[11px] font-semibold leading-4 text-slate-500">{hint}</p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-7">
        {WEEKDAYS.map((day) => <label key={day} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold capitalize"><input type="checkbox" checked={values.includes(day)} onChange={() => toggle(day)} />{day}</label>)}
      </div>
    </div>
  );
}

function HourPeriodPicker({ label, hint = "", hour, period, onHourChange, onPeriodChange }) {
  const selectedHour = Number.isInteger(Number(hour)) && Number(hour) >= 1 && Number(hour) <= 12 ? Number(hour) : "";
  const selectedPeriod = PERIODS.includes(period) ? period : "";
  return (
    <Field label={label} hint={hint}>
      <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2">
        <Select ariaLabel={`${label} hour`} value={selectedHour} onChange={(event) => onHourChange(event.target.value ? Number(event.target.value) : "")}>
          <option value="">Choose</option>
          {HOURS.map((value) => <option key={value} value={value}>{value}</option>)}
        </Select>
        <Select ariaLabel={`${label} AM or PM`} value={selectedPeriod} onChange={(event) => onPeriodChange(event.target.value)}>
          <option value="">Choose</option>
          {PERIODS.map((value) => <option key={value} value={value}>{value}</option>)}
        </Select>
      </div>
    </Field>
  );
}

function StackedListEditor({ items, onChange, placeholder, addLabel }) {
  const normalizedItems = Array.isArray(items) ? items.map((item) => String(item || "").trim()).filter(Boolean) : [];
  const [entry, setEntry] = useState("");

  function addItem() {
    const nextItem = entry.trim();
    if (!nextItem) return;
    const duplicate = normalizedItems.some((item) => item.toLowerCase() === nextItem.toLowerCase());
    if (!duplicate) onChange([...normalizedItems, nextItem]);
    setEntry("");
  }

  function removeRow(index) {
    onChange(normalizedItems.filter((_, rowIndex) => rowIndex !== index));
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <input value={entry} onChange={(event) => setEntry(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addItem(); } }} placeholder={placeholder} className="h-11 min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-950" />
        <button type="button" disabled={!entry.trim()} onClick={addItem} className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">{addLabel}</button>
      </div>
      {normalizedItems.map((item, index) => (
        <div key={`${item}-${index}`} className="flex items-center gap-2">
          <div className="flex h-11 min-w-0 flex-1 items-center rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm text-slate-800">{item}</div>
          <button type="button" onClick={() => removeRow(index)} aria-label={`Remove ${item}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-red-200 bg-white text-xl font-black text-red-600">×</button>
        </div>
      ))}
    </div>
  );
}

function ServicesEditor({ services, onChange }) {
  const current = services && typeof services === "object" && !Array.isArray(services) ? services : {};
  const names = Object.keys(current).map(titleCase);
  function updateServices(nextNames) {
    onChange(Object.fromEntries(nextNames.map((name) => { const key = name.trim().toLowerCase(); return [key, key]; }).filter(([key]) => key)));
  }
  return <StackedListEditor items={names} onChange={updateServices} placeholder="Snow plowing" addLabel="Add Service" />;
}

function BusinessInformationEditor({ items, onChange }) {
  const normalizedItems = normalizeBusinessInformation(items);
  const [title, setTitle] = useState("");
  const [info, setInfo] = useState("");

  function addItem() {
    const nextTitle = title.trim();
    const nextInfo = info.trim();
    if (!nextTitle || !nextInfo) return;
    const duplicate = normalizedItems.some((item) => item.title.toLowerCase() === nextTitle.toLowerCase() && item.info.toLowerCase() === nextInfo.toLowerCase());
    if (duplicate) return;
    onChange([...normalizedItems, { title: nextTitle, info: nextInfo }]);
    setTitle("");
    setInfo("");
  }

  function removeItem(index) {
    onChange(normalizedItems.filter((_, itemIndex) => itemIndex !== index));
  }

  function submitOnEnter(event) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addItem();
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[minmax(72px,0.7fr)_minmax(110px,1.3fr)_auto] gap-2">
        <input aria-label="Information title" value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={submitOnEnter} placeholder="Title" className="h-11 min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-950" />
        <input aria-label="Information details" value={info} onChange={(event) => setInfo(event.target.value)} onKeyDown={submitOnEnter} placeholder="Info" className="h-11 min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-950" />
        <button type="button" disabled={!title.trim() || !info.trim()} onClick={addItem} className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Add Info</button>
      </div>
      {normalizedItems.map((item, index) => (
        <div key={`${item.title}-${item.info}-${index}`} className="flex items-center gap-2">
          <div className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800"><strong className="block break-words">{item.title}</strong><span className="mt-0.5 block break-words text-slate-600">{item.info}</span></div>
          <button type="button" onClick={() => removeItem(index)} aria-label={`Remove ${item.title}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-red-200 bg-white text-xl font-black text-red-600">×</button>
        </div>
      ))}
    </div>
  );
}

function editableProfileWithoutRemovedFields(profile = {}) {
  return Object.fromEntries(
    Object.entries(profile).filter(([key]) => !RAILWAY_OWNED_FIELDS.has(key) && !REMOVED_BUSINESS_HOUR_FIELDS.has(key) && key !== "about"),
  );
}

export function prepareReceptionistProfile(profile = {}, { requireExplicitSelections = false } = {}) {
  const estimateStart = parseTime(profile.earliestEstimateStart);
  const estimateEnd = parseTime(profile.latestEstimateStart);
  const editableProfile = editableProfileWithoutRemovedFields(profile);
  const explicitHour = (value) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 12 ? Number(value) : "";
  const explicitPeriod = (value) => PERIODS.includes(value) ? value : "";
  return {
    ...editableProfile,
    serviceAreas: Array.isArray(profile.serviceAreas) ? profile.serviceAreas : [],
    services: profile.services && typeof profile.services === "object" && !Array.isArray(profile.services) ? profile.services : {},
    businessInformation: normalizeBusinessInformation(profile.businessInformation),
    timeZone: requireExplicitSelections ? String(profile.timeZone || "") : profile.timeZone || "America/New_York",
    estimateWeekdays: Array.isArray(profile.estimateWeekdays) ? profile.estimateWeekdays : [],
    estimateStartHour: explicitHour(profile.estimateStartHour || estimateStart.hour),
    estimateStartPeriod: explicitPeriod(profile.estimateStartPeriod || estimateStart.period),
    estimateEndHour: explicitHour(profile.estimateEndHour || estimateEnd.hour),
    estimateEndPeriod: explicitPeriod(profile.estimateEndPeriod || estimateEnd.period),
  };
}

export function receptionistRequestPayload(profile = {}) {
  const editableProfile = editableProfileWithoutRemovedFields(profile);
  const estimateWeekdays = Array.isArray(profile.estimateWeekdays) ? profile.estimateWeekdays : [];
  const businessInformation = normalizeBusinessInformation(profile.businessInformation);
  return {
    ...editableProfile,
    businessInformation,
    extraInformation: businessInformationText(businessInformation),
    estimateDays: formatDayList(estimateWeekdays),
    estimateWeekdays,
    earliestEstimateStart: formatTime(profile.estimateStartHour, profile.estimateStartPeriod),
    latestEstimateStart: formatTime(profile.estimateEndHour, profile.estimateEndPeriod),
  };
}

export default function ReceptionistBusinessForm({ profile, onChange, adminMode = false, onboardingMode = false }) {
  if (!profile) return null;
  function update(field, value) { onChange({ ...profile, [field]: value }); }
  function updateEstimateWeekdays(days) {
    onChange(days.length ? { ...profile, estimateWeekdays: days } : { ...profile, estimateWeekdays: [], estimateStartHour: "", estimateStartPeriod: "", estimateEndHour: "", estimateEndPeriod: "" });
  }
  const timeZoneField = <Field label="Time zone"><Select value={onboardingMode ? profile.timeZone || "" : profile.timeZone || "America/New_York"} onChange={(event) => update("timeZone", event.target.value)}>{onboardingMode && <option value="">Choose</option>}{TIME_ZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</Select></Field>;
  const estimateFields = <>
    {timeZoneField}
    <DayCheckboxes label="Estimate days (optional)" hint="Choose days only if the receptionist may offer estimate appointments. Unchecking every day clears the estimate times." selected={profile.estimateWeekdays} onChange={updateEstimateWeekdays} />
    <HourPeriodPicker label="Earliest estimate time (optional)" hour={profile.estimateStartHour} period={profile.estimateStartPeriod} onHourChange={(value) => update("estimateStartHour", value)} onPeriodChange={(value) => update("estimateStartPeriod", value)} />
    <HourPeriodPicker label="Latest estimate time (optional)" hour={profile.estimateEndHour} period={profile.estimateEndPeriod} onHourChange={(value) => update("estimateEndHour", value)} onPeriodChange={(value) => update("estimateEndPeriod", value)} />
  </>;
  const serviceAreasField = <Field label="Service areas" hint="Add each city, town, county, or region the business serves." wide><StackedListEditor items={profile.serviceAreas} onChange={(items) => update("serviceAreas", items)} placeholder="Worcester, Massachusetts" addLabel="Add Area" /></Field>;
  const servicesField = <Field label="Services" hint="Add each type of work customers can request." wide><ServicesEditor services={profile.services} onChange={(services) => update("services", services)} /></Field>;
  const businessInformationField = <Field label="Additional business information" hint="Optional. Add any other facts the AI receptionist should know." wide><BusinessInformationEditor items={profile.businessInformation} onChange={(items) => update("businessInformation", items)} /></Field>;
  return (
    <div className="space-y-7">
      {adminMode && <section><h3 className="text-lg font-black">Receptionist Access</h3><p className="mt-1 text-xs font-semibold leading-5 text-slate-500">Railway owns the model, voice, timing, and call controls. This switch only controls whether this business may receive receptionist calls.</p><label className="mt-4 flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-sm font-black">AI receptionist enabled<input type="checkbox" checked={profile.enabled !== false} onChange={(event) => update("enabled", event.target.checked)} /></label></section>}
      {onboardingMode ? <>
        <section>
          <h3 className="text-lg font-black">Estimate availability</h3>
          <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">Choose the business time zone. Estimate days and hours are optional and are used only when the receptionist may offer appointment times.</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">{estimateFields}</div>
        </section>
        <section>
          <h3 className="text-lg font-black">Service areas</h3>
          <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">These locations help the AI receptionist answer whether the business serves a caller&apos;s project area.</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">{serviceAreasField}</div>
        </section>
        <section>
          <h3 className="text-lg font-black">Services</h3>
          <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">List the work the business offers so the AI receptionist can answer service questions and record requests accurately.</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">{servicesField}</div>
        </section>
        <section>
          <h3 className="text-lg font-black">Additional business information</h3>
          <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">Optionally add other facts the AI receptionist may use when answering callers. Give each fact a title and the information itself.</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">{businessInformationField}</div>
        </section>
      </> : <section>
        <h3 className="text-lg font-black">Business Information</h3>
        <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">These details are used by the receptionist during calls.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Business name"><Input value={profile.businessName} onChange={(event) => update("businessName", dashBusinessName(event.target.value))} /></Field>
          <Field label="Owner name"><Input value={profile.ownerName} onChange={(event) => update("ownerName", event.target.value)} /></Field>
          <Field label="Business phone"><Input type="tel" value={profile.businessPhone} onChange={(event) => update("businessPhone", event.target.value)} /></Field>
          <Field label="Business email"><Input type="email" value={profile.businessEmail} onChange={(event) => update("businessEmail", event.target.value)} /></Field>
          {estimateFields}
          {serviceAreasField}
          {servicesField}
          {businessInformationField}
        </div>
      </section>}
    </div>
  );
}
