"use client";

import { useState } from "react";
import { BUSINESS_TYPES, canonicalBusinessType, serviceSuggestionsForBusinessType } from "../lib/businessCatalog";
import { ASAP_OR_SCHEDULED_QUESTION, normalizeEmergencyServiceSettings, REGULAR_SERVICE_WEEKDAYS } from "../lib/emergencyService";
import { businessInformationText, normalizeBusinessInformation } from "../lib/receptionistBusinessInformation";
import { changeReceptionistBusinessType, setEmergencyService24Hours, setRegularService24Hours, setRegularServiceEveryDay } from "../lib/receptionistBusinessSettings";
import { normalizeServiceAreas, serviceAreaFields, serviceAreaValues, US_STATES } from "../lib/serviceAreas";
import { dashBusinessName } from "../lib/valueUtils";
import AppSelect from "./AppSelect";
import InfoTip from "./InfoTip";

const WEEKDAYS = REGULAR_SERVICE_WEEKDAYS;
const TIME_ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "America/Anchorage", "Pacific/Honolulu"];
const HOURS = Array.from({ length: 12 }, (_, index) => index + 1);
const PERIODS = ["AM", "PM"];
const HOUR_OPTIONS = [{ value: "", label: "Choose" }, ...HOURS];
const PERIOD_OPTIONS = [{ value: "", label: "Choose" }, ...PERIODS];
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
  const labelClassName = heading
    ? "text-lg font-black"
    : "text-[10px] font-black uppercase tracking-[0.12em] text-slate-500 sm:text-xs";
  return (
    <div className="flex items-center gap-2">
      {heading ? <h3 className={labelClassName}>{label}</h3> : <p className={labelClassName}>{label}</p>}
      {explanation && <InfoTip label={`About ${label}`}>{explanation}</InfoTip>}
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
        <AppSelect label={`${label} hour`} ariaLabel={`${label} hour`} value={selectedHour} options={HOUR_OPTIONS} placeholder="Choose" onChange={(value) => onHourChange(value ? Number(value) : "")} />
        <AppSelect label={`${label} AM or PM`} ariaLabel={`${label} AM or PM`} value={selectedPeriod} options={PERIOD_OPTIONS} placeholder="Choose" onChange={onPeriodChange} align="right" />
      </div>
    </Field>
  );
}

