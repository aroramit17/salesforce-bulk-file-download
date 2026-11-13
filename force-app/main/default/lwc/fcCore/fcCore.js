// fcCore: pure logic shared by the LWCs and the engine page.
// Keep this file free of imports and DOM access. scripts/build-bundle.js
// strips the `export` keywords to reuse it inside the engine page.

const DEFAULT_PATTERN = '{RecordName}_{Title}.{ext}';
const STORED_TYPES = ['jpg', 'jpeg', 'png', 'gif', 'pdf', 'zip', 'docx', 'xlsx', 'pptx', 'mp4', 'mp3'];
const MAX_SEGMENT = 150;
// Device names Windows refuses as a file or folder name, with or without an extension.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export function sanitizeSegment(s) {
    const cleaned = String(s === null || s === undefined ? '' : s)
        // eslint-disable-next-line no-control-regex
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
        .slice(0, MAX_SEGMENT)
        .replace(/^\s+/, '')
        .replace(/[.\s]+$/, '');
    if (cleaned === '') {
        return '_';
    }
    return RESERVED.test(cleaned) ? '_' + cleaned : cleaned;
}

function tokenValue(v) {
    return v === null || v === undefined || v === '' ? '' : sanitizeSegment(v);
}

export function applyPattern(pattern, row) {
    const ext = tokenValue(row.ext);
    const values = {
        RecordName: tokenValue(row.parentName),
        RecordId: tokenValue(row.parentId),
        Title: tokenValue(row.title),
        ext,
        FileId: tokenValue(row.id),
        Object: tokenValue(row.parentObject),
        CreatedDate: tokenValue(String(row.createdDate || '').slice(0, 10)),
        Version: tokenValue(row.version)
    };
    const name = (pattern && pattern.trim() ? pattern : DEFAULT_PATTERN).replace(/\{(\w+)\}/g, (match, token) =>
        Object.prototype.hasOwnProperty.call(values, token) ? values[token] : match
    );
    // Cut the stem, never the version suffix or the extension.
    const dotExt = ext && name.endsWith('.' + ext) ? '.' + ext : '';
    const stem = dotExt ? name.slice(0, -dotExt.length) : name;
    const suffix = row.isLatest === false && row.version ? '_v' + tokenValue(row.version) : '';
    const tail = suffix + dotExt;
    const cut = sanitizeSegment(stem).slice(0, Math.max(1, MAX_SEGMENT - tail.length));
    return sanitizeSegment(cut + tail);
}

export function folderFor(layout, row) {
    if (layout === 'PerRecord') {
        return sanitizeSegment(row.parentName);
    }
    if (layout === 'PerObject') {
        return sanitizeSegment(row.parentObject) + '/' + sanitizeSegment(row.parentName);
    }
    return '';
}

export function uniquePath(path, used) {
    const slash = path.lastIndexOf('/');
    const dir = path.slice(0, slash + 1);
    const base = path.slice(slash + 1);
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : '';
    let candidate = path;
    let n = 1;
    while (used.has(candidate.toLowerCase())) {
        n += 1;
        candidate = dir + stem + ' (' + n + ')' + ext;
    }
    used.add(candidate.toLowerCase());
    return candidate;
}

export function filterRows(rows, options) {
    const kinds = {
        File: options.includeFiles,
        Attachment: options.includeAttachments,
        Note: options.includeNotes,
        EnhancedNote: options.includeEnhancedNotes
    };
    const exts = (options.extensions || []).map((e) => String(e).toLowerCase());
    return rows.filter((row) => {
        // Kinds without a switch (documents, static resources, event logs) always pass.
        if (Object.prototype.hasOwnProperty.call(kinds, row.kind) && !kinds[row.kind]) {
            return false;
        }
        if (exts.length && !exts.includes(String(row.ext || '').toLowerCase())) {
            return false;
        }
        const day = String(row.createdDate || '').slice(0, 10);
        if (options.createdFrom && day < options.createdFrom) {
            return false;
        }
        if (options.createdTo && day > options.createdTo) {
            return false;
        }
        if (options.maxSizeBytes > 0 && row.size > options.maxSizeBytes) {
            return false;
        }
        return true;
    });
}

