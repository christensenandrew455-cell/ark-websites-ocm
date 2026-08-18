"use client";

import { useEffect, useId, useRef, useState } from "react";
import { businessInformationText, normalizeBusinessInformation } from "../lib/receptionistBusinessInformation";
import { normalizeServiceAreas, serviceAreaFields, serviceAreaValues, US_STATES } from "../lib/serviceAreas";
import { dashBusinessName } from "../lib/valueUtils";

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const TIME_ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "America/Anchorage", "Pacific/Honolulu"];
const HOURS = Array.from({ length: 12 }, (_, index) => index + 1);
const PERIODS = ["AM", "PM"];
const HOUR_OPTIONS = [{ value: "", label: "Choose" }, ...HOURS];
const PERIOD_OPTIONS = [{ value: "", label: "Choose" }, ...PERIODS];
const BUSINESS_TYPE_SUGGESTIONS = [
  "Auto Repair",
  "Cleaning Service",
  "Construction",
  "Electrical",
  "General Contractor",
  "HVAC",
  "Landscaping",
  "Lawn Care",
  "Moving Company",
  "Painting",
  "Pest Control",
  "Plumbing",
  "Property Maintenance",
  "Roofing",
  "Snow Removal",
  "Tree Service",
];
const SERVICE_SUGGESTIONS_BY_BUSINESS_TYPE = {
  "auto repair": ["Brake service", "Diagnostics", "Oil change", "Tire service"],
  cleaning: ["Deep cleaning", "House cleaning", "Move-in or move-out cleaning", "Office cleaning"],
  construction: ["Additions", "Remodeling", "Repairs", "Renovations"],
  electrical: ["Electrical repair", "Lighting installation", "Outlet installation", "Panel upgrade"],
  "general contractor": ["Additions", "Remodeling", "Repairs", "Renovations"],
  hvac: ["Air conditioning repair", "Heating repair", "HVAC installation", "Seasonal maintenance"],
  landscaping: ["Fall cleanup", "Hedge trimming", "Lawn mowing", "Mulching", "Spring cleanup"],
  "lawn care": ["Fall cleanup", "Fertilization", "Lawn mowing", "Spring cleanup"],
  moving: ["Commercial moving", "Local moving", "Long-distance moving", "Packing"],
  painting: ["Cabinet painting", "Exterior painting", "Interior painting", "Touch-ups"],
  "pest control": ["Inspection", "Pest removal", "Preventive treatment", "Wildlife removal"],
  plumbing: ["Drain cleaning", "Leak repair", "Pipe repair", "Water heater service"],
  "property maintenance": ["General repairs", "Preventive maintenance", "Property inspection", "Seasonal cleanup"],
  roofing: ["Gutter service", "Roof inspection", "Roof repair", "Roof replacement"],
  "snow removal": ["De-icing", "Driveway plowing", "Sidewalk clearing", "Snow hauling"],
  "tree service": ["Emergency tree removal", "Stump grinding", "Tree removal", "Tree trimming"],
};
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
  "businessBase",
  "estimateDays",
]);