function StackedListEditor({ items, onChange, placeholder, addLabel, inputLabel, suggestions = [] }) {
  const normalizedItems = Array.isArray(items) ? items.map((item) => String(item || "").trim()).filter(Boolean) : [];
  const [entry, setEntry] = useState("");
  const availableSuggestions = [...new Set(suggestions.map((item) => String(item || "").trim()).filter(Boolean))]
    .filter((suggestion) => !normalizedItems.some((item) => item.toLowerCase() === suggestion.toLowerCase()));

  function addItem(value = entry) {
    const nextItem = String(value || "").trim();
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
        <input
          aria-label={inputLabel}
          autoComplete="off"
          autoCapitalize="words"
          autoCorrect="on"
          spellCheck
          value={entry}
          onChange={(event) => setEntry(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addItem(); } }}
          placeholder={placeholder}
          className="h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-950"
        />
        <button type="button" disabled={!entry.trim()} onClick={() => addItem()} className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">{addLabel}</button>
      </div>
      {suggestions.length > 0 && !entry.trim() && availableSuggestions.length > 0 && <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-black text-slate-600">Suggested services</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {availableSuggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => addItem(suggestion)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-xs font-bold text-slate-800 active:bg-slate-100">{suggestion}</button>)}
        </div>
      </div>}
      {normalizedItems.map((item, index) => (
        <div key={`${item}-${index}`} className="flex items-center gap-2">
          <div className="flex h-11 min-w-0 flex-1 items-center rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm text-slate-800">{item}</div>
          <button type="button" onClick={() => removeRow(index)} aria-label={`Remove ${item}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-red-200 bg-white text-xl font-black text-red-600">×</button>
        </div>
      ))}
    </div>
  );
}

function ServiceAreaEditor({ serviceAreas, onChange }) {
  const { states, counties } = serviceAreaFields(serviceAreas);
  const [stateToAdd, setStateToAdd] = useState("");
  const availableStates = US_STATES.filter((state) => !states.includes(state));
  const countiesRequireOneState = states.length !== 1;
  const addingStateBlocked = counties.length > 0;
  const selectedStateToAdd = availableStates.includes(stateToAdd) ? stateToAdd : "";

  function addState() {
    if (!selectedStateToAdd || addingStateBlocked) return;
    onChange(serviceAreaValues([...states, selectedStateToAdd], counties));
    setStateToAdd("");
  }

  function removeState(state) {
    if (states.length === 1 && counties.length) return;
    onChange(serviceAreaValues(states.filter((item) => item !== state), counties));
  }

  return (
    <div className="space-y-4">
      <div>
        <ExplainedLabel label="States" />
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <AppSelect
            label="State"
            ariaLabel="State to add"
            value={selectedStateToAdd}
            options={availableStates}
            placeholder={availableStates.length ? "Choose a state" : "All states selected"}
            disabled={addingStateBlocked || !availableStates.length}
            onChange={setStateToAdd}
          />
          <button type="button" disabled={!selectedStateToAdd || addingStateBlocked} onClick={addState} className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Add State</button>
        </div>
        {addingStateBlocked && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">Remove every county before adding another state.</p>}
        <div className="mt-2 space-y-2">
          {states.map((state) => {
            const removalBlocked = states.length === 1 && counties.length > 0;
            return (
              <div key={state} className="flex items-center gap-2">
                <div className="flex h-11 min-w-0 flex-1 items-center rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm text-slate-800">{state}</div>
                <button type="button" disabled={removalBlocked} onClick={() => removeState(state)} aria-label={`Remove ${state}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-red-200 bg-white text-xl font-black text-red-600 disabled:cursor-not-allowed disabled:opacity-35">×</button>
              </div>
            );
          })}
          {!states.length && <p className="rounded-xl border border-dashed border-slate-300 px-3 py-3 text-sm font-semibold text-slate-500">Add at least one state.</p>}
        </div>
      </div>

      <div>
        <ExplainedLabel label="Counties (optional)" explanation="Counties are available when exactly one state is selected." />
        {states.length === 1 ? (
          <div className="mt-2">
            <StackedListEditor items={counties} onChange={(nextCounties) => onChange(serviceAreaValues(states, nextCounties))} placeholder="Worcester County" addLabel="Add County" inputLabel="County" />
          </div>
        ) : (
          <p className="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">{countiesRequireOneState && states.length > 1 ? "Counties are unavailable while multiple states are selected." : "Choose one state before adding counties."}</p>
        )}
      </div>
    </div>
  );
}

function ServicesEditor({ services, onChange, businessType }) {
  const current = services && typeof services === "object" && !Array.isArray(services) ? services : {};
  const names = Object.keys(current).map(titleCase);
  function updateServices(nextNames) {
    onChange(Object.fromEntries(nextNames.map((name) => { const key = name.trim().toLowerCase(); return [key, key]; }).filter(([key]) => key)));
  }
  return <StackedListEditor items={names} onChange={updateServices} placeholder="Start typing a service" addLabel="Add Service" inputLabel="Service" suggestions={serviceSuggestionsForBusinessType(businessType)} />;
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
  const emergencyService = normalizeEmergencyServiceSettings(profile);
  const regularServiceEveryDay = typeof profile.regularServiceEveryDay === "boolean"
    ? profile.regularServiceEveryDay
    : Array.isArray(profile.estimateWeekdays) && WEEKDAYS.every((day) => profile.estimateWeekdays.includes(day));
  const regularService24Hours = profile.regularService24Hours === true;
  return {
    ...editableProfile,
    serviceAreas: normalizeServiceAreas(profile.serviceAreas),
    services: profile.services && typeof profile.services === "object" && !Array.isArray(profile.services) ? profile.services : {},
    businessInformation: normalizeBusinessInformation(profile.businessInformation),
    businessType: canonicalBusinessType(profile.businessType || profile.businessBase),
    timeZone: requireExplicitSelections ? String(profile.timeZone || "") : profile.timeZone || "America/New_York",
    estimateWeekdays: Array.isArray(profile.estimateWeekdays) ? profile.estimateWeekdays : [],
    estimateStartHour: regularService24Hours ? "" : explicitHour(profile.estimateStartHour || estimateStart.hour),
    estimateStartPeriod: regularService24Hours ? "" : explicitPeriod(profile.estimateStartPeriod || estimateStart.period),
    estimateEndHour: regularService24Hours ? "" : explicitHour(profile.estimateEndHour || estimateEnd.hour),
    estimateEndPeriod: regularService24Hours ? "" : explicitPeriod(profile.estimateEndPeriod || estimateEnd.period),
    regularServiceEveryDay,
    regularService24Hours,
    ...emergencyService,
  };
}

