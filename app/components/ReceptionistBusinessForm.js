"use client";

import { useEffect, useState } from "react";
import { dashBusinessName } from "../lib/valueUtils";

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const TIME_ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "America/Anchorage", "Pacific/Honolulu"];
const HOURS = Array.from({ length: 12 }, (_, index) => index + 1);
const PERIODS = ["AM", "PM"];
const DEFAULT_BUSINESS_DAYS = WEEKDAYS.slice(0, 5);
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

function titleCase(value) {
  const text = String(value || "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function parseTime(value, fallbackHour, fallbackPeriod) {
  const match = String(value || "").toUpperCase().match(/\b(1[0-2]|[1-9])(?::\d{2})?\s*(AM|PM)\b/);
  return match ? { hour: Number(match[1]), period: match[2] } : { hour: fallbackHour, period: fallbackPeriod };
}

function formatTime(hour, period) {
  return `${Number(hour) || 12}:00 ${PERIODS.includes(period) ? period : "AM"}`;
}

function parseBusinessDays(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("every day") || normalized.includes("daily")) return [...WEEKDAYS];
  const matchedDays = WEEKDAYS.filter((day) => normalized.includes(day));
  if (normalized.includes("through") && matchedDays.length >= 2) {
    const start = WEEKDAYS.indexOf(matchedDays[0]);
    const end = WEEKDAYS.indexOf(matchedDays[matchedDays.length - 1]);
    if (start >= 0 && end >= start) return WEEKDAYS.slice(start, end + 1);
  }
  return matchedDays.length ? matchedDays : [...DEFAULT_BUSINESS_DAYS];
}

function parseBusinessHours(value) {
  const matches = [...String(value || "").toUpperCase().matchAll(/\b(1[0-2]|[1-9])(?::\d{2})?\s*(AM|PM)\b/g)];
  return {
    days: parseBusinessDays(value),
    start: matches[0] ? { hour: Number(matches[0][1]), period: matches[0][2] } : { hour: 9, period: "AM" },
    end: matches[1] ? { hour: Number(matches[1][1]), period: matches[1][2] } : { hour: 5, period: "PM" },
  };
}

