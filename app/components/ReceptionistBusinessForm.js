"use client";

import { useState } from "react";

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const TIME_ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "America/Anchorage", "Pacific/Honolulu"];
const BUSINESS_HOURS = [
  "Monday through Friday, 8:00 AM to 5:00 PM",
  "Monday through Friday, 9:00 AM to 5:00 PM",
  "Monday through Saturday, 8:00 AM to 5:00 PM",
  "Monday through Saturday, 9:00 AM to 5:00 PM",
  "Every day, 8:00 AM to 5:00 PM",
  "Open 24 hours",
];
const TIME_OPTIONS = Array.from({ length: 25 }, (_, index) => {
  const minutes = 7 * 60 + index * 30;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const labelHour = hour % 12 || 12;
  return `${labelHour}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
});
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

function Select({ value, onChange, children }) {
  return <select value={value ?? ""} onChange={onChange} className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-950">{children}</select>;
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
  return {
    ...profile,
    serviceAreas: Array.isArray(profile.serviceAreas) ? profile.serviceAreas : [],
    about: Array.isArray(profile.about) ? profile.about : [],
    services: profile.services && typeof profile.services === "object" && !Array.isArray(profile.services) ? profile.services : {},
    aiSilenceSeconds: Number(profile.aiSilenceMs || 1200) / 1000,
  };
}

export function receptionistRequestPayload(profile = {}) {
  return {
    ...profile,
    aiSilenceMs: Math.round(Number(profile.aiSilenceSeconds || 1.2) * 1000),
  };
}

export default function ReceptionistBusinessForm({ profile, onChange, adminMode = false }) {
  if (!profile) return null;
  const voice = VOICES.find((item) => item.value === profile.aiVoice) || VOICES[0];
  const speed = SPEEDS.find((item) => item.value === Number(profile.aiSpeechSpeed)) || SPEEDS[1];
  const currentHours = profile.businessHours || BUSINESS_HOURS[1];
  const hourOptions = BUSINESS_HOURS.includes(currentHours) ? BUSINESS_HOURS : [currentHours, ...BUSINESS_HOURS];

  function update(field, value) {
    onChange({ ...profile, [field]: value });
  }

  function toggleWeekday(day) {
    const days = new Set(profile.estimateWeekdays || []);
    if (days.has(day)) days.delete(day); else days.add(day);
    update("estimateWeekdays", WEEKDAYS.filter((item) => days.has(item)));
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
          <Field label="Business hours" hint="Choose the schedule callers should hear." wide><Select value={currentHours} onChange={(event) => update("businessHours", event.target.value)}>{hourOptions.map((hours) => <option key={hours} value={hours}>{hours}</option>)}</Select></Field>
          <Field label="Earliest estimate time"><Select value={profile.earliestEstimateStart || "9:00 AM"} onChange={(event) => update("earliestEstimateStart", event.target.value)}>{TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}</Select></Field>
          <Field label="Latest estimate time"><Select value={profile.latestEstimateStart || "4:30 PM"} onChange={(event) => update("latestEstimateStart", event.target.value)}>{TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}</Select></Field>
          <div className="md:col-span-2">
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500 sm:text-xs">Days available for estimates</p>
            <p className="mt-1 text-[11px] font-semibold leading-4 text-slate-500">Choose the days the receptionist may offer an estimate appointment.</p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-7">{WEEKDAYS.map((day) => <label key={day} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold capitalize"><input type="checkbox" checked={(profile.estimateWeekdays || []).includes(day)} onChange={() => toggleWeekday(day)} />{day}</label>)}</div>
          </div>
          <Field label="Service areas" hint="Add a city, county, state, the whole United States, or any other area the business serves." wide><ListEditor items={profile.serviceAreas} onChange={(items) => update("serviceAreas", items)} placeholder="Worcester, Massachusetts" addLabel="Add Area" /></Field>
          <Field label="About the business" hint="Add short facts the receptionist should know, one at a time." wide><ListEditor items={profile.about} onChange={(items) => update("about", items)} placeholder="Family-owned since 2018" addLabel="Add Fact" /></Field>
          <Field label="Services" hint="Add each service with a short explanation so the receptionist can describe it correctly." wide><ServicesEditor services={profile.services} onChange={(services) => update("services", services)} /></Field>
          <Field label="Extra business information" hint="Use this for policies, common questions, timing, limitations, and anything else the receptionist may need." wide><textarea rows={10} value={profile.extraInformation || ""} onChange={(event) => update("extraInformation", event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm leading-6 outline-none focus:border-slate-950" /></Field>
        </div>
      </section>
    </div>
  );
}
