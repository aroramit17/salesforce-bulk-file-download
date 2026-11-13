import { LightningElement } from 'lwc';
import getObjects from '@salesforce/apex/FcRecordService.getObjects';
import getListViews from '@salesforce/apex/FcRecordService.getListViews';
import searchRecords from '@salesforce/apex/FcSelectionService.searchRecords';
import runQuery from '@salesforce/apex/FcSelectionService.runQuery';
import canRunSoql from '@salesforce/apex/FcSelectionService.canRunSoql';
import getDocumentFolders from '@salesforce/apex/FcOrgFileService.getDocumentFolders';
import getDocuments from '@salesforce/apex/FcOrgFileService.getDocuments';
import getLibraries from '@salesforce/apex/FcOrgFileService.getLibraries';
import getLibraryFiles from '@salesforce/apex/FcOrgFileService.getLibraryFiles';
import getStaticResources from '@salesforce/apex/FcOrgFileService.getStaticResources';
import getEventLogFiles from '@salesforce/apex/FcOrgFileService.getEventLogFiles';
import { LABELS, fmt } from 'c/fcLabels';

const ALL_FOLDERS = 'all';
const ORG_LABELS = { documents: 'Documents', library: 'Library', staticresources: 'StaticResources', eventlogs: 'EventLogs' };

function errorText(e) {
    return (e && e.body && e.body.message) || (e && e.message) || String(e);
}

/**
 * The FileCrate tab. Five ways to choose what to download: list views (from
 * several objects), a name search, a SOQL query, org-wide file sources, and
 * the history of earlier runs.
 */
export default class FcCrateTab extends LightningElement {
    labels = LABELS;
    mode = 'listviews';
    errorMessage = null;
    soqlAllowed = false;
    objects = [];
    initialOptions = null;

    // list views
    objectApiName = null;
    listViews = [];
    listViewsLoaded = false;
    listViewChoice = null;
    selections = [];

    // search
    searchObject = null;
    searchTerm = '';
    searchResults = null;
    searchTruncated = null;
    selectedIds = [];
    searchRequest = null;
    searchColumns = [{ label: LABELS.Name, fieldName: 'name' }];

    // soql
    soqlText = '';
    soqlIds = null;
    soqlRequest = null;

    // org files
    orgSource = 'documents';
    folders = [];
    libraries = [];
    orgFolder = ALL_FOLDERS;
    orgLibrary = null;
    orgEventType = '';
    orgFrom = null;
    orgTo = null;
    orgRows = null;
    orgRequest = null;
    orgLabel = null;

    connectedCallback() {
        this.load(async () => {
            this.objects = await getObjects();
        });
        canRunSoql()
            .then((allowed) => {
                this.soqlAllowed = allowed === true;
            })
            .catch(() => {});
    }

    async load(work) {
        this.errorMessage = null;
        try {
            await work();
        } catch (e) {
            this.errorMessage = this.labels.Error + ' ' + errorText(e);
        }
    }

    // ---- mode ---------------------------------------------------------------

    get modeOptions() {
        const options = [
            { label: this.labels.Mode_List_Views, value: 'listviews' },
            { label: this.labels.Mode_Search, value: 'search' }
        ];
        if (this.soqlAllowed) {
            options.push({ label: this.labels.Mode_Soql, value: 'soql' });
        }
        options.push({ label: this.labels.Mode_Org_Files, value: 'orgfiles' }, { label: this.labels.Mode_History, value: 'history' });
        return options;
    }

    handleMode(event) {
        this.setMode(event.detail.value);
        this.initialOptions = null;
    }

    setMode(mode) {
        this.mode = mode;
        this.errorMessage = null;
        if (mode === 'orgfiles') {
            this.loadOrgPickers();
        }
    }

    get isListViews() {
        return this.mode === 'listviews';
    }
    get isSearch() {
        return this.mode === 'search';
    }
    get isSoql() {
        return this.mode === 'soql';
    }
    get isOrgFiles() {
        return this.mode === 'orgfiles';
    }
    get isHistory() {
        return this.mode === 'history';
    }

    // ---- list views ---------------------------------------------------------