function formatDayList(days) {
  const labels = WEEKDAYS.filter((day) => days.includes(day)).map(titleCase);
  if (labels.length === 7) return "every day";
  if (labels.length === 0) return "no selected days";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

function businessHoursSummary(profile) {
  const days = Array.isArray(profile.businessWeekdays) ? profile.businessWeekdays : DEFAULT_BUSINESS_DAYS;
  return `Open ${formatDayList(days)} from ${formatTime(profile.businessStartHour, profile.businessStartPeriod)} to ${formatTime(profile.businessEndHour, profile.businessEndPeriod)}.`;
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
  return (
    <Field label={label} hint={hint}>
      <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2">
        <Select ariaLabel={`${label} hour`} value={Number(hour) || 12} onChange={(event) => onHourChange(Number(event.target.value))}>{HOURS.map((value) => <option key={value} value={value}>{value}</option>)}</Select>
        <Select ariaLabel={`${label} AM or PM`} value={period || "AM"} onChange={(event) => onPeriodChange(event.target.value)}>{PERIODS.map((value) => <option key={value} value={value}>{value}</option>)}</Select>
      </div>
    </Field>
  );
}

function StackedListEditor({ items, onChange, placeholder, addLabel }) {
  const normalizedItems = Array.isArray(items) && items.length ? items : [""];
  const itemKey = JSON.stringify(normalizedItems);
  const [rows, setRows] = useState(() => normalizedItems);

  useEffect(() => {
    setRows(JSON.parse(itemKey));
  }, [itemKey]);

  function apply(nextRows) {
    setRows(nextRows);
    onChange(nextRows.map((item) => String(item || "").trim()).filter(Boolean));
  }

  function updateRow(index, value) {
    apply(rows.map((row, rowIndex) => rowIndex === index ? value : row));
  }

  function removeRow(index) {
    const next = rows.filter((_, rowIndex) => rowIndex !== index);
    apply(next.length ? next : [""]);
  }

  return (
    <div className="space-y-2">
      {rows.map((item, index) => (
        <div key={index} className="flex items-center gap-2">
          <input value={item} onChange={(event) => updateRow(index, event.target.value)} placeholder={placeholder} className="h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-950" />
          <button type="button" onClick={() => removeRow(index)} aria-label={`Delete ${item || "empty item"}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-red-200 bg-white text-xl font-black text-red-600">×</button>
        </div>
      ))}
      <button type="button" onClick={() => setRows((current) => [...current, ""])} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-black text-slate-700">+ {addLabel}</button>
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

export function prepareReceptionistProfile(profile = {}) {
  const hours = parseBusinessHours(profile.businessHours);
  const estimateStart = parseTime(profile.earliestEstimateStart, 9, "AM");
  const estimateEnd = parseTime(profile.latestEstimateStart, 5, "PM");
  const editableProfile = Object.fromEntries(
    Object.entries(profile).filter(([key]) => !RAILWAY_OWNED_FIELDS.has(key)),
  );
  return {
    ...editableProfile,
    serviceAreas: Array.isArray(profile.serviceAreas) ? profile.serviceAreas : [],
    about: Array.isArray(profile.about) ? profile.about : [],
    services: profile.services && typeof profile.services === "object" && !Array.isArray(profile.services) ? profile.services : {},
    businessWeekdays: Array.isArray(profile.businessWeekdays) ? profile.businessWeekdays : hours.days,
    businessStartHour: Number(profile.businessStartHour || hours.start.hour),
    businessStartPeriod: profile.businessStartPeriod || hours.start.period,
    businessEndHour: Number(profile.businessEndHour || hours.end.hour),
    businessEndPeriod: profile.businessEndPeriod || hours.end.period,
    estimateStartHour: Number(profile.estimateStartHour || estimateStart.hour),
    estimateStartPeriod: profile.estimateStartPeriod || estimateStart.period,
    estimateEndHour: Number(profile.estimateEndHour || estimateEnd.hour),
    estimateEndPeriod: profile.estimateEndPeriod || estimateEnd.period,
  };
}

export function receptionistRequestPayload(profile = {}) {
  const editableProfile = Object.fromEntries(
    Object.entries(profile).filter(([key]) => !RAILWAY_OWNED_FIELDS.has(key)),
  );
  return {
    ...editableProfile,
    extraInformation: "",
    businessHours: businessHoursSummary(profile),
    earliestEstimateStart: formatTime(profile.estimateStartHour, profile.estimateStartPeriod),
    latestEstimateStart: formatTime(profile.estimateEndHour, profile.estimateEndPeriod),
  };
}

export default function ReceptionistBusinessForm({ profile, onChange, adminMode = false }) {
  if (!profile) return null;
  function update(field, value) { onChange({ ...profile, [field]: value }); }
  return (
    <div className="space-y-7">
      {adminMode && <section><h3 className="text-lg font-black">Receptionist Access</h3><p className="mt-1 text-xs font-semibold leading-5 text-slate-500">Railway owns the model, voice, timing, and call controls. This switch only controls whether this business may receive receptionist calls.</p><label className="mt-4 flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-sm font-black">AI receptionist enabled<input type="checkbox" checked={profile.enabled !== false} onChange={(event) => update("enabled", event.target.checked)} /></label></section>}
      <section>
        <h3 className="text-lg font-black">Business Information</h3>
        <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">These details are used by the receptionist during calls.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Business name"><Input value={profile.businessName} onChange={(event) => update("businessName", dashBusinessName(event.target.value))} /></Field>
          <Field label="Owner name"><Input value={profile.ownerName} onChange={(event) => update("ownerName", event.target.value)} /></Field>
          <Field label="Business phone"><Input type="tel" value={profile.businessPhone} onChange={(event) => update("businessPhone", event.target.value)} /></Field>
          <Field label="Business email"><Input type="email" value={profile.businessEmail} onChange={(event) => update("businessEmail", event.target.value)} /></Field>
          <Field label="Time zone"><Select value={profile.timeZone || "America/New_York"} onChange={(event) => update("timeZone", event.target.value)}>{TIME_ZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</Select></Field>
          <DayCheckboxes label="Business days" hint="Choose every day the business is normally open." selected={profile.businessWeekdays} onChange={(days) => update("businessWeekdays", days)} />
          <HourPeriodPicker label="Business opens" hour={profile.businessStartHour} period={profile.businessStartPeriod} onHourChange={(value) => update("businessStartHour", value)} onPeriodChange={(value) => update("businessStartPeriod", value)} />
          <HourPeriodPicker label="Business closes" hour={profile.businessEndHour} period={profile.businessEndPeriod} onHourChange={(value) => update("businessEndHour", value)} onPeriodChange={(value) => update("businessEndPeriod", value)} />
          <DayCheckboxes label="Days available for estimates" hint="Choose the days the receptionist may offer an estimate appointment." selected={profile.estimateWeekdays} onChange={(days) => update("estimateWeekdays", days)} />
          <HourPeriodPicker label="Earliest estimate time" hour={profile.estimateStartHour} period={profile.estimateStartPeriod} onHourChange={(value) => update("estimateStartHour", value)} onPeriodChange={(value) => update("estimateStartPeriod", value)} />
          <HourPeriodPicker label="Latest estimate time" hour={profile.estimateEndHour} period={profile.estimateEndPeriod} onHourChange={(value) => update("estimateEndHour", value)} onPeriodChange={(value) => update("estimateEndPeriod", value)} />
          <Field label="Service areas" hint="Each area stays on its own line. Add as many as the business needs." wide><StackedListEditor items={profile.serviceAreas} onChange={(items) => update("serviceAreas", items)} placeholder="Worcester, Massachusetts" addLabel="Add Area" /></Field>
          <Field label="About the business" hint="Each fact stays on its own line." wide><StackedListEditor items={profile.about} onChange={(items) => update("about", items)} placeholder="Family-owned since 2018" addLabel="Add Fact" /></Field>
          <Field label="Services" hint="Each service stays on its own line." wide><ServicesEditor services={profile.services} onChange={(services) => update("services", services)} /></Field>
        </div>
      </section>
    </div>
  );
}
