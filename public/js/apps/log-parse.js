// Reading log files the way CMTrace does: Configuration Manager's own format, its older
// "$$<component>" format, and any other text log (one entry per line, with the time and an
// error / warning level worked out from the text).
//
// An entry: { text, component, time (ms since 1970, or null), timeText, thread, type (1 info,
// 2 warning, 3 error), file, source }

export const INFO = 1, WARN = 2, ERROR = 3;

const CM = /<!\[LOG\[([\s\S]*?)\]LOG\]!><time="([^"]*)" date="([^"]*)" component="([^"]*)" context="([^"]*)" type="(\d)" thread="([^"]*)" file="([^"]*)">/g;
const SMS = /([^\r\n]*?(?:\r?\n(?!.*\$\$<)[^\r\n]*)*?)\s*\$\$<([^>]*)><([^>]*)><thread=(\d+)[^>]*>/g;

// "13:45:07.123+300" + "01-31-2024" -> local time (CMTrace shows the writer's local time).
function cmTime(time, date) {
  const t = /^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(time || '');
  const d = /^(\d{1,2})-(\d{1,2})-(\d{4})/.exec(date || '');
  if (!t || !d) return null;
  return new Date(Number(d[3]), Number(d[1]) - 1, Number(d[2]), Number(t[1]), Number(t[2]), Number(t[3]), Number((t[4] || '0').padEnd(3, '0'))).getTime();
}

// Time stamps commonly found at the start of (or inside) other logs.
const STAMPS = [
  // 2024-01-31 13:45:07.123 / 2024-01-31T13:45:07,123Z / 2024/01/31 13:45:07
  [/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d{1,6}))?(Z|[+-]\d{2}:?\d{2})?/, (m) => {
    const ms = Number((m[7] || '0').slice(0, 3).padEnd(3, '0'));
    if (m[8]) return Date.parse(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T${m[4].padStart(2, '0')}:${m[5]}:${m[6]}.${String(ms).padStart(3, '0')}${m[8] === 'Z' ? 'Z' : m[8].replace(/(\d{2})(\d{2})$/, '$1:$2')}`);
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms).getTime();
  }],
  // 01/31/2024 13:45:07 (US order, as Windows writes it)
  [/(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?\s*(AM|PM)?/i, (m) => {
    let hr = +m[4];
    if (m[8]) hr = (hr % 12) + (/pm/i.test(m[8]) ? 12 : 0);
    return new Date(+m[3], +m[1] - 1, +m[2], hr, +m[5], +m[6], Number((m[7] || '0').padEnd(3, '0'))).getTime();
  }],
  // Jan 31 13:45:07 (syslog)
  [/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})/, (m) => {
    const mon = 'JanFebMarAprMayJunJulAugSepOctNovDec'.indexOf(m[1]) / 3;
    return new Date(new Date().getFullYear(), mon, +m[2], +m[3], +m[4], +m[5]).getTime();
  }],
];

// CMTrace's rule for logs that don't say: words like "error" or "fail" make it an error,
// "warn" a warning.
const ERR_WORDS = /\b(error|errors|fail|failed|failure|fatal|exception|critical|crash(ed)?|denied|abort(ed)?|unable to)\b|0x8[0-9a-f]{7}\b/i;
const WARN_WORDS = /\b(warn|warning|warnings|retry(ing)?|timed? ?out|deprecated)\b/i;
const NOT_ERR = /\b(0 errors?|no errors?|errors?: 0|error code 0x0+\b|without errors?)\b/i;
export function guessType(text) {
  if (ERR_WORDS.test(text) && !NOT_ERR.test(text)) return ERROR;
  if (WARN_WORDS.test(text)) return WARN;
  return INFO;
}

const fmtTime = (ms) => {
  if (ms == null || Number.isNaN(ms)) return '';
  const d = new Date(ms);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};
export { fmtTime };

export function detectFormat(text) {
  const head = text.slice(0, 20000);
  if (/<!\[LOG\[[\s\S]*?\]LOG\]!></.test(head)) return 'cmtrace';
  if (/\$\$<[^>]*><[^>]*><thread=\d+/.test(head)) return 'sms';
  return 'text';
}

// Parse a whole file (or a chunk appended to one). `carry` is text left over from the previous
// chunk that didn't make a complete entry yet; the result says what to carry next time.
export function parse(text, { format, source = '', carry = '' } = {}) {
  const all = carry + text;
  const fmt = format || detectFormat(all);
  const entries = [];
  let rest = '';
  if (fmt === 'cmtrace') {
    CM.lastIndex = 0;
    let m, end = 0;
    while ((m = CM.exec(all))) {
      const time = cmTime(m[2], m[3]);
      const type = Number(m[6]) || INFO;
      entries.push({ text: m[1].replace(/\r?\n$/, ''), component: m[4], time, timeText: time ? fmtTime(time) : `${m[3]} ${m[2]}`, thread: m[7], type: type >= 3 ? ERROR : type === 2 ? WARN : INFO, file: m[8], source });
      end = CM.lastIndex;
    }
    rest = all.slice(end);
    // Anything after the last entry that isn't the start of one is a stray line: show it.
    if (!/<!\[LOG\[/.test(rest) && rest.includes('\n')) {
      for (const line of rest.split(/\r?\n/).filter((l) => l.trim())) entries.push(lineEntry(line, source));
      rest = '';
    }
  } else if (fmt === 'sms') {
    SMS.lastIndex = 0;
    let m, end = 0;
    while ((m = SMS.exec(all))) {
      const dt = /^(\d{1,2})-(\d{1,2})-(\d{4}) (\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(m[3]);
      const time = dt ? new Date(+dt[3], +dt[1] - 1, +dt[2], +dt[4], +dt[5], +dt[6], Number((dt[7] || '0').padEnd(3, '0'))).getTime() : null;
      const msg = m[1].replace(/^\r?\n/, '');
      entries.push({ text: msg, component: m[2], time, timeText: time ? fmtTime(time) : m[3], thread: m[4], type: guessType(msg), file: '', source });
      end = SMS.lastIndex;
    }
    rest = all.slice(end);
  } else {
    const lines = all.split(/\r?\n/);
    rest = lines.pop(); // may be incomplete
    let last = null;
    for (const line of lines) {
      if (!line.trim()) continue;
      // Indented lines with no time of their own continue the entry above (stack traces).
      if (last && /^\s+\S/.test(line) && !STAMPS.some(([re]) => re.test(line.slice(0, 40)))) { last.text += `\n${line}`; if (last.type < ERROR) last.type = Math.max(last.type, guessType(line)); continue; }
      last = lineEntry(line, source);
      entries.push(last);
    }
  }
  return { entries, carry: rest, format: fmt };
}

// One line of an ordinary text log.
function lineEntry(line, source) {
  let time = null, timeText = '', text = line, component = '', thread = '';
  for (const [re, toMs] of STAMPS) {
    const m = re.exec(line.slice(0, 80));
    if (m) { time = toMs(m); timeText = time != null && !Number.isNaN(time) ? fmtTime(time) : m[0]; text = (line.slice(0, m.index) + line.slice(m.index + m[0].length)).replace(/^\s*\[\s*\]/, '').replace(/^[\s,:\]|-]+/, ''); break; }
  }
  // "Info  CBS  message" (Windows CBS / DISM logs) and "[component]" prefixes.
  let m = /^(Info|Warning|Error|Perf)\s+(\w{2,12})\s+(.*)$/.exec(text);
  let type = null;
  if (m) { component = m[2]; type = m[1] === 'Error' ? ERROR : m[1] === 'Warning' ? WARN : INFO; /* the log says, so don't guess */ text = m[3]; }
  else if ((m = /^\[([^\]]{1,40})\]\s*(.*)$/.exec(text))) { component = m[1]; text = m[2]; }
  if ((m = /\b(?:thread|tid)[=: ]+(\d+)/i.exec(line))) thread = m[1];
  // Common level words at the start: "ERROR:", "[WARN]", "W/", "level=error".
  const lvl = /^(?:\[)?(TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|ERR|FATAL|CRITICAL)(?:\])?[:\s]/i.exec(text) || /\blevel=(error|warn|warning|info|debug|fatal)\b/i.exec(text);
  if (lvl && type == null) type = /err|fatal|crit/i.test(lvl[1]) ? ERROR : /warn/i.test(lvl[1]) ? WARN : INFO;
  return { text, component, time: time != null && !Number.isNaN(time) ? time : null, timeText, thread, type: type ?? guessType(text), file: '', source };
}

// Text from bytes: UTF-16 logs (with a byte-order mark) are common on Windows.
export function decode(bytes, encoding) {
  const enc = encoding || (bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8');
  return { text: new TextDecoder(enc).decode(bytes), encoding: enc };
}

// ---------------------------------------------------------------------------
// Error lookup (CMTrace's Tools → Error Lookup), for the codes logs mention most.
// ---------------------------------------------------------------------------

const WIN32 = {
  0: 'The operation completed successfully.', 1: 'Incorrect function.', 2: 'The system cannot find the file specified.', 3: 'The system cannot find the path specified.',
  4: 'The system cannot open the file.', 5: 'Access is denied.', 6: 'The handle is invalid.', 8: 'Not enough memory resources are available to process this command.',
  13: 'The data is invalid.', 14: 'Not enough memory resources are available to complete this operation.', 15: 'The system cannot find the drive specified.',
  21: 'The device is not ready.', 23: 'Data error (cyclic redundancy check).', 32: 'The process cannot access the file because it is being used by another process.',
  33: 'The process cannot access the file because another process has locked a portion of the file.', 50: 'The request is not supported.', 53: 'The network path was not found.',
  59: 'An unexpected network error occurred.', 64: 'The specified network name is no longer available.', 67: 'The network name cannot be found.', 80: 'The file exists.',
  87: 'The parameter is incorrect.', 112: 'There is not enough space on the disk.', 122: 'The data area passed to a system call is too small.', 123: 'The filename, directory name, or volume label syntax is incorrect.',
  126: 'The specified module could not be found.', 127: 'The specified procedure could not be found.', 145: 'The directory is not empty.', 161: 'The specified path is invalid.',
  183: 'Cannot create a file when that file already exists.', 193: 'The application is not a valid Win32 application.', 206: 'The filename or extension is too long.',
  234: 'More data is available.', 258: 'The wait operation timed out.', 267: 'The directory name is invalid.', 1053: 'The service did not respond to the start or control request in a timely fashion.',
  1060: 'The specified service does not exist as an installed service.', 1062: 'The service has not been started.', 1068: 'The dependency service or group failed to start.',
  1069: 'The service did not start due to a logon failure.', 1115: 'A system shutdown is in progress.', 1150: 'The specified program requires a newer version of Windows.',
  1151: 'The specified program is not a Windows or MS-DOS program.', 1155: 'No application is associated with the specified file for this operation.',
  1219: 'Multiple connections to a server or shared resource by the same user, using more than one user name, are not allowed.', 1223: 'The operation was canceled by the user.',
  1260: 'This program is blocked by group policy.', 1326: 'The user name or password is incorrect.', 1327: 'Account restrictions are preventing this user from signing in.',
  1330: 'The password for this account has expired.', 1355: 'The specified domain either does not exist or could not be contacted.', 1392: 'The file or directory is corrupted and unreadable.',
  1601: 'The Windows Installer Service could not be accessed.', 1602: 'User cancelled installation.', 1603: 'Fatal error during installation.', 1605: 'This action is only valid for products that are currently installed.',
  1612: 'The installation source for this product is not available.', 1618: 'Another installation is already in progress.', 1619: 'This installation package could not be opened.',
  1620: 'This installation package could not be opened. Contact the application vendor to verify that this is a valid Windows Installer package.', 1625: 'This installation is forbidden by system policy.',
  1633: 'This installation package is not supported on this processor type.', 1638: 'Another version of this product is already installed.', 1639: 'Invalid command line argument.',
  1641: 'The requested operation completed successfully. The system will be restarted so the changes can take effect.', 1642: 'The upgrade cannot be installed because the program to be upgraded may be missing.',
  1722: 'The RPC server is unavailable.', 1726: 'The remote procedure call failed.', 1909: 'The referenced account is currently locked out and may not be logged on to.',
  2147: 'The file name is too long.', 3010: 'The requested operation is successful. Changes will not be effective until the system is rebooted.',
  10054: 'An existing connection was forcibly closed by the remote host.', 10060: 'A connection attempt failed because the connected party did not properly respond after a period of time.',
  10061: 'No connection could be made because the target machine actively refused it.', 12002: 'The operation timed out (WinHTTP).', 12007: 'The server name or address could not be resolved (WinHTTP).',
  12029: 'A connection with the server could not be established (WinHTTP).', 12030: 'The connection with the server was terminated abnormally (WinHTTP).', 12175: 'A security error occurred (WinHTTP / TLS).',
};
const HRESULTS = {
  0x80004001: 'Not implemented.', 0x80004002: 'No such interface supported.', 0x80004003: 'Invalid pointer.', 0x80004004: 'Operation aborted.', 0x80004005: 'Unspecified error.',
  0x8000ffff: 'Catastrophic failure.', 0x80010105: 'The server threw an exception.', 0x80041001: 'Generic WMI failure.', 0x80041002: 'WMI: Object cannot be found.', 0x80041003: 'WMI: Access denied.',
  0x80041010: 'WMI: Specified class is not valid.', 0x80041013: 'WMI: Provider load failure.', 0x8004100e: 'WMI: Invalid namespace.', 0x80070002: 'The system cannot find the file specified.',
  0x80240017: 'Windows Update: Operation was not performed because there are no applicable updates.', 0x8024402c: 'Windows Update: The proxy server or target server name cannot be resolved.',
  0x80244022: 'Windows Update: Same as HTTP status 503 - the service is temporarily overloaded.', 0x80244010: 'Windows Update: The number of round trips to the server exceeded the maximum limit.',
  0x8024401c: 'Windows Update: Same as HTTP status 408 - the server timed out waiting for the request.', 0x80240022: 'Windows Update: Operation failed for all the updates.',
  0x8024000b: 'Windows Update: Operation was cancelled.', 0x80246007: 'Windows Update: The update has not been downloaded.', 0x80246008: 'Windows Update: An error occurred when BITS transferred the file.',
  0x800f081f: 'The source files could not be found (DISM / features on demand).', 0x800f0922: 'The update could not be installed (servicing stack / reserved partition).', 0x800f0831: 'CBS store is corrupted: a required package is missing.',
  0x87d00213: 'ConfigMgr: Timeout occurred.', 0x87d00215: 'ConfigMgr: Item not found.', 0x87d00227: 'ConfigMgr: The software update is not required.', 0x87d00244: 'ConfigMgr: The object was not found.',
  0x87d00269: 'ConfigMgr: No current or valid management point found.', 0x87d00314: 'ConfigMgr: CI not found.', 0x87d00324: 'ConfigMgr: The application was not detected after installation completed.',
  0x87d00325: 'ConfigMgr: The application was still detected after uninstall completed.', 0x87d00607: 'ConfigMgr: Content not found.', 0x87d00664: 'ConfigMgr: Updates handler job was cancelled.',
  0x87d00665: 'ConfigMgr: No updates to process in the job.', 0x87d00668: 'ConfigMgr: Software update still detected as actionable after apply.', 0x87d00692: 'ConfigMgr: Group policy conflict.',
  0x87d00705: 'ConfigMgr: Pending system restart.', 0x87d01106: 'ConfigMgr: Failed to verify the executable file is valid or to construct the associated command line.',
  0x87d01201: 'ConfigMgr: The content download cannot be performed because there is not enough available space in cache or the disk is full.',
  0x87d01202: 'ConfigMgr: The content download cannot be performed because the total size of the content is larger than the total size of the cache.',
  0x87d00321: 'ConfigMgr: The script execution has timed out.', 0x87d1041c: 'ConfigMgr: The application was not detected after installation completed.',
  0x80072ee2: 'The operation timed out (WinHTTP 12002).', 0x80072ee7: 'The server name or address could not be resolved (WinHTTP 12007).', 0x80072efd: 'A connection with the server could not be established (WinHTTP 12029).',
  0x80072efe: 'The connection with the server was terminated abnormally (WinHTTP 12030).', 0x80072f8f: 'A security error occurred (WinHTTP 12175 / TLS or clock problem).',
  0xc0000005: 'Access violation (the program read or wrote memory it shouldn\'t).', 0xc000000d: 'An invalid parameter was passed to a service or function.', 0xc0000022: 'Access denied.',
  0xc0000034: 'Object name not found.', 0xc000009a: 'Insufficient system resources exist to complete the API.', 0xc0000135: 'Unable to locate a component (a DLL is missing).',
  0xc0000142: 'The application failed to initialize properly (DLL initialization failed).', 0xc0000409: 'Stack buffer overrun / fail-fast.', 0xc000041d: 'An unhandled exception was encountered during a user callback.',
};
const FACILITY = { 0: 'Null', 1: 'RPC', 2: 'Dispatch', 3: 'Storage', 4: 'ITF (COM/WMI)', 7: 'Win32', 8: 'Windows', 10: 'Control', 11: 'Cert', 12: 'Internet', 15: 'Setup API', 16: 'SCard', 17: 'COM+', 21: 'Windows Update', 23: 'Windows Defender', 36: 'Windows Store', 0x7d0: 'ConfigMgr' };

// "0x80070005", "-2147024891", "5", "87D00324" -> a description.
export function lookupError(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  let n;
  if (/^-\d+$/.test(s)) n = (Number(s) >>> 0);
  else if (/^0x[0-9a-f]+$/i.test(s)) n = parseInt(s, 16) >>> 0;
  else if (/^[0-9a-f]{8}$/i.test(s)) n = parseInt(s, 16) >>> 0;
  else if (/^\d+$/.test(s)) n = Number(s);
  else return null;
  const hex = `0x${n.toString(16).toUpperCase().padStart(8, '0')}`;
  const out = { code: n, hex, decimal: n > 0x7fffffff ? n - 0x100000000 : n, message: null, facility: null };
  if (HRESULTS[n]) out.message = HRESULTS[n];
  else if (n <= 0xffff && WIN32[n]) out.message = WIN32[n];
  const sev = n >>> 31, facility = (n >>> 16) & 0x7ff, code = n & 0xffff;
  if (n > 0xffff) {
    out.facility = FACILITY[facility] ? `${FACILITY[facility]} (${facility})` : String(facility);
    if (!out.message && facility === 7 && WIN32[code]) out.message = WIN32[code];
    if (!out.message && sev) out.message = `A failure code (severity: error, facility ${out.facility}, code ${code}).`;
  }
  return out;
}
