function text(value) {
  return String(value || "").trim();
}

export function normalizeAddressKey(value) {
  return text(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(apartment|apt|unit|suite|ste)\b/g, " unit ")
    .replace(/\b(street)\b/g, " st ")
    .replace(/\b(road)\b/g, " rd ")
    .replace(/\b(avenue)\b/g, " ave ")
    .replace(/\b(boulevard)\b/g, " blvd ")
    .replace(/\b(drive)\b/g, " dr ")
    .replace(/\b(lane)\b/g, " ln ")
    .replace(/\b(court)\b/g, " ct ")
    .replace(/\b(highway)\b/g, " hwy ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

export function uniqueTexts(...values) {
  const seen = new Set();
  const result = [];

  values.flat(Infinity).forEach((value) => {
    const cleaned = text(value);
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) return;
    seen.add(key);
    result.push(cleaned);
  });

  return result;
}

function jobId(value, fallbackNumber) {
  return text(value) || `job-${fallbackNumber}`;
}

export function normalizeJobs(data = {}, stageKey = "contactedMe") {
  if (Array.isArray(data.Jobs) && data.Jobs.length) {
    return data.Jobs.map((job, index) => ({
      id: jobId(job.id, index + 1),
      number: Number(job.number) || index + 1,
      type: text(job.type || job.Job || job.job),
      status: text(job.status) || stageKey,
      estimateDate: text(job.estimateDate || job.EstimateDate),
      estimateTime: text(job.estimateTime || job.EstimateTime),
      startDate: text(job.startDate || job.WorkStartDate),
      completeDate: text(job.completeDate || job.WorkCompleteDate),
      notes: text(job.notes || job.Notes),
      source: text(job.source || data.source),
      createdAt: text(job.createdAt),
      updatedAt: text(job.updatedAt),
      lastMoveBackReason: text(job.lastMoveBackReason),
    }));
  }

  const hasLegacyJob = Boolean(
    text(data.Job) ||
    text(data.WorkStartDate) ||
    text(data.WorkCompleteDate) ||
    text(data.EstimateDate) ||
    text(data.Notes)
  );

  if (!hasLegacyJob) return [];

  return [{
    id: "job-1",
    number: 1,
    type: text(data.Job),
    status: stageKey,
    estimateDate: text(data.EstimateDate),
    estimateTime: text(data.EstimateTime),
    startDate: text(data.WorkStartDate),
    completeDate: text(data.WorkCompleteDate),
    notes: text(data.Notes),
    source: text(data.source),
    createdAt: "",
    updatedAt: "",
    lastMoveBackReason: text(data.lastMoveBackReason),
  }];
}

export function createJob(data = {}, number = 1, stageKey = "contactedMe") {
  const now = new Date().toISOString();
  return {
    id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    number,
    type: text(data.Job || data.job || data.service || data.projectType || data.requestedService),
    status: stageKey,
    estimateDate: text(data.EstimateDate),
    estimateTime: text(data.EstimateTime),
    startDate: text(data.WorkStartDate),
    completeDate: text(data.WorkCompleteDate),
    notes: text(data.Notes || data.notes || data.message || data.summary),
    source: text(data.source || "website"),
    createdAt: now,
    updatedAt: now,
    lastMoveBackReason: "",
  };
}

export function updateCurrentJob(data = {}, stageKey, patch = {}) {
  const jobs = normalizeJobs(data, stageKey);
  const nextJobs = jobs.length ? [...jobs] : [createJob(data, 1, stageKey)];
  const index = nextJobs.length - 1;

  nextJobs[index] = {
    ...nextJobs[index],
    ...patch,
    status: patch.status || stageKey || nextJobs[index].status,
    updatedAt: new Date().toISOString(),
  };

  return nextJobs;
}

export function mergeJobs(...jobLists) {
  const result = [];
  const seen = new Set();

  jobLists.flat(Infinity).forEach((job) => {
    if (!job || typeof job !== "object") return;
    const key = text(job.id) || `${text(job.type)}|${text(job.startDate)}|${text(job.completeDate)}|${result.length}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ ...job, number: result.length + 1 });
  });

  return result;
}
