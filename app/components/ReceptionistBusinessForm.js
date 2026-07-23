"use client";

import { useState } from "react";

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const TIME_ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "America/Anchorage", "Pacific/Honolulu"];
const HOURS = Array.from({ length: 12 }, (_, index) => index + 1);
const PERIODS = ["AM", "PM"];
const DEFAULT_BUSINESS_DAYS = WEEKDAYS.slice(0, 5);
const VOICES = [
  { value: "alloy", label: "Alloy", description: "Balanced and neutral." },
  { value: "ash", label: "Ash", description: "Warm and direct." },
  { value: "ballad", label: "Ballad", description: "Expressive and friendly." },
  { value: "coral", label: "Coral", description: "Clear and upbeat." },
  { value: "echo", label: "Echo", description: "Calm and measured." },
  { value: "sage", label: "Sage", description: "Steady and professional." },
  { value: "shimmer", label: "Shimmer", description: "Bright and welcoming." },
  { value: "verse", label: "Verse", description: "Natural and conversational." },
];
const SPEEDS = [
  { value: 0.85, label: "Slow", description: "More deliberate pacing." },
  { value: 0.94, label: "Normal", description: "Recommended everyday pace." },
  { value: 1.08, label: "Fast", description: "Quicker, more energetic delivery." },
];
const SILENCE_SECONDS = [
  { value: 0.7, label: "0.7 seconds — Quick" },
  { value: 1.2, label: "1.2 seconds — Natural" },
  { value: 1.8, label: "1.8 seconds — Patient" },
];

function titleCase(value) {
  return String(value || "").charAt(0).toUpperCase() + String(value || "").slice(1);
}

function parseTime(value, fallbackHour, fallbackPeriod) {
  const match = String(value || "").toUpperCase().match(/\b(1[0-2]|[1-9])(?::\d{2})?\s*(AM|PM)\b/);
  return match
    ? { hour: Number(match[1]), period: match[2] }
    : { hour: fallbackHour, period: fallbackPeriod };
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
  const start = matches[0]
    ? { hour: Number(matches[0][1]), period: matches[0][2] }
    : { hour: 9, period: "AM" };
  const end = matches[1]
    ? { hour: Number(matches[1][1]), period: matches[1][2] }
    : { hour: 5, period: "PM" };
  return { days: parseBusinessDays(value), start, end };
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
        {WEEKDAYS.map((day) => (
          <label key={day} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold capitalize">
            <input type="checkbox" checked={values.includes(day)} onChange={() => toggle(day)} />
            {day}
          </label>
        ))}
      </div>
    </div>
  );
}

function HourPeriodPicker({ label, hint = "", hour, period, onHourChange, onPeriodChange }) {
  return (
    <Field label={label} hint={hint}>
      <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2">
        <Select ariaLabel={`${label} hour`} value={Number(hour) || 12} onChange={(event) => onHourChange(Number(event.target.value))}>
          {HOURS.map((value) => <option key={value} value={value}>{value}</option>)}
        </Select>
        <Select ariaLabel={`${label} AM or PM`} value={period || "AM"} onChange={(event) => onPeriodChange(event.target.value)}>
          {PERIODS.map((value) => <option key={value} value={value}>{value}</option>)}
        </Select>
      </div>
    </Field>
  );
}

function ListEditor({ items, onChange, placeholder, addLabel }) {
  const [draft, setDraft] = useState("");
  const values = Array.isArray(items) ? items : [];

  function addItem() {
    const value = draft.trim();
    if (!value) return;
    if (!values.some((item) => item.toLowerCase() === value.toLowerCase())) onChange([...values, value]);
    setDraft("");
  }

  return (
    <div>
      <div className="flex gap-2">
        <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addItem(); } }} placeholder={placeholder} className="h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-950" />
        <button type="button" onClick={addItem} className="rounded-xl bg-slate-950 px-4 text-xs font-black text-white">{addLabel}</button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {values.map((item) => (
          <span key={item} className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700">
            {item}
            <button type="button" onClick={() => onChange(values.filter((value) => value !== item))} aria-label={`Remove ${item}`} className="text-base leading-none text-slate-400 hover:text-red-600">×</button>
          </span>
        ))}
      </div>
    </div>
  );
}

