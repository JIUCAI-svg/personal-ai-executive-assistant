import crypto from 'node:crypto';

export const PROACTIVE_SIGNAL_TYPES = Object.freeze([
  'time',
  'task',
  'phone_usage',
  'plan_deviation',
  'schedule_self_check'
]);

export const PROACTIVE_SIGNAL_TYPE_SET = new Set(PROACTIVE_SIGNAL_TYPES);
// The device timezone is authoritative when a client sends one. This fallback
// keeps standalone/server-side signals aligned with the host instead of
// silently forcing every user into Shanghai time.
export const DEFAULT_PROACTIVE_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const TYPE_ALIASES = new Map([
  ['phone-usage', 'phone_usage'],
  ['phone usage', 'phone_usage'],
  ['usage', 'phone_usage'],
  ['plan-deviation', 'plan_deviation'],
  ['plan deviation', 'plan_deviation'],
  ['self-check', 'schedule_self_check'],
  ['schedule-self-check', 'schedule_self_check'],
  ['schedule self check', 'schedule_self_check'],
  ['time_signal', 'time'],
  ['task_signal', 'task']
]);

function text(value, limit = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function validTimezone(value, fallback = DEFAULT_PROACTIVE_TIMEZONE) {
  const candidate = text(value, 120);
  if (candidate) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format();
      return candidate;
    } catch { /* use the device/default timezone below */ }
  }
  const backup = text(fallback, 120);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: backup }).format();
    return backup;
  } catch {
    return DEFAULT_PROACTIVE_TIMEZONE;
  }
}

function isoTimestamp(value, fallback = new Date()) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  const candidate = text(value, 80);
  const parsed = candidate ? new Date(candidate) : fallback;
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback.toISOString();
}

function normalizeType(value) {
  const candidate = text(value, 80).toLowerCase();
  const normalized = TYPE_ALIASES.get(candidate) || candidate;
  return PROACTIVE_SIGNAL_TYPE_SET.has(normalized) ? normalized : '';
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value ?? null);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 40);
}

function dateTimeParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
    second: Number(get('second')) || 0
  };
}

function clockMinutes(value) {
  const match = text(value, 10).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function addDays(date, offset) {
  const [year, month, day] = String(date).split('-').map(Number);
  if (![year, month, day].every(Number.isFinite)) return date;
  const result = new Date(Date.UTC(year, month - 1, day + offset));
  return result.toISOString().slice(0, 10);
}

/**
 * Return the local sleep interval containing `at`, if any. The interval is
 * represented with local date/time labels so callers never accidentally mix
 * the device timezone with the server timezone.
 */
export function proactiveSleepWindow(settings = {}, at = new Date(), timezone = DEFAULT_PROACTIVE_TIMEZONE) {
  const zone = validTimezone(timezone);
  const date = at instanceof Date ? at : new Date(at);
  const current = dateTimeParts(Number.isFinite(date.getTime()) ? date : new Date(), zone);
  const start = clockMinutes(settings.sleep_time) ?? 60;
  const duration = Math.max(60, Math.min(900, Number(settings.sleep_duration_minutes) || 480));
  const currentMinutes = clockMinutes(current.time) ?? 0;
  const endAbsolute = start + duration;
  const crossesMidnight = endAbsolute >= 1440;
  let sleeping = false;
  let startDate = current.date;
  if (crossesMidnight) {
    const end = endAbsolute % 1440;
    if (currentMinutes >= start) {
      sleeping = true;
    } else if (currentMinutes < end) {
      sleeping = true;
      startDate = addDays(current.date, -1);
    }
  } else if (currentMinutes >= start && currentMinutes < endAbsolute) {
    sleeping = true;
  }
  const endDate = addDays(startDate, Math.floor(endAbsolute / 1440));
  const endTime = `${String(endAbsolute % 1440 === 0 ? 0 : Math.floor((endAbsolute % 1440) / 60)).padStart(2, '0')}:${String(endAbsolute % 60).padStart(2, '0')}`;
  return {
    timezone: zone,
    is_sleeping: sleeping,
    start: { date: startDate, time: `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}` },
    end: { date: endDate, time: endTime },
    local: current,
    duration_minutes: duration
  };
}

export function isWithinProactiveSleepWindow(settings, at = new Date(), timezone = DEFAULT_PROACTIVE_TIMEZONE) {
  return proactiveSleepWindow(settings, at, timezone).is_sleeping;
}

/**
 * Normalize all clients to one signal envelope. `event_id`/`request_id` are
 * retained as explicit idempotency keys; a missing key intentionally remains
 * null so two distinct device observations are not collapsed accidentally.
 */
export function normalizeProactiveSignal(input = {}, options = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const nested = source.signal && typeof source.signal === 'object' ? source.signal : {};
  const merged = { ...source, ...nested };
  const explicitType = normalizeType(merged.type || merged.signal_type || merged.kind);
  const type = explicitType || (
    merged.followup_id || merged.followupId ? 'schedule_self_check' :
      merged.app_usage || merged.appUsage ? 'phone_usage' :
        merged.device_activity || merged.deviceActivity ? 'time' :
          text(merged.event || merged.message) ? 'task' : ''
  );
  const observedAt = isoTimestamp(merged.observed_at || merged.observedAt || merged.event_at || merged.timestamp);
  const timezone = validTimezone(merged.timezone || merged.device_timezone || options.timezone || options.deviceTimezone);
  const eventId = text(merged.event_id || merged.eventId, 160) || null;
  const requestId = text(merged.request_id || merged.requestId, 160) || null;
  const followupId = text(merged.followup_id || merged.followupId, 160) || null;
  const suppliedKey = text(merged.idempotency_key || merged.idempotencyKey, 200) || null;
  const signalId = text(merged.signal_id || merged.signalId, 160) || crypto.randomUUID();
  const event = text(merged.event || merged.title || merged.message, 800);
  const instruction = text(merged.instruction, 800);
  const payload = merged.payload && typeof merged.payload === 'object' && !Array.isArray(merged.payload)
    ? structuredClone(merged.payload)
    : {};
  for (const key of ['app_usage', 'device_activity', 'task', 'tasks', 'plan', 'time', 'date']) {
    if (merged[key] !== undefined && payload[key] === undefined) payload[key] = structuredClone(merged[key]);
  }
  const explicitKey = suppliedKey || eventId || requestId || followupId;
  const idempotencyKey = explicitKey || null;
  return {
    id: signalId,
    signal_id: signalId,
    type,
    source: text(merged.source || merged.origin, 80) || 'unknown',
    event,
    instruction,
    payload,
    event_id: eventId,
    request_id: requestId,
    followup_id: followupId,
    idempotency_key: idempotencyKey,
    observed_at: observedAt,
    timezone,
    local: dateTimeParts(new Date(observedAt), timezone),
    received_at: new Date().toISOString()
  };
}

export function proactiveSignalKey(signal) {
  if (!signal || typeof signal !== 'object') return '';
  if (signal.idempotency_key) return text(signal.idempotency_key, 200);
  return '';
}

export function deriveProactiveKey(signal) {
  const normalized = normalizeProactiveSignal(signal);
  return normalized.idempotency_key || digest(stableJson({
    type: normalized.type,
    source: normalized.source,
    event: normalized.event,
    instruction: normalized.instruction,
    payload: normalized.payload,
    observed_at: normalized.observed_at
  }));
}
