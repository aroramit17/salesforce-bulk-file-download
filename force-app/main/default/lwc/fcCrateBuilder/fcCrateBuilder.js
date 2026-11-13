import { LightningElement, api } from 'lwc';
import getFiles from '@salesforce/apex/FcFileQueryService.getFiles';
import getSettings from '@salesforce/apex/FcSettingsService.getSettings';
import getRelatedIds from '@salesforce/apex/FcSelectionService.getRelatedIds';
import logJob from '@salesforce/apex/FcJobService.logJob';
import { filterRows, planParts, formatBytes, chunk, applyPattern, isEngineMessage, makeNonce } from 'c/fcCore';
import { LABELS, fmt } from 'c/fcLabels';

const RECORDS_PER_CALL = 200;
const CALLS_IN_FLIGHT = 3;
const ROWS_PER_MESSAGE = 500;
const MB = 1024 * 1024;
const ENGINE_START_TIMEOUT_MS = 15000;
const MAX_IDS_IN_REQUEST = 2000;

const TYPE_EXTENSIONS = {
    all: [],
    pdf: ['pdf'],
    images: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tif', 'tiff', 'webp', 'svg', 'heic'],
    office: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']
};

const SAMPLE_ROW = {
    parentName: 'Acme Corp',
    parentId: '001000000000001',
    parentObject: 'Account',
    title: 'Contract',
    ext: 'pdf',
    id: '068000000000001',
    createdDate: '2026-01-31',
    version: '1',
    isLatest: true
};

function errorText(e) {
    return (e && e.body && e.body.message) || (e && e.message) || String(e);
}

export default class FcCrateBuilder extends LightningElement {
    @api objectApiName;
    @api compact = false;
    /** Comma separated child relationship paths offered in record mode, e.g. "Contacts, Opportunities.OpportunityLineItems". */
    @api relatedPaths;
    /** Name used for the zip when the rows were handed in through presetRows. */
    @api presetLabel;
    /** What to store in the job history so the run can be repeated. */
    @api request;
    /** Options saved with an earlier run, applied on top of the org defaults. */
    @api initialOptions;

    labels = LABELS;
    // Each builder gets its own engine frame; the nonce ties the frame's messages to this builder.
    _nonce = makeNonce();
    engineUrl = '/apex/FcEngine?fc=' + this._nonce;

    phase = 'loading'; // loading | ready | running | done
    errorMessage = null;
    options = null;
    typeChoice = 'all';
    sizeChoice = '0';
    optionsOpen = false;
    rows = [];
    recordCount = null;
    related = [];
    relatedErrors = [];
    engineReady = false;
    progress = { done: 0, total: 0, bytes: 0, totalBytes: 0, current: '' };
    savedParts = [];
    result = null;

    _recordIds = [];
    _listViewId = null;
    _listViews = null;
    _presetRows = null;
    _pendingSources = [];
    _collectedIds = [];
    _currentIds = [];
    _connected = false;
    _engineOrigin = null;
    _loadToken = 0;
    _jobId = null;
    _runBytes = 0;
    _folderNonce = null;
    _folderWindow = null;
    _folderOrigin = null;
    _folderRows = null;
    folderMode = false;
    _listRequest = 0;
    _engineTimer = null;
    _onMessage = (event) => this.handleMessage(event);

    @api
    get recordIds() {
        return this._recordIds;
    }
    set recordIds(value) {
        this._recordIds = Array.isArray(value) ? value.filter(Boolean) : [];
        if (this._connected && this.options) {
            this.reload();
        }
    }

    @api
    get listViewId() {
        return this._listViewId;
    }
    set listViewId(value) {
        this._listViewId = value || null;
        if (this._connected && this.options) {
            this.reload();
        }
    }

    /** Several list views at once: [{ objectApiName, listViewId }]. */
    @api
    get listViews() {
        return this._listViews;
    }
    set listViews(value) {
        this._listViews = Array.isArray(value) && value.length ? value : null;
        if (this._connected && this.options) {
            this.reload();
        }
    }

    /** File rows loaded by the host (documents, libraries, static resources, event logs). */
    @api
    get presetRows() {
        return this._presetRows;
    }
    set presetRows(value) {
        this._presetRows = Array.isArray(value) ? value : null;
        if (this._connected && this.options) {
            this.reload();
        }
    }

    connectedCallback() {
        this._connected = true;
        window.addEventListener('message', this._onMessage);
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._engineTimer = setTimeout(() => {
            if (!this.engineReady) {
                this.errorMessage = this.labels.Engine_Error;
            }
        }, ENGINE_START_TIMEOUT_MS);
        this.init();
    }