function ServicesEditor({ services, onChange }) {
  const entries = Object.entries(services && typeof services === "object" ? services : {});
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  function updateEntry(oldName, nextName, nextDescription) {
    const cleanName = nextName.trim().toLowerCase();
    const next = { ...(services || {}) };
    delete next[oldName];
    if (cleanName) next[cleanName] = nextDescription;
    onChange(next);
  }

  function addService() {
    const cleanName = name.trim().toLowerCase();
    if (!cleanName) return;
    onChange({ ...(services || {}), [cleanName]: description.trim() || `${name.trim()}.` });
    setName("");
    setDescription("");
  }

  return (
    <div className="space-y-2">
      {entries.map(([serviceName, serviceDescription]) => (
        <div key={serviceName} className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)_auto]">
          <input value={serviceName} onChange={(event) => updateEntry(serviceName, event.target.value, serviceDescription)} aria-label="Service name" className="h-10 min-w-0 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-slate-950" />
          <input value={serviceDescription} onChange={(event) => updateEntry(serviceName, serviceName, event.target.value)} aria-label="Service description" className="h-10 min-w-0 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-slate-950" />
          <button type="button" onClick={() => { const next = { ...(services || {}) }; delete next[serviceName]; onChange(next); }} className="rounded-lg border border-red-200 px-3 text-xs font-black text-red-700">Remove</button>
        </div>
      ))}
      <div className="grid gap-2 rounded-xl bg-slate-100 p-3 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)_auto]">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Service name" className="h-10 min-w-0 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-slate-950" />
        <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Short description" className="h-10 min-w-0 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-slate-950" />
        <button type="button" onClick={addService} className="rounded-lg bg-slate-950 px-4 text-xs font-black text-white">Add Service</button>
      </div>
    </div>
  );
}

export function prepareReceptionistProfile(profile = {}) {
  const hours = parseBusinessHours(profile.businessHours);
  const estimateStart = parseTime(profile.earliestEstimateStart, 9, "AM");
  const estimateEnd = parseTime(profile.latestEstimateStart, 5, "PM");
  return {
    ...profile,
    serviceAreas: Array.isArray(profile.serviceAreas) ? profile.serviceAreas : [],
    about: Array.isArray(profile.about) ? profile.about : [],
    services: profile.services && typeof profile.services === "object" && !Array.isArray(profile.services) ? profile.services : {},
    aiSilenceSeconds: Number(profile.aiSilenceMs || 1200) / 1000,
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
  return {
    ...profile,
    businessHours: businessHoursSummary(profile),
    earliestEstimateStart: formatTime(profile.estimateStartHour, profile.estimateStartPeriod),
    latestEstimateStart: formatTime(profile.estimateEndHour, profile.estimateEndPeriod),
    aiSilenceMs: Math.round(Number(profile.aiSilenceSeconds || 1.2) * 1000),
  };
}

export default function ReceptionistBusinessForm({ profile, onChange, adminMode = false }) {
  if (!profile) return null;
  const voice = VOICES.find((item) => item.value === profile.aiVoice) || VOICES[0];
  const speed = SPEEDS.find((item) => item.value === Number(profile.aiSpeechSpeed)) || SPEEDS[1];

  function update(field, value) {
    onChange({ ...profile, [field]: value });
  }

  return (
    <div className="space-y-7">
      <section>
        <h3 className="text-lg font-black">AI Voice and Timing</h3>
        <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">Choose how the receptionist sounds and how long it waits after a caller stops speaking.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {adminMode && <Field label="AI model" hint="The model is managed by ARK."><Input value="GPT Realtime Mini" readOnly /></Field>}
          <Field label="AI voice" hint={voice.description}><Select value={profile.aiVoice || "alloy"} onChange={(event) => update("aiVoice", event.target.value)}>{VOICES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field>
          <Field label="Speech speed" hint={`Controls how quickly the receptionist speaks. ${speed.description}`}><Select value={Number(profile.aiSpeechSpeed || 0.94)} onChange={(event) => update("aiSpeechSpeed", Number(event.target.value))}>{SPEEDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field>
          <Field label="Silence before replying" hint="How long the receptionist waits after the caller becomes quiet."><Select value={Number(profile.aiSilenceSeconds || 1.2)} onChange={(event) => update("aiSilenceSeconds", Number(event.target.value))}>{SILENCE_SECONDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field>
          {adminMode && <label className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-sm font-black md:self-end">AI receptionist enabled<input type="checkbox" checked={profile.enabled !== false} onChange={(event) => update("enabled", event.target.checked)} /></label>}
        </div>
      </section>

      <section>
        <h3 className="text-lg font-black">Business Information</h3>
        <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">These details are used by the receptionist during calls.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Business name"><Input value={profile.businessName} onChange={(event) => update("businessName", event.target.value)} /></Field>
          <Field label="Receptionist name"><Input value={profile.receptionistName} onChange={(event) => update("receptionistName", event.target.value)} /></Field>
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

          <Field label="Service areas" hint="Add a city, county, state, the whole United States, or any other area the business serves." wide><ListEditor items={profile.serviceAreas} onChange={(items) => update("serviceAreas", items)} placeholder="Worcester, Massachusetts" addLabel="Add Area" /></Field>
          <Field label="About the business" hint="Add short facts the receptionist should know, one at a time." wide><ListEditor items={profile.about} onChange={(items) => update("about", items)} placeholder="Family-owned since 2018" addLabel="Add Fact" /></Field>
          <Field label="Services" hint="Add each service with a short explanation so the receptionist can describe it correctly." wide><ServicesEditor services={profile.services} onChange={(services) => update("services", services)} /></Field>
          <Field label="Extra business information" hint="Use this for policies, common questions, timing, limitations, and anything else the receptionist may need." wide><textarea rows={10} value={profile.extraInformation || ""} onChange={(event) => update("extraInformation", event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm leading-6 outline-none focus:border-slate-950" /></Field>
        </div>
      </section>
    </div>
  );
}