    handleObject(event) {
        const chosen = event.detail.value;
        this.objectApiName = chosen;
        this.listViewChoice = null;
        this.listViews = [];
        this.listViewsLoaded = false;
        this.load(async () => {
            const views = await getListViews({ objectApiName: chosen });
            if (this.objectApiName === chosen) {
                this.listViews = views;
                this.listViewsLoaded = true;
            }
        });
    }

    handleListView(event) {
        const listViewId = event.detail.value;
        const view = this.listViews.find((v) => v.value === listViewId);
        const object = this.objects.find((o) => o.value === this.objectApiName);
        if (view && !this.selections.some((s) => s.listViewId === listViewId)) {
            this.selections = this.selections.concat([
                {
                    objectApiName: this.objectApiName,
                    listViewId,
                    label: (object ? object.label : this.objectApiName) + ': ' + view.label
                }
            ]);
        }
        this.listViewChoice = null;
    }

    handleRemoveSelection(event) {
        const listViewId = event.target.dataset.selection;
        this.selections = this.selections.filter((s) => s.listViewId !== listViewId);
    }

    get noListViews() {
        return this.listViewsLoaded && !this.listViews.length;
    }
    get listViewDisabled() {
        return !this.listViews.length;
    }
    get hasSelections() {
        return this.selections.length > 0;
    }
    /** The object name for the zip, when every selected list view is on the same object. */
    get selectionObject() {
        const names = Array.from(new Set(this.selections.map((s) => s.objectApiName)));
        return names.length === 1 ? names[0] : undefined;
    }
    get listViewRequest() {
        return { mode: 'listviews', objectApiName: this.selectionObject, listViews: this.selections };
    }

    // ---- search -------------------------------------------------------------

    handleSearchObject(event) {
        this.searchObject = event.detail.value;
        this.searchResults = null;
        this.selectedIds = [];
    }

    handleSearchTerm(event) {
        this.searchTerm = event.detail.value;
    }

    handleSearch() {
        const objectApiName = this.searchObject;
        const term = this.searchTerm;
        this.selectedIds = [];
        this.searchedTerm = term;
        this.searchTruncated = null;
        this.load(async () => {
            const result = await searchRecords({ objectApiName, term });
            if (this.searchObject !== objectApiName) {
                return; // the user has moved to another object since
            }
            this.searchResults = result.records || [];
            this.searchTruncated = result.truncated ? fmt(this.labels.Search_Truncated, this.searchResults.length) : null;
        });
    }

    handleSearchSelection(event) {
        this.selectedIds = event.detail.selectedRows.map((row) => row.id);
        this.searchRequest = {
            mode: 'search',
            objectApiName: this.searchObject,
            term: this.searchedTerm,
            recordIds: this.selectedIds
        };
    }

    get searchDisabled() {
        return !this.searchObject || !this.searchTerm || this.searchTerm.trim().length < 2;
    }
    get hasSearchResults() {
        return Array.isArray(this.searchResults) && this.searchResults.length > 0;
    }
    get searchEmpty() {
        return Array.isArray(this.searchResults) && this.searchResults.length === 0;
    }
    get hasSelectedIds() {
        return this.selectedIds.length > 0;
    }

    // ---- SOQL ---------------------------------------------------------------

    handleSoqlText(event) {
        this.soqlText = event.detail.value;
    }

    handleSoqlRun() {
        const soql = this.soqlText;
        this.soqlIds = null;
        return this.load(async () => {
            const ids = await runQuery({ soql });
            this.soqlRequest = { mode: 'soql', objectApiName: this.soqlObject, soql };
            this.soqlIds = ids;
        });
    }

    get soqlObject() {
        const match = /\bfrom\s+([a-z0-9_]+)/i.exec(this.soqlText || '');
        return match ? match[1] : undefined;
    }
    get soqlDisabled() {
        return !this.soqlText || !this.soqlText.trim();
    }

    // ---- org files ----------------------------------------------------------

    async loadOrgPickers() {
        if (this.folders.length || this.libraries.length) {
            return;
        }
        await this.load(async () => {
            const [folders, libraries] = await Promise.all([getDocumentFolders(), getLibraries()]);
            this.folders = folders || [];
            this.libraries = libraries || [];
        });
    }

