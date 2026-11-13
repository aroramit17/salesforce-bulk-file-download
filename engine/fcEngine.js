// fcEngine: fetches file bytes and builds zips. No DOM access; every
// dependency is injected so the same code runs in Jest and in FcEngine.page.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.FcEngine = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var PREFETCH_COUNT = 4;
    var PREFETCH_MAX_BYTES = 8 * 1024 * 1024;
    var MAX_ATTEMPTS = 3;

    function AuthError(status) {
        this.name = 'AuthError';
        this.message = 'HTTP ' + status;
    }

    function pad(n) {
        return (n < 10 ? '0' : '') + n;
    }

    function createEngine(deps) {
        var fflate = deps.fflate;
        var core = deps.core;
        var fetchFn = deps.fetchFn;
        var post = deps.post;
        var apiBase = deps.apiBase;
        var now = deps.now || function () { return new Date(); };
        var makeBlob = deps.makeBlob || function (chunks) { return new Blob(chunks, { type: 'application/zip' }); };
        var retryDelayMs = deps.retryDelayMs === undefined ? 500 : deps.retryDelayMs;
        var jobs = {};

        function send(type, fields) {
            var message = { fc: 1, nonce: deps.nonce, type: type };
            Object.keys(fields || {}).forEach(function (k) { message[k] = fields[k]; });
            post(message);
        }

        function wait(ms) {
            return ms > 0 ? new Promise(function (resolve) { setTimeout(resolve, ms); }) : Promise.resolve();
        }

        // Resolves to a Response-like object, or throws AuthError / Error('HTTP n').
        async function request(url) {
            var lastError;
            for (var attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                try {
                    var res = await fetchFn(url, { headers: { Authorization: 'Bearer ' + deps.sessionId } });
                    if (res.status === 401 || res.status === 403) {
                        throw new AuthError(res.status);
                    }
                    if (res.ok) {
                        return res;
                    }
                    lastError = new Error('HTTP ' + res.status);
                    if (res.status < 500) {
                        throw lastError;
                    }
                } catch (e) {
                    if (e instanceof AuthError || (e === lastError && /^HTTP 4/.test(e.message))) {
                        throw e;
                    }
                    lastError = e;
                }
                if (attempt < MAX_ATTEMPTS) {
                    await wait(retryDelayMs * attempt);
                }
            }
            throw lastError;
        }

        async function fetchBytes(row) {
            var res = await request(apiBase + row.path);
            if (row.kind === 'Note') {
                var record = await res.json();
                return fflate.strToU8(String((record && record.Body) || ''));
            }
            return new Uint8Array(await res.arrayBuffer());
        }

        // Starts small files ahead of time; a failed prefetch is surfaced when its turn comes.
        function prefetcher(rows) {
            var started = {};
            function start(i) {
                if (!started[i]) {
                    started[i] = fetchBytes(rows[i]).then(
                        function (bytes) { return { bytes: bytes }; },
                        function (error) { return { error: error }; }
                    );
                }
                return started[i];
            }
            return function (i) {
                for (var k = i + 1; k < rows.length && k < i + PREFETCH_COUNT; k++) {
                    if ((rows[k].size || 0) <= PREFETCH_MAX_BYTES && (rows[i].size || 0) <= PREFETCH_MAX_BYTES) {
                        start(k);
                    }
                }
                var mine = start(i);
                delete started[i - 1];
                return mine;
            };
        }

        function addText(zip, name, text) {
            var entry = new fflate.ZipDeflate(name, { level: 6 });
            zip.add(entry);
            entry.push(fflate.strToU8(text), true);
        }

        async function run(job) {
            var options = job.options;
            var plan = core.planParts(job.rows, options);
            var parts = plan.parts.length ? plan.parts : plan.oversized.length ? [[]] : [];
            var d = now();
            var dateStr = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
            var total = plan.parts.reduce(function (n, p) { return n + p.length; }, 0);
            var totalBytes = plan.parts.reduce(function (n, p) {
                return n + p.reduce(function (m, r) { return m + (r.size || 0); }, 0);
            }, 0);
            var done = 0;
            var bytes = 0;
            var ok = 0;
            var failed = 0;

            for (var p = 0; p < parts.length; p++) {
                var rows = parts[p];
                var isLast = p === parts.length - 1;
                var chunks = [];
                var finished;
                var whenFinished = new Promise(function (resolve, reject) { finished = { resolve: resolve, reject: reject }; });
                // eslint-disable-next-line no-loop-func
                var zip = new fflate.Zip(function (err, chunk, final) {
                    if (err) {
                        finished.reject(err);
                        return;
                    }
                    chunks.push(chunk);
                    if (final) {
                        finished.resolve();
                    }
                });
                var used = new Set(['manifest.csv', 'errors.csv']);
                var manifest = [];
                var errors = [];
                var next = prefetcher(rows);

                for (var i = 0; i < rows.length; i++) {
                    if (job.cancelled) {
                        break;
                    }
                    var row = rows[i];
                    var fileName = core.applyPattern(options.pattern, row);
                    send('progress', {
                        jobId: job.id, done: done, total: total, bytes: bytes, totalBytes: totalBytes,
                        part: p + 1, parts: parts.length, current: row.parentName + ' / ' + fileName
                    });
                    var result = await next(i);
                    if (result.error instanceof AuthError) {
                        throw result.error;
                    }
                    if (result.error) {
                        errors.push({ row: row, fileName: fileName, reason: String(result.error.message || result.error) });
                        failed += 1;
                    } else {
                        var folder = core.folderFor(options.layout, row);
                        var zipPath = core.uniquePath(folder ? folder + '/' + fileName : fileName, used);
                        var entry = core.isStored(row.ext)
                            ? new fflate.ZipPassThrough(zipPath)
                            : new fflate.ZipDeflate(zipPath, { level: 6 });
                        zip.add(entry);
                        entry.push(result.bytes, true);
                        manifest.push({ row: row, fileName: fileName, zipPath: zipPath, link: '' });
                        ok += 1;
                    }
                    done += 1;
                    bytes += row.size || 0;
                }

                if (job.cancelled) {
                    zip.terminate();
                    send('done', { jobId: job.id, ok: ok, failed: failed, oversized: plan.oversized.length, cancelled: true });
                    return;
                }

                if (isLast) {
                    plan.oversized.forEach(function (big) {
                        manifest.push({
                            row: big, fileName: core.applyPattern(options.pattern, big), zipPath: '',
                            link: deps.baseUrl + '/' + big.id
                        });
                    });
                }
                addText(zip, 'manifest.csv', core.manifestCsv(manifest));
                // Each part lists its own failures, so an earlier part is complete even if a later one stops.
                if (errors.length) {
                    addText(zip, 'errors.csv', core.errorsCsv(errors));
                }
                zip.end();
                await whenFinished;
                send('progress', {
                    jobId: job.id, done: done, total: total, bytes: bytes, totalBytes: totalBytes,
                    part: p + 1, parts: parts.length, current: ''
                });
                send('part', {
                    jobId: job.id, name: core.zipName(job.objectLabel, dateStr, p, parts.length),
                    blob: makeBlob(chunks), index: p, count: parts.length
                });
            }
            send('done', { jobId: job.id, ok: ok, failed: failed, oversized: plan.oversized.length, cancelled: false });
        }

        // Folder output: every file goes straight into a folder the user picked.
        // There is no zip, so there are no parts and no size limit per file.
        async function runFolder(job) {
            var options = job.options;
            var rows = job.rows;
            // Wait for the user to pick a folder, unless the run is cancelled first.
            var sink = await Promise.race([deps.getFolderSink(), job.cancelSignal.then(function () { return null; })]);
            if (!sink) {
                send('done', { jobId: job.id, ok: 0, failed: 0, oversized: 0, cancelled: true, folder: true });
                return;
            }
            var totalBytes = rows.reduce(function (n, r) { return n + (r.size || 0); }, 0);
            var used = new Set(['manifest.csv', 'errors.csv']);
            var manifest = [];
            var errors = [];
            var bytes = 0;
            var next = prefetcher(rows);

            for (var i = 0; i < rows.length; i++) {
                if (job.cancelled) {
                    break;
                }
                var row = rows[i];
                var fileName = core.applyPattern(options.pattern, row);
                send('progress', {
                    jobId: job.id, done: i, total: rows.length, bytes: bytes, totalBytes: totalBytes,
                    part: 1, parts: 1, current: row.parentName + ' / ' + fileName
                });
                var result = await next(i);
                if (result.error instanceof AuthError) {
                    throw result.error;
                }
                var reason = result.error ? String(result.error.message || result.error) : null;
                if (!reason) {
                    var folder = core.folderFor(options.layout, row);
                    var path = core.uniquePath(folder ? folder + '/' + fileName : fileName, used);
                    try {
                        var written = await sink.writeFile(path, result.bytes);
                        manifest.push({ row: row, fileName: fileName, zipPath: written, link: '' });
                    } catch (e) {
                        reason = String(e.message || e);
                    }
                }
                if (reason) {
                    errors.push({ row: row, fileName: fileName, reason: reason });
                }
                bytes += row.size || 0;
            }

            await sink.writeFile('manifest.csv', fflate.strToU8(core.manifestCsv(manifest)));
            if (errors.length) {
                await sink.writeFile('errors.csv', fflate.strToU8(core.errorsCsv(errors)));
            }
            send('progress', {
                jobId: job.id, done: manifest.length + errors.length, total: rows.length, bytes: bytes,
                totalBytes: totalBytes, part: 1, parts: 1, current: ''
            });
            send('done', {
                jobId: job.id, ok: manifest.length, failed: errors.length, oversized: 0,
                cancelled: job.cancelled, folder: true
            });
        }

        async function listViewIds(message) {
            var ids = [];
            try {
                var describe = await (await request(
                    apiBase + 'sobjects/' + encodeURIComponent(message.object) + '/listviews/' +
                    encodeURIComponent(message.listViewId) + '/describe'
                )).json();
                var soql = String(describe.query).replace(/^\s*SELECT\s[\s\S]*?\sFROM\s/i, 'SELECT Id FROM ');
                var url = apiBase + 'query?q=' + encodeURIComponent(soql);
                while (url) {
                    var page = await (await request(url)).json();
                    (page.records || []).forEach(function (r) { ids.push(r.Id); });
                    url = page.done ? null : page.nextRecordsUrl;
                }
                send('ids', { requestId: message.requestId, ids: ids });
            } catch (e) {
                if (e instanceof AuthError) {
                    send('fatal', { jobId: null, code: 'AUTH', message: e.message });
                } else {
                    send('ids', { requestId: message.requestId, ids: [], error: String(e.message || e) });
                }
            }
        }

        // A small API call that proves this user can reach the REST API.
        async function ping(message) {
            try {
                var limits = await (await request(apiBase + 'limits')).json();
                var daily = (limits && limits.DailyApiRequests) || {};
                send('pong', { requestId: message.requestId, ok: true, apiRemaining: daily.Remaining, apiMax: daily.Max });
            } catch (e) {
                send('pong', { requestId: message.requestId, ok: false, error: String(e.message || e) });
            }
        }

        async function handle(message) {
            if (!message || message.fc !== 1) {
                return;
            }
            if (message.type === 'ping') {
                await ping(message);
            } else if (message.type === 'listview') {
                await listViewIds(message);
            } else if (message.type === 'start') {
                jobs[message.jobId] = {
                    id: message.jobId, options: message.options, objectLabel: message.objectLabel || 'Files',
                    rows: [], cancelled: false
                };
                var started = jobs[message.jobId];
                started.cancelSignal = new Promise(function (resolve) { started.signalCancel = resolve; });
            } else if (message.type === 'rows' && jobs[message.jobId]) {
                var job = jobs[message.jobId];
                job.rows = job.rows.concat(message.rows || []);
                if (message.last) {
                    try {
                        await (job.options.output === 'folder' ? runFolder(job) : run(job));
                    } catch (e) {
                        send('fatal', {
                            jobId: job.id, code: e instanceof AuthError ? 'AUTH' : 'UNKNOWN',
                            message: String(e.message || e)
                        });
                    }
                    delete jobs[job.id];
                }
            } else if (message.type === 'cancel' && jobs[message.jobId]) {
                jobs[message.jobId].cancelled = true;
                jobs[message.jobId].signalCancel();
            }
        }

        return { handle: handle };
    }

    // Tracks which parent window origin the engine may talk to. The engine is
    // embedded from Lightning pages and from flow pages, which Salesforce
    // serves on the Visualforce domain, so more than one origin is allowed.
    function createParentLink(allowedOrigins, postFn) {
        var parent = null;
        return {
            announce: function (message) {
                allowedOrigins.forEach(function (origin) { postFn(message, origin); });
            },
            accept: function (origin) {
                if (allowedOrigins.indexOf(origin) === -1) {
                    return false;
                }
                parent = origin;
                return true;
            },
            post: function (message) {
                if (parent) {
                    postFn(message, parent);
                }
            }
        };
    }

    // Wraps a FileSystemDirectoryHandle. Never overwrites: a name that is
    // already in the folder gets " (2)", " (3)" and so on.
    function createFolderSink(root) {
        async function exists(dir, name) {
            try {
                await dir.getFileHandle(name);
                return true;
            } catch (e) {
                if (e && e.name === 'NotFoundError') {
                    return false;
                }
                throw e;
            }
        }
        return {
            writeFile: async function (path, bytes) {
                var segments = path.split('/');
                var name = segments.pop();
                var dir = root;
                for (var i = 0; i < segments.length; i++) {
                    dir = await dir.getDirectoryHandle(segments[i], { create: true });
                }
                var dot = name.lastIndexOf('.');
                var stem = dot > 0 ? name.slice(0, dot) : name;
                var ext = dot > 0 ? name.slice(dot) : '';
                var candidate = name;
                var n = 1;
                while (await exists(dir, candidate)) {
                    n += 1;
                    candidate = stem + ' (' + n + ')' + ext;
                }
                var handle = await dir.getFileHandle(candidate, { create: true });
                var writable = await handle.createWritable();
                await writable.write(bytes);
                await writable.close();
                return segments.concat(candidate).join('/');
            }
        };
    }

    return { createEngine: createEngine, createParentLink: createParentLink, createFolderSink: createFolderSink };
});