function titleCase(value) {
  const text = String(value || "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function serviceSuggestionsFor(businessType) {
  const normalizedType = String(businessType || "").trim().toLowerCase();
  const matched = Object.entries(SERVICE_SUGGESTIONS_BY_BUSINESS_TYPE)
    .find(([type]) => normalizedType === type || normalizedType.includes(type));
  return matched?.[1] || [];
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

function ExplainedLabel({ label, explanation, heading = false }) {
  const [open, setOpen] = useState(false);
  const labelClassName = heading
    ? "text-lg font-black"
    : "text-[10px] font-black uppercase tracking-[0.12em] text-slate-500 sm:text-xs";
  return (
    <div>
      <div className="flex items-center gap-2">
        {heading ? <h3 className={labelClassName}>{label}</h3> : <p className={labelClassName}>{label}</p>}
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? "Hide" : "Show"} explanation for ${label}`}
          onClick={() => setOpen((current) => !current)}
          className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px] font-black ${open ? "border-slate-950 bg-slate-950 text-white" : "border-slate-300 bg-white text-slate-600"}`}
        >
          ?
        </button>
      </div>
      {open && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold leading-5 text-slate-600">{explanation}</p>}
    </div>
  );
}

function Field({ label, explanation, children }) {
  return (
    <div className="min-w-0">
      <ExplainedLabel label={label} explanation={explanation} />
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Input({ value, onChange, type = "text", placeholder = "", readOnly = false, ariaLabel, ...inputProps }) {
  return <input {...inputProps} aria-label={ariaLabel} type={type} value={value ?? ""} onChange={onChange} placeholder={placeholder} readOnly={readOnly} className={readOnly ? "h-11 w-full rounded-xl border border-slate-200 bg-slate-100 px-3 text-sm text-slate-600" : "h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-950"} />;
}

function normalizedOptions(options = []) {
  return options.map((option) => typeof option === "string" ? { value: option, label: option } : option);
}

function InAppSelect({ value, onChange, options, ariaLabel, placeholder = "Choose" }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const items = normalizedOptions(options);
  const selected = items.find((item) => String(item.value) === String(value ?? ""));

  useEffect(() => {
    if (!open) return undefined;
    function dismiss(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function dismissWithKeyboard(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismissWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismissWithKeyboard);
    };
  }, [open]);

  function choose(nextValue) {
    onChange(nextValue);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-11 w-full items-center justify-between gap-3 rounded-xl border border-slate-300 bg-white px-3 text-left text-sm outline-none focus:border-slate-950"
      >
        <span className={selected ? "truncate text-slate-900" : "truncate text-slate-500"}>{selected?.label || placeholder}</span>
        <span aria-hidden="true" className={`shrink-0 text-xs text-slate-500 transition ${open ? "rotate-180" : ""}`}>▼</span>
      </button>
      {open && (
        <div role="listbox" aria-label={ariaLabel} className="absolute inset-x-0 top-[calc(100%+0.35rem)] z-40 max-h-64 overflow-y-auto overscroll-contain rounded-xl border border-slate-300 bg-white p-1.5 shadow-2xl">
          {items.map((item) => {
            const itemSelected = String(item.value) === String(value ?? "");
            return <button key={`${item.label}-${String(item.value)}`} type="button" role="option" aria-selected={itemSelected} onClick={() => choose(item.value)} className={itemSelected ? "flex w-full items-center justify-between rounded-lg bg-slate-950 px-3 py-3 text-left text-sm font-bold text-white" : "flex w-full items-center justify-between rounded-lg px-3 py-3 text-left text-sm font-semibold text-slate-800 active:bg-slate-100"}><span>{item.label}</span>{itemSelected && <span aria-hidden="true">✓</span>}</button>;
          })}
        </div>
      )}
    </div>
  );
}

function SuggestionInput({ value, onChange, onBlur, onSubmit, suggestions = [], ariaLabel, placeholder }) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const rootRef = useRef(null);
  const listboxId = useId();
  const query = String(value || "").trim().toLowerCase();
  const matches = [...new Set(suggestions.map((item) => String(item || "").trim()).filter(Boolean))]
    .filter((item) => !query || item.toLowerCase().includes(query))
    .sort((left, right) => {
      const leftStarts = left.toLowerCase().startsWith(query);
      const rightStarts = right.toLowerCase().startsWith(query);
      return leftStarts === rightStarts ? left.localeCompare(right) : leftStarts ? -1 : 1;
    })
    .slice(0, 8);

  useEffect(() => {
    if (!open) return undefined;
    function dismiss(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  function selectSuggestion(suggestion) {
    onChange(suggestion, { selectedSuggestion: true });
    setHighlighted(-1);
    setOpen(false);
  }

  function handleKeyDown(event) {
    if (event.key === "ArrowDown" && matches.length) {
      event.preventDefault();
      setOpen(true);
      setHighlighted((current) => (current + 1) % matches.length);
      return;
    }
    if (event.key === "ArrowUp" && matches.length) {
      event.preventDefault();
      setOpen(true);
      setHighlighted((current) => (current <= 0 ? matches.length - 1 : current - 1));
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      setHighlighted(-1);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (open && highlighted >= 0 && matches[highlighted]) selectSuggestion(matches[highlighted]);
    else onSubmit?.();
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <input
        aria-label={ariaLabel}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={open && matches.length > 0}
        autoComplete="off"
        autoCapitalize="words"
        autoCorrect="on"
        spellCheck
        value={value}
        onFocus={() => { setOpen(true); setHighlighted(-1); }}
        onChange={(event) => { onChange(event.target.value, { selectedSuggestion: false }); setOpen(true); setHighlighted(-1); }}
        onBlur={onBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-950"
      />
      {open && matches.length > 0 && (
        <div id={listboxId} role="listbox" aria-label={`${ariaLabel} suggestions`} className="absolute inset-x-0 top-[calc(100%+0.35rem)] z-40 max-h-64 overflow-y-auto overscroll-contain rounded-xl border border-slate-300 bg-white p-1.5 shadow-2xl">
          {matches.map((suggestion, index) => <button key={suggestion} type="button" role="option" aria-selected={highlighted === index} onPointerDown={(event) => event.preventDefault()} onClick={() => selectSuggestion(suggestion)} className={highlighted === index ? "w-full rounded-lg bg-slate-950 px-3 py-3 text-left text-sm font-bold text-white" : "w-full rounded-lg px-3 py-3 text-left text-sm font-semibold text-slate-800 active:bg-slate-100"}>{suggestion}</button>)}
        </div>
      )}
    </div>
  );
}

function DayCheckboxes({ label, explanation, selected, onChange }) {
  const values = Array.isArray(selected) ? selected : [];
  function toggle(day) {
    const next = new Set(values);
    if (next.has(day)) next.delete(day); else next.add(day);
    onChange(WEEKDAYS.filter((item) => next.has(item)));
  }
  return (
    <div className="md:col-span-2">
      <ExplainedLabel label={label} explanation={explanation} />
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-7">
        {WEEKDAYS.map((day) => <label key={day} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold capitalize"><input type="checkbox" checked={values.includes(day)} onChange={() => toggle(day)} />{day}</label>)}
      </div>
    </div>
  );
}

function HourPeriodPicker({ label, explanation, hour, period, onHourChange, onPeriodChange }) {
  const selectedHour = Number.isInteger(Number(hour)) && Number(hour) >= 1 && Number(hour) <= 12 ? Number(hour) : "";
  const selectedPeriod = PERIODS.includes(period) ? period : "";
  return (
    <Field label={label} explanation={explanation}>
      <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2">
        <InAppSelect ariaLabel={`${label} hour`} value={selectedHour} options={HOUR_OPTIONS} placeholder="Choose" onChange={(value) => onHourChange(value ? Number(value) : "")} />
        <InAppSelect ariaLabel={`${label} AM or PM`} value={selectedPeriod} options={PERIOD_OPTIONS} placeholder="Choose" onChange={onPeriodChange} />
      </div>
    </Field>
  );
}

function StackedListEditor({ items, onChange, placeholder, addLabel, inputLabel, suggestions = [] }) {
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
        <SuggestionInput ariaLabel={inputLabel} value={entry} onChange={setEntry} onSubmit={addItem} suggestions={suggestions} placeholder={placeholder} />
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

function ServicesEditor({ services, onChange, businessType }) {
  const current = services && typeof services === "object" && !Array.isArray(services) ? services : {};
  const names = Object.keys(current).map(titleCase);
  function updateServices(nextNames) {
    onChange(Object.fromEntries(nextNames.map((name) => { const key = name.trim().toLowerCase(); return [key, key]; }).filter(([key]) => key)));
  }
  return <StackedListEditor items={names} onChange={updateServices} placeholder="Start typing a service" addLabel="Add Service" inputLabel="Service" suggestions={serviceSuggestionsFor(businessType)} />;
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
    serviceAreas: normalizeServiceAreas(profile.serviceAreas),
    services: profile.services && typeof profile.services === "object" && !Array.isArray(profile.services) ? profile.services : {},
    businessInformation: normalizeBusinessInformation(profile.businessInformation),
    businessType: String(profile.businessType || profile.businessBase || ""),
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
    serviceAreas: normalizeServiceAreas(profile.serviceAreas),
    businessInformation,
    extraInformation: businessInformationText(businessInformation),
    estimateWeekdays,
    earliestEstimateStart: formatTime(profile.estimateStartHour, profile.estimateStartPeriod),
    latestEstimateStart: formatTime(profile.estimateEndHour, profile.estimateEndPeriod),
  };
}

export default function ReceptionistBusinessForm({ profile, onChange, onboardingMode = false }) {
  if (!profile) return null;
  const { state: serviceState, county: serviceCounty } = serviceAreaFields(profile.serviceAreas);
  function update(field, value, options = {}) { onChange({ ...profile, [field]: value }, options); }
  function updateEstimateWeekdays(days) {
    onChange(days.length ? { ...profile, estimateWeekdays: days } : { ...profile, estimateWeekdays: [], estimateStartHour: "", estimateStartPeriod: "", estimateEndHour: "", estimateEndPeriod: "" }, { saveImmediately: true });
  }
  const acceptsAllHours = profile.estimateStartHour === 12
    && profile.estimateStartPeriod === "AM"
    && profile.estimateEndHour === 11
    && profile.estimateEndPeriod === "PM";
  function updateAllHours(enabled) {
    onChange(enabled
      ? { ...profile, estimateStartHour: 12, estimateStartPeriod: "AM", estimateEndHour: 11, estimateEndPeriod: "PM" }
      : { ...profile, estimateStartHour: "", estimateStartPeriod: "", estimateEndHour: "", estimateEndPeriod: "" }, { saveImmediately: true });
  }
  const identitySection = !onboardingMode && (
    <section>
      <h3 className="text-lg font-black">Business details</h3>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="Business name" explanation="Enter the name customers know the business by."><Input ariaLabel="Business name" value={profile.businessName} onChange={(event) => update("businessName", dashBusinessName(event.target.value))} onBlur={() => update("businessName", profile.businessName, { saveImmediately: true })} /></Field>
        <Field label="Owner name" explanation="Enter the business owner&apos;s name."><Input ariaLabel="Owner name" value={profile.ownerName} onChange={(event) => update("ownerName", event.target.value)} onBlur={() => update("ownerName", profile.ownerName, { saveImmediately: true })} /></Field>
        <Field label="Business phone" explanation="Enter the main phone number used for this business account."><Input ariaLabel="Business phone" type="tel" value={profile.businessPhone} onChange={(event) => update("businessPhone", event.target.value)} onBlur={() => update("businessPhone", profile.businessPhone, { saveImmediately: true })} /></Field>
        <Field label="Business email" explanation="Enter the main email address used for this business account."><Input ariaLabel="Business email" type="email" value={profile.businessEmail} onChange={(event) => update("businessEmail", event.target.value)} onBlur={() => update("businessEmail", profile.businessEmail, { saveImmediately: true })} /></Field>
      </div>
    </section>
  );
  const sharedSections = <>
    <section>
      <h3 className="text-lg font-black">Business type</h3>
      <div className="mt-4">
        <Field label="Type of business" explanation="Choose a suggestion or enter the general kind of work this business does.">
          <SuggestionInput ariaLabel="Type of business" value={profile.businessType} suggestions={BUSINESS_TYPE_SUGGESTIONS} onChange={(value, details) => update("businessType", value, { saveImmediately: details.selectedSuggestion })} onBlur={() => update("businessType", profile.businessType, { saveImmediately: true })} placeholder="Start typing a business type" />
          <p className="mt-1 text-xs font-semibold text-slate-500">Choose a suggestion or type your own.</p>
        </Field>
      </div>
    </section>
    <section>
      <h3 className="text-lg font-black">Estimate availability</h3>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="Time zone" explanation="Choose the time zone where the business is located so appointment times are interpreted correctly.">
          <InAppSelect ariaLabel="Time zone" value={onboardingMode ? profile.timeZone || "" : profile.timeZone || "America/New_York"} options={TIME_ZONES} onChange={(value) => update("timeZone", value, { saveImmediately: true })} />
        </Field>
        <DayCheckboxes label="Estimate days" explanation="Choose the days customers may request estimates, or leave them unchecked if there is no set schedule." selected={profile.estimateWeekdays} onChange={updateEstimateWeekdays} />
        <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 md:col-span-2">
          <input type="checkbox" checked={acceptsAllHours} onChange={(event) => updateAllHours(event.target.checked)} />
          <span><strong className="block text-sm text-slate-900">24 hours</strong><span className="block text-xs font-semibold text-slate-600">Accept estimate requests all day on the selected days.</span></span>
        </label>
        {!acceptsAllHours && <HourPeriodPicker label="Earliest estimate time" explanation="Choose the earliest estimate-request time, or leave it blank when no schedule is set." hour={profile.estimateStartHour} period={profile.estimateStartPeriod} onHourChange={(hour) => update("estimateStartHour", hour, { saveImmediately: true })} onPeriodChange={(period) => update("estimateStartPeriod", period, { saveImmediately: true })} />}
        {!acceptsAllHours && <HourPeriodPicker label="Latest estimate time" explanation="Choose the latest estimate-request time. A time earlier than the starting time means the availability continues overnight." hour={profile.estimateEndHour} period={profile.estimateEndPeriod} onHourChange={(hour) => update("estimateEndHour", hour, { saveImmediately: true })} onPeriodChange={(period) => update("estimateEndPeriod", period, { saveImmediately: true })} />}
      </div>
    </section>
    <section>
      <ExplainedLabel label="Service area" explanation="Choose the state the business serves. Add a county only when the business is limited to or focused on one county." heading />
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="State" explanation="Choose the state where this business provides service.">
          <InAppSelect ariaLabel="State" value={serviceState} options={US_STATES} placeholder="Choose a state" onChange={(state) => update("serviceAreas", serviceAreaValues(state, serviceCounty), { saveImmediately: true })} />
        </Field>
        <Field label="County (optional)" explanation="Enter a county only if it helps define the service area more precisely.">
          <Input ariaLabel="County (optional)" value={serviceCounty} placeholder="Worcester County" onChange={(event) => update("serviceAreas", serviceAreaValues(serviceState, event.target.value))} onBlur={(event) => update("serviceAreas", serviceAreaValues(serviceState, event.currentTarget.value), { saveImmediately: true })} />
        </Field>
      </div>
    </section>
    <section>
      <ExplainedLabel label="Services" explanation="Add each type of work customers can request from the business." heading />
      <div className="mt-4"><ServicesEditor services={profile.services} businessType={profile.businessType} onChange={(services) => update("services", services, { saveImmediately: true })} /></div>
    </section>
    <section>
      <ExplainedLabel label="Additional business information" explanation="Add optional titled facts the AI receptionist can use when answering customer questions." heading />
      <div className="mt-4"><BusinessInformationEditor items={profile.businessInformation} onChange={(items) => update("businessInformation", items, { saveImmediately: true })} /></div>
    </section>
  </>;
  return (
    <div className="space-y-7">
      {identitySection}
      {sharedSections}
    </div>
  );
}