    disconnectedCallback() {
        this._connected = false;
        window.removeEventListener('message', this._onMessage);
        clearTimeout(this._engineTimer);
        if (this._jobId) {
            this.postToEngine({ type: 'cancel', jobId: this._jobId });
        }
    }

    async init() {
        try {
            const s = await getSettings();
            this.options = {
                includeFiles: true,
                includeAttachments: s.includeAttachments !== false,
                includeNotes: s.includeNotes !== false,
                includeEnhancedNotes: s.includeNotes !== false,
                latestOnly: s.latestVersionOnly !== false,
                extensions: [],
                createdFrom: null,
                createdTo: null,
                maxSizeBytes: 0,
                layout: s.folderLayout || 'PerRecord',
                pattern: s.namePattern || '{RecordName}_{Title}.{ext}',
                maxZipBytes: (s.maxZipMb || 1500) * MB,
                maxFilesPerZip: s.maxFilesPerZip || 500
            };
            this.applyInitialOptions();
            this.reload();
        } catch (e) {
            this.fail(e);
        }
    }

    /** The list views to resolve into record Ids. */
    get sources() {
        if (this._listViews) {
            return this._listViews;
        }
        return this._listViewId ? [{ objectApiName: this.objectApiName, listViewId: this._listViewId }] : [];
    }

    applyInitialOptions() {
        const saved = this.initialOptions;
        if (!saved || typeof saved !== 'object') {
            return;
        }
        const allowed = [
            'includeFiles', 'includeAttachments', 'includeNotes', 'includeEnhancedNotes', 'latestOnly',
            'extensions', 'createdFrom', 'createdTo', 'maxSizeBytes', 'layout', 'pattern'
        ];
        const next = { ...this.options };
        allowed.forEach((key) => {
            if (saved[key] !== undefined) {
                next[key] = saved[key];
            }
        });
        this.options = next;
        const wanted = JSON.stringify((next.extensions || []).slice().sort());
        this.typeChoice = Object.keys(TYPE_EXTENSIONS).find((k) => JSON.stringify(TYPE_EXTENSIONS[k].slice().sort()) === wanted) || 'all';
        const sizeMb = String((next.maxSizeBytes || 0) / MB);
        this.sizeChoice = ['0', '10', '100', '500'].includes(sizeMb) ? sizeMb : '0';
    }

    reload() {
        this.errorMessage = null;
        this.recordCount = null;
        this.related = [];
        this.relatedErrors = [];
        if (this._presetRows) {
            this._loadToken += 1;
            this._currentIds = [];
            this.rows = this._presetRows;
            this.phase = 'ready';
        } else if (this.sources.length) {
            this.phase = 'loading';
            this._loadToken += 1;
            this._pendingSources = this.sources.slice();
            this._collectedIds = [];
            this.requestListView();
        } else {
            this._currentIds = this._recordIds;
            this.loadRows();
            this.loadRelated();
        }
    }

    requestListView() {
        if (this.engineReady && this._pendingSources.length) {
            const source = this._pendingSources[0];
            this._listRequest += 1;
            this.postToEngine({
                type: 'listview',
                requestId: 'r' + this._listRequest,
                object: source.objectApiName,
                listViewId: source.listViewId
            });
        }
    }