export function receptionistRequestPayload(profile = {}) {
  const editableProfile = editableProfileWithoutRemovedFields(profile);
  const estimateWeekdays = Array.isArray(profile.estimateWeekdays) ? profile.estimateWeekdays : [];
  const businessInformation = normalizeBusinessInformation(profile.businessInformation);
  const emergencyService = normalizeEmergencyServiceSettings(profile);
  const regularServiceEveryDay = profile.regularServiceEveryDay === true;
  const regularService24Hours = profile.regularService24Hours === true;
  return {
    ...editableProfile,
    serviceAreas: normalizeServiceAreas(profile.serviceAreas),
    businessInformation,
    extraInformation: businessInformationText(businessInformation),
    estimateWeekdays: regularServiceEveryDay ? WEEKDAYS : estimateWeekdays,
    earliestEstimateStart: regularService24Hours ? "" : formatTime(profile.estimateStartHour, profile.estimateStartPeriod),
    latestEstimateStart: regularService24Hours ? "" : formatTime(profile.estimateEndHour, profile.estimateEndPeriod),
    regularServiceEveryDay,
    regularService24Hours,
    ...emergencyService,
  };
}

export default function ReceptionistBusinessForm({ profile, onChange, onboardingMode = false }) {
  if (!profile) return null;
  function update(field, value, options = {}) { onChange({ ...profile, [field]: value }, options); }
  function updateBusinessType(value) {
    onChange(changeReceptionistBusinessType(profile, value), { saveImmediately: true });
  }
  function updateEstimateWeekdays(days) {
    onChange(days.length ? { ...profile, estimateWeekdays: days } : { ...profile, estimateWeekdays: [], estimateStartHour: "", estimateStartPeriod: "", estimateEndHour: "", estimateEndPeriod: "" }, { saveImmediately: true });
  }
  function updateEveryDay(enabled) {
    onChange(setRegularServiceEveryDay(profile, enabled), { saveImmediately: true });
  }
  function updateAllDay(enabled) {
    onChange(setRegularService24Hours(profile, enabled), { saveImmediately: true });
  }
  function updateEmergencyService(enabled) {
    onChange(setEmergencyService24Hours(profile, enabled), { saveImmediately: true });
  }
  const identitySection = !onboardingMode && (
    <section>
      <h3 className="text-lg font-black">Business details</h3>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="Business name"><Input ariaLabel="Business name" value={profile.businessName} onChange={(event) => update("businessName", dashBusinessName(event.target.value))} onBlur={() => update("businessName", profile.businessName, { saveImmediately: true })} /></Field>
        <Field label="Owner name"><Input ariaLabel="Owner name" value={profile.ownerName} onChange={(event) => update("ownerName", event.target.value)} onBlur={() => update("ownerName", profile.ownerName, { saveImmediately: true })} /></Field>
        <Field label="Business phone"><Input ariaLabel="Business phone" type="tel" value={profile.businessPhone} onChange={(event) => update("businessPhone", event.target.value)} onBlur={() => update("businessPhone", profile.businessPhone, { saveImmediately: true })} /></Field>
        <Field label="Business email"><Input ariaLabel="Business email" type="email" value={profile.businessEmail} onChange={(event) => update("businessEmail", event.target.value)} onBlur={() => update("businessEmail", profile.businessEmail, { saveImmediately: true })} /></Field>
      </div>
    </section>
  );
  const sharedSections = <>
    <section>
      <h3 className="text-lg font-black">Business type</h3>
      <div className="mt-4">
        <Field label="Type of business">
          <AppSelect label="Type of business" ariaLabel="Type of business" value={profile.businessType} options={BUSINESS_TYPES} onChange={updateBusinessType} placeholder="Choose a business type" />
        </Field>
      </div>
    </section>
    <section>
      <ExplainedLabel label="Regular scheduling" explanation="Callers request a day and a morning or afternoon window. You confirm the exact appointment after accepting the lead." heading />
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="Time zone">
          <AppSelect label="Time zone" ariaLabel="Time zone" value={onboardingMode ? profile.timeZone || "" : profile.timeZone || "America/New_York"} options={TIME_ZONES} onChange={(value) => update("timeZone", value, { saveImmediately: true })} />
        </Field>
        <label className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 md:col-span-2">
          <span className="text-sm font-black text-slate-900">Open every day</span>
          <input type="checkbox" checked={profile.regularServiceEveryDay === true} onChange={(event) => updateEveryDay(event.target.checked)} className="h-5 w-5 accent-[#071a3d]" />
        </label>
        {profile.regularServiceEveryDay !== true && <DayCheckboxes label="Open days" selected={profile.estimateWeekdays} onChange={updateEstimateWeekdays} />}
        <label className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 md:col-span-2">
          <span className="text-sm font-black text-slate-900">Open 24 hours</span>
          <input type="checkbox" checked={profile.regularService24Hours === true} onChange={(event) => updateAllDay(event.target.checked)} className="h-5 w-5 accent-[#071a3d]" />
        </label>
        {profile.regularService24Hours !== true && <>
          <HourPeriodPicker label="Opens" hour={profile.estimateStartHour} period={profile.estimateStartPeriod} onHourChange={(hour) => update("estimateStartHour", hour, { saveImmediately: true })} onPeriodChange={(period) => update("estimateStartPeriod", period, { saveImmediately: true })} />
          <HourPeriodPicker label="Closes" explanation="A closing time before the opening time means the business stays open overnight." hour={profile.estimateEndHour} period={profile.estimateEndPeriod} onHourChange={(hour) => update("estimateEndHour", hour, { saveImmediately: true })} onPeriodChange={(period) => update("estimateEndPeriod", period, { saveImmediately: true })} />
        </>}
      </div>
    </section>
    <section>
      <ExplainedLabel label="24/7 emergency service" explanation="Use this only when your business takes urgent work at any hour. Regular appointments can still be scheduled." heading />
      <div className="mt-4">
        <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
          <input id="accept-emergency-requests" type="checkbox" className="mt-0.5 h-5 w-5 accent-[#071a3d]" checked={profile.emergencyServiceEnabled === true} onChange={(event) => updateEmergencyService(event.target.checked)} />
          <div className="min-w-0 flex-1">
            <label htmlFor="accept-emergency-requests" className="block text-sm font-black text-slate-900">Offer 24/7 emergency service</label>
            <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">For urgent problems that need help right away, including nights, weekends, and holidays.</p>
          </div>
          <InfoTip label="How 24/7 emergency service works" align="right">The receptionist asks: “{ASAP_OR_SCHEDULED_QUESTION}” It marks the lead Emergency for you to review and never promises an arrival time.</InfoTip>
        </div>
      </div>
    </section>
    <section>
      <ExplainedLabel label="Service area" explanation="Choose multiple states, or choose one state and any number of counties. Counties cannot be combined with multiple states." heading />
      <div className="mt-4"><ServiceAreaEditor serviceAreas={profile.serviceAreas} onChange={(serviceAreas) => update("serviceAreas", serviceAreas, { saveImmediately: true })} /></div>
    </section>
    <section>
      <ExplainedLabel label="Services" heading />
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
