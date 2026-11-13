import { LightningElement, api } from 'lwc';
import getFiles from '@salesforce/apex/FcFileQueryService.getFiles';
import getSettings from '@salesforce/apex/FcSettingsService.getSettings';
import { filterRows, planParts, formatBytes, chunk, applyPattern } from 'c/fcCore';
import { LABELS, fmt } from 'c/fcLabels';

const RECORDS_PER_CALL = 200;
const CALLS_IN_FLIGHT = 3;
const ROWS_PER_MESSAGE = 500;
const MB = 1024 * 1024;

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

    labels = LABELS;
    engineUrl = '/apex/FcEngine';

    phase = 'loading'; // loading | ready | running | done
    errorMessage = null;
    options = null;
    typeChoice = 'all';
    sizeChoice = '0';
    optionsOpen = false;
    rows = [];
    recordCount = null;
    engineReady = false;
    progress = { done: 0, total: 0, bytes: 0, totalBytes: 0, current: '' };
    savedParts = [];
    result = null;

    _recordIds = [];
    _listViewId = null;
    _currentIds = [];
    _connected = false;
    _engineOrigin = null;
    _loadToken = 0;
    _jobId = null;
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

    connectedCallback() {
        this._connected = true;
        window.addEventListener('message', this._onMessage);
        this.init();
    }

    disconnectedCallback() {
        this._connected = false;
        window.removeEventListener('message', this._onMessage);
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
            this.reload();
        } catch (e) {
            this.fail(e);
        }
    }

    reload() {
        this.errorMessage = null;
        this.recordCount = null;
        if (this._listViewId) {
            this.phase = 'loading';
            this._loadToken += 1;
            this.requestListView();
        } else {
            this._currentIds = this._recordIds;
            this.loadRows();
        }
    }

    requestListView() {
        if (this.engineReady && this._listViewId) {
            this.postToEngine({ type: 'listview', object: this.objectApiName, listViewId: this._listViewId });
        }
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

    /** The org's Visualforce origin, derived from the Lightning host. Null outside Lightning. */
    get expectedEngineOrigin() {
        const host = window.location.host;
        const marker = '.lightning.force.com';
        if (!host.endsWith(marker)) {
            return null;
        }
        const domain = host.slice(0, -marker.length);
        const dot = domain.indexOf('.');
        const first = dot === -1 ? domain : domain.slice(0, dot);
        const rest = dot === -1 ? '' : domain.slice(dot);
        return 'https://' + first + '--c' + rest + '.vf.force.com';
    }

    isFromEngine(event) {
        const frame = this.engineFrame;
        if (frame && event.source === frame.contentWindow) {
            return true;
        }
        const expected = this.expectedEngineOrigin;
        return expected !== null && event.origin === expected;
    }

    postToEngine(message) {
        const frame = this.engineFrame;
        if (frame && frame.contentWindow && this._engineOrigin) {
            frame.contentWindow.postMessage({ fc: 1, ...message }, this._engineOrigin);
        }
    }

    handleMessage(event) {
        const data = event.data;
        if (!data || data.fc !== 1 || !this.isFromEngine(event)) {
            return;
        }
        if (data.type === 'ready') {
            this._engineOrigin = event.origin;
            this.engineReady = true;
            if (this._listViewId && this.phase === 'loading') {
                this.requestListView();
            }
        } else if (data.type === 'ids') {
            if (data.error) {
                this.fail(data.error);
            } else {
                this._currentIds = data.ids || [];
                this.recordCount = this._currentIds.length;
                this.loadRows();
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
        }
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
        this._jobId = 'job' + Date.now();
        this.savedParts = [];
        this.result = null;
        this.progress = { done: 0, total: rows.length, bytes: 0, totalBytes: this.totalBytes, current: '' };
        this.phase = 'running';
        this.postToEngine({
            type: 'start',
            jobId: this._jobId,
            objectLabel: this.objectApiName || rows[0].parentObject,
            options: {
                layout: this.options.layout,
                pattern: this.options.pattern || '',
                maxZipBytes: this.options.maxZipBytes,
                maxFilesPerZip: this.options.maxFilesPerZip
            }
        });
        const pages = chunk(rows, ROWS_PER_MESSAGE);
        pages.forEach((page, i) => {
            // Plain copies, so the message never carries framework proxies.
            this.postToEngine({
                type: 'rows',
                jobId: this._jobId,
                rows: JSON.parse(JSON.stringify(page)),
                last: i === pages.length - 1
            });
        });
    }

    handleCancel() {
        if (this._jobId) {
            this.postToEngine({ type: 'cancel', jobId: this._jobId });
        }
    }

    handleStartOver() {
        this.errorMessage = null;
        this.result = null;
        this.savedParts = [];
        this._jobId = null;
        this.phase = 'ready';
        if (!this.options) {
            this.init();
        } else if (!this.rows.length) {
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
        return this.phase === 'ready' && !this._listViewId && !this._currentIds.length;
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
        return this.result.cancelled ? this.labels.Cancelled : fmt(this.labels.Done, this.result.ok);
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