    async loadRelated() {
        const paths = String(this.relatedPaths || '')
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean);
        if (!paths.length || this._recordIds.length !== 1) {
            return;
        }
        const recordId = this._recordIds[0];
        try {
            const result = await getRelatedIds({ recordId, paths });
            if (this._recordIds[0] !== recordId) {
                return;
            }
            const byPath = result.byPath || {};
            this.related = Object.keys(byPath).map((path) => ({
                path,
                ids: byPath[path],
                checked: false,
                label: fmt(this.labels.Related_Count, path, byPath[path].length)
            }));
            this.relatedErrors = result.errors || [];
        } catch (e) {
            this.relatedErrors = [errorText(e)];
        }
    }

    handleRelated(event) {
        const path = event.target.dataset.related;
        const checked = event.target.checked;
        this.related = this.related.map((r) => (r.path === path ? { ...r, checked } : r));
        const ids = this._recordIds.slice();
        this.related.filter((r) => r.checked).forEach((r) => ids.push(...r.ids));
        this._currentIds = Array.from(new Set(ids));
        this.loadRows();
    }

    async loadRows() {
        const token = ++this._loadToken;
        const ids = this._currentIds;
        if (!ids.length) {
            this.rows = [];
            this.phase = 'ready';
            return;
        }
        this.phase = 'loading';
        try {
            const batches = chunk(ids, RECORDS_PER_CALL);
            let rows = [];
            for (let i = 0; i < batches.length; i += CALLS_IN_FLIGHT) {
                // eslint-disable-next-line no-await-in-loop
                const results = await Promise.all(
                    batches
                        .slice(i, i + CALLS_IN_FLIGHT)
                        .map((recordIds) => getFiles({ recordIds, latestOnly: this.options.latestOnly }))
                );
                if (token !== this._loadToken) {
                    return;
                }
                results.forEach((r) => {
                    rows = rows.concat(r || []);
                });
            }
            this.rows = rows;
            this.phase = 'ready';
        } catch (e) {
            if (token === this._loadToken) {
                this.fail(e);
            }
        }
    }

    fail(e) {
        this.errorMessage = this.labels.Error + ' ' + errorText(e);
    }

    // ---- engine messaging -------------------------------------------------

    get engineFrame() {
        return this.template.querySelector('iframe');
    }

    isFromEngine(event) {
        const frame = this.engineFrame;
        return isEngineMessage({
            host: window.location.host,
            origin: event.origin,
            sourceMatches: Boolean(frame) && event.source === frame.contentWindow
        });
    }

    postToEngine(message) {
        const frame = this.engineFrame;
        if (frame && frame.contentWindow && this._engineOrigin) {
            frame.contentWindow.postMessage({ fc: 1, ...message }, this._engineOrigin);
        }
    }

    handleMessage(event) {
        const data = event.data;
        if (!data || data.fc !== 1) {
            return;
        }
        if (this._folderNonce && data.nonce === this._folderNonce) {
            this.handleFolderMessage(event, data);
            return;
        }
        if (data.nonce !== this._nonce || !this.isFromEngine(event)) {
            return;
        }
        if (data.type === 'ready') {
            this._engineOrigin = event.origin;
            this.engineReady = true;
            clearTimeout(this._engineTimer);
            if (this.phase === 'loading') {
                this.requestListView();
            }
        } else if (data.type === 'ids') {
            if (data.requestId !== 'r' + this._listRequest) {
                return; // answer to a list view the user has since moved away from
            }
            if (data.error) {
                this.fail(data.error);
            } else {
                this._collectedIds = this._collectedIds.concat(data.ids || []);
                this._pendingSources = this._pendingSources.slice(1);
                if (this._pendingSources.length) {
                    this.requestListView();
                } else {
                    this._currentIds = Array.from(new Set(this._collectedIds));
                    this.recordCount = this._currentIds.length;
                    this.loadRows();
                }
            }
        } else if (data.type === 'fatal') {
            this._jobId = null;
            this.errorMessage = data.code === 'AUTH' ? this.labels.Auth_Error : this.labels.Error + ' ' + data.message;
        } else if (data.jobId && data.jobId === this._jobId) {
            this.handleJobMessage(data);
        }
    }

    handleJobMessage(data) {
        if (data.type === 'progress') {
            this.progress = data;
        } else if (data.type === 'part') {
            this.saveBlob(data.name, data.blob);
            this.savedParts = this.savedParts.concat([{ name: data.name, sizeText: formatBytes(data.blob.size) }]);
        } else if (data.type === 'done') {
            this._jobId = null;
            this.result = data;
            this.phase = 'done';
            this.logRun(data);
        }
    }

    /** Records the run in the job history. A logging problem never gets in the way of the download. */
    logRun(result) {
        const request = this.request || {
            mode: 'records',
            objectApiName: this.objectApiName,
            recordIds: this._currentIds.slice(0, MAX_IDS_IN_REQUEST)
        };
        const options = { ...this.options };
        delete options.maxZipBytes;
        delete options.maxFilesPerZip;
        let status = 'Done';
        if (result.cancelled) {
            status = 'Cancelled';
        } else if (result.failed) {
            status = 'Partial';
        }
        const job = {
            status,
            sourceType: request.mode,
            objectApiName: request.objectApiName || this.objectApiName || null,
            destination: result.folder ? 'Folder' : 'Browser',
            recordCount: this._presetRows ? null : this._currentIds.length,
            fileCount: result.ok,
            totalBytes: this._runBytes,
            request: JSON.stringify({ ...request, options }),
            error: null
        };
        Promise.resolve()
            .then(() => logJob({ job }))
            .catch(() => {});
    }

    saveBlob(name, blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    // ---- option handlers ---------------------------------------------------

    setOption(key, value) {
        this.options = { ...this.options, [key]: value };
    }

    handleCheck(event) {
        this.setOption(event.target.dataset.option, event.target.checked);
    }

    handleValue(event) {
        const value = event.detail && event.detail.value !== undefined ? event.detail.value : event.target.value;
        this.setOption(event.target.dataset.option, value === '' ? null : value);
    }

    handleType(event) {
        this.typeChoice = event.detail.value;
        this.setOption('extensions', TYPE_EXTENSIONS[this.typeChoice] || []);
    }

    handleSize(event) {
        this.sizeChoice = event.detail.value;
        this.setOption('maxSizeBytes', Number(this.sizeChoice) * MB);
    }

    handleLatest(event) {
        this.setOption('latestOnly', event.target.checked);
        this.loadRows();
    }

    handleToggleOptions() {
        this.optionsOpen = !this.optionsOpen;
    }

    handleDownload() {
        const rows = this.filteredRows;
        if (!rows.length || !this.engineReady) {
            return;
        }
        this.folderMode = false;
        this.beginRun(rows);
        this.sendJob((message) => this.postToEngine(message), rows, 'zip');
    }

    /** Folder output runs in its own window, because browsers block the folder picker inside an embedded frame. */
    handleFolder() {
        const rows = this.filteredRows;
        if (!rows.length) {
            return;
        }
        this._folderNonce = makeNonce();
        const opened = window.open('/apex/FcEngine?fc=' + this._folderNonce + '&mode=folder', '_blank');
        if (!opened) {
            this._folderNonce = null;
            this.errorMessage = this.labels.Popup_Blocked;
            return;
        }
        this._folderWindow = opened;
        this._folderOrigin = null;
        this._folderRows = rows;
        this.folderMode = true;
        this.beginRun(rows);
    }

    handleFolderMessage(event, data) {
        const trusted = isEngineMessage({
            host: window.location.host,
            origin: event.origin,
            sourceMatches: event.source === this._folderWindow
        });
        if (!trusted) {
            return;
        }
        if (data.type === 'ready') {
            if (this._folderOrigin) {
                return; // the job has already been handed over
            }
            this._folderOrigin = event.origin;
            this.sendJob((message) => this.postToFolder(message), this._folderRows, 'folder');
        } else if (data.type === 'fatal') {
            this._jobId = null;
            this.errorMessage = data.code === 'AUTH' ? this.labels.Auth_Error : this.labels.Error + ' ' + data.message;
        } else if (data.jobId && data.jobId === this._jobId) {
            this.handleJobMessage(data);
        }
    }

    postToFolder(message) {
        if (this._folderWindow && this._folderOrigin) {
            this._folderWindow.postMessage({ fc: 1, ...message }, this._folderOrigin);
        }
    }

    beginRun(rows) {
        this._jobId = 'job' + Date.now();
        this.savedParts = [];
        this.result = null;
        this.progress = { done: 0, total: rows.length, bytes: 0, totalBytes: this.totalBytes, current: '' };
        this._runBytes = this.totalBytes;
        this.phase = 'running';
    }

    sendJob(post, rows, output) {
        post({
            type: 'start',
            jobId: this._jobId,
            objectLabel: this.presetLabel || this.objectApiName || (this._listViews ? 'Files' : rows[0].parentObject),
            options: {
                output,
                layout: this.options.layout,
                pattern: this.options.pattern || '',
                maxZipBytes: this.options.maxZipBytes,
                maxFilesPerZip: this.options.maxFilesPerZip
            }
        });
        const pages = chunk(rows, ROWS_PER_MESSAGE);
        pages.forEach((page, i) => {
            // Plain copies, so the message never carries framework proxies.
            post({ type: 'rows', jobId: this._jobId, rows: JSON.parse(JSON.stringify(page)), last: i === pages.length - 1 });
        });
    }

    handleCancel() {
        if (this._jobId) {
            const message = { type: 'cancel', jobId: this._jobId };
            if (this.folderMode) {
                this.postToFolder(message);
            } else {
                this.postToEngine(message);
            }
        }
    }

    handleStartOver() {
        this.errorMessage = null;
        this.result = null;
        this.savedParts = [];
        this._jobId = null;
        if (!this.options) {
            this.phase = 'loading';
            this.init();
            return;
        }
        this.phase = 'ready';
        if (!this.rows.length) {
            this.reload();
        }
    }

    // ---- view state -------------------------------------------------------

    get isLoading() {
        return this.phase === 'loading';
    }
    get isRunning() {
        return this.phase === 'running';
    }
    get isDone() {
        return this.phase === 'done';
    }
    get noRecords() {
        return this.phase === 'ready' && !this._presetRows && !this.sources.length && !this._currentIds.length;
    }
    get canSaveToFolder() {
        return typeof window.showDirectoryPicker === 'function';
    }
    get runNote() {
        return this.folderMode ? this.labels.Folder_Window : this.labels.Keep_Open;
    }
    get showLatest() {
        return !this._presetRows;
    }
    get hasRelated() {
        return this.related.length > 0;
    }
    get relatedErrorText() {
        return this.relatedErrors.length ? this.relatedErrors.join(' ') : null;
    }
    get showOptions() {
        return !this.compact || this.optionsOpen;
    }
    get previewColumnClass() {
        return this.showOptions
            ? 'slds-col slds-size_1-of-1 slds-large-size_5-of-12'
            : 'slds-col slds-size_1-of-1';
    }
    get optionsToggleLabel() {
        return this.optionsOpen ? this.labels.Fewer_Options : this.labels.More_Options;
    }

    get filteredRows() {
        return this.options ? filterRows(this.rows, this.options) : [];
    }
    get plan() {
        return planParts(this.filteredRows, this.options);
    }
    get fileCount() {
        return this.filteredRows.length;
    }
    get totalBytes() {
        return this.filteredRows.reduce((n, r) => n + (r.size || 0), 0);
    }
    get totalSizeText() {
        return formatBytes(this.totalBytes);
    }
    get noFiles() {
        return this.fileCount === 0;
    }
    get kindCounts() {
        const rows = this.filteredRows;
        return [
            ['File', this.labels.Files],
            ['Attachment', this.labels.Attachments],
            ['Note', this.labels.Notes],
            ['EnhancedNote', this.labels.Enhanced_Notes]
        ].map(([kind, label]) => ({ label, count: rows.filter((r) => r.kind === kind).length }));
    }
    get recordCountText() {
        return this.recordCount === null ? null : fmt(this.labels.Records_Found, this.recordCount);
    }
    get partsNotice() {
        const count = this.plan.parts.length;
        return count > 1 ? fmt(this.labels.Parts_Notice, count) : null;
    }
    get oversizedNotice() {
        const count = this.plan.oversized.length;
        return count ? fmt(this.labels.Oversized_Notice, count) : null;
    }
    get downloadLabel() {
        return fmt(this.labels.Download, this.fileCount);
    }
    get downloadDisabled() {
        return this.noFiles || !this.engineReady;
    }
    get engineWaiting() {
        return !this.engineReady && !this.noFiles;
    }
    get exampleName() {
        return applyPattern(this.options.pattern, SAMPLE_ROW);
    }

    get typeOptions() {
        return [
            { label: this.labels.All_Types, value: 'all' },
            { label: this.labels.Type_Pdf, value: 'pdf' },
            { label: this.labels.Type_Images, value: 'images' },
            { label: this.labels.Type_Office, value: 'office' }
        ];
    }
    get sizeOptions() {
        return [
            { label: this.labels.No_Limit, value: '0' },
            { label: '10 MB', value: '10' },
            { label: '100 MB', value: '100' },
            { label: '500 MB', value: '500' }
        ];
    }
    get layoutOptions() {
        return [
            { label: this.labels.Layout_Record, value: 'PerRecord' },
            { label: this.labels.Layout_Object, value: 'PerObject' },
            { label: this.labels.Layout_Flat, value: 'Flat' }
        ];
    }

    get progressFilesText() {
        return fmt(this.labels.Progress, this.progress.done, this.progress.total);
    }
    get progressBytesText() {
        return fmt(this.labels.Progress_Bytes, formatBytes(this.progress.bytes), formatBytes(this.progress.totalBytes));
    }
    get progressPercent() {
        return this.progress.total ? Math.round((this.progress.done / this.progress.total) * 100) : 0;
    }
    get doneText() {
        if (!this.result) {
            return '';
        }
        if (this.result.cancelled) {
            return this.labels.Cancelled;
        }
        return fmt(this.result.folder ? this.labels.Done_Folder : this.labels.Done, this.result.ok);
    }
    get doneWarning() {
        const notes = [];
        if (this.result && this.result.failed) {
            notes.push(fmt(this.labels.Done_Failed, this.result.failed));
        }
        if (this.result && this.result.oversized) {
            notes.push(fmt(this.labels.Oversized_Notice, this.result.oversized));
        }
        return notes.length ? notes.join(' ') : null;
    }
}