    get orgSourceOptions() {
        return [
            { label: this.labels.Org_Documents, value: 'documents' },
            { label: this.labels.Org_Library, value: 'library' },
            { label: this.labels.Org_Static, value: 'staticresources' },
            { label: this.labels.Org_Event_Logs, value: 'eventlogs' }
        ];
    }
    get folderOptions() {
        return [{ label: this.labels.Org_All_Folders, value: ALL_FOLDERS }].concat(this.folders);
    }
    get isDocuments() {
        return this.orgSource === 'documents';
    }
    get isLibrary() {
        return this.orgSource === 'library';
    }
    get isEventLogs() {
        return this.orgSource === 'eventlogs';
    }
    get orgLoadDisabled() {
        return this.isLibrary && !this.orgLibrary;
    }

    handleOrgSource(event) {
        this.orgSource = event.detail.value;
        this.orgRows = null;
        this.errorMessage = null;
    }

    handleOrgValue(event) {
        const value = event.detail.value;
        this[event.target.dataset.org] = value === '' ? null : value;
    }

    handleOrgLoad() {
        const source = this.orgSource;
        const request = { mode: 'orgfiles', source };
        this.orgRows = null;
        return this.load(async () => {
            let rows;
            if (source === 'documents') {
                request.folderId = this.orgFolder === ALL_FOLDERS ? null : this.orgFolder;
                rows = await getDocuments({ folderId: request.folderId });
            } else if (source === 'library') {
                request.libraryId = this.orgLibrary;
                rows = await getLibraryFiles({ libraryId: request.libraryId });
            } else if (source === 'staticresources') {
                rows = await getStaticResources();
            } else {
                request.eventType = this.orgEventType || null;
                request.fromDate = this.orgFrom;
                request.toDate = this.orgTo;
                rows = await getEventLogFiles({ eventType: request.eventType, fromDate: request.fromDate, toDate: request.toDate });
            }
            this.orgRequest = request;
            this.orgLabel = ORG_LABELS[source];
            this.orgRows = rows || [];
        });
    }

    // ---- history ------------------------------------------------------------

    /** Puts the tab back into the state of an earlier run. */
    handleRerun(event) {
        // The request comes from a stored row that another user may have written,
        // so every part of it is checked before it is used, and nothing runs by itself.
        const request = event.detail.request || {};
        const text = (value) => (typeof value === 'string' ? value : null);
        const options = request.options;
        this.initialOptions = options && typeof options === 'object' && !Array.isArray(options) ? options : null;
        if (request.mode === 'listviews') {
            this.selections = (Array.isArray(request.listViews) ? request.listViews : [])
                .filter((v) => v && typeof v === 'object' && text(v.objectApiName) && text(v.listViewId))
                .map((v) => ({ objectApiName: v.objectApiName, listViewId: v.listViewId, label: text(v.label) || v.objectApiName }));
            this.setMode('listviews');
        } else if (request.mode === 'soql') {
            // Filled in for the user to read and run; never run automatically.
            this.soqlText = text(request.soql) || '';
            this.soqlIds = null;
            this.setMode('soql');
        } else if (request.mode === 'orgfiles') {
            this.orgSource = ORG_LABELS[request.source] ? request.source : 'documents';
            this.orgFolder = text(request.folderId) || ALL_FOLDERS;
            this.orgLibrary = text(request.libraryId);
            this.orgEventType = text(request.eventType) || '';
            this.orgFrom = text(request.fromDate);
            this.orgTo = text(request.toDate);
            this.setMode('orgfiles');
            this.handleOrgLoad();
        } else {
            // Runs that started from explicit records: a search, a record page or a list button.
            const ids = Array.isArray(request.recordIds) ? request.recordIds.filter((id) => text(id)) : [];
            const tooMany = request.recordIdsTruncated === true;
            this.searchObject = text(request.objectApiName);
            this.searchTerm = text(request.term) || '';
            this.searchedTerm = this.searchTerm;
            this.searchResults = null;
            this.searchTruncated = null;
            this.selectedIds = tooMany ? [] : ids;
            this.searchRequest = { mode: 'search', objectApiName: this.searchObject, term: this.searchTerm, recordIds: this.selectedIds };
            this.setMode('search');
            if (tooMany) {
                this.errorMessage = this.labels.Rerun_Truncated;
            }
        }
    }
}