export function planParts(rows, limits) {
    const parts = [];
    const oversized = [];
    let current = [];
    let bytes = 0;
    rows.forEach((row) => {
        const size = row.size || 0;
        if (size > limits.maxZipBytes) {
            oversized.push(row);
            return;
        }
        if (current.length && (bytes + size > limits.maxZipBytes || current.length >= limits.maxFilesPerZip)) {
            parts.push(current);
            current = [];
            bytes = 0;
        }
        current.push(row);
        bytes += size;
    });
    if (current.length) {
        parts.push(current);
    }
    return { parts, oversized };
}

export function csvEscape(v) {
    if (v === null || v === undefined) {
        return '';
    }
    let s = String(v);
    if (typeof v === 'string' && /^\s*[=+\-@]/.test(s)) {
        s = "'" + s;
    }
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(headers, rows) {
    const lines = [headers].concat(rows).map((cells) => cells.map(csvEscape).join(','));
    return '﻿' + lines.join('\r\n') + '\r\n';
}

export function manifestCsv(entries) {
    return toCsv(
        [
            'Record Id',
            'Record Name',
            'Object',
            'File Id',
            'File Name',
            'Type',
            'Size (bytes)',
            'Created Date',
            'Zip Path',
            'Link'
        ],
        entries.map((e) => [
            e.row.parentId,
            e.row.parentName,
            e.row.parentObject,
            e.row.id,
            e.fileName,
            e.row.kind,
            e.row.size,
            e.row.createdDate,
            e.zipPath,
            e.link
        ])
    );
}

export function errorsCsv(entries) {
    return toCsv(
        ['Record Id', 'Record Name', 'File Id', 'File Name', 'Reason'],
        entries.map((e) => [e.row.parentId, e.row.parentName, e.row.id, e.fileName, e.reason])
    );
}

export function isStored(ext) {
    return STORED_TYPES.includes(String(ext || '').toLowerCase());
}

export function formatBytes(n) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = Number(n) || 0;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return unit === 0 ? value + ' B' : value.toFixed(1) + ' ' + units[unit];
}

export function zipName(objectLabel, dateStr, index, count) {
    const part = count > 1 ? '-part' + (index + 1) : '';
    return 'crate-' + sanitizeSegment(objectLabel).replace(/\s+/g, '_') + '-' + dateStr + part + '.zip';
}

export function chunk(arr, n) {
    const out = [];
    for (let i = 0; i < arr.length; i += n) {
        out.push(arr.slice(i, i + n));
    }
    return out;
}

/**
 * The origin FcEngine.page is served from, worked out from the host of the page
 * that embeds it. Null when the host is neither Lightning nor Visualforce.
 */
export function engineOriginFor(host) {
    const lightning = '.lightning.force.com';
    const h = String(host || '').toLowerCase();
    if (h.endsWith('.vf.force.com')) {
        return 'https://' + h;
    }
    if (!h.endsWith(lightning)) {
        return null;
    }
    const domain = h.slice(0, -lightning.length);
    const dot = domain.indexOf('.');
    const first = dot === -1 ? domain : domain.slice(0, dot);
    const rest = dot === -1 ? '' : domain.slice(dot);
    return 'https://' + first + '--c' + rest + '.vf.force.com';
}

/**
 * Whether a window message really comes from the engine page. On a Salesforce
 * page the engine origin is known, so the origin must match it exactly. On any
 * other host (unit tests) the sender must be the window the component opened.
 */
export function isEngineMessage(input) {
    const expected = engineOriginFor(input.host);
    return expected === null ? input.sourceMatches === true : input.origin === expected;
}

/** A random 32 character hex string that ties an engine frame's messages to the component that embeds it. */
export function makeNonce() {
    const bytes = new Uint8Array(16);
    // eslint-disable-next-line no-undef
    const source = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : null;
    if (source) {
        source.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = Math.floor(Math.random() * 256);
        }
    }
    return Array.from(bytes, (b) => (b < 16 ? '0' : '') + b.toString(16)).join('');
}
